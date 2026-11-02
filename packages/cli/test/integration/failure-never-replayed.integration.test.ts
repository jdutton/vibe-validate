/**
 * End-to-end guards for the greens-only cache and validation levels.
 *
 * Only a PASS is ever served from cache. A failure is recorded (for history,
 * `--retry-failed` and flakiness detection) but never replayed, so a failure
 * whose cause the cache key cannot see - an IGNORED path (issue #169), or a
 * machine starved enough to time a test out - cannot stick to a tree.
 *
 * WHY THESE ARE INTEGRATION TESTS, NOT UNIT TESTS
 *
 * The unit tests drive the cache lookup through a mocked history note. Only a
 * real scratch repository proves the whole chain: the runner records a run in
 * real git notes, the next command reads that note back, and a step either
 * really runs (its log grows) or really does not.
 */

import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { mkdirSyncReal } from '@vibe-validate/utils';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
  cleanupTestDir,
  executeVibeValidateCommand,
  setupTestGitRepo,
} from '../helpers/cli-execution-helpers.js';

/** Several CLI spawns per test; generous so a loaded machine cannot time them out */
const TEST_TIMEOUT_MS = 120_000;

/** Appends one line per real execution, so a cache hit is distinguishable from a run. */
function loggingScript(log: string): string {
  return String.raw`const fs = require('node:fs');
fs.appendFileSync('${log}', 'ran\n');
`;
}

/**
 * Fails while an IGNORED directory exists — the issue #169 shape. It reports in
 * ESLint's format with a 0:0 position (ESLint prints one for a file-level
 * problem), which once made the recorded run unreadable and let an older pass
 * answer past it.
 */
const STRAY_JS = String.raw`const fs = require('node:fs');
fs.appendFileSync('stray-runs.log', 'ran\n');
if (fs.existsSync('.pytest_cache')) {
  console.log('/repo/.pytest_cache');
  console.log('  0:0  error  stray .pytest_cache/ found at repo root  no-stray');
  console.log('');
  console.log('✖ 1 problem (1 error, 0 warnings)');
  process.exit(1);
}
`;

const CONFIG = `validation:
  phases:
    - name: Checks
      parallel: false
      steps:
        - name: Expensive Suite
          command: node expensive.js
        - name: Stray File Check
          command: node stray.js
git:
  mainBranch: main
hooks:
  preCommit:
    enabled: true
    secretScanning:
      enabled: false
`;

const LEVELS_CONFIG = `validation:
  levels: [commit, full]
  phases:
    - name: Checks
      parallel: false
      steps:
        - name: Commit Step
          level: commit
          command: node commit-step.js
        - name: Full Step
          level: full
          command: node full-step.js
git:
  mainBranch: main
hooks:
  preCommit:
    enabled: true
    secretScanning:
      enabled: false
`;

// The scratch repo has no lock file; that gate is unrelated to what is under test.
const ENV = { VV_SKIP_DEPENDENCY_CHECK: '1' };

/** Every phrase the deleted replayed-failure presentation printed */
const REPLAY_WORDING = ['not re-run just now', 'Replayed from', 'Validation failed for this code'];

function countRuns(dir: string, log: string): number {
  const path = join(dir, log);
  if (!existsSync(path)) return 0;
  return readFileSync(path, 'utf8').split('\n').filter(Boolean).length;
}

function expectNoReplayWording(output: string): void {
  for (const phrase of REPLAY_WORDING) {
    expect(output).not.toContain(phrase);
  }
}

describe('a recorded failure is never replayed (issue #169)', () => {
  let testDir: string;

  const runs = (log: string): number => countRuns(testDir, log);
  const vv = (args: string[], env: Record<string, string> = ENV) =>
    executeVibeValidateCommand(args, { cwd: testDir, env, timeout: TEST_TIMEOUT_MS });

  const ignoredDir = () => join(testDir, '.pytest_cache');
  const createIgnoredCause = (): void => {
    mkdirSyncReal(ignoredDir(), { recursive: true });
    writeFileSync(join(ignoredDir(), 'junk.txt'), 'x');
  };
  const removeIgnoredCause = (): void => rmSync(ignoredDir(), { recursive: true, force: true });

  /**
   * Record a FAILURE against the current tree hash whose cause (an ignored
   * path the tree hash cannot see) is then removed. No pass is recorded first,
   * so nothing on this tree can answer from cache.
   */
  const seedFailureWithRemovedCause = async (): Promise<void> => {
    createIgnoredCause();
    const seeded = await vv(['validate']);
    expect(seeded.exitCode, 'the seed run must record a failure').toBe(1);
    removeIgnoredCause();
  };

  beforeEach(() => {
    testDir = setupTestGitRepo('vv-never-replayed-', {
      files: {
        'expensive.js': loggingScript('expensive-runs.log'),
        'stray.js': STRAY_JS,
        'vibe-validate.config.yaml': CONFIG,
        '.gitignore': '.pytest_cache/\n*-runs.log\n',
        'README.md': '# failure never replayed test\n',
      },
    });
  });

  afterEach(() => {
    cleanupTestDir(testDir);
  });

  it('plain validate runs the failed step again and exits 0 once the cause is gone', async () => {
    await seedFailureWithRemovedCause();
    const strayBefore = runs('stray-runs.log');

    const result = await vv(['validate']);

    expect(result.exitCode).toBe(0);
    // The steps really ran again: no replay of the stored failure
    expect(runs('stray-runs.log')).toBe(strayBefore + 1);
    expectNoReplayWording(result.output);
  }, TEST_TIMEOUT_MS);

  it('pre-commit exits 0 without VV_FORCE_EXECUTION once the cause is gone', async () => {
    // A local change, as there would be before any real commit
    writeFileSync(join(testDir, 'README.md'), '# changed\n');
    await seedFailureWithRemovedCause();
    const strayBefore = runs('stray-runs.log');

    const result = await vv(['pre-commit']);

    expect(result.exitCode).toBe(0);
    expect(runs('stray-runs.log')).toBe(strayBefore + 1);
    expectNoReplayWording(result.output);
  }, TEST_TIMEOUT_MS);

  it('--retry-failed re-runs only the failed step', async () => {
    await seedFailureWithRemovedCause();
    const expensiveBefore = runs('expensive-runs.log');
    const strayBefore = runs('stray-runs.log');

    const result = await vv(['validate', '--retry-failed']);

    expect(result.exitCode).toBe(0);
    // The step that passed last time is reused, not re-executed...
    expect(runs('expensive-runs.log')).toBe(expensiveBefore);
    // ...and the one that failed really ran again
    expect(runs('stray-runs.log')).toBe(strayBefore + 1);
  }, TEST_TIMEOUT_MS);

  it('a --force re-check that goes red overturns the pass it re-checked, everywhere', async () => {
    // A local change, as there would be before any real commit (pre-commit needs one)
    writeFileSync(join(testDir, 'README.md'), '# changed\n');
    expect((await vv(['validate'])).exitCode).toBe(0);

    createIgnoredCause();
    const forced = await vv(['validate', '--force']);
    expect(forced.exitCode, 'the forced re-check fails').toBe(1);

    // The forced red decides: no command may answer from the older pass
    expect((await vv(['validate', '--check'])).exitCode).toBe(1);
    const strayBefore = runs('stray-runs.log');
    expect((await vv(['validate'])).exitCode).toBe(1);
    expect(runs('stray-runs.log')).toBe(strayBefore + 1);
    expect((await vv(['pre-commit'])).exitCode).toBe(1);
    expect(runs('stray-runs.log')).toBe(strayBefore + 2);

    removeIgnoredCause();
    expect((await vv(['validate'])).exitCode).toBe(0);
  }, TEST_TIMEOUT_MS);

  it('a recorded pass is a cache hit, and --force re-runs it', async () => {
    const first = await vv(['validate']);
    expect(first.exitCode).toBe(0);
    expect(runs('expensive-runs.log')).toBe(1);

    // Same tree, recorded pass: served from cache, nothing runs
    const cached = await vv(['validate']);
    expect(cached.exitCode).toBe(0);
    expect(runs('expensive-runs.log')).toBe(1);

    const forced = await vv(['validate', '--force']);
    expect(forced.exitCode).toBe(0);
    expect(runs('expensive-runs.log')).toBe(2);
  }, TEST_TIMEOUT_MS);
});

describe('validation levels end to end', () => {
  let testDir: string;

  const runs = (log: string): number => countRuns(testDir, log);
  const vv = (args: string[]) =>
    executeVibeValidateCommand(args, { cwd: testDir, env: ENV, timeout: TEST_TIMEOUT_MS });

  beforeEach(() => {
    testDir = setupTestGitRepo('vv-levels-', {
      files: {
        'commit-step.js': loggingScript('commit-runs.log'),
        'full-step.js': loggingScript('full-runs.log'),
        'vibe-validate.config.yaml': LEVELS_CONFIG,
        '.gitignore': '*-runs.log\n',
        'README.md': '# levels test\n',
      },
    });
  });

  afterEach(() => {
    cleanupTestDir(testDir);
  });

  it('a commit pass does not answer full; a full pass covers commit', async () => {
    // --level commit runs only the commit step
    const commit = await vv(['validate', '--level', 'commit']);
    expect(commit.exitCode).toBe(0);
    expect(runs('commit-runs.log')).toBe(1);
    expect(runs('full-runs.log')).toBe(0);

    // Default validate runs the last level (full): the commit pass does not answer
    // it, so every step runs (full contains commit)
    const full = await vv(['validate']);
    expect(full.exitCode).toBe(0);
    expect(runs('commit-runs.log')).toBe(2);
    expect(runs('full-runs.log')).toBe(1);

    // The full pass covers commit: a cache hit, nothing runs
    const commitAgain = await vv(['validate', '--level', 'commit']);
    expect(commitAgain.exitCode).toBe(0);
    expect(runs('commit-runs.log')).toBe(2);
    expect(runs('full-runs.log')).toBe(1);
    expect(commitAgain.output).toContain('Level: full (covers commit)');
  }, TEST_TIMEOUT_MS);
});

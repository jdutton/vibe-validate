/**
 * End-to-end guards for the stale-cache escape path (issue #169).
 *
 * A validation step that inspects IGNORED working-tree state can record a
 * failure that cleaning up that state cannot invalidate — the cache key is a
 * tree hash that deliberately excludes ignored paths. The stored failure then
 * replays indefinitely, and the user's only way out is a command we print for
 * them in `displayCachedFailureHint`.
 *
 * WHY THESE ARE INTEGRATION TESTS, NOT UNIT TESTS
 *
 * The unit tests around the hint assert its text (`toContain('validate
 * --force')`). That shape can prove the string is present and stable, but it
 * cannot prove the command it names actually rescues the user — it just mirrors
 * whatever the implementation chose to say. PR #170 shipped a hint that named
 * only `--force`, which re-runs every step, when `--retry-failed` resolves the
 * identical situation by re-running only what failed. Every unit test passed,
 * an adversarial review passed, and a four-reviewer panel passed, because none
 * of them executed the advice.
 *
 * So these tests execute it. `resolves the stuck state` below reads the
 * commands out of the real hint output and runs each one against a genuinely
 * stuck repository. A hint that recommends a broken, removed, or misspelled
 * flag fails here regardless of what the text says.
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

/** Appends one line per real execution, so cached replays are distinguishable. */
const EXPENSIVE_JS = String.raw`const fs = require('node:fs');
fs.appendFileSync('expensive-runs.log', 'ran\n');
`;

/** Fails while an IGNORED directory exists — the issue #169 shape. */
const STRAY_JS = String.raw`const fs = require('node:fs');
fs.appendFileSync('stray-runs.log', 'ran\n');
if (fs.existsSync('.pytest_cache')) {
  console.log('ERROR: stray .pytest_cache/ found at repo root');
  process.exit(1);
}
`;

/**
 * Pull the `validate` invocations the CLI just recommended out of its own output.
 *
 * Reading the advice back rather than hardcoding it is the point: the guard
 * follows the hint wherever its wording goes. Scanning line by line and then
 * filtering tokens keeps the patterns linear — a single combined
 * `(?:--[A-Za-z][\w-]*[ \t]*)+` nests quantifiers and is a ReDoS risk.
 */
function extractRecommendedFlagSets(output: string): string[][] {
  const flagSets: string[][] = [];
  for (const line of output.split('\n')) {
    const invocation = /(?:vv|vibe-validate) validate (.*)$/.exec(line);
    if (!invocation) continue;
    const flags = invocation[1]
      .trim()
      .split(/\s+/)
      .filter(token => /^--[A-Za-z][\w-]*$/.test(token));
    if (flags.length > 0) flagSets.push(flags);
  }
  return flagSets;
}

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

// The scratch repo has no lock file; that gate is unrelated to what is under test.
const ENV = { VV_SKIP_DEPENDENCY_CHECK: '1' };

describe('cached failure escape hatches (issue #169)', () => {
  let testDir: string;

  const runs = (log: string): number => {
    const path = join(testDir, log);
    if (!existsSync(path)) return 0;
    return readFileSync(path, 'utf8').split('\n').filter(Boolean).length;
  };

  const ignoredDir = () => join(testDir, '.pytest_cache');
  const createIgnoredCause = (): void => {
    mkdirSyncReal(ignoredDir(), { recursive: true });
    writeFileSync(join(ignoredDir(), 'junk.txt'), 'x');
  };
  const removeIgnoredCause = (): void => rmSync(ignoredDir(), { recursive: true, force: true });

  /**
   * Leave the repo in the stuck state: a FAILURE stored against the current
   * tree hash whose cause no longer exists. `--force` is used to record the
   * failure so this works even after a passing run was already stored.
   */
  const seedStuckFailure = async (): Promise<void> => {
    createIgnoredCause();
    await executeVibeValidateCommand(['validate', '--force'], { cwd: testDir, env: ENV });
    removeIgnoredCause();
  };

  beforeEach(() => {
    testDir = setupTestGitRepo('vv-cached-escape-', {
      files: {
        'expensive.js': EXPENSIVE_JS,
        'stray.js': STRAY_JS,
        'vibe-validate.config.yaml': CONFIG,
        '.gitignore': '.pytest_cache/\n*-runs.log\n',
        'README.md': '# cached failure escape test\n',
      },
    });
  });

  afterEach(() => {
    cleanupTestDir(testDir);
  });

  it('replays a cached failure whose cause was an ignored path, and discloses it', async () => {
    await seedStuckFailure();

    const result = await executeVibeValidateCommand(['validate'], { cwd: testDir, env: ENV });

    // The failure is served from cache rather than recomputed...
    expect(result.output).toContain('not re-run just now');
    // ...and must still exit non-zero, or `vv validate && git push` pushes a
    // failing tree (the defect found late in PR #170's own review).
    expect(result.exitCode).toBe(1);
  });

  it('recommends only commands that actually resolve the stuck state', async () => {
    await seedStuckFailure();

    const stuck = await executeVibeValidateCommand(['validate'], { cwd: testDir, env: ENV });
    expect(stuck.exitCode).toBe(1);

    const recommended = extractRecommendedFlagSets(stuck.output);

    expect(recommended.length).toBeGreaterThan(0);

    for (const flags of recommended) {
      await seedStuckFailure();

      const escape = await executeVibeValidateCommand(['validate', ...flags], {
        cwd: testDir,
        env: ENV,
      });

      expect(
        escape.exitCode,
        `hint recommends "validate ${flags.join(' ')}" but it left the user stuck`,
      ).toBe(0);
    }
  });

  it('offers at least one escape that does not cost a full revalidation', async () => {
    // The defect this file exists for: the hint named only `--force`, which
    // re-runs every step. `--force` "works", so a guard that merely checks the
    // advice succeeds would have passed it. What was actually wrong is that the
    // cheapest escape was never offered - and the cost of escaping is the whole
    // reason issue #169 hurt. Stated behaviourally so it survives renames.
    await seedStuckFailure();
    const stuck = await executeVibeValidateCommand(['validate'], { cwd: testDir, env: ENV });
    const recommended = extractRecommendedFlagSets(stuck.output);

    let cheapEscapeOffered = false;
    for (const flags of recommended) {
      await seedStuckFailure();
      const before = runs('expensive-runs.log');
      const escape = await executeVibeValidateCommand(['validate', ...flags], {
        cwd: testDir,
        env: ENV,
      });
      if (escape.exitCode === 0 && runs('expensive-runs.log') === before) {
        cheapEscapeOffered = true;
      }
    }

    expect(
      cheapEscapeOffered,
      'every command the stale-cache hint offers re-runs already-passed steps; ' +
        'a user with a slow suite has no cheap way out of a replayed failure',
    ).toBe(true);
  });

  it('--retry-failed escapes without re-running steps that already passed', async () => {
    await seedStuckFailure();

    const before = runs('expensive-runs.log');
    const result = await executeVibeValidateCommand(['validate', '--retry-failed'], {
      cwd: testDir,
      env: ENV,
    });

    expect(result.exitCode).toBe(0);
    // The cost invariant, and the reason --retry-failed leads the hint: the
    // reporter of #169 was blocked by a >10 minute full revalidation. If this
    // ever re-executes passed steps, --retry-failed is just a slower --force.
    expect(runs('expensive-runs.log')).toBe(before);
    expect(runs('stray-runs.log')).toBeGreaterThan(0);
  });

  it('--force escapes by re-running everything', async () => {
    await seedStuckFailure();

    const before = runs('expensive-runs.log');
    const result = await executeVibeValidateCommand(['validate', '--force'], {
      cwd: testDir,
      env: ENV,
    });

    expect(result.exitCode).toBe(0);
    expect(runs('expensive-runs.log')).toBe(before + 1);
  });

  it('VV_FORCE_EXECUTION=1 bypasses the cache from the pre-commit path', async () => {
    // Issue #169 asked for a cache bypass reachable from `git commit`. Git hooks
    // take no flags of their own, so the environment variable is the only usable
    // shape - and it is now documented in `pre-commit --help --verbose`.
    writeFileSync(join(testDir, 'README.md'), '# changed\n');
    await executeVibeValidateCommand(['validate'], { cwd: testDir, env: ENV });
    await seedStuckFailure();

    const stuck = await executeVibeValidateCommand(['pre-commit'], { cwd: testDir, env: ENV });
    expect(stuck.exitCode).toBe(1);

    const bypassed = await executeVibeValidateCommand(['pre-commit'], {
      cwd: testDir,
      env: { ...ENV, VV_FORCE_EXECUTION: '1' },
    });
    expect(bypassed.exitCode).toBe(0);
  });
});

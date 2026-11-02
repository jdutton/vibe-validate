/**
 * The pre-levels notes ref answers nothing
 *
 * Releases before validation levels recorded runs under
 * `refs/notes/vibe-validate/validate`. Git notes are shared by every worktree,
 * and a 0.20.x reader would take a commit-level pass for a whole-tree pass, so
 * leveled runs live under a new ref and the old one is never read: after an
 * upgrade the cache is cold, even for a tree the old ref holds a PASS for.
 *
 * Real git, real CLI: the seeded note is a genuine passing run for the
 * current tree (recorded by `vv validate`, then moved to the old ref).
 */

import { executeGitCommand } from '@vibe-validate/git';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
  cleanupTestDir,
  executeVibeValidateCommand,
  setupTestGitRepo,
} from '../helpers/cli-execution-helpers.js';

/** Several CLI spawns per test; generous so a loaded machine cannot time them out */
const TEST_TIMEOUT_MS = 120_000;

const LEGACY_REF = 'vibe-validate/validate';
const LEVELED_REF = 'vibe-validate/leveled-runs';

const CONFIG = `validation:
  phases:
    - name: Checks
      parallel: false
      steps:
        - name: Pass
          command: node -e "process.exit(0)"
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

describe('the pre-levels notes ref (refs/notes/vibe-validate/validate)', () => {
  let testDir: string;

  const vv = (args: string[]) => executeVibeValidateCommand(args, { cwd: testDir, env: ENV, timeout: TEST_TIMEOUT_MS });
  const git = (args: string[]) => executeGitCommand(['-C', testDir, ...args], { suppressStderr: true }).stdout.trim();

  beforeEach(() => {
    testDir = setupTestGitRepo('vv-legacy-ref-', {
      files: {
        'vibe-validate.config.yaml': CONFIG,
        'README.md': '# legacy notes ref test\n',
      },
    });
  });

  afterEach(() => {
    cleanupTestDir(testDir);
  });

  it('answers nothing: --check exits 2 though the old ref holds a pass for this tree', async () => {
    // Record a real pass for the current tree, under the leveled ref
    const recorded = await vv(['validate']);
    expect(recorded.exitCode, 'the seed run must pass').toBe(0);
    const sanity = await vv(['validate', '--check']);
    expect(sanity.exitCode, 'the leveled ref answers --check before the move').toBe(0);

    // Move that note to the old ref: same tree, same passing content
    const [noteLine] = git(['notes', `--ref=${LEVELED_REF}`, 'list']).split('\n');
    const treeHash = noteLine?.split(' ')[1];
    expect(treeHash, 'a note was recorded for the tree').toMatch(/^[0-9a-f]{40,64}$/);
    const passingNote = git(['notes', `--ref=${LEVELED_REF}`, 'show', treeHash]);
    expect(passingNote).toContain('passed: true');
    git(['notes', `--ref=${LEGACY_REF}`, 'add', '-f', '-m', passingNote, treeHash]);
    git(['update-ref', '-d', `refs/notes/${LEVELED_REF}`]);
    expect(git(['notes', `--ref=${LEGACY_REF}`, 'list'])).toContain(treeHash);

    const check = await vv(['validate', '--check']);

    // 2 = nothing recorded that bears on the level; 0 would mean the old ref answered
    expect(check.exitCode).toBe(2);
  }, TEST_TIMEOUT_MS);
});

/**
 * End-to-end integration test: GIT_* env scrubbing through multi-process chains
 *
 * Verifies that GIT_DIR is stripped not just at the immediate spawn boundary,
 * but throughout the full validation execution chain:
 *
 *   vv validate → spawnCommand → step subprocess → forked worker
 *
 * Background: PR #158 added GIT_* scrubbing inside `spawnCommand`. It worked
 * for `vv run`, which passes nothing dangerous via `options.env`. It did NOT
 * cover `vv validate`, because the runner adapter (`createRunnerConfig`)
 * copies all of `process.env` into the runner config's `env`, which the
 * runner then passes as `options.env` to `spawnCommand`. The merge order at
 * the spawn boundary (`{ ...scrubbedParentEnv, ...options.env }`) let
 * GIT_DIR back in via the second spread, so step subprocesses (and any
 * workers they forked) still saw GIT_DIR. This test catches that gap.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { cleanupTestDir, cliBinPath, setupTestGitRepo } from '../helpers/cli-execution-helpers.js';
import { executeCommandWithSeparateStreams } from '../helpers/test-command-runner.js';

// worker-check.js: forks a child, then asserts in the child that none of the
// dangerous GIT_* vars are set. Exits non-zero if any leaked through. This
// exercises the multi-process chain: vv → spawnCommand → node → fork(worker).
const WORKER_CHECK_JS = `'use strict';
const { fork } = require('node:child_process');

if (process.argv[2] === 'worker') {
  const dangerous = ['GIT_DIR', 'GIT_INDEX_FILE', 'GIT_WORK_TREE'];
  for (const key of dangerous) {
    if (process.env[key]) {
      console.error('LEAK: worker ' + key + '=' + process.env[key]);
      process.exit(2);
    }
  }
  process.exit(0);
}

const worker = fork(__filename, ['worker'], { stdio: 'inherit' });
worker.on('exit', (code) => process.exit(code === null ? 1 : code));
`;

const VIBE_VALIDATE_CONFIG = `validation:
  phases:
    - name: worker-check
      steps:
        - name: worker-check
          command: node worker-check.js
`;

describe('GIT_* env scrubbing through multi-process chains (end-to-end)', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = setupTestGitRepo('vv-git-scrub-worker', {
      files: {
        'worker-check.js': WORKER_CHECK_JS,
        'vibe-validate.config.yaml': VIBE_VALIDATE_CONFIG,
        '.gitignore': 'node_modules\n',
      },
    });
  });

  afterEach(() => {
    cleanupTestDir(testDir);
  });

  it('strips GIT_DIR/GIT_INDEX_FILE through full validate → step → fork worker chain', async () => {
    const result = await executeCommandWithSeparateStreams(
      cliBinPath,
      ['validate', '--force'],
      {
        cwd: testDir,
        env: {
          GIT_DIR: '/fake/parent/.git',
          GIT_INDEX_FILE: '/fake/parent/index',
        },
      },
    );

    // If vv exits 0, no LEAK was emitted by the worker.
    // If non-zero, dump diagnostics so the failure is actionable.
    expect(
      result.exitCode,
      `vv validate exited ${result.exitCode}.\nstderr:\n${result.stderr}\nstdout:\n${result.stdout}`,
    ).toBe(0);
    // Defensive: even if exit code is somehow 0, ensure no LEAK message slipped through.
    expect(result.stderr + result.stdout).not.toContain('LEAK:');
  }, 60000);
});

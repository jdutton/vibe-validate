/**
 * End-to-end integration test: GIT_* env scrubbing
 *
 * Verifies that GIT_DIR and GIT_INDEX_FILE (injected by git hooks into the
 * parent process) are stripped before vv run spawns its step subprocess.
 *
 * Background: when a pre-commit hook invokes vv, git sets GIT_DIR and
 * GIT_INDEX_FILE in the hook environment. If those vars leak into validation
 * step subprocesses the steps can see the wrong git context. Task 2
 * (spawnCommand) scrubs them; this test proves the scrub works end-to-end.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { cleanupTestDir, cliBinPath, setupTestGitRepo } from '../helpers/cli-execution-helpers.js';
import { executeCommandWithSeparateStreams } from '../helpers/test-command-runner.js';

describe('GIT_* env scrubbing (end-to-end)', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = setupTestGitRepo('vv-git-scrub-test', { files: { 'README.md': 'test' } });
  });

  afterEach(() => {
    cleanupTestDir(testDir);
  });

  it('strips GIT_DIR and GIT_INDEX_FILE from step subprocesses when invoked from a hook-like context', async () => {
    // Inline node command that prints the values of GIT_DIR and GIT_INDEX_FILE to stdout.
    // The --verbose flag makes vv run replay each captured output line to its own stderr
    // as "[stdout] <line>" so we can assert on vv's combined output stream without
    // reading temporary log files.
    //
    // Windows note: the inline script passes through cmd.exe (vv's spawnCommand uses
    // shell: true). Keep cmd metacharacters (& | < > ^) out of this string, or escape
    // them — Windows will mangle the script even though it's inside double quotes.
    const stepCmd = `node -e "console.log('GIT_DIR=' + (process.env.GIT_DIR || '<unset>')); console.log('GIT_INDEX_FILE=' + (process.env.GIT_INDEX_FILE || '<unset>'))"`;

    const result = await executeCommandWithSeparateStreams(cliBinPath, ['run', '--verbose', stepCmd], {
      cwd: testDir,
      env: {
        GIT_DIR: '/fake/parent/.git',
        GIT_INDEX_FILE: '/fake/parent/index',
      },
    });

    // --verbose writes captured output lines to vv's stderr as "[stdout] <line>"
    expect(result.stderr).toContain('GIT_DIR=<unset>');
    expect(result.stderr).toContain('GIT_INDEX_FILE=<unset>');
  }, 30000);
});

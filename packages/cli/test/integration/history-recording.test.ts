/**
 * Integration test for git notes history recording bug
 *
 * Bug: When running validation multiple times with the same tree hash,
 * only the first run gets recorded to git notes. Subsequent runs fail
 * silently because conflict detection doesn't match git's actual error message.
 *
 * Expected: Each validation run should be recorded to git notes, even if
 * the tree hash is the same (e.g., when using --force or when a command
 * produces different results for the same code).
 */

/* eslint-disable local/no-git-commands-direct */
// This integration test directly uses git commands for test setup
// and verification - this is the exception mentioned in CLAUDE.md

import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { normalizedTmpdir } from '@vibe-validate/utils';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { executeWrapperSync } from '../helpers/test-command-runner.js';

describe('History Recording - Git Notes Merge Bug', () => {
  let testDir: string;

  /**
   * Helper: Run validation and return result
   * Uses executeWrapperSync for secure, cross-platform execution
   */
  function runValidation(expectedResult: 'pass' | 'fail') {
    return executeWrapperSync(['validate', '--force'], {
      cwd: testDir,
      env: { VV_TEST_RESULT: expectedResult },
    });
  }

  /**
   * Helper: Get validation state
   * Uses executeWrapperSync for secure, cross-platform execution
   */
  function getState() {
    return executeWrapperSync(['state'], { cwd: testDir });
  }

  beforeEach(() => {
    // Create temporary test directory
    testDir = mkdtempSync(join(normalizedTmpdir(), 'vv-test-'));

    // Initialize git repo
    spawnSync('git', ['init'], { cwd: testDir });
    spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: testDir });
    spawnSync('git', ['config', 'user.name', 'Test User'], { cwd: testDir });

    // Create a cross-platform test script that checks environment variable
    // This is more reliable than shell-specific commands
    const testScript = `#!/usr/bin/env node
// Cross-platform test script for validation testing
process.exit(process.env.VV_TEST_RESULT === 'fail' ? 1 : 0);
`;
    writeFileSync(join(testDir, 'test.js'), testScript);

    // Create vibe-validate config that uses the test script
    const config = `
validation:
  phases:
    - name: Test Phase
      steps:
        - name: Controlled Test
          command: node test.js
`;
    writeFileSync(join(testDir, 'vibe-validate.config.yaml'), config);

    // Create a dummy file to ensure stable tree hash
    writeFileSync(join(testDir, 'test.txt'), 'initial content\n');

    // Commit to get a stable tree
    spawnSync('git', ['add', '.'], { cwd: testDir });
    spawnSync('git', ['commit', '-m', 'Initial commit'], { cwd: testDir });
  });

  afterEach(() => {
    // Cleanup
    if (testDir) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('should record multiple validation runs for the same tree hash', () => {
    // Run 1: Pass validation
    const run1 = runValidation('pass');
    expect(run1.status).toBe(0);

    // Get tree hash
    const treeHashResult = spawnSync('git', ['rev-parse', 'HEAD:'], {
      cwd: testDir,
      encoding: 'utf-8',
    });
    const treeHash = treeHashResult.stdout.trim();

    // Verify first run is recorded
    const note1Result = spawnSync(
      'git',
      ['notes', '--ref=refs/notes/vibe-validate/validate', 'show', treeHash],
      {
        cwd: testDir,
        encoding: 'utf-8',
      }
    );
    expect(note1Result.status).toBe(0);
    const note1Content = note1Result.stdout;
    expect(note1Content).toContain('runs:');
    expect(note1Content).toContain('- id:');

    // Count runs in first note (should be 1)
    const runs1 = note1Content.match(/^ {2}- id:/gm) ?? [];
    expect(runs1.length).toBe(1);

    // Run 2: Fail validation (SAME tree hash, different result)
    const run2 = runValidation('fail');
    expect(run2.status).toBe(1);

    // Verify second run is recorded (THIS WILL FAIL WITH THE BUG)
    const note2Result = spawnSync(
      'git',
      ['notes', '--ref=refs/notes/vibe-validate/validate', 'show', treeHash],
      {
        cwd: testDir,
        encoding: 'utf-8',
      }
    );
    expect(note2Result.status).toBe(0);
    const note2Content = note2Result.stdout;

    // Count runs in second note (should be 2)
    const runs2 = note2Content.match(/^ {2}- id:/gm) ?? [];
    expect(runs2.length).toBe(2); // ← FAILS: Bug causes only 1 run to be recorded

    // Run 3: Pass again (verify third run also records)
    const run3 = runValidation('pass');
    expect(run3.status).toBe(0);

    // Verify third run is recorded
    const note3Result = spawnSync(
      'git',
      ['notes', '--ref=refs/notes/vibe-validate/validate', 'show', treeHash],
      {
        cwd: testDir,
        encoding: 'utf-8',
      }
    );
    expect(note3Result.status).toBe(0);
    const note3Content = note3Result.stdout;

    // Count runs in third note (should be 3)
    const runs3 = note3Content.match(/^ {2}- id:/gm) ?? [];
    expect(runs3.length).toBe(3); // ← FAILS: Bug causes only 1 run to be recorded
  });

  it('should show most recent cached result', () => {
    // Run 1: Fail
    const run1 = runValidation('fail');
    expect(run1.status).toBe(1);

    // Check state - should show failed
    const state1 = getState();
    expect(state1.stdout).toContain('passed: false');

    // Run 2: Pass (same tree hash)
    const run2 = runValidation('pass');
    expect(run2.status).toBe(0);

    // Check state - should show passed (most recent)
    const state2 = getState();
    expect(state2.stdout).toContain('passed: true');

    // Run 3: Fail again
    const run3 = runValidation('fail');
    expect(run3.status).toBe(1);

    // Check state - should show failed (most recent)
    const state3 = getState();
    expect(state3.stdout).toContain('passed: false');
  });

  it('should detect flaky validations', () => {
    // Run 1: Pass
    const run1 = runValidation('pass');
    expect(run1.status).toBe(0);

    // Run 2: Fail (same tree hash, different outcome = flaky)
    const run2 = runValidation('fail');
    expect(run2.status).toBe(1);

    // Check for flakiness warning in output
    // (This test documents expected behavior, implementation may vary)
    // Future enhancement: Could query state and check for flakiness indicators
    // const stateResult = getState();
    // const output = stateResult.stdout + stateResult.stderr;
    // expect(output).toMatch(/flak|inconsistent|unstable/i);
  });
});

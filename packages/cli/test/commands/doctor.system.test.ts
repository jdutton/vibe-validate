/**
 * System tests for doctor command
 *
 * These tests run the REAL doctor command against THIS project (vibe-validate itself)
 * to verify self-hosting works correctly. No mocks - real execution.
 *
 * Tests verify:
 * 1. Doctor runs successfully from project root
 * 2. Doctor runs successfully from subdirectories
 * 3. All checks pass (this project should be fully healthy)
 */

import { describe, it, expect } from 'vitest';
import { safeExecFromString } from '@vibe-validate/utils';
import { join } from 'node:path';

// Get the project root (vibe-validate repo root)
const PROJECT_ROOT = join(__dirname, '../../../..');
const PACKAGES_DIR = join(PROJECT_ROOT, 'packages');
const CLI_DIR = join(PROJECT_ROOT, 'packages/cli');

/**
 * Execute vibe-validate doctor command and return parsed result
 */
function runDoctorCommand(cwd: string): {
  exitCode: number;
  output: string;
  allPassed: boolean;
  failedChecks: string[];
} {
  // Use absolute path to vv binary (works from any cwd)
  const vvBinary = join(PROJECT_ROOT, 'packages/cli/dist/bin/vv');

  try {
    const output = safeExecFromString(`node "${vvBinary}" doctor --verbose`, {
      cwd,
      encoding: 'utf8',
      stdio: 'pipe',
    });

    return {
      exitCode: 0,
      output,
      allPassed: !output.includes('❌') && output.includes('All checks passed'),
      failedChecks: [],
    };
  } catch (error: any) {
    // Doctor returns non-zero exit code when checks fail
    const output = error.stdout || error.stderr || '';
    const failedChecks = (output.match(/❌ .+/g) || []).map((line: string) =>
      line.replace(/^❌\s+/, '').split('\n')[0]
    );

    return {
      exitCode: error.status || 1,
      output,
      allPassed: false,
      failedChecks,
    };
  }
}

/**
 * Extract check status lines from doctor output
 */
function extractCheckStatuses(output: string): string[] {
  const lines = output.split('\n');
  const checkLines = lines.filter(line => line.match(/^[✅❌]/));
  return checkLines.map(line => line.trim());
}

describe('doctor command - system tests (self-hosting)', () => {
  describe('running from project root', () => {
    it('should pass all checks when run from project root', () => {
      // ACT: Run real doctor command from project root
      const result = runDoctorCommand(PROJECT_ROOT);

      // ASSERT: All checks should pass
      expect(result.exitCode).toBe(0);
      expect(result.allPassed).toBe(true);
      expect(result.failedChecks).toHaveLength(0);

      // Verify key checks are present in output
      expect(result.output).toContain('✅ Node.js version');
      expect(result.output).toContain('✅ Git installed');
      expect(result.output).toContain('✅ Configuration file');
      expect(result.output).toContain('✅ Pre-commit hook');
      expect(result.output).toContain('All checks passed');
    });

    it('should report 17/17 checks passed from project root', () => {
      const result = runDoctorCommand(PROJECT_ROOT);

      expect(result.output).toContain('17/17 checks passed');
    });
  });

  describe('running from subdirectories', () => {
    it('should pass all checks when run from packages/ subdirectory', () => {
      // ACT: Run real doctor command from packages/ subdirectory
      const result = runDoctorCommand(PACKAGES_DIR);

      // ASSERT: All checks should pass (same as from root)
      expect(result.exitCode).toBe(0);
      expect(result.allPassed).toBe(true);
      expect(result.failedChecks).toHaveLength(0);

      // CRITICAL: Pre-commit hook check should PASS (not fail as it currently does)
      expect(result.output).toContain('✅ Pre-commit hook');
      expect(result.output).not.toContain('❌ Pre-commit hook');
    });

    it('should pass all checks when run from packages/cli/ subdirectory', () => {
      // ACT: Run real doctor command from packages/cli/ subdirectory
      const result = runDoctorCommand(CLI_DIR);

      // ASSERT: All checks should pass
      expect(result.exitCode).toBe(0);
      expect(result.allPassed).toBe(true);
      expect(result.failedChecks).toHaveLength(0);

      // CRITICAL: Pre-commit hook check should PASS
      expect(result.output).toContain('✅ Pre-commit hook');
      expect(result.output).not.toContain('❌ Pre-commit hook');
    });

    it('should report same 17/17 checks passed from subdirectories as from root', () => {
      const rootResult = runDoctorCommand(PROJECT_ROOT);
      const packagesResult = runDoctorCommand(PACKAGES_DIR);
      const cliResult = runDoctorCommand(CLI_DIR);

      // All should report same number of passing checks
      expect(rootResult.output).toContain('17/17 checks passed');
      expect(packagesResult.output).toContain('17/17 checks passed');
      expect(cliResult.output).toContain('17/17 checks passed');
    });

    it('should find same .gitignore from subdirectories', () => {
      const packagesResult = runDoctorCommand(PACKAGES_DIR);

      // Should find and check .gitignore (not report ".gitignore file not found")
      expect(packagesResult.output).toContain('✅ Gitignore state file');
      expect(packagesResult.output).not.toContain('.gitignore file not found');
    });
  });

  describe('consistency across directories', () => {
    it('should produce identical check results regardless of working directory', () => {
      const rootResult = runDoctorCommand(PROJECT_ROOT);
      const packagesResult = runDoctorCommand(PACKAGES_DIR);
      const cliResult = runDoctorCommand(CLI_DIR);

      // Extract check statuses (✅ or ❌) for each check
      const rootChecks = extractCheckStatuses(rootResult.output);
      const packagesChecks = extractCheckStatuses(packagesResult.output);
      const cliChecks = extractCheckStatuses(cliResult.output);

      // All three should have same checks
      expect(packagesChecks).toEqual(rootChecks);
      expect(cliChecks).toEqual(rootChecks);
    });
  });
});

/**
 * Tests for doctor command config error reporting
 *
 * Verifies that doctor command shows detailed validation errors
 * consistently with the config command.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { execSync } from 'child_process';

describe('doctor command config error reporting (regression tests)', () => {
  let testDir: string;
  const cliPath = join(__dirname, '../../dist/bin.js');

  beforeEach(() => {
    // Create temp directory for test files
    testDir = join(tmpdir(), `vibe-validate-doctor-errors-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });

    // Initialize as git repo (doctor requires this)
    execSync('git init', { cwd: testDir, stdio: 'ignore' });
    execSync('git config user.email "test@example.com"', { cwd: testDir, stdio: 'ignore' });
    execSync('git config user.name "Test User"', { cwd: testDir, stdio: 'ignore' });
  });

  afterEach(() => {
    // Clean up test files
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('config validation in doctor checks', () => {
    it('should show detailed errors for invalid config in doctor output', () => {
      // Create invalid config - missing validation.phases
      const invalidConfig = `
validation:
  # Missing required phases field
git:
  mainBranch: 123  # Wrong type
  unknownField: test  # Unknown field
`;
      writeFileSync(join(testDir, 'vibe-validate.config.yaml'), invalidConfig);

      // Doctor may exit with non-zero code when checks fail, capture output anyway
      let output = '';
      try {
        output = execSync(`node "${cliPath}" doctor`, {
          cwd: testDir,
          encoding: 'utf-8',
        });
      } catch (error: any) {
        output = error.stdout || error.stderr || '';
      }

      // Should show config validation check failed
      expect(output).toContain('Configuration valid');
      expect(output).toContain('❌');

      // Should show specific validation errors (same as config command)
      expect(output).toContain('validation');
      expect(output).toContain('git.mainBranch');
      expect(output).toContain('Expected string, received number');
      expect(output).toContain('Unrecognized key');

      // Should show helpful suggestions
      expect(output).toContain('Fix validation errors');
      expect(output).toContain('config-templates');
    });

    it('should show same errors as config command for consistency', () => {
      // Create invalid config
      const invalidConfig = `
validation:
  phases: null
git:
  mainBranch: 999
`;
      writeFileSync(join(testDir, 'vibe-validate.config.yaml'), invalidConfig);

      // Get doctor output (may exit with error code)
      let doctorOutput = '';
      try {
        doctorOutput = execSync(`node "${cliPath}" doctor`, {
          cwd: testDir,
          encoding: 'utf-8',
        });
      } catch (error: any) {
        doctorOutput = error.stdout || error.stderr || '';
      }

      // Get config output
      let configOutput = '';
      try {
        execSync(`node "${cliPath}" config --validate`, {
          cwd: testDir,
          encoding: 'utf-8',
          stdio: 'pipe',
        });
      } catch (error: any) {
        configOutput = error.stderr || error.stdout || '';
      }

      // Both should mention the same validation errors
      // Doctor wraps errors differently, but core error messages should match
      const doctorHasValidationError = doctorOutput.includes('validation');
      const configHasValidationError = configOutput.includes('validation');

      expect(doctorHasValidationError).toBe(true);
      expect(configHasValidationError).toBe(true);

      // Both should mention git.mainBranch error
      const doctorHasGitError = doctorOutput.includes('git.mainBranch');
      const configHasGitError = configOutput.includes('git.mainBranch');

      expect(doctorHasGitError).toBe(true);
      expect(configHasGitError).toBe(true);
    });
  });

  describe('doctor with valid config', () => {
    it('should pass config validation check with valid config', () => {
      // Create valid config
      const validConfig = `
validation:
  phases:
    - name: Test
      parallel: false
      steps:
        - name: Echo
          command: echo test
`;
      writeFileSync(join(testDir, 'vibe-validate.config.yaml'), validConfig);

      // Doctor may still exit with non-zero if other checks fail
      let output = '';
      try {
        output = execSync(`node "${cliPath}" doctor --verbose`, {
          cwd: testDir,
          encoding: 'utf-8',
        });
      } catch (error: any) {
        output = error.stdout || error.stderr || '';
      }

      // Config validation check should pass (verbose mode shows all checks)
      // The check may be named differently, so just verify config doesn't show errors
      expect(output).toContain('vibe-validate Doctor');
      expect(output).not.toContain('Configuration is invalid');
      expect(output).not.toContain('validation errors');
    });
  });

  describe('doctor with no config file', () => {
    it('should report missing config file', () => {
      // Don't create config file
      let output = '';
      try {
        output = execSync(`node "${cliPath}" doctor`, {
          cwd: testDir,
          encoding: 'utf-8',
        });
      } catch (error: any) {
        output = error.stdout || error.stderr || '';
      }

      // Should report config file not found
      expect(output).toContain('Configuration file');
      expect(output).toContain('❌');
      expect(output).toContain('vibe-validate init');
    });
  });
});

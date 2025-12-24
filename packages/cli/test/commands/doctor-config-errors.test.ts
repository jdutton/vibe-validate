/**
 * Tests for doctor command config error reporting
 *
 * Verifies that doctor command shows detailed validation errors
 * consistently with the config command.
 */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { executeVibeValidateWithError } from '../helpers/cli-execution-helpers.js';
import { setupTestEnvironment, cleanupTempTestDir } from '../helpers/integration-setup-helpers.js';

describe('doctor command config error reporting (regression tests)', () => {
  let testDir: string;

  beforeEach(() => {
    // Create temp directory and initialize git repo
    testDir = setupTestEnvironment('vibe-validate-doctor-errors');
  });

  afterEach(() => {
    // Clean up test files
    cleanupTempTestDir(testDir);
  });

  describe('config validation in doctor checks', () => {
    it('should show detailed errors for invalid config in doctor output', async () => {
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
      const result = await executeVibeValidateWithError(['doctor'], { cwd: testDir });
      const output = result.stdout + result.stderr;

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

    it('should show same errors as config command for consistency', async () => {
      // Create invalid config
      const invalidConfig = `
validation:
  phases: null
git:
  mainBranch: 999
`;
      writeFileSync(join(testDir, 'vibe-validate.config.yaml'), invalidConfig);

      // Get doctor output (may exit with error code)
      const doctorResult = await executeVibeValidateWithError(['doctor'], { cwd: testDir });
      const doctorOutput = doctorResult.stdout + doctorResult.stderr;

      // Get config output
      const configResult = await executeVibeValidateWithError(['config', '--validate'], { cwd: testDir, timeout: 10000 });
      const configOutput = configResult.stdout + configResult.stderr;

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
    it('should pass config validation check with valid config', async () => {
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
      const result = await executeVibeValidateWithError(['doctor', '--verbose'], { cwd: testDir });
      const output = result.stdout + result.stderr;

      // Config validation check should pass (verbose mode shows all checks)
      // The check may be named differently, so just verify config doesn't show errors
      expect(output).toContain('vibe-validate Doctor');
      expect(output).not.toContain('Configuration is invalid');
      expect(output).not.toContain('validation errors');
    });
  });

  describe('doctor with no config file', () => {
    it('should report missing config file', async () => {
      // Don't create config file
      const result = await executeVibeValidateWithError(['doctor'], { cwd: testDir });
      const output = result.stdout + result.stderr;

      // Should report config file not found
      expect(output).toContain('Configuration file');
      expect(output).toContain('❌');
      // Command name could be "vv" or "vibe-validate" depending on execution context
      expect(output).toMatch(/(vv|vibe-validate) init/);
    });
  });
});

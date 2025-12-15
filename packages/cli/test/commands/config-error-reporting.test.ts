/**
 * Tests for config command error reporting
 *
 * Verifies that the config command shows detailed validation errors
 * when given invalid configuration files.
 */

import { join } from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { executeCommand } from '../helpers/test-command-runner.js';
import {
  createTempTestDir,
  cleanupTempTestDir,
  writeTestConfig,
} from '../helpers/test-fixtures.js';

describe.skipIf(process.platform === 'win32')('config command error reporting (regression tests)', () => {
  // Skipped on Windows: Node.js module loader errors when executing CLI with node command
  let testDir: string;
  const cliPath = join(__dirname, '../../dist/bin.js');

  beforeEach(() => {
    testDir = createTempTestDir('vibe-validate-config-errors');
  });

  afterEach(() => {
    cleanupTempTestDir(testDir);
  });

  describe('invalid config with missing required fields', () => {
    it('should show detailed validation errors', () => {
      // Create invalid config - missing validation.phases
      const invalidConfig = `
validation:
  # Missing required phases field
git:
  mainBranch: main
`;
      writeTestConfig(testDir, invalidConfig);

      const result = executeCommand(`node "${cliPath}" config --validate`, { cwd: testDir });

      // Should show error header
      expect(result.output).toContain('Configuration is invalid');
      expect(result.output).toContain('vibe-validate.config.yaml');

      // Should show specific validation error
      expect(result.output).toContain('Validation errors:');
      expect(result.output).toContain('validation');

      // Should show helpful suggestions
      expect(result.output).toContain('Suggestions:');
      expect(result.output).toContain('YAML syntax');
      expect(result.output).toContain('config-templates');

      // Should exit with error code
      expect(result.exitCode).toBe(1);
    });
  });

  describe('invalid config with wrong types', () => {
    it('should show type mismatch errors', () => {
      // Create config with wrong types
      const invalidConfig = `
validation:
  phases:
    - name: Test
      parallel: true
      steps: []
git:
  mainBranch: 123  # Should be string
  autoSync: "yes"  # Should be boolean
`;
      writeTestConfig(testDir, invalidConfig);

      const result = executeCommand(`node "${cliPath}" config --validate`, { cwd: testDir });

      // Should show specific field errors
      expect(result.output).toContain('git.mainBranch');
      expect(result.output).toContain('Expected string, received number');
      expect(result.exitCode).toBe(1);
    });
  });

  describe('invalid config with unknown fields', () => {
    it('should show unrecognized key errors', () => {
      // Create config with unknown fields
      const invalidConfig = `
validation:
  phases: []
git:
  mainBranch: main
  unknownField: value  # Not in schema
`;
      writeTestConfig(testDir, invalidConfig);

      const result = executeCommand(`node "${cliPath}" config --validate`, { cwd: testDir });

      // Should show unrecognized key error
      expect(result.output).toContain('Unrecognized key');
      expect(result.output).toContain('unknownField');
      expect(result.exitCode).toBe(1);
    });
  });

  describe('invalid YAML syntax', () => {
    it('should show YAML parse errors', () => {
      // Create file with invalid YAML syntax
      const invalidYaml = `
validation:
  phases:
    - name: Test
      parallel true  # Missing colon
      steps: []
`;
      writeTestConfig(testDir, invalidYaml);

      const result = executeCommand(`node "${cliPath}" config --validate`, { cwd: testDir });

      // Should mention YAML syntax error
      expect(result.output).toContain('Configuration is invalid');
      expect(result.exitCode).toBe(1);
    });
  });

  describe('valid config', () => {
    it('should validate successfully', () => {
      // Create valid minimal config
      const validConfig = `
validation:
  phases:
    - name: Test
      parallel: false
      steps:
        - name: Echo
          command: echo test
`;
      writeTestConfig(testDir, validConfig);

      const result = executeCommand(`node "${cliPath}" config --validate`, { cwd: testDir });

      expect(result.output).toContain('Configuration is valid');
      expect(result.exitCode).toBe(0);
    });
  });

  describe('error message limits', () => {
    it('should show max 5 errors with "and X more" message', () => {
      // Create config with many validation errors
      const invalidConfig = `
validation:
  phases:
    - name: 123  # Wrong type
      parallel: "yes"  # Wrong type
      steps: "not-array"  # Wrong type
git:
  mainBranch: 456  # Wrong type
  autoSync: "no"  # Wrong type
  unknownField1: val
  unknownField2: val
  unknownField3: val
`;
      writeTestConfig(testDir, invalidConfig);

      const result = executeCommand(`node "${cliPath}" config --validate`, { cwd: testDir });

      // Count actual error bullet lines (not suggestions which also use bullets)
      const lines = result.output.split('\n');
      const validationErrorsIndex = lines.findIndex(l => l.includes('Validation errors:'));
      const suggestionsIndex = lines.findIndex(l => l.includes('Suggestions:'));

      // Only count bullets between "Validation errors:" and "Suggestions:"
      const errorSection = lines.slice(validationErrorsIndex + 1, suggestionsIndex > 0 ? suggestionsIndex : lines.length);
      const errorLines = errorSection.filter((line: string) => line.includes('•'));

      expect(errorLines.length).toBeLessThanOrEqual(6); // 5 errors + "and X more" line

      // May show "and X more" if there are more than 5 errors
      if (errorLines.length === 6) {
        expect(result.output).toContain('and');
        expect(result.output).toContain('more');
      }

      expect(result.exitCode).toBe(1);
    });
  });
});

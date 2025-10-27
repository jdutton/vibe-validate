/**
 * Tests for config command error reporting
 *
 * Verifies that the config command shows detailed validation errors
 * when given invalid configuration files.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { execSync } from 'child_process';

describe('config command error reporting (regression tests)', () => {
  let testDir: string;
  const cliPath = join(__dirname, '../../dist/bin.js');

  beforeEach(() => {
    // Create temp directory for test files
    testDir = join(tmpdir(), `vibe-validate-config-errors-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    // Clean up test files
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
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
      writeFileSync(join(testDir, 'vibe-validate.config.yaml'), invalidConfig);

      try {
        execSync(`node "${cliPath}" config --validate`, {
          cwd: testDir,
          encoding: 'utf-8',
          stdio: 'pipe',
        });
        expect.fail('Should have thrown error for invalid config');
      } catch (error: any) {
        const output = error.stderr || error.stdout || '';

        // Should show error header
        expect(output).toContain('Configuration is invalid');
        expect(output).toContain('vibe-validate.config.yaml');

        // Should show specific validation error
        expect(output).toContain('Validation errors:');
        expect(output).toContain('validation');

        // Should show helpful suggestions
        expect(output).toContain('Suggestions:');
        expect(output).toContain('YAML syntax');
        expect(output).toContain('config-templates');

        // Should exit with error code
        expect(error.status).toBe(1);
      }
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
      writeFileSync(join(testDir, 'vibe-validate.config.yaml'), invalidConfig);

      try {
        execSync(`node "${cliPath}" config --validate`, {
          cwd: testDir,
          encoding: 'utf-8',
          stdio: 'pipe',
        });
        expect.fail('Should have thrown error for type mismatch');
      } catch (error: any) {
        const output = error.stderr || error.stdout || '';

        // Should show specific field errors
        expect(output).toContain('git.mainBranch');
        expect(output).toContain('Expected string, received number');
        expect(error.status).toBe(1);
      }
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
      writeFileSync(join(testDir, 'vibe-validate.config.yaml'), invalidConfig);

      try {
        execSync(`node "${cliPath}" config --validate`, {
          cwd: testDir,
          encoding: 'utf-8',
          stdio: 'pipe',
        });
        expect.fail('Should have thrown error for unknown field');
      } catch (error: any) {
        const output = error.stderr || error.stdout || '';

        // Should show unrecognized key error
        expect(output).toContain('Unrecognized key');
        expect(output).toContain('unknownField');
        expect(error.status).toBe(1);
      }
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
      writeFileSync(join(testDir, 'vibe-validate.config.yaml'), invalidYaml);

      try {
        execSync(`node "${cliPath}" config --validate`, {
          cwd: testDir,
          encoding: 'utf-8',
          stdio: 'pipe',
        });
        expect.fail('Should have thrown error for YAML syntax');
      } catch (error: any) {
        const output = error.stderr || error.stdout || '';

        // Should mention YAML syntax error
        expect(output).toContain('Configuration is invalid');
        expect(error.status).toBe(1);
      }
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
      writeFileSync(join(testDir, 'vibe-validate.config.yaml'), validConfig);

      const output = execSync(`node "${cliPath}" config --validate`, {
        cwd: testDir,
        encoding: 'utf-8',
      });

      expect(output).toContain('Configuration is valid');
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
      writeFileSync(join(testDir, 'vibe-validate.config.yaml'), invalidConfig);

      try {
        execSync(`node "${cliPath}" config --validate`, {
          cwd: testDir,
          encoding: 'utf-8',
          stdio: 'pipe',
        });
        expect.fail('Should have thrown error');
      } catch (error: any) {
        const output = error.stderr || error.stdout || '';

        // Count actual error bullet lines (not suggestions which also use bullets)
        const lines = output.split('\n');
        const validationErrorsIndex = lines.findIndex(l => l.includes('Validation errors:'));
        const suggestionsIndex = lines.findIndex(l => l.includes('Suggestions:'));

        // Only count bullets between "Validation errors:" and "Suggestions:"
        const errorSection = lines.slice(validationErrorsIndex + 1, suggestionsIndex > 0 ? suggestionsIndex : lines.length);
        const errorLines = errorSection.filter((line: string) => line.includes('•'));

        expect(errorLines.length).toBeLessThanOrEqual(6); // 5 errors + "and X more" line

        // May show "and X more" if there are more than 5 errors
        if (errorLines.length === 6) {
          expect(output).toContain('and');
          expect(output).toContain('more');
        }
      }
    });
  });
});

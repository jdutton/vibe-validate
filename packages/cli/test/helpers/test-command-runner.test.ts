/**
 * Tests for test-command-runner utilities
 *
 * Focus: Cross-platform command parsing
 */

import { describe, it, expect } from 'vitest';

import { executeCommand, executeCommandWithYaml } from './test-command-runner.js';

describe('parseCommand (via executeCommand)', () => {
  describe('basic command parsing', () => {
    it('should parse simple commands', () => {
      const result = executeCommand('echo test');
      expect(result.exitCode).toBe(0);
      expect(result.output.trim()).toBe('test');
    });

    it('should handle arguments without quotes', () => {
      const result = executeCommand('node -e "console.log(123)"');
      expect(result.exitCode).toBe(0);
      expect(result.output.trim()).toBe('123');
    });
  });

  describe('Windows path handling (Issue #86)', () => {
    it('should preserve backslashes in simple paths (no spaces)', () => {
      // CRITICAL TEST: Backslashes in file paths must not be treated as escape characters
      // Test simple paths that work identically on both platforms
      const result = executeCommand(String.raw`node -e "console.log(process.argv[1])" C:\Users\test\file.js`);
      expect(result.exitCode).toBe(0);
      expect(result.output.trim()).toBe(String.raw`C:\Users\test\file.js`);
    });

    it('should handle forward slash paths (cross-platform)', () => {
      // Unix-style paths work on Windows too
      const result = executeCommand('node -e "console.log(process.argv[1])" /usr/local/bin/node');
      expect(result.exitCode).toBe(0);
      expect(result.output.trim()).toBe('/usr/local/bin/node');
    });

    it('should handle path-like arguments', () => {
      const result = executeCommand(String.raw`node -e "console.log(process.argv[1])" path\to\file`);
      expect(result.exitCode).toBe(0);
      expect(result.output.trim()).toBe(String.raw`path\to\file`);
    });
  });

  describe('command execution', () => {
    it('should execute node -e commands', () => {
      const result = executeCommand('node -e "console.log(42)"');
      expect(result.exitCode).toBe(0);
      expect(result.output.trim()).toBe('42');
    });

    it('should handle YAML parsing with executeCommandWithYaml', () => {
      const result = executeCommandWithYaml('node -e "console.log(123)"');
      expect(result.exitCode).toBe(0);
      expect(result.output.trim()).toBe('123');
    });
  });

  describe('error handling', () => {
    it('should capture exit code for failing commands', () => {
      const result = executeCommand('node -e "process.exit(42)"');
      expect(result.exitCode).toBe(42);
    });

    it('should capture error output', () => {
      // Use console.error instead of process.stderr.write to avoid quoting issues on Windows
      // Double quotes work consistently across platforms when properly escaped
      const result = executeCommand('node -e "console.error(123); process.exit(1)"');
      expect(result.exitCode).toBe(1);
      expect(result.output).toContain('123');
    });
  });
});

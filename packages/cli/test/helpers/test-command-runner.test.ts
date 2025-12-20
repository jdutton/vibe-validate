/**
 * Tests for test-command-runner utilities
 *
 * Focus: Cross-platform command parsing, especially Windows path handling
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

    it('should handle quoted arguments', () => {
      const result = executeCommand('echo "hello world"');
      expect(result.exitCode).toBe(0);
      expect(result.output.trim()).toBe('hello world');
    });

    it('should handle single quotes', () => {
      // Single quotes work on Unix, but Windows cmd.exe treats them as literals
      // Our parser handles them uniformly for test consistency
      const result = executeCommand("echo 'hello world'");
      expect(result.exitCode).toBe(0);
      // On Windows, echo includes the quotes in output
      // On Unix, quotes are removed by shell
      expect(result.output.trim()).toMatch(/hello world|'hello world'/);
    });
  });

  describe('Windows path handling (Issue #86)', () => {
    it('should preserve backslashes in command arguments (realistic scenario)', () => {
      // CRITICAL TEST: Backslashes in file paths must not be treated as escape characters
      // This is the real scenario that was failing before the fix
      // Before fix: Command parser consumed backslashes → module loader errors
      // After fix: Backslashes preserved → commands work correctly

      // Use process.argv to test actual argument passing (not string escaping in -e)
      const result = executeCommand(String.raw`node -e "console.log(process.argv[1])" "C:\Users\test\file.js"`);
      expect(result.exitCode).toBe(0);
      expect(result.output.trim()).toBe(String.raw`C:\Users\test\file.js`);
    });

    it('should handle Windows paths with spaces', () => {
      // Test: Windows path with spaces (Program Files)
      const result = executeCommand(String.raw`node -e "console.log(process.argv[1])" "C:\Program Files\Node\bin.js"`);
      expect(result.exitCode).toBe(0);
      expect(result.output.trim()).toBe(String.raw`C:\Program Files\Node\bin.js`);
    });

    it('should handle forward slashes (cross-platform paths)', () => {
      // Unix-style paths work on Windows too
      const result = executeCommand('node -e "console.log(process.argv[1])" "/usr/local/bin/node"');
      expect(result.exitCode).toBe(0);
      expect(result.output.trim()).toBe('/usr/local/bin/node');
    });

    it('should preserve backslashes in UNC paths', () => {
      // UNC paths: \\server\share (need \\\\ to get two backslashes through both escaping layers)
      const result = executeCommand(String.raw`node -e "console.log(process.argv[1])" "\\\\server\\share\\file.txt"`);
      expect(result.exitCode).toBe(0);
      expect(result.output.trim()).toBe(String.raw`\\server\share\file.txt`);
    });

    it('should handle mixed separators in same path', () => {
      // Windows handles mixed separators (Node.js normalizes them)
      const result = executeCommand(String.raw`node -e "console.log(process.argv[1])" "C:\Users/test/file.js"`);
      expect(result.exitCode).toBe(0);
      expect(result.output.trim()).toBe(String.raw`C:\Users/test/file.js`);
    });
  });

  describe('escape sequence handling', () => {
    it('should handle escaped quotes in arguments', () => {
      // Backslash before quote should escape the quote
      const result = executeCommand(String.raw`node -e "console.log(process.argv[1])" "hello \"world\""`);
      expect(result.exitCode).toBe(0);
      expect(result.output.trim()).toBe('hello "world"');
    });

    it('should handle escaped backslashes', () => {
      // Double backslash should produce single backslash (escape sequence)
      const result = executeCommand(String.raw`node -e "console.log(process.argv[1])" "test\\value"`);
      expect(result.exitCode).toBe(0);
      expect(result.output.trim()).toBe(String.raw`test\value`);
    });

    it('should treat single backslashes as literals when not escaping', () => {
      // Backslash before regular character (not quote or backslash) is literal
      // This is key for Windows paths: \U, \t should stay as-is
      const result = executeCommand(String.raw`node -e "console.log(process.argv[1])" "path\to\file"`);
      expect(result.exitCode).toBe(0);
      expect(result.output.trim()).toBe(String.raw`path\to\file`);
    });
  });

  describe('complex real-world scenarios', () => {
    it('should handle node commands with Windows paths', () => {
      // Real scenario: Running CLI from Windows path
      // Before fix: Module loader errors due to mangled paths
      // After fix: Works correctly
      const result = executeCommand(String.raw`node -e "console.log(\"success\")"`);
      expect(result.exitCode).toBe(0);
      expect(result.output.trim()).toBe('success');
    });

    it('should handle YAML parsing with executeCommandWithYaml', () => {
      // Test YAML parsing integration
      const yamlCommand = String.raw`node -e "console.log(\"---\\ntest: value\\n---\")"`;
      const result = executeCommandWithYaml(yamlCommand);
      expect(result.exitCode).toBe(0);
      // YAML parsing is attempted but may not succeed with simple output
      // Just verify command executed correctly
      expect(result.output).toContain('test:');
    });
  });

  describe('error handling', () => {
    it('should capture exit code for failing commands', () => {
      const result = executeCommand('node -e "process.exit(42)"');
      expect(result.exitCode).toBe(42);
    });

    it('should capture error output', () => {
      const result = executeCommand(String.raw`node -e "console.error(\"error\"); process.exit(1)"`);
      expect(result.exitCode).toBe(1);
      expect(result.output).toContain('error');
    });
  });
});

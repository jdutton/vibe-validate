/**
 * Tests for path-helpers utilities
 *
 * Critical for Windows compatibility - ensures normalizedTmpdir() and mkdirSyncReal()
 * properly resolve Windows 8.3 short names (RUNNER~1 → runneradmin).
 */

import { existsSync, rmSync,  writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { normalizePath } from '@vibe-validate/utils';
import { describe, it, expect, afterEach } from 'vitest';

import { normalizedTmpdir, mkdirSyncReal, toForwardSlash } from '../src/path-helpers.js';

describe('path-helpers', () => {
  const testDirs: string[] = [];

  afterEach(() => {
    // Clean up test directories
    for (const dir of testDirs) {
      if (existsSync(dir)) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
    testDirs.length = 0;
  });

  describe('normalizedTmpdir()', () => {
    it('should return an existing directory', () => {
      const temp = normalizedTmpdir();

      expect(temp).toBeDefined();
      expect(typeof temp).toBe('string');
      expect(temp.length).toBeGreaterThan(0);
      expect(existsSync(temp)).toBe(true);
    });

    it('should return normalized path without Windows 8.3 short names', () => {
      const temp = normalizedTmpdir();

      // Check for common Windows 8.3 short name patterns
      // RUNNER~1, PROGRA~1, etc. (name~digit)
      const hasShortName = /~\d/.test(temp);

      expect(hasShortName).toBe(false);
    });

    it('should match realpathSync(tmpdir()) on all platforms', () => {
      const temp = normalizedTmpdir();
      // eslint-disable-next-line local/no-os-tmpdir -- Testing normalizedTmpdir() by comparing with tmpdir()
      const osTmp = tmpdir();

      // normalizedTmpdir() should return the same as realpathSync(tmpdir())
      // This is critical for Windows where tmpdir() may return 8.3 short names
      const expected = normalizePath(osTmp);

      expect(temp).toBe(expected);
    });

    it('should be idempotent', () => {
      const temp1 = normalizedTmpdir();
      const temp2 = normalizedTmpdir();

      expect(temp1).toBe(temp2);
    });
  });

  describe('mkdirSyncReal()', () => {
    it('should create directory and return normalized path', () => {
      const testDir = join(normalizedTmpdir(), `vibe-test-mkdirSyncReal-${Date.now()}`);
      testDirs.push(testDir);

      const returnedPath = mkdirSyncReal(testDir);

      // Directory should exist
      expect(existsSync(returnedPath)).toBe(true);

      // Returned path should be normalized (match realpathSync)
      expect(returnedPath).toBe(normalizePath(testDir));
    });

    it('should return path without Windows 8.3 short names', () => {
      const testDir = join(normalizedTmpdir(), `vibe-test-shortname-${Date.now()}`);
      testDirs.push(testDir);

      const returnedPath = mkdirSyncReal(testDir);

      // Check for Windows 8.3 short name patterns
      const hasShortName = /~\d/.test(returnedPath);

      expect(hasShortName).toBe(false);
    });

    it('should create nested directories with recursive option', () => {
      const parentDir = join(normalizedTmpdir(), `vibe-test-parent-${Date.now()}`);
      const childDir = join(parentDir, 'child', 'grandchild');
      testDirs.push(parentDir);

      const returnedPath = mkdirSyncReal(childDir, { recursive: true });

      expect(existsSync(returnedPath)).toBe(true);
      expect(existsSync(parentDir)).toBe(true);
      expect(existsSync(join(parentDir, 'child'))).toBe(true);
    });

    it('should allow file operations using returned path', () => {
      const testDir = join(normalizedTmpdir(), `vibe-test-fileops-${Date.now()}`);
      testDirs.push(testDir);

      const normalizedDir = mkdirSyncReal(testDir);
      const testFile = join(normalizedDir, 'test.txt');
      const content = 'test content';

      // Write file using normalized path
      writeFileSync(testFile, content);

      // File should exist
      expect(existsSync(testFile)).toBe(true);

      // File should be accessible via realpathSync as well
      const realFilePath = normalizePath(testFile);
      expect(existsSync(realFilePath)).toBe(true);
    });

    it('should handle existing directories', () => {
      const testDir = join(normalizedTmpdir(), `vibe-test-existing-${Date.now()}`);
      testDirs.push(testDir);

      // Create directory first time
      const path1 = mkdirSyncReal(testDir);

      // Create again (should not throw)
      expect(() => {
        mkdirSyncReal(testDir);
      }).toThrow(); // Without recursive: true, should throw

      // With recursive: true, should succeed
      const path2 = mkdirSyncReal(testDir, { recursive: true });

      expect(path1).toBe(path2);
    });
  });

  describe('normalizePath()', () => {
    it('should normalize existing path (single argument)', () => {
      const temp = normalizedTmpdir();
      const normalized = normalizePath(temp);

      expect(normalized).toBe(temp);
      expect(normalized).not.toContain('~');
    });

    it('should accept multiple path segments like path.resolve()', () => {
      const temp = normalizedTmpdir();
      const testSubdir = 'test-subdir';

      // Multiple arguments should work like path.resolve()
      const result = normalizePath(temp, testSubdir);

      expect(result).toContain(temp);
      expect(result).toContain(testSubdir);
      expect(result).not.toContain('~');
    });

    it('should resolve relative paths to absolute', () => {
      // Relative path should be resolved to absolute
      const result = normalizePath('.', 'test.txt');

      expect(result).toContain('test.txt');
      // Should be absolute path
      expect(result.startsWith('/')).toBe(process.platform !== 'win32');
      if (process.platform === 'win32') {
        // Windows absolute paths start with drive letter
        expect(/^[A-Z]:/i.test(result)).toBe(true);
      }
    });

    it('should resolve __dirname-relative paths (common test pattern)', () => {
      // Simulate the common test pattern: normalizePath(__dirname, '../../dist/bin.js')
      const result = normalizePath(__dirname, '..', 'path-helpers.js');

      expect(result).toContain('path-helpers.js');
      expect(result).not.toContain('~');
      // Should be absolute
      expect(result.startsWith('/')).toBe(process.platform !== 'win32');
    });

    it('should handle non-existent paths gracefully (fallback to resolved)', () => {
      // Non-existent path should still resolve (but not normalize via realpathSync)
      const result = normalizePath(__dirname, 'non-existent', 'file.txt');

      expect(result).toContain('non-existent');
      expect(result).toContain('file.txt');
      // Should still be absolute even if not normalized
      expect(result.startsWith('/')).toBe(process.platform !== 'win32');
    });
  });

  describe('toForwardSlash()', () => {
    it('should convert Windows backslashes to forward slashes', () => {
      const windowsPath = String.raw`C:\Users\docs\README.md`;
      const result = toForwardSlash(windowsPath);

      expect(result).toBe('C:/Users/docs/README.md');
    });

    it('should leave Unix paths unchanged', () => {
      const unixPath = '/project/docs/README.md';
      const result = toForwardSlash(unixPath);

      expect(result).toBe('/project/docs/README.md');
    });

    it('should handle mixed slashes', () => {
      const mixedPath = String.raw`C:\Users/docs\file.txt`;
      const result = toForwardSlash(mixedPath);

      expect(result).toBe('C:/Users/docs/file.txt');
    });

    it('should handle empty string', () => {
      const result = toForwardSlash('');

      expect(result).toBe('');
    });

    it('should handle multiple consecutive backslashes', () => {
      const path = String.raw`path\\with\\\\multiple`;
      const result = toForwardSlash(path);

      expect(result).toBe('path//with////multiple');
    });

    it('should handle UNC paths (Windows network paths)', () => {
      const uncPath = String.raw`\\server\share\folder`;
      const result = toForwardSlash(uncPath);

      expect(result).toBe('//server/share/folder');
    });

    it('should be useful for glob pattern matching', () => {
      // Glob patterns expect forward slashes
      const windowsPath = String.raw`src\utils\helpers.ts`;
      const normalized = toForwardSlash(windowsPath);

      expect(normalized).toBe('src/utils/helpers.ts');
      expect(normalized).toMatch(/^src\/utils\/.*\.ts$/);
    });

    it('should enable cross-platform path comparisons', () => {
      const windowsPath = String.raw`src\utils\helpers.ts`;
      const unixPath = 'src/utils/helpers.ts';

      expect(toForwardSlash(windowsPath)).toBe(toForwardSlash(unixPath));
    });

    it('should work with path.sep-based string operations', () => {
      // Common pattern: split by path.sep
      const windowsPath = String.raw`C:\Users\docs\file.txt`;
      const normalized = toForwardSlash(windowsPath);
      const parts = normalized.split('/');

      expect(parts).toEqual(['C:', 'Users', 'docs', 'file.txt']);
    });

    it('should handle relative paths', () => {
      const relativePath = String.raw`..\..\src\utils.ts`;
      const result = toForwardSlash(relativePath);

      expect(result).toBe('../../src/utils.ts');
    });
  });

  describe('Windows 8.3 short name detection (critical for CI)', () => {
    it('should detect if normalizedTmpdir() is failing silently on Windows', () => {
      const temp = normalizedTmpdir();
      // eslint-disable-next-line local/no-os-tmpdir -- Testing normalizedTmpdir() by comparing with tmpdir()
      const osTmp = tmpdir();

      // If normalizedTmpdir() catches an error and returns unnormalized path,
      // it would return the same as tmpdir() WITHOUT normalization
      // This test detects that failure mode

      if (process.platform === 'win32' && osTmp.includes('~')) {
        // On Windows, if tmpdir() returns a path with ~, normalizedTmpdir() MUST resolve it
        // If tmpdir() has short names, normalizedTmpdir() should NOT have them
        expect(temp.includes('~')).toBe(false);
        expect(temp).not.toBe(osTmp); // Should be different (normalized)
      }

      // On all platforms, normalizedTmpdir() should equal realpathSync(tmpdir())
      const expected = normalizePath(osTmp);
      expect(temp).toBe(expected);
    });

    it('should log diagnostic info if normalization appears to fail (Windows only)', () => {
      if (process.platform !== 'win32') {
        return; // Skip on non-Windows
      }

      const temp = normalizedTmpdir();
      // eslint-disable-next-line local/no-os-tmpdir -- Testing normalizedTmpdir() by comparing with tmpdir()
      const osTmp = tmpdir();
      const realTemp = normalizePath(osTmp);

      // Diagnostic logging for CI failures
      if (temp !== realTemp || temp.includes('~')) {
        console.error('⚠️  normalizedTmpdir() FAILED TO NORMALIZE:');
        console.error('   tmpdir():', osTmp);
        console.error('   normalizedTmpdir():', temp);
        console.error('   realpathSync(tmpdir()):', realTemp);
        console.error('   This will cause test failures! Check normalizedTmpdir() implementation.');

        // This test should fail if normalization failed
        expect(temp).toBe(realTemp);
      }
    });
  });

  describe('Error handling and fallback paths', () => {
    it('normalizedTmpdir() should fallback gracefully on realpathSync failures', () => {
      // Even if realpathSync fails, should still return something usable
      const temp = normalizedTmpdir();

      expect(temp).toBeDefined();
      expect(typeof temp).toBe('string');
      expect(temp.length).toBeGreaterThan(0);
    });

    it('mkdirSyncReal() should fallback to original path if realpathSync fails', () => {
      const testDir = join(normalizedTmpdir(), `vibe-test-fallback-${Date.now()}`);
      testDirs.push(testDir);

      // Create directory - even if realpathSync fails, should return a usable path
      const returnedPath = mkdirSyncReal(testDir, { recursive: true });

      expect(returnedPath).toBeDefined();
      expect(typeof returnedPath).toBe('string');
      // Directory should actually exist
      expect(existsSync(returnedPath)).toBe(true);
    });

    it('normalizePath() should fallback to resolved path for non-existent paths', () => {
      const nonExistent = join(normalizedTmpdir(), 'definitely-does-not-exist-12345', 'subdir');

      const result = normalizePath(nonExistent);

      expect(result).toBeDefined();
      expect(typeof result).toBe('string');
      // Should be absolute path even if not normalized
      expect(result.includes(nonExistent) || result.includes('definitely-does-not-exist-12345')).toBe(true);
    });

    it('normalizePath() with single argument should handle paths correctly', () => {
      const singlePath = normalizedTmpdir();
      const result = normalizePath(singlePath);

      // Single-argument path should work
      expect(result).toBe(singlePath);
    });

    it('normalizePath() with empty string should handle gracefully', () => {
      // Edge case: empty path
      const result = normalizePath('');

      // Should resolve to current directory
      expect(result).toBeDefined();
      expect(typeof result).toBe('string');
    });

    it('mkdirSyncReal() should propagate mkdir errors (non-existent parent)', () => {
      const invalidPath = join(normalizedTmpdir(), 'non-existent-parent-12345', 'child');

      // Should throw because parent doesn't exist and recursive is not set
      expect(() => {
        mkdirSyncReal(invalidPath);
      }).toThrow();
    });

    it('normalizePath() should handle Windows-style paths on all platforms', () => {
      // Should work even with Windows-style backslashes
      const result = normalizePath('test', 'subdir');

      expect(result).toBeDefined();
      expect(result).toContain('test');
    });
  });
});

/**
 * Tests for path-helpers utilities
 *
 * Critical for Windows compatibility - ensures normalizedTmpdir() and mkdirSyncReal()
 * properly resolve Windows 8.3 short names (RUNNER~1 → runneradmin).
 */

import { existsSync, rmSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, afterEach } from 'vitest';

import { normalizedTmpdir, mkdirSyncReal } from '../src/path-helpers.js';

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
      const expected = realpathSync(osTmp);

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
      expect(returnedPath).toBe(realpathSync(testDir));
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
      const realFilePath = realpathSync(testFile);
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

  describe('Windows 8.3 short name detection (critical for CI)', () => {
    it('should detect if normalizedTmpdir() is failing silently on Windows', () => {
      const temp = normalizedTmpdir();
      // eslint-disable-next-line local/no-os-tmpdir -- Testing normalizedTmpdir() by comparing with tmpdir()
      const osTmp = tmpdir();

      // If normalizedTmpdir() catches an error and returns unnormalized path,
      // it would return the same as tmpdir() WITHOUT normalization
      // This test detects that failure mode

      if (process.platform === 'win32') {
        // On Windows, if tmpdir() returns a path with ~, normalizedTmpdir() MUST resolve it
        if (osTmp.includes('~')) {
          // If tmpdir() has short names, normalizedTmpdir() should NOT have them
          expect(temp.includes('~')).toBe(false);
          expect(temp).not.toBe(osTmp); // Should be different (normalized)
        }
      }

      // On all platforms, normalizedTmpdir() should equal realpathSync(tmpdir())
      const expected = realpathSync(osTmp);
      expect(temp).toBe(expected);
    });

    it('should log diagnostic info if normalization appears to fail (Windows only)', () => {
      if (process.platform !== 'win32') {
        return; // Skip on non-Windows
      }

      const temp = normalizedTmpdir();
      // eslint-disable-next-line local/no-os-tmpdir -- Testing normalizedTmpdir() by comparing with tmpdir()
      const osTmp = tmpdir();
      const realTemp = realpathSync(osTmp);

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
});

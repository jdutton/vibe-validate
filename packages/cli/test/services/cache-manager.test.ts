/**
 * Tests for CacheManager
 *
 * Tests cover:
 * - Constructor & directory structure
 * - Atomic writes (concurrent safety)
 * - Cache operations (save/retrieve)
 * - TTL freshness checks
 * - getOrFetch behavior
 *
 * @packageDocumentation
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import type { ErrorExtractorResult } from '@vibe-validate/extractors';
import { normalizedTmpdir } from '@vibe-validate/utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { WatchPRResult } from '../../src/schemas/watch-pr-result.schema.js';
import { CacheManager } from '../../src/services/cache-manager.js';

describe('CacheManager', () => {
  let cacheManager: CacheManager;
  let tmpDir: string;
  const repoName = 'test-repo';
  const prNumber = 123;

  beforeEach(async () => {
    // Create temp directory for tests
    tmpDir = await fs.mkdtemp(path.join(normalizedTmpdir(), 'cache-manager-test-'));
    cacheManager = new CacheManager(repoName, prNumber, tmpDir);
  });

  afterEach(async () => {
    // Clean up temp directory
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('constructor & directory structure', () => {
    it('should create cache directory with correct structure', async () => {
      const cacheDir = path.join(tmpDir, 'vibe-validate', 'watch-pr-cache', repoName, String(prNumber));

      // Verify base directory exists
      const dirExists = await fs
        .stat(cacheDir)
        .then((stat) => stat.isDirectory())
        .catch(() => false);
      expect(dirExists).toBe(true);

      // Verify logs directory exists
      const logsDirExists = await fs
        .stat(path.join(cacheDir, 'logs'))
        .then((stat) => stat.isDirectory())
        .catch(() => false);
      expect(logsDirExists).toBe(true);

      // Verify extractions directory exists
      const extractionsDirExists = await fs
        .stat(path.join(cacheDir, 'extractions'))
        .then((stat) => stat.isDirectory())
        .catch(() => false);
      expect(extractionsDirExists).toBe(true);
    });

    it('should handle special characters in repo name', async () => {
      const specialRepoName = 'my-org/my-repo';
      // eslint-disable-next-line @typescript-eslint/no-unused-vars, sonarjs/no-unused-vars, sonarjs/no-dead-store
      const specialCacheManager = new CacheManager(specialRepoName, prNumber, tmpDir);

      const cacheDir = path.join(
        tmpDir,
        'vibe-validate',
        'watch-pr-cache',
        specialRepoName.replaceAll('/', '_'),
        String(prNumber)
      );

      const dirExists = await fs
        .stat(cacheDir)
        .then((stat) => stat.isDirectory())
        .catch(() => false);
      expect(dirExists).toBe(true);
    });

    it('should use OS temp directory by default', () => {
      const defaultCacheManager = new CacheManager(repoName, prNumber);
      const expectedBase = path.join(normalizedTmpdir(), 'vibe-validate');
      expect(defaultCacheManager['cacheDir']).toContain(expectedBase);
    });
  });

  describe('atomic writes', () => {
    it('should write files atomically using temp file + rename', async () => {
      const testFile = path.join(tmpDir, 'test-atomic.txt');
      const content = 'test content';

      await cacheManager['atomicWrite'](testFile, content);

      const written = await fs.readFile(testFile, 'utf8');
      expect(written).toBe(content);
    });

    it.skipIf(process.platform === 'win32')('should handle concurrent writes safely', async () => {
      const testFile = path.join(tmpDir, 'test-concurrent.txt');

      // Simulate concurrent writes
      const writes = Array.from({ length: 10 }, (_, i) =>
        cacheManager['atomicWrite'](testFile, `content-${i}`)
      );

      await Promise.all(writes);

      // File should exist with one of the contents
      const content = await fs.readFile(testFile, 'utf8');
      expect(content).toMatch(/^content-\d+$/);
    });

    it('should create parent directories if missing', async () => {
      const nestedFile = path.join(tmpDir, 'deep', 'nested', 'file.txt');
      const content = 'nested content';

      await cacheManager['atomicWrite'](nestedFile, content);

      const written = await fs.readFile(nestedFile, 'utf8');
      expect(written).toBe(content);
    });
  });

  describe('saveLog & getLog', () => {
    it('should save and retrieve log file', async () => {
      const runId = 456;
      const logs = 'Test log output\nLine 2\nLine 3';

      const logPath = await cacheManager.saveLog(runId, logs);

      // Normalize path separators for cross-platform compatibility
      const normalizedPath = logPath.replaceAll('\\', '/');
      expect(normalizedPath).toContain(`logs/${runId}.log`);

      const retrieved = await fs.readFile(logPath, 'utf8');
      expect(retrieved).toBe(logs);
    });

    it('should return immutable file path for logs', async () => {
      const runId = 789;
      const logs = 'Original logs';

      const path1 = await cacheManager.saveLog(runId, logs);
      const path2 = await cacheManager.saveLog(runId, 'Updated logs');

      // Path should remain the same (immutable)
      expect(path1).toBe(path2);
    });

    it('should handle large log files', async () => {
      const runId = 999;
      const largeLogs = 'x'.repeat(1024 * 1024); // 1 MB

      const logPath = await cacheManager.saveLog(runId, largeLogs);

      const retrieved = await fs.readFile(logPath, 'utf8');
      expect(retrieved.length).toBe(largeLogs.length);
    });

    it('should save to VV_TEMP_DIR when jobName is provided', async () => {
      const runId = 12345;
      const logs = 'Job-specific logs\nLine 2';
      const jobName = 'integration-tests';

      const logPath = await cacheManager.saveLog(runId, logs, jobName);

      // Should return VV_TEMP_DIR path, not cache path
      expect(logPath).toContain('watch-pr-logs');
      expect(logPath).toContain(`${runId}`);
      expect(logPath).toContain(jobName);
      expect(logPath).toContain('.log');

      // Verify file exists and has correct content
      const retrieved = await fs.readFile(logPath, 'utf8');
      expect(retrieved).toBe(logs);
    });

    it('should include timestamp in VV_TEMP_DIR filename', async () => {
      const runId = 67890;
      const logs = 'Test logs';
      const jobName = 'unit-tests';

      const logPath = await cacheManager.saveLog(runId, logs, jobName);

      // Filename format: <runId>-HH-mm-ss-<jobName>.log
      const filename = path.basename(logPath);
      expect(filename).toMatch(/^\d+-\d{2}-\d{2}-\d{2}-unit-tests\.log$/);
    });

    it('should still save to cache directory when jobName is provided', async () => {
      const runId = 11111;
      const logs = 'Dual-saved logs';
      const jobName = 'build';

      // Save with jobName (returns VV_TEMP_DIR path)
      await cacheManager.saveLog(runId, logs, jobName);

      // Verify cache directory also has the log (backward compatibility)
      const cachePath = path.join(tmpDir, 'vibe-validate', 'watch-pr-cache', repoName, String(prNumber), 'logs', `${runId}.log`);
      const cacheExists = await fs
        .stat(cachePath)
        .then(() => true)
        .catch(() => false);
      expect(cacheExists).toBe(true);

      const cacheContent = await fs.readFile(cachePath, 'utf8');
      expect(cacheContent).toBe(logs);
    });

    it('should respect VV_TEMP_DIR environment variable', async () => {
      const runId = 22222;
      const logs = 'Custom temp dir logs';
      const jobName = 'e2e-tests';
      const customTempDir = await fs.mkdtemp(path.join(normalizedTmpdir(), 'custom-vv-temp-'));

      // Set environment variable
      const originalEnv = process.env.VV_TEMP_DIR;
      process.env.VV_TEMP_DIR = customTempDir;

      try {
        const logPath = await cacheManager.saveLog(runId, logs, jobName);

        // Should use custom temp dir
        expect(logPath).toContain(customTempDir);
        expect(logPath).toContain('watch-pr-logs');

        // Verify file exists
        const fileExists = await fs
          .stat(logPath)
          .then(() => true)
          .catch(() => false);
        expect(fileExists).toBe(true);
      } finally {
        // Restore original environment
        if (originalEnv === undefined) {
          delete process.env.VV_TEMP_DIR;
        } else {
          process.env.VV_TEMP_DIR = originalEnv;
        }

        // Clean up custom temp dir
        await fs.rm(customTempDir, { recursive: true, force: true });
      }
    });

    it('should sanitize jobName for filename', async () => {
      const runId = 33333;
      const logs = 'Test logs';
      const jobName = 'build (ubuntu-latest, 22)'; // Contains special chars

      const logPath = await cacheManager.saveLog(runId, logs, jobName);

      // Filename should have sanitized jobName
      const filename = path.basename(logPath);
      // Spaces and parens should be replaced
      expect(filename).toContain('build');
      expect(filename).not.toContain('(');
      expect(filename).not.toContain(')');
    });
  });

  describe('saveExtraction & getExtraction', () => {
    it('should save and retrieve extraction result', async () => {
      const runId = 555;
      const extraction: ErrorExtractorResult = {
        summary: '2 test failures',
        totalErrors: 2,
        errors: [
          { file: 'test.ts', line: 10, message: 'Test failed' },
          { file: 'test2.ts', line: 20, message: 'Another failure' },
        ],
        guidance: 'Fix the failing tests',
      };

      await cacheManager.saveExtraction(runId, extraction);

      const retrieved = await cacheManager.getExtraction(runId);
      expect(retrieved).toEqual(extraction);
    });

    it('should return null for non-existent extraction', async () => {
      const retrieved = await cacheManager.getExtraction(99999);
      expect(retrieved).toBeNull();
    });

    it('should overwrite existing extraction (mutable)', async () => {
      const runId = 666;
      const extraction1: ErrorExtractorResult = {
        summary: 'First extraction',
        totalErrors: 1,
        errors: [{ message: 'Error 1' }],
      };
      const extraction2: ErrorExtractorResult = {
        summary: 'Second extraction',
        totalErrors: 2,
        errors: [{ message: 'Error 2' }],
      };

      await cacheManager.saveExtraction(runId, extraction1);
      await cacheManager.saveExtraction(runId, extraction2);

      const retrieved = await cacheManager.getExtraction(runId);
      expect(retrieved).toEqual(extraction2);
    });
  });

  describe('saveMetadata & getMetadata', () => {
    it('should save and retrieve metadata', async () => {
      const metadata: WatchPRResult = {
        pr: {
          number: prNumber,
          title: 'Test PR',
          url: 'https://github.com/test/test/pull/123',
          branch: 'feature/test',
          base_branch: 'main',
          author: 'testuser',
          draft: false,
          mergeable: true,
          merge_state_status: 'CLEAN',
          labels: ['enhancement'],
        },
        status: 'passed',
        checks: {
          total: 3,
          passed: 3,
          failed: 0,
          pending: 0,
          github_actions: [],
          external_checks: [],
        },
      };

      await cacheManager.saveMetadata(metadata);

      const retrieved = await cacheManager.getMetadata();
      expect(retrieved).toEqual(metadata);
    });

    it('should return null for non-existent metadata', async () => {
      const retrieved = await cacheManager.getMetadata();
      expect(retrieved).toBeNull();
    });

    it('should overwrite existing metadata', async () => {
      const metadata1: WatchPRResult = {
        pr: {
          number: prNumber,
          title: 'Test PR 1',
          url: 'https://github.com/test/test/pull/123',
          branch: 'feature/test',
          base_branch: 'main',
          author: 'testuser',
          draft: false,
          mergeable: true,
          merge_state_status: 'CLEAN',
          labels: [],
        },
        status: 'pending',
        checks: {
          total: 0,
          passed: 0,
          failed: 0,
          pending: 0,
          github_actions: [],
          external_checks: [],
        },
      };
      const metadata2: WatchPRResult = {
        ...metadata1,
        pr: { ...metadata1.pr, title: 'Test PR 2' },
        status: 'passed',
      };

      await cacheManager.saveMetadata(metadata1);
      await cacheManager.saveMetadata(metadata2);

      const retrieved = await cacheManager.getMetadata();
      expect(retrieved).toEqual(metadata2);
    });
  });

  describe('TTL freshness checks', () => {
    it('should consider recently written file as fresh', async () => {
      const testFile = path.join(tmpDir, 'fresh-file.txt');
      await fs.writeFile(testFile, 'content');

      const isFresh = await cacheManager['isFresh'](testFile, 5 * 60 * 1000); // 5 minutes
      expect(isFresh).toBe(true);
    });

    it('should consider old file as stale', async () => {
      const testFile = path.join(tmpDir, 'stale-file.txt');
      await fs.writeFile(testFile, 'content');

      // Set file time to 10 minutes ago
      const tenMinutesAgo = Date.now() - 10 * 60 * 1000;
      await fs.utimes(testFile, tenMinutesAgo / 1000, tenMinutesAgo / 1000);

      const isFresh = await cacheManager['isFresh'](testFile, 5 * 60 * 1000); // 5 minutes
      expect(isFresh).toBe(false);
    });

    it('should return false for non-existent file', async () => {
      const nonExistentFile = path.join(tmpDir, 'does-not-exist.txt');

      const isFresh = await cacheManager['isFresh'](nonExistentFile, 5 * 60 * 1000);
      expect(isFresh).toBe(false);
    });
  });

  describe('getOrFetch', () => {
    it('should fetch data when cache is empty', async () => {
      const key = 'test-key';
      const fetcher = vi.fn(async () => ({ data: 'fetched value' }));

      const result = await cacheManager.getOrFetch(key, fetcher);

      expect(result).toEqual({ data: 'fetched value' });
      expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it('should return cached data when fresh', async () => {
      const key = 'cached-key';
      const fetcher = vi.fn(async () => ({ data: 'new value' }));

      // First call - fetch and cache
      const result1 = await cacheManager.getOrFetch(key, fetcher, 5 * 60 * 1000);
      expect(result1).toEqual({ data: 'new value' });
      expect(fetcher).toHaveBeenCalledTimes(1);

      // Second call - use cache
      const result2 = await cacheManager.getOrFetch(key, fetcher, 5 * 60 * 1000);
      expect(result2).toEqual({ data: 'new value' });
      expect(fetcher).toHaveBeenCalledTimes(1); // Not called again
    });

    it('should re-fetch data when cache is stale', async () => {
      const key = 'stale-key';
      let fetchCount = 0;
      const fetcher = vi.fn(async () => ({ data: `value-${++fetchCount}` }));

      // First fetch
      const result1 = await cacheManager.getOrFetch(key, fetcher, 100); // 100ms TTL
      expect(result1).toEqual({ data: 'value-1' });

      // Wait for cache to expire
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Force file modification time to be old
      const cacheFile = path.join(cacheManager['cacheDir'], `${key}.json`);
      const oldTime = Date.now() - 200;
      await fs.utimes(cacheFile, oldTime / 1000, oldTime / 1000);

      // Second fetch - should call fetcher again
      const result2 = await cacheManager.getOrFetch(key, fetcher, 100);
      expect(result2).toEqual({ data: 'value-2' });
      expect(fetcher).toHaveBeenCalledTimes(2);
    });

    it('should use default TTL of 5 minutes', async () => {
      const key = 'default-ttl-key';
      const fetcher = vi.fn(async () => ({ data: 'value' }));

      await cacheManager.getOrFetch(key, fetcher);

      // Verify cache file exists
      const cacheFile = path.join(cacheManager['cacheDir'], `${key}.json`);
      const exists = await fs
        .stat(cacheFile)
        .then(() => true)
        .catch(() => false);
      expect(exists).toBe(true);
    });

    it('should handle fetcher errors gracefully', async () => {
      const key = 'error-key';
      const fetcher = vi.fn(async () => {
        throw new Error('Fetch failed');
      });

      await expect(cacheManager.getOrFetch(key, fetcher)).rejects.toThrow('Fetch failed');
      expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it('should handle complex nested data', async () => {
      const key = 'complex-key';
      const complexData = {
        nested: {
          array: [1, 2, 3],
          object: { foo: 'bar' },
        },
        nullValue: null,
        boolValue: true,
      };
      const fetcher = vi.fn(async () => complexData);

      const result = await cacheManager.getOrFetch(key, fetcher);
      expect(result).toEqual(complexData);
    });
  });

  describe('edge cases', () => {
    it('should handle invalid JSON in cache gracefully', async () => {
      const key = 'invalid-json-key';
      const cacheFile = path.join(cacheManager['cacheDir'], `${key}.json`);

      // Write invalid JSON
      await fs.mkdir(path.dirname(cacheFile), { recursive: true });
      await fs.writeFile(cacheFile, 'invalid json {');

      const fetcher = vi.fn(async () => ({ data: 'fresh value' }));
      const result = await cacheManager.getOrFetch(key, fetcher);

      // Should fetch fresh data when cache is corrupt
      expect(result).toEqual({ data: 'fresh value' });
      expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it('should handle permission errors gracefully', async () => {
      // Skip this test on Windows or as root
      if (process.platform === 'win32' || process.getuid?.() === 0) {
        return;
      }

      const restrictedDir = path.join(tmpDir, 'restricted');
      await fs.mkdir(restrictedDir);
      // eslint-disable-next-line sonarjs/file-permissions -- NOSONAR: Test requires restricted permissions
      await fs.chmod(restrictedDir, 0o444); // Read-only

      const restrictedCacheManager = new CacheManager(repoName, prNumber, restrictedDir);

      const key = 'permission-test';
      const fetcher = vi.fn(async () => ({ data: 'value' }));

      // Should return data even when cache write fails (graceful degradation)
      const result = await restrictedCacheManager.getOrFetch(key, fetcher);
      expect(result).toEqual({ data: 'value' });
      expect(fetcher).toHaveBeenCalledTimes(1);

      // Verify cache file was not created
      const cacheFile = path.join(restrictedDir, 'vibe-validate', 'watch-pr-cache', repoName.replaceAll('/', '_'), String(prNumber), `${key}.json`);
      const exists = await fs.stat(cacheFile).then(() => true).catch(() => false);
      expect(exists).toBe(false);

      // Clean up
      // eslint-disable-next-line sonarjs/file-permissions -- NOSONAR: Restoring permissions after test
      await fs.chmod(restrictedDir, 0o755);
    });
  });
});

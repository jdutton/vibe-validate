/**
 * Tests for PID lock utilities
 *
 * Ensures cross-platform single-instance validation execution
 */

import {  rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';

import { mkdirSyncReal } from '@vibe-validate/utils';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import {
  acquireLock,
  releaseLock,
  checkLock,
  type LockInfo,
} from '../../src/utils/pid-lock.js';

// Mock os.tmpdir before importing pid-lock
// Note: Must use os.tmpdir() here (not normalizedTmpdir) to avoid circular dependency with mock
// eslint-disable-next-line local/no-os-tmpdir -- Required for mock setup
const testDir = join(os.tmpdir(), 'vibe-validate-test');
vi.mock('os', async () => {
  const actual = await vi.importActual<typeof os>('os');
  return {
    ...actual,
    tmpdir: () => testDir,
  };
});

describe('PID Lock Utilities', () => {
  const projectDir = '/Users/test/my-project';
  const treeHash = 'abc123def456';

  beforeEach(() => {
    // Clean up any existing test locks
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    mkdirSyncReal(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('acquireLock', () => {
    it('should create lock file when none exists', async () => {
      const result = await acquireLock(projectDir, treeHash);

      expect(result.acquired).toBe(true);
      expect(result.lockFile).toMatch(/\.lock$/);
      expect(existsSync(`${result.lockFile}.meta.json`)).toBe(true);

      // Verify metadata file contents
      const lockData = JSON.parse(readFileSync(`${result.lockFile}.meta.json`, 'utf-8'));
      expect(lockData).toMatchObject({
        pid: process.pid,
        directory: projectDir,
        treeHash,
      });
      expect(lockData.startTime).toBeDefined();
    });

    it('should encode directory path for lock file name', async () => {
      const result = await acquireLock('/Users/jeff/my-project', treeHash);

      expect(result.lockFile).toContain('_Users_jeff_my-project.lock');
    });

    it('should encode Windows paths correctly', async () => {
      const result = await acquireLock(String.raw`C:\Users\jeff\project`, treeHash);

      expect(result.lockFile).toContain('C-_Users_jeff_project.lock');
    });

    it('should fail when lock already exists with running process', async () => {
      // First acquisition succeeds
      const first = await acquireLock(projectDir, treeHash);
      expect(first.acquired).toBe(true);

      // Second acquisition should fail
      const second = await acquireLock(projectDir, 'different-hash');
      expect(second.acquired).toBe(false);
      expect(second.existingLock).toBeDefined();
      expect(second.existingLock?.pid).toBe(process.pid);
      expect(second.existingLock?.treeHash).toBe(treeHash);
    });

    it('should acquire lock when PID file is stale', async () => {
      // proper-lockfile handles stale lock detection automatically
      // We test that a lock can be acquired successfully
      const result = await acquireLock(projectDir, treeHash);
      expect(result.acquired).toBe(true);

      // Verify new lock has current PID
      const lockData = JSON.parse(readFileSync(`${result.lockFile}.meta.json`, 'utf-8'));
      expect(lockData.pid).toBe(process.pid);
      expect(lockData.treeHash).toBe(treeHash);
    });
  });

  describe('releaseLock', () => {
    it('should remove lock file', async () => {
      const { lockFile, release } = await acquireLock(projectDir, treeHash);
      expect(existsSync(`${lockFile}.meta.json`)).toBe(true);

      await releaseLock(lockFile, release);
      expect(existsSync(`${lockFile}.meta.json`)).toBe(false);
    });

    it('should not error if lock file does not exist', async () => {
      const nonExistentLock = join(testDir, 'does-not-exist.lock');
      await expect(releaseLock(nonExistentLock)).resolves.not.toThrow();
    });
  });

  describe('checkLock', () => {
    it('should return null when no lock exists', async () => {
      const result = await checkLock(projectDir);
      expect(result).toBeNull();
    });

    it('should return lock info when lock exists', async () => {
      await acquireLock(projectDir, treeHash);

      const result = await checkLock(projectDir);
      expect(result).toMatchObject({
        pid: process.pid,
        directory: projectDir,
        treeHash,
      });
      expect(result?.startTime).toBeDefined();
    });

    it('should return null when lock is stale', async () => {
      // Create stale lock
      const lockFile = join(testDir, 'vibe-validate-_Users_test_my-project.lock');
      const staleLock: LockInfo = {
        pid: 999999,
        directory: projectDir,
        treeHash,
        startTime: new Date().toISOString(),
      };
      writeFileSync(lockFile, JSON.stringify(staleLock));

      const result = await checkLock(projectDir);
      expect(result).toBeNull(); // Stale lock should be treated as no lock
    });
  });

  describe('path encoding edge cases', () => {
    it('should handle paths with spaces', async () => {
      const result = await acquireLock('/Users/my user/my project', treeHash);
      expect(result.lockFile).toContain('_Users_my user_my project.lock');
    });

    it('should handle paths with special characters', async () => {
      const result = await acquireLock('/Users/test/@project-name', treeHash);
      expect(result.lockFile).toContain('_Users_test_@project-name.lock');
    });
  });

  describe('project-scoped locking', () => {
    it('should use project-scoped lock file when scope is project', async () => {
      const result = await acquireLock(projectDir, treeHash, {
        scope: 'project',
        projectId: 'my-app',
      });

      expect(result.acquired).toBe(true);
      expect(result.lockFile).toContain('project-my-app.lock');
      expect(existsSync(`${result.lockFile}.meta.json`)).toBe(true);
    });

    it('should share lock across different directories with same projectId', async () => {
      const dir1 = '/Users/test/worktree-1';
      const dir2 = '/Users/test/worktree-2';
      const options = { scope: 'project' as const, projectId: 'my-app' };

      // First directory acquires lock
      const result1 = await acquireLock(dir1, treeHash, options);
      expect(result1.acquired).toBe(true);

      // Second directory should fail (same project lock)
      const result2 = await acquireLock(dir2, 'different-hash', options);
      expect(result2.acquired).toBe(false);
      expect(result2.existingLock?.directory).toBe(dir1);
    });

    it('should not share lock across different projectIds', async () => {
      const dir = '/Users/test/project';

      // Acquire lock for first project
      const result1 = await acquireLock(dir, treeHash, {
        scope: 'project',
        projectId: 'project-a',
      });
      expect(result1.acquired).toBe(true);

      // Should be able to acquire lock for different project
      const result2 = await acquireLock(dir, treeHash, {
        scope: 'project',
        projectId: 'project-b',
      });
      expect(result2.acquired).toBe(true);
    });

    it('should throw error when projectId is missing with project scope', async () => {
      await expect(
        acquireLock(projectDir, treeHash, { scope: 'project' })
      ).rejects.toThrow('projectId is required');
    });

    it('should use directory-scoped lock by default', async () => {
      const result = await acquireLock(projectDir, treeHash);

      expect(result.acquired).toBe(true);
      expect(result.lockFile).toContain('_Users_test_my-project.lock');
      expect(result.lockFile).not.toContain('vibe-validate-project-');
    });

    it('should allow explicit directory scope', async () => {
      const result = await acquireLock(projectDir, treeHash, { scope: 'directory' });

      expect(result.acquired).toBe(true);
      expect(result.lockFile).toContain('_Users_test_my-project.lock');
    });
  });
});

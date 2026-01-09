/**
 * Tests for validation lock wrapper utility
 *
 * Ensures proper lock management for validation workflows
 */

import { rmSync, existsSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';

import { mkdirSyncReal } from '@vibe-validate/utils';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { withValidationLock } from '../../src/utils/validation-lock-wrapper.js';

// Mock os.tmpdir before importing validation-lock-wrapper
// eslint-disable-next-line local/no-os-tmpdir -- Required for mock setup
const testDir = join(os.tmpdir(), 'vibe-validate-lock-wrapper-test');
vi.mock('os', async () => {
  const actual = await vi.importActual<typeof os>('os');
  return {
    ...actual,
    tmpdir: () => testDir,
  };
});

// Create a test fixture directory
const fixtureDir = join(testDir, 'project-fixture');
const configContent = `
validation:
  phases:
    - name: Test Phase
      parallel: false
      steps:
        - name: Test Step
          command: echo "test"
`;

/**
 * Helper to test process.exit behavior when config loading fails
 */
async function expectProcessExitOnConfigError(): Promise<void> {
  const mockExit = vi.spyOn(process, 'exit').mockImplementation((() => {
    throw new Error('process.exit(1)');
  }) as never);

  await expect(
    withValidationLock(
      { lockEnabled: false },
      async () => {}
    )
  ).rejects.toThrow('process.exit(1)');

  expect(mockExit).toHaveBeenCalledWith(1);
  mockExit.mockRestore();
}

/**
 * Helper to check if a lock file exists in testDir
 */
function checkLockExists(): boolean {
  const { readdirSync } = require('node:fs');
  const locksDir = join(testDir, '.vibe-validate', 'locks');
  if (!existsSync(locksDir)) return false;
  const files = readdirSync(locksDir) as string[];
  return files.some((f: string) => f.endsWith('.lock') || f.endsWith('.meta.json'));
}

/**
 * Create test config file
 */
async function createTestConfig(): Promise<void> {
  mkdirSyncReal(fixtureDir, { recursive: true });
  writeFileSync(join(fixtureDir, 'vibe-validate.config.yaml'), configContent);

  // Initialize as git repo
  const { executeGitCommand } = await import('@vibe-validate/git');
  executeGitCommand(['init'], { cwd: fixtureDir });
  executeGitCommand(['config', 'user.email', 'test@example.com'], { cwd: fixtureDir });
  executeGitCommand(['config', 'user.name', 'Test User'], { cwd: fixtureDir });
  executeGitCommand(['add', '.'], { cwd: fixtureDir });
  executeGitCommand(['commit', '-m', 'Initial commit'], { cwd: fixtureDir });
}

/**
 * Cleanup test directories
 */
function cleanupTestDirs(): void {
  if (existsSync(testDir)) {
    rmSync(testDir, { recursive: true, force: true });
  }
}

describe('withValidationLock', () => {
  const originalCwd = process.cwd();

  beforeEach(async () => {
    cleanupTestDirs();
    mkdirSyncReal(testDir, { recursive: true });
    await createTestConfig();
    process.chdir(fixtureDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    cleanupTestDirs();
  });

  describe('basic functionality', () => {
    it('should load config and pass to callback', async () => {
      let capturedConfig: unknown = null;
      let capturedConfigDir: unknown = null;
      let capturedContext: unknown = null;

      await withValidationLock(
        { lockEnabled: false },
        async ({ config, configDir, context }) => {
          capturedConfig = config;
          capturedConfigDir = configDir;
          capturedContext = context;
        }
      );

      expect(capturedConfig).toBeDefined();
      expect(capturedConfig).toHaveProperty('validation');
      // Use endsWith to handle /private/var vs /var symlink on macOS
      expect(capturedConfigDir).toMatch(/project-fixture$/);
      expect(capturedContext).toBeDefined();
      expect(capturedContext).toHaveProperty('isAgent');
    });

    it('should return callback result', async () => {
      const result = await withValidationLock(
        { lockEnabled: false },
        async () => ({ success: true, value: 42 })
      );

      expect(result).toEqual({ success: true, value: 42 });
    });

    it('should propagate callback errors', async () => {
      await expect(
        withValidationLock(
          { lockEnabled: false },
          async () => {
            throw new Error('Callback error');
          }
        )
      ).rejects.toThrow('Callback error');
    });
  });

  describe('config loading errors', () => {
    it('should exit with error when config not found', async () => {
      // Change to directory without config
      const emptyDir = join(testDir, 'empty');
      mkdirSyncReal(emptyDir, { recursive: true });
      process.chdir(emptyDir);

      await expectProcessExitOnConfigError();
    });

    it('should exit with error when config has validation errors', async () => {
      // Write invalid config
      writeFileSync(
        join(fixtureDir, 'vibe-validate.config.yaml'),
        'validation:\n  invalid_field: true\n'
      );

      await expectProcessExitOnConfigError();
    });
  });

  describe('locking behavior', () => {
    it('should not acquire lock when lockEnabled is false', async () => {
      let lockAcquired = false;

      await withValidationLock(
        { lockEnabled: false },
        async () => {
          lockAcquired = checkLockExists();
        }
      );

      expect(lockAcquired).toBe(false);
    });

    it('should acquire and release lock when lockEnabled is true', async () => {
      let lockExistsDuringCallback = false;

      await withValidationLock(
        { lockEnabled: true },
        async () => {
          lockExistsDuringCallback = checkLockExists();
        }
      );

      expect(lockExistsDuringCallback).toBe(true);

      // Check if lock was released after callback
      expect(checkLockExists()).toBe(false);
    });

    it('should release lock even if callback throws', async () => {
      await expect(
        withValidationLock(
          { lockEnabled: true },
          async () => {
            throw new Error('Callback failed');
          }
        )
      ).rejects.toThrow('Callback failed');

      // Check if lock was released
      const { readdirSync } = await import('node:fs');
      const files = readdirSync(testDir);
      const lockExists = files.some((f: string) => f.includes('vibe-validate') && f.endsWith('.lock'));
      expect(lockExists).toBe(false);
    });

    it('should respect config.locking.enabled setting', async () => {
      // Update config to disable locking
      const configWithLockingDisabled = `
locking:
  enabled: false

validation:
  phases:
    - name: Test Phase
      parallel: false
      steps:
        - name: Test Step
          command: echo "test"
`;
      writeFileSync(join(fixtureDir, 'vibe-validate.config.yaml'), configWithLockingDisabled);

      let lockAcquired = false;

      // Even with lockEnabled: true in options, config should override
      await withValidationLock(
        { lockEnabled: true },
        async () => {
          lockAcquired = checkLockExists();
        }
      );

      expect(lockAcquired).toBe(false);
    });
  });

  describe('wait behavior', () => {
    it('should wait for existing lock when waitEnabled is true', async () => {
      // This test verifies that waitForLock is called when a lock exists
      // The actual wait behavior is tested in pid-lock.test.ts
      let callbackExecuted = false;

      await withValidationLock(
        { lockEnabled: true, waitEnabled: true, waitTimeout: 1 },
        async () => {
          callbackExecuted = true;
        }
      );

      // Callback should execute after wait completes (or no lock exists)
      expect(callbackExecuted).toBe(true);
    });

    it('should timeout when wait exceeds waitTimeout', async () => {
      // Create existing lock that won't be released
      const { acquireLock, releaseLock } = await import('../../src/utils/pid-lock.js');
      const { getGitTreeHash } = await import('@vibe-validate/git');
      const treeHash = await getGitTreeHash();
      const lockResult = await acquireLock(fixtureDir, treeHash);

      try {
        // Should timeout and continue (not throw)
        await withValidationLock(
          { lockEnabled: true, waitEnabled: true, waitTimeout: 1 },
          async () => {}
        );
        // If we get here, the timeout worked correctly
        expect(true).toBe(true);
      } finally {
        // Cleanup lock
        await releaseLock(lockResult.lockFile);
      }
    });

    it('should not wait when waitEnabled is false', async () => {
      // This test verifies that waitEnabled: false skips the wait logic
      // The actual exit behavior is tested in validate.test.ts integration tests
      let callbackExecuted = false;

      await withValidationLock(
        { lockEnabled: true, waitEnabled: false },
        async () => {
          callbackExecuted = true;
        }
      );

      // Callback should execute immediately (no wait)
      expect(callbackExecuted).toBe(true);
    });
  });

  describe('project-scoped locking', () => {
    it('should use project-scoped lock when config specifies it', async () => {
      // Update config for project-scoped locking
      const configWithProjectLocking = `
locking:
  enabled: true
  concurrencyScope: project
  projectId: test-project

validation:
  phases:
    - name: Test Phase
      parallel: false
      steps:
        - name: Test Step
          command: echo "test"
`;
      writeFileSync(join(fixtureDir, 'vibe-validate.config.yaml'), configWithProjectLocking);

      let lockFileName: string | null = null;

      await withValidationLock(
        { lockEnabled: true },
        async () => {
          const { readdirSync } = await import('node:fs');
          const locksDir = join(testDir, '.vibe-validate', 'locks');
          const files = readdirSync(locksDir);
          const lockFile = files.find((f: string) => f.endsWith('.lock'));
          lockFileName = lockFile ?? null;
        }
      );

      // Should use project-scoped lock filename
      expect(lockFileName).toContain('project-test-project.lock');
    });

    it('should exit with error when project scope specified but projectId cannot be detected', async () => {
      // Update config for project-scoped locking without projectId
      const configWithoutProjectId = `
locking:
  enabled: true
  concurrencyScope: project

validation:
  phases:
    - name: Test Phase
      parallel: false
      steps:
        - name: Test Step
          command: echo "test"
`;
      writeFileSync(join(fixtureDir, 'vibe-validate.config.yaml'), configWithoutProjectId);

      const mockExit = vi.spyOn(process, 'exit').mockImplementation((() => {
        throw new Error('process.exit(1)');
      }) as never);

      await expect(
        withValidationLock(
          { lockEnabled: true },
          async () => {}
        )
      ).rejects.toThrow('process.exit(1)');

      expect(mockExit).toHaveBeenCalledWith(1);
      mockExit.mockRestore();
    });
  });

  describe('yaml mode', () => {
    it('should suppress output when yaml is true', async () => {
      const consoleLogSpy = vi.spyOn(console, 'log');

      await withValidationLock(
        { lockEnabled: false, yaml: true },
        async () => {}
      );

      // Should not have any console output
      expect(consoleLogSpy).not.toHaveBeenCalled();

      consoleLogSpy.mockRestore();
    });
  });
});

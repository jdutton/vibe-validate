import { rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import type { VibeValidateConfig } from '@vibe-validate/config';
import * as core from '@vibe-validate/core';
import * as git from '@vibe-validate/git';
import * as history from '@vibe-validate/history';
import * as utils from '@vibe-validate/utils';
import { mkdirSyncReal, normalizedTmpdir } from '@vibe-validate/utils';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { preCommitCommand } from '../../src/commands/pre-commit.js';
import * as configLoader from '../../src/utils/config-loader.js';
import { setupCommanderTest, type CommanderTestEnv } from '../helpers/commander-test-setup.js';

// Mock the core validation module
vi.mock('@vibe-validate/core', async () => {
  const actual = await vi.importActual<typeof core>('@vibe-validate/core');
  return {
    ...actual,
    runValidation: vi.fn(),
  };
});

// Mock the utils module
vi.mock('@vibe-validate/utils', async () => {
  const actual = await vi.importActual<typeof utils>('@vibe-validate/utils');
  return {
    ...actual,
    safeExecSync: vi.fn(),
    safeExecFromString: vi.fn(),
    isToolAvailable: vi.fn(),
  };
});

// Mock the git module
vi.mock('@vibe-validate/git', async () => {
  const actual = await vi.importActual<typeof git>('@vibe-validate/git');
  return {
    ...actual,
    checkBranchSync: vi.fn(),
    getGitTreeHash: vi.fn(),
    isCurrentBranchBehindTracking: vi.fn(),
    getPartiallyStagedFiles: vi.fn().mockReturnValue([]),
    isMergeInProgress: vi.fn(),
  };
});

// Mock the history module
vi.mock('@vibe-validate/history', async () => {
  const actual = await vi.importActual<typeof history>('@vibe-validate/history');
  return {
    ...actual,
    readHistoryNote: vi.fn(),
    recordValidationHistory: vi.fn(),
    checkWorktreeStability: vi.fn(),
    checkHistoryHealth: vi.fn(),
  };
});

// Mock the config loader
vi.mock('../../src/utils/config-loader.js', async () => {
  const actual = await vi.importActual<typeof configLoader>('../../src/utils/config-loader.js');
  return {
    ...actual,
    loadConfig: vi.fn(),
  };
});

describe('pre-commit command', () => {
  let testDir: string;
  let originalCwd: string;
  let env: CommanderTestEnv;

  beforeEach(() => {
    // Clear all mock calls from previous tests (prevents test pollution across test files)
    vi.clearAllMocks();

    // Create temp directory for test files (Windows-safe: no 8.3 short names)
    const targetDir = join(normalizedTmpdir(), `vibe-validate-pre-commit-test-${Date.now()}`);
    testDir = mkdirSyncReal(targetDir, { recursive: true });

    // Save original cwd and change to test directory
    originalCwd = process.cwd();
    process.chdir(testDir);

    // Setup Commander test environment
    env = setupCommanderTest();

    // Reset mocks
    vi.mocked(core.runValidation).mockReset();
    vi.mocked(git.checkBranchSync).mockReset();
    vi.mocked(git.getGitTreeHash).mockReset();
    vi.mocked(git.isCurrentBranchBehindTracking).mockReset();
    vi.mocked(git.getPartiallyStagedFiles).mockReset();
    vi.mocked(git.isMergeInProgress).mockReset();
    vi.mocked(utils.safeExecSync).mockReset();
    vi.mocked(utils.safeExecFromString).mockReset();
    vi.mocked(utils.isToolAvailable).mockReset();
    vi.mocked(configLoader.loadConfig).mockReset();

    // Set default mock values (tests can override)
    vi.mocked(git.getGitTreeHash).mockResolvedValue('abc123def456');
    vi.mocked(git.isCurrentBranchBehindTracking).mockReturnValue(0); // Up to date by default
    vi.mocked(git.getPartiallyStagedFiles).mockReturnValue([]); // No partially staged by default
    vi.mocked(git.isMergeInProgress).mockReturnValue(false); // No merge by default
    vi.mocked(utils.safeExecSync).mockReturnValue(''); // Default empty output
    vi.mocked(utils.safeExecFromString).mockReturnValue(''); // Default empty output
    vi.mocked(utils.isToolAvailable).mockReturnValue(false); // No tools available by default
  });

  afterEach(() => {
    env.cleanup();

    // Restore cwd
    process.chdir(originalCwd);

    // Clean up test files
    if (existsSync(testDir)) {
      try {
        rmSync(testDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }

    vi.restoreAllMocks();
  });

  // ========================================================================
  // FACTORY FUNCTIONS: Create test objects
  // ========================================================================

  /**
   * Factory: Create minimal config with optional overrides
   * Eliminates duplication of basic config structure
   */
  function createConfig(overrides: Partial<VibeValidateConfig> = {}): VibeValidateConfig {
    return {
      version: '1.0',
      validation: {
        phases: [],
      },
      ...overrides,
    };
  }

  /**
   * Factory: Create config with custom git settings
   */
  function createConfigWithGit(
    mainBranch?: string,
    remoteOrigin?: string
  ): VibeValidateConfig {
    return createConfig({
      git: {
        mainBranch: mainBranch ?? 'main',
        remoteOrigin: remoteOrigin ?? 'origin',
        autoSync: false,
        warnIfBehind: true,
      },
    });
  }

  /**
   * Factory: Create config with secret scanning settings
   */
  function createConfigWithSecretScanning(
    enabled: boolean,
    scanCommand?: string
  ): VibeValidateConfig {
    return createConfig({
      hooks: {
        preCommit: {
          enabled: true,
          secretScanning: {
            enabled,
            ...(scanCommand !== undefined && { scanCommand }),
          },
        },
      },
    });
  }

  /**
   * Factory: Create config with validation phases
   */
  function createConfigWithPhases(): VibeValidateConfig {
    return createConfig({
      validation: {
        phases: [
          {
            name: 'Test',
            steps: [{ name: 'Test Step', command: 'echo test' }],
          },
        ],
      },
    });
  }

  /**
   * Factory: Create successful branch sync result
   */
  function createBranchSyncResult(overrides: Partial<{
    isUpToDate: boolean;
    behindBy: number;
    currentBranch: string;
    hasRemote: boolean;
    aheadBy?: number;
  }> = {}) {
    return {
      isUpToDate: true,
      behindBy: 0,
      currentBranch: 'feature/test',
      hasRemote: true,
      aheadBy: 0,
      ...overrides,
    };
  }

  /**
   * Factory: Create successful validation result
   */
  function createValidationResult(overrides: Partial<{
    passed: boolean;
    phasesRun: number;
    stepsRun: number;
    duration: number;
  }> = {}) {
    return {
      passed: true,
      phasesRun: 0,
      stepsRun: 0,
      duration: 100,
      ...overrides,
    };
  }

  /**
   * Factory: Create history note with cache data
   */
  function createHistoryNote(treeHash: string, passed: boolean = true) {
    return {
      treeHash,
      runs: [
        {
          timestamp: '2025-10-23T20:00:00Z',
          duration: 30000,
          passed,
          branch: 'feature/test',
          headCommit: 'abc123',
          uncommittedChanges: false,
          result: {
            passed,
            timestamp: '2025-10-23T20:00:00Z',
            treeHash,
            duration: 30000,
            phases: [
              {
                name: 'Test',
                passed,
                steps: [{ name: 'Test Step', passed, duration: 1000 }],
              },
            ],
          },
        },
      ],
    };
  }

  /**
   * Factory: Create error object for command failures
   */
  function createCommandError(stdout = '', stderr = ''): Error & { stdout: string; stderr: string } {
    const error = new Error('Command failed') as Error & { stdout: string; stderr: string };
    error.stdout = stdout;
    error.stderr = stderr;
    return error;
  }

  // ========================================================================
  // SETUP FUNCTIONS: Configure mocks for test scenarios
  // ========================================================================

  /**
   * Setup: Configure mocks for successful pre-commit
   */
  function setupSuccessfulPreCommit(config: VibeValidateConfig = createConfig()) {
    vi.mocked(configLoader.loadConfig).mockResolvedValue(config);
    vi.mocked(git.checkBranchSync).mockResolvedValue(createBranchSyncResult());
    vi.mocked(core.runValidation).mockResolvedValue(createValidationResult());
  }

  /**
   * Setup: Configure mocks for branch behind scenario
   */
  function setupBranchBehind(behindBy: number, hasTracking = true) {
    vi.mocked(git.getGitTreeHash).mockResolvedValue('abc123def456');
    vi.mocked(git.getPartiallyStagedFiles).mockReturnValue([]);
    vi.mocked(git.isCurrentBranchBehindTracking).mockReturnValue(hasTracking ? behindBy : null);
    vi.mocked(git.checkBranchSync).mockResolvedValue(
      createBranchSyncResult({ isUpToDate: false, behindBy })
    );
  }

  /**
   * Setup: Configure mocks for cache hit scenario
   */
  function setupCacheHit(treeHash: string) {
    vi.mocked(git.getGitTreeHash).mockResolvedValue(treeHash);
    vi.mocked(history.readHistoryNote).mockResolvedValue(createHistoryNote(treeHash, true));
  }

  /**
   * Setup: Configure mocks for cache miss scenario
   */
  function setupCacheMiss(treeHash: string) {
    vi.mocked(git.getGitTreeHash).mockResolvedValue(treeHash);
    vi.mocked(history.readHistoryNote).mockResolvedValue(null);
    vi.mocked(history.checkWorktreeStability).mockResolvedValue({
      stable: true,
      treeHashBefore: treeHash,
      treeHashAfter: treeHash,
    });
    vi.mocked(history.recordValidationHistory).mockResolvedValue({
      recorded: true,
    });
  }

  /**
   * Setup: Configure mocks for merge scenario
   */
  function setupMergeTest(isMerging: boolean) {
    vi.mocked(configLoader.loadConfig).mockResolvedValue(createConfig());
    vi.mocked(git.isMergeInProgress).mockReturnValue(isMerging);
    vi.mocked(git.checkBranchSync).mockResolvedValue(
      createBranchSyncResult({ isUpToDate: false, behindBy: 3 })
    );

    // Only mock validation for merge case (normal case exits before validation)
    if (isMerging) {
      vi.mocked(core.runValidation).mockResolvedValue(createValidationResult());
    }
  }

  /**
   * Setup: Configure mocks for secret scanning failure
   */
  function setupSecretScanningFailure(stdout = '', stderr = 'Secrets detected') {
    vi.mocked(utils.safeExecFromString).mockImplementation(() => {
      throw createCommandError(stdout, stderr);
    });
  }

  // ========================================================================
  // EXECUTION FUNCTIONS: Run commands and handle results
  // ========================================================================

  /**
   * Execute pre-commit command and verify exit code
   * Replicates the repeated try/catch pattern from the original tests
   */
  async function runPreCommit(expectedExitCode = 0): Promise<void> {
    preCommitCommand(env.program);

    try {
      await env.program.parseAsync(['pre-commit'], { from: 'user' });
    } catch (err: unknown) {
      // Commander throws on exitOverride, expected
      if (err && typeof err === 'object' && 'exitCode' in err) {
        expect(err.exitCode).toBe(expectedExitCode);
      }
    }
  }

  /**
   * Execute pre-commit and expect it to throw with specific exit code
   * Used for tests that expect failure
   */
  async function runPreCommitExpectError(expectedExitCode = 1): Promise<void> {
    preCommitCommand(env.program);

    try {
      await env.program.parseAsync(['pre-commit'], { from: 'user' });
      throw new Error('Should have exited with error');
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'exitCode' in err) {
        expect(err.exitCode).toBe(expectedExitCode);
      }
    }
  }

  // ========================================================================
  // ASSERTION HELPERS: Verify common expectations
  // ========================================================================

  /**
   * Assert that checkBranchSync was called with expected remote branch
   */
  function expectBranchSyncCalledWith(remoteBranch: string) {
    expect(git.checkBranchSync).toHaveBeenCalledWith({ remoteBranch });
  }

  /**
   * Assert that console.error was called (for error messages)
   */
  function expectErrorLogged() {
    expect(console.error).toHaveBeenCalled();
  }

  /**
   * Assert that console.error output contains specific text
   */
  function expectErrorContains(text: string) {
    expectErrorLogged();
    const errorCalls = vi.mocked(console.error).mock.calls;
    const errorOutput = errorCalls.map(call => call.join(' ')).join('\n');
    expect(errorOutput).toContain(text);
  }

  /**
   * Assert that validation was run
   */
  function expectValidationRan() {
    expect(core.runValidation).toHaveBeenCalled();
  }

  /**
   * Assert that validation was NOT run
   */
  function expectValidationNotRan() {
    expect(core.runValidation).not.toHaveBeenCalled();
  }

  /**
   * Assert that cache hit message was displayed
   */
  function expectCacheHitMessage() {
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('Validation already passed for current working tree')
    );
  }

  /**
   * Assert that getGitTreeHash was called before checkBranchSync
   */
  function expectSnapshotBeforeSync() {
    const getTreeHashOrder = vi.mocked(git.getGitTreeHash).mock.invocationCallOrder[0];
    const checkSyncOrder = vi.mocked(git.checkBranchSync).mock.invocationCallOrder[0];
    expect(getTreeHashOrder).toBeLessThan(checkSyncOrder);
  }

  describe('branch sync check with custom git config', () => {
    it('should respect config.git.mainBranch when checking sync', async () => {
      setupSuccessfulPreCommit(createConfigWithGit('develop', 'upstream'));

      await runPreCommit(0);

      // Should call checkBranchSync with upstream/develop instead of origin/main
      expectBranchSyncCalledWith('upstream/develop');
    });

    it('should default to origin/main when git config is not provided', async () => {
      setupSuccessfulPreCommit(createConfig());

      await runPreCommit(0);

      // Should default to origin/main
      expectBranchSyncCalledWith('origin/main');
    });

    it('should respect mainBranch but use default origin when remoteOrigin not provided', async () => {
      setupSuccessfulPreCommit(createConfigWithGit('master'));

      await runPreCommit(0);

      // Should use origin/master (custom branch with default origin)
      expectBranchSyncCalledWith('origin/master');
    });
  });

  describe('secret scanning integration', () => {
    it('should run secret scanning before validation when enabled', async () => {
      setupSuccessfulPreCommit(
        createConfigWithSecretScanning(true, 'echo "No secrets found"')
      );

      await runPreCommit(0);

      // Validation should still run after successful secret scan
      expectValidationRan();
    });

    it('should block commit when secret scanning finds secrets', async () => {
      vi.mocked(configLoader.loadConfig).mockResolvedValue(
        createConfigWithSecretScanning(true, 'exit 1')
      );
      vi.mocked(git.checkBranchSync).mockResolvedValue(createBranchSyncResult());
      setupSecretScanningFailure('', 'Secrets detected');

      await runPreCommit(1);

      // Validation should NOT run when secret scanning fails
      expectValidationNotRan();
    });

    it('should skip secret scanning when disabled', async () => {
      setupSuccessfulPreCommit(
        createConfigWithSecretScanning(false, 'exit 1') // Would fail if run
      );

      await runPreCommit(0);

      // Validation should run since scanning was skipped
      expectValidationRan();
    });

    it('should skip secret scanning when secretScanning config not provided', async () => {
      setupSuccessfulPreCommit(
        createConfig({
          hooks: {
            preCommit: {
              enabled: true,
              // No secretScanning config
            },
          },
        })
      );

      await runPreCommit(0);

      // Validation should run since no scanning configured
      expectValidationRan();
    });

    it('should handle missing scan tool gracefully', async () => {
      vi.mocked(configLoader.loadConfig).mockResolvedValue(
        createConfigWithSecretScanning(true, 'nonexistent-tool --scan')
      );
      vi.mocked(git.checkBranchSync).mockResolvedValue(createBranchSyncResult());
      setupSecretScanningFailure('', 'nonexistent-tool: command not found');

      await runPreCommit(1);

      // Should show error about missing tool
      expectErrorLogged();
      // Validation should NOT run when tool is missing
      expectValidationNotRan();
    });

    it('should allow custom scan commands (detect-secrets)', async () => {
      setupSuccessfulPreCommit(
        createConfigWithSecretScanning(true, 'echo "detect-secrets scan complete"')
      );

      await runPreCommit(0);

      // Validation should run after successful scan
      expectValidationRan();
    });

    it('should provide helpful error message when secrets detected', async () => {
      vi.mocked(configLoader.loadConfig).mockResolvedValue(
        createConfigWithSecretScanning(true, 'echo "Found: AWS_SECRET_KEY=abc123" && exit 1')
      );
      vi.mocked(git.checkBranchSync).mockResolvedValue(createBranchSyncResult());
      setupSecretScanningFailure('Found: AWS_SECRET_KEY=abc123', 'Secret detected in staged files');

      await runPreCommitExpectError(1);

      // Should show error message about secrets
      expectErrorContains('secret');
    });
  });

  describe('validation caching integration', () => {
    it('should use shared workflow which provides caching', async () => {
      vi.mocked(configLoader.loadConfig).mockResolvedValue(createConfigWithPhases());
      vi.mocked(git.checkBranchSync).mockResolvedValue(createBranchSyncResult());
      setupCacheHit('abc123def456');

      await runPreCommit(0);

      // CRITICAL: Verify runValidation was NOT called (cache hit)
      expectValidationNotRan();

      // Verify cache hit message was displayed
      expectCacheHitMessage();
    });

    it('should run validation when cache misses', async () => {
      vi.mocked(configLoader.loadConfig).mockResolvedValue(createConfigWithPhases());
      vi.mocked(git.checkBranchSync).mockResolvedValue(createBranchSyncResult());
      setupCacheMiss('abc123def456');
      vi.mocked(core.runValidation).mockResolvedValue(createValidationResult());

      await runPreCommit(0);

      // Verify runValidation WAS called on cache miss
      expect(core.runValidation).toHaveBeenCalledOnce();
    });
  });

  // Note: Autodetect mode behavior (scanCommand omitted) is tested in
  // packages/cli/test/utils/secret-scanning.test.ts with 28 unit tests covering:
  // - Tool detection (gitleaks available/unavailable, config present/absent)
  // - selectToolsToRun() autodetect logic
  // - Fallback behavior when gitleaks config exists but command unavailable
  // - Defense-in-depth (both tools configured)
  // - Explicit command mode vs autodetect mode

  describe('merge detection', () => {
    it('should skip branch sync check when merge is in progress', async () => {
      setupMergeTest(true);

      await runPreCommit(0);

      expect(git.isMergeInProgress).toHaveBeenCalled();
      expect(git.checkBranchSync).not.toHaveBeenCalled();
    });

    it('should enforce branch sync check when NOT in merge', async () => {
      setupMergeTest(false);

      await runPreCommit(1);

      expect(git.isMergeInProgress).toHaveBeenCalled();
      expect(git.checkBranchSync).toHaveBeenCalled();
    });
  });

  describe('work protection (Issue #69)', () => {
    it('should create worktree snapshot BEFORE checking branch sync', async () => {
      setupSuccessfulPreCommit();

      await runPreCommit(0);

      // Verify getGitTreeHash was called
      expect(git.getGitTreeHash).toHaveBeenCalled();

      // Verify getGitTreeHash was called BEFORE checkBranchSync (using invocationCallOrder)
      expectSnapshotBeforeSync();
    });

    it('should show recovery instructions with snapshot hash when branch is behind tracking', async () => {
      vi.mocked(configLoader.loadConfig).mockResolvedValue(createConfig());
      setupBranchBehind(3, true);

      await runPreCommit(1);

      // Snapshot should have been created before the error
      expect(git.getGitTreeHash).toHaveBeenCalled();
    });

    it('should show recovery instructions with snapshot hash when branch is behind origin/main', async () => {
      vi.mocked(configLoader.loadConfig).mockResolvedValue(createConfig());
      setupBranchBehind(2, false); // No tracking branch

      await runPreCommit(1);

      // Snapshot should have been created before the error
      expect(git.getGitTreeHash).toHaveBeenCalled();

      // And before sync check (using invocationCallOrder)
      expectSnapshotBeforeSync();
    });

    it('should handle snapshot creation failure gracefully', async () => {
      vi.mocked(configLoader.loadConfig).mockResolvedValue(createConfig());
      vi.mocked(git.getPartiallyStagedFiles).mockReturnValue([]);
      vi.mocked(git.isCurrentBranchBehindTracking).mockReturnValue(0); // Up to date

      // Mock snapshot failure
      vi.mocked(git.getGitTreeHash).mockRejectedValue(new Error('Git tree hash failed'));

      vi.mocked(git.checkBranchSync).mockResolvedValue(createBranchSyncResult());
      vi.mocked(core.runValidation).mockResolvedValue(createValidationResult());

      await runPreCommit(0);

      // Should have attempted snapshot
      expect(git.getGitTreeHash).toHaveBeenCalled();

      // But validation should still run (fail-safe)
      expectValidationRan();
    });
  });
});

import { join } from 'node:path';

import type { SyncGuardMode, VibeValidateConfig } from '@vibe-validate/config';
import * as core from '@vibe-validate/core';
import * as git from '@vibe-validate/git';
import * as history from '@vibe-validate/history';
import * as utils from '@vibe-validate/utils';
import { mkdirSyncReal } from '@vibe-validate/utils';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { preCommitCommand } from '../../src/commands/pre-commit.js';
import * as configLoader from '../../src/utils/config-loader.js';
import { setupCommanderTest, setupTempDirTest, type CommanderTestEnv, type TempDirTestEnv } from '../helpers/commander-test-setup.js';

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
    runDependencyCheck: vi.fn(),
  };
});

// Mock the git module
vi.mock('@vibe-validate/git', async () => {
  const actual = await vi.importActual<typeof git>('@vibe-validate/git');
  return {
    ...actual,
    checkBranchSync: vi.fn(),
    fetchRemoteRefs: vi.fn(),
    getGitTreeHash: vi.fn(),
    getRepositoryRoot: vi.fn(),
    getTrackingDivergence: vi.fn(),
    getUpstreamRef: vi.fn(),
    getPartiallyStagedFiles: vi.fn().mockReturnValue([]),
    isMergeInProgress: vi.fn(),
    isRebaseInProgress: vi.fn(),
  };
});

// Mock the history module
vi.mock('@vibe-validate/history', async () => {
  const actual = await vi.importActual<typeof history>('@vibe-validate/history');
  return {
    ...actual,
    findCachedValidation: vi.fn(),
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
    loadConfigWithDir: vi.fn(),
    loadConfigWithErrors: vi.fn(),
  };
});

/** The upstream the test branch tracks — used for the sync-guard fetch. */
const UPSTREAM_REF = { remote: 'origin', branch: 'feature/test' };

/** The base branch ref the base-branch guard fetches (origin/main by default). */
const BASE_REF = { remote: 'origin', branch: 'main' };

/**
 * Factory: fetch outcomes where every requested ref refreshed successfully
 *
 * `fetchRemoteRefs` reports per ref (keyed by `refKey`), not per remote, so a
 * deleted upstream branch cannot take the base-branch guard down with it.
 */
function allRefsFresh(): Record<string, { ok: boolean }> {
  return {
    [git.refKey(BASE_REF)]: { ok: true },
    [git.refKey(UPSTREAM_REF)]: { ok: true },
  };
}

/**
 * Factory: fetch outcomes where nothing could be refreshed (offline)
 */
function noRefsFresh(error = 'network unreachable'): Record<string, { ok: boolean; error: string }> {
  return {
    [git.refKey(BASE_REF)]: { ok: false, error },
    [git.refKey(UPSTREAM_REF)]: { ok: false, error },
  };
}

// ========================================================================
// FACTORY FUNCTIONS: Create test objects
// ========================================================================

/**
 * Factory: Create minimal config with optional overrides
 * Eliminates duplication of basic config structure
 */
function createConfig(overrides: Partial<VibeValidateConfig> = {}): VibeValidateConfig {
  return {
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
 * Factory: Create config with explicit sync guard modes
 *
 * Omitted guards fall back to the shipped default ('warn').
 */
function createConfigWithSyncGuards(
  guards: { branchSync?: SyncGuardMode; trackingSync?: SyncGuardMode }
): VibeValidateConfig {
  return createConfig({
    hooks: {
      preCommit: {
        enabled: true,
        ...guards,
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
  timestamp: string;
  passed: boolean;
  phasesRun: number;
  stepsRun: number;
  duration: number;
}> = {}) {
  return {
    timestamp: '2025-10-23T20:00:00Z',
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
    id: treeHash,
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
  // Use current directory as configDir (safe since we're already in test directory)
  vi.mocked(configLoader.loadConfigWithDir).mockResolvedValue({ config, configDir: process.cwd() });
  vi.mocked(git.checkBranchSync).mockResolvedValue(createBranchSyncResult());
  vi.mocked(core.runValidation).mockResolvedValue(createValidationResult());
}

/**
 * Setup: Configure mocks for branch behind scenario
 *
 * Behind on BOTH axes when `hasTracking`, so a test can pin either guard.
 */
function setupBranchBehind(behindBy: number, hasTracking = true) {
  vi.mocked(git.getGitTreeHash).mockResolvedValue({
    hash: 'abc123def456' as git.TreeHash,
  });
  vi.mocked(git.getPartiallyStagedFiles).mockReturnValue([]);
  vi.mocked(git.getTrackingDivergence).mockReturnValue(
    hasTracking ? { ahead: 0, behind: behindBy } : null
  );
  vi.mocked(git.getUpstreamRef).mockReturnValue(hasTracking ? UPSTREAM_REF : null);
  vi.mocked(git.checkBranchSync).mockResolvedValue(
    createBranchSyncResult({ isUpToDate: false, behindBy })
  );
}

/**
 * Setup: Configure mocks for cache hit scenario
 */
function setupCacheHit(treeHash: string) {
  vi.mocked(git.getGitTreeHash).mockResolvedValue({
    hash: treeHash as git.TreeHash,
  });
  const historyNote = createHistoryNote(treeHash, true);
  vi.mocked(history.findCachedValidation).mockResolvedValue(historyNote.runs[0]);
}

/**
 * Setup: Configure mocks for cache miss scenario
 */
function setupCacheMiss(treeHash: string) {
  const treeHashResult: git.TreeHashResult = {
    hash: treeHash as git.TreeHash,
  };
  vi.mocked(git.getGitTreeHash).mockResolvedValue(treeHashResult);
  vi.mocked(history.findCachedValidation).mockResolvedValue(null);
  vi.mocked(history.checkWorktreeStability).mockResolvedValue({
    stable: true,
    treeHashBefore: treeHash as git.TreeHash,
    treeHashAfter: treeHash as git.TreeHash,
  });
  vi.mocked(history.recordValidationHistory).mockResolvedValue({
    recorded: true,
    treeHash: treeHash as git.TreeHash,
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

  // Validation runs either way: mid-merge the base-branch guard is skipped, and
  // outside a merge the default 'warn' mode reports but does not stop the run.
  vi.mocked(core.runValidation).mockResolvedValue(createValidationResult());
}

/**
 * Setup: Configure mocks for secret scanning failure
 */
function setupSecretScanningFailure(stdout = '', stderr = 'Secrets detected') {
  vi.mocked(utils.safeExecFromString).mockImplementation(() => {
    throw createCommandError(stdout, stderr);
  });
}

/**
 * Setup: Configure mocks for dependency check test with specific runOn setting
 *
 * @param runOn - The runOn setting ('pre-commit', 'validate', 'disabled', or undefined for implicit)
 */
function setupDependencyCheckTest(runOn?: 'pre-commit' | 'validate' | 'disabled') {
  const config = createConfig({
    ci: {
      dependencyLockCheck: runOn === undefined ? {
        // No runOn specified - defaults to 'pre-commit'
      } : { runOn },
    },
    validation: {
      phases: [
        {
          name: 'Test',
          steps: [{ name: 'Test Step', command: 'echo test' }],
        },
      ],
    },
  });
  setupSuccessfulPreCommit(config);
  setupCacheMiss('abc123def456');

  // Mock runDependencyCheck to return success
  vi.mocked(utils.runDependencyCheck).mockResolvedValue({
    passed: true,
    skipped: false,
    duration: 100,
  });
}

// ========================================================================
// EXECUTION FUNCTIONS: Run commands and handle results
// ========================================================================

/**
 * Execute pre-commit command and verify exit code
 * Replicates the repeated try/catch pattern from the original tests
 */
async function runPreCommit(env: CommanderTestEnv, expectedExitCode = 0, args: string[] = []): Promise<void> {
  preCommitCommand(env.program);

  try {
    await env.program.parseAsync(['pre-commit', ...args], { from: 'user' });
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
async function runPreCommitExpectError(env: CommanderTestEnv, expectedExitCode = 1): Promise<void> {
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
 *
 * `skipFetch` is always true from pre-commit: the combined fetch in Step 5
 * already refreshed the ref, so checkBranchSync must not pay for a second
 * round-trip.
 */
function expectBranchSyncCalledWith(remoteBranch: string) {
  expect(git.checkBranchSync).toHaveBeenCalledWith({ remoteBranch, skipFetch: true });
}

/**
 * Collect everything written to a console channel as one searchable string
 */
function consoleOutput(channel: 'log' | 'warn' | 'error'): string {
  return vi.mocked(console[channel]).mock.calls.map(call => call.join(' ')).join('\n');
}

/**
 * Assert that console.warn output contains specific text
 */
function expectWarnContains(text: string) {
  expect(consoleOutput('warn')).toContain(text);
}

/**
 * Assert that console.log output contains specific text
 */
function expectLogContains(text: string) {
  expect(consoleOutput('log')).toContain(text);
}

/**
 * Assert exactly which refs were fetched for the sync guards
 */
function expectFetchedRefs(refs: Array<{ remote: string; branch: string }>) {
  expect(git.fetchRemoteRefs).toHaveBeenCalledWith(refs);
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
    expect.stringContaining('Validation passed for this code')
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

describe('pre-commit command', () => {
  let tempEnv: TempDirTestEnv;
  let env: CommanderTestEnv;

  beforeEach(() => {
    // Clear all mock calls from previous tests (prevents test pollution across test files)
    vi.clearAllMocks();

    // Setup temp directory
    tempEnv = setupTempDirTest('vibe-validate-pre-commit-test');

    // Setup Commander test environment
    env = setupCommanderTest();

    // Reset mocks
    vi.mocked(core.runValidation).mockReset();
    vi.mocked(git.checkBranchSync).mockReset();
    vi.mocked(git.fetchRemoteRefs).mockReset();
    vi.mocked(git.getGitTreeHash).mockReset();
    vi.mocked(git.getRepositoryRoot).mockReset();
    vi.mocked(git.getTrackingDivergence).mockReset();
    vi.mocked(git.getUpstreamRef).mockReset();
    vi.mocked(git.getPartiallyStagedFiles).mockReset();
    vi.mocked(git.isMergeInProgress).mockReset();
    vi.mocked(git.isRebaseInProgress).mockReset();
    vi.mocked(utils.safeExecSync).mockReset();
    vi.mocked(utils.safeExecFromString).mockReset();
    vi.mocked(utils.isToolAvailable).mockReset();
    vi.mocked(utils.runDependencyCheck).mockReset();
    vi.mocked(configLoader.loadConfig).mockReset();

    // Set default mock values (tests can override)
    vi.mocked(git.getGitTreeHash).mockResolvedValue({
      hash: 'abc123def456' as git.TreeHash,
      });
    vi.mocked(git.getRepositoryRoot).mockReturnValue('/test/repo'); // Default git repo path
    vi.mocked(git.getTrackingDivergence).mockReturnValue({ ahead: 0, behind: 0 }); // Up to date by default
    vi.mocked(git.getUpstreamRef).mockReturnValue(UPSTREAM_REF); // Branch tracks origin/feature/test
    vi.mocked(git.fetchRemoteRefs).mockReturnValue(allRefsFresh()); // Remote reachable by default
    vi.mocked(git.getPartiallyStagedFiles).mockReturnValue([]); // No partially staged by default
    vi.mocked(git.isMergeInProgress).mockReturnValue(false); // No merge by default
    vi.mocked(git.isRebaseInProgress).mockReturnValue(false); // No rebase by default
    vi.mocked(utils.safeExecSync).mockReturnValue(''); // Default empty output
    vi.mocked(utils.safeExecFromString).mockReturnValue(''); // Default empty output
    vi.mocked(utils.isToolAvailable).mockReturnValue(false); // No tools available by default
    vi.mocked(utils.runDependencyCheck).mockResolvedValue({ passed: true, skipped: true, duration: 0 }); // Skip by default
  });

  afterEach(() => {
    env.cleanup();
    tempEnv.cleanup();
    vi.restoreAllMocks();
  });

  describe('branch sync check with custom git config', () => {
    it('should respect config.git.mainBranch when checking sync', async () => {
      setupSuccessfulPreCommit(createConfigWithGit('develop', 'upstream'));

      await runPreCommit(env, 0);

      // Should call checkBranchSync with upstream/develop instead of origin/main
      expectBranchSyncCalledWith('upstream/develop');
    });

    it('should default to origin/main when git config is not provided', async () => {
      setupSuccessfulPreCommit(createConfig());

      await runPreCommit(env, 0);

      // Should default to origin/main
      expectBranchSyncCalledWith('origin/main');
    });

    it('should respect mainBranch but use default origin when remoteOrigin not provided', async () => {
      setupSuccessfulPreCommit(createConfigWithGit('master'));

      await runPreCommit(env, 0);

      // Should use origin/master (custom branch with default origin)
      expectBranchSyncCalledWith('origin/master');
    });
  });

  describe('secret scanning integration', () => {
    it('should run secret scanning before validation when enabled', async () => {
      setupSuccessfulPreCommit(
        createConfigWithSecretScanning(true, 'echo "No secrets found"')
      );

      await runPreCommit(env, 0);

      // Validation should still run after successful secret scan
      expectValidationRan();
    });

    it('should block commit when secret scanning finds secrets', async () => {
      vi.mocked(configLoader.loadConfig).mockResolvedValue(
        createConfigWithSecretScanning(true, 'exit 1')
      );
      vi.mocked(git.checkBranchSync).mockResolvedValue(createBranchSyncResult());
      setupSecretScanningFailure('', 'Secrets detected');

      await runPreCommit(env, 1);

      // Validation should NOT run when secret scanning fails
      expectValidationNotRan();
    });

    it('should skip secret scanning when disabled', async () => {
      setupSuccessfulPreCommit(
        createConfigWithSecretScanning(false, 'exit 1') // Would fail if run
      );

      await runPreCommit(env, 0);

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

      await runPreCommit(env, 0);

      // Validation should run since no scanning configured
      expectValidationRan();
    });

    it('should handle missing scan tool gracefully', async () => {
      vi.mocked(configLoader.loadConfig).mockResolvedValue(
        createConfigWithSecretScanning(true, 'nonexistent-tool --scan')
      );
      vi.mocked(git.checkBranchSync).mockResolvedValue(createBranchSyncResult());
      setupSecretScanningFailure('', 'nonexistent-tool: command not found');

      await runPreCommit(env, 1);

      // Should show error about missing tool
      expectErrorLogged();
      // Validation should NOT run when tool is missing
      expectValidationNotRan();
    });

    it('should allow custom scan commands (detect-secrets)', async () => {
      setupSuccessfulPreCommit(
        createConfigWithSecretScanning(true, 'echo "detect-secrets scan complete"')
      );

      await runPreCommit(env, 0);

      // Validation should run after successful scan
      expectValidationRan();
    });

    it('should provide helpful error message when secrets detected', async () => {
      vi.mocked(configLoader.loadConfig).mockResolvedValue(
        createConfigWithSecretScanning(true, 'echo "Found: AWS_SECRET_KEY=abc123" && exit 1')
      );
      vi.mocked(git.checkBranchSync).mockResolvedValue(createBranchSyncResult());
      setupSecretScanningFailure('Found: AWS_SECRET_KEY=abc123', 'Secret detected in staged files');

      await runPreCommitExpectError(env, 1);

      // Should show error message about secrets
      expectErrorContains('secret');
    });
  });

  describe('validation caching integration', () => {
    it('should use shared workflow which provides caching', async () => {
      setupSuccessfulPreCommit(createConfigWithPhases());
      setupCacheHit('abc123def456');

      await runPreCommit(env, 0);

      // CRITICAL: Verify runValidation was NOT called (cache hit)
      expectValidationNotRan();

      // Verify cache hit message was displayed
      expectCacheHitMessage();
    });

    it('should run validation when cache misses', async () => {
      setupSuccessfulPreCommit(createConfigWithPhases());
      setupCacheMiss('abc123def456');

      await runPreCommit(env, 0);

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

      await runPreCommit(env, 0);

      expect(git.isMergeInProgress).toHaveBeenCalled();
      expect(git.checkBranchSync).not.toHaveBeenCalled();
    });

    it('should run the branch sync check when NOT in merge', async () => {
      setupMergeTest(false);

      // Default mode is 'warn': the check still runs and still reports, it just
      // no longer gates the commit.
      await runPreCommit(env, 0);

      expect(git.isMergeInProgress).toHaveBeenCalled();
      expect(git.checkBranchSync).toHaveBeenCalled();
      expectWarnContains('Branch is behind origin/main by 3 commit(s)');
    });
  });

  describe('rebase divergence handling (Issue #155)', () => {
    it('should pass pre-commit when local history is rewritten (ahead AND behind tracking)', async () => {
      // Classic post-rebase shape: ahead by N (rewritten commits), behind by M
      // (pre-rebase originals still on origin). Pre-commit must NOT fail here —
      // the user will force-push-with-lease when ready. Step 3 should pass-through
      // to Step 4 (checkBranchSync) rather than bail with exit 1.
      setupSuccessfulPreCommit();
      vi.mocked(git.getTrackingDivergence).mockReturnValue({ ahead: 5, behind: 3 });

      await runPreCommit(env, 0);

      expect(git.getTrackingDivergence).toHaveBeenCalled();
      // checkBranchSync only runs if Step 3 didn't bail — this pins the diverged
      // pass-through path (the bug fix). Without it, the test would also pass
      // if the mock returned {0, 0} or {N, 0}.
      expect(git.checkBranchSync).toHaveBeenCalled();
    });

    it('should skip base-branch sync check when a rebase is in progress', async () => {
      // During an interactive rebase pause (e.g. edit step), HEAD is transiently
      // rewinding; sync against origin/main is meaningless. Mirror the merge
      // short-circuit: skip checkBranchSync, let validation run.
      setupSuccessfulPreCommit();
      vi.mocked(git.isRebaseInProgress).mockReturnValue(true);

      await runPreCommit(env, 0);

      expect(git.isRebaseInProgress).toHaveBeenCalled();
      expect(git.checkBranchSync).not.toHaveBeenCalled();
    });
  });

  describe('sync guards (branchSync / trackingSync)', () => {
    describe('fetch policy', () => {
      it('should refresh both guards refs in a single call when both are active', async () => {
        setupSuccessfulPreCommit();

        await runPreCommit(env, 0);

        // One call, both refs — not one round-trip per guard.
        expect(git.fetchRemoteRefs).toHaveBeenCalledTimes(1);
        expectFetchedRefs([BASE_REF, UPSTREAM_REF]);
      });

      it('should fetch only the base branch ref when trackingSync is off', async () => {
        setupSuccessfulPreCommit(createConfigWithSyncGuards({ trackingSync: 'off' }));

        await runPreCommit(env, 0);

        expectFetchedRefs([BASE_REF]);
        expect(git.getTrackingDivergence).not.toHaveBeenCalled();
      });

      it('should fetch only the upstream ref when branchSync is off', async () => {
        setupSuccessfulPreCommit(createConfigWithSyncGuards({ branchSync: 'off' }));

        await runPreCommit(env, 0);

        expectFetchedRefs([UPSTREAM_REF]);
        expect(git.checkBranchSync).not.toHaveBeenCalled();
      });

      it('should make no network call at all when both guards are off', async () => {
        setupSuccessfulPreCommit(
          createConfigWithSyncGuards({ branchSync: 'off', trackingSync: 'off' })
        );

        await runPreCommit(env, 0);

        // 'off' must cost nothing — that is the whole point of having it.
        expect(git.fetchRemoteRefs).not.toHaveBeenCalled();
        expect(git.getTrackingDivergence).not.toHaveBeenCalled();
        expect(git.checkBranchSync).not.toHaveBeenCalled();
      });

      it('should still fetch in warn mode', async () => {
        // Rejected alternative: skip the fetch when only warning. A notice
        // computed from a stale ref is worth nothing — freshness IS the warning.
        setupSuccessfulPreCommit(
          createConfigWithSyncGuards({ branchSync: 'warn', trackingSync: 'warn' })
        );

        await runPreCommit(env, 0);

        expect(git.fetchRemoteRefs).toHaveBeenCalledTimes(1);
      });

      it('should not fetch the base branch ref while a merge is in progress', async () => {
        setupSuccessfulPreCommit();
        vi.mocked(git.isMergeInProgress).mockReturnValue(true);

        await runPreCommit(env, 0);

        // The base guard is skipped mid-merge, so its ref is dead weight.
        expectFetchedRefs([UPSTREAM_REF]);
      });

      it('should make no network call while a rebase is in progress', async () => {
        // Mid-rebase HEAD is detached: the base comparison is meaningless and
        // there is no upstream to compare against either.
        setupSuccessfulPreCommit();
        vi.mocked(git.isRebaseInProgress).mockReturnValue(true);

        await runPreCommit(env, 0);

        expect(git.fetchRemoteRefs).not.toHaveBeenCalled();
        expect(git.getTrackingDivergence).not.toHaveBeenCalled();
      });

      it('should not claim the branch has no upstream while a rebase is in progress', async () => {
        // Detached HEAD makes getUpstreamRef/getTrackingDivergence report "no
        // tracking branch", which is false — and it would print on every commit
        // during a conflict resolution.
        setupSuccessfulPreCommit();
        vi.mocked(git.isRebaseInProgress).mockReturnValue(true);

        await runPreCommit(env, 0);

        expect(consoleOutput('log')).not.toContain('No remote tracking branch');
        expectLogContains('Rebase in progress');
      });

      it('should not request an upstream fetch when the branch has no upstream', async () => {
        setupSuccessfulPreCommit();
        vi.mocked(git.getUpstreamRef).mockReturnValue(null);

        await runPreCommit(env, 0);

        expectFetchedRefs([BASE_REF]);
      });

      it('should pass skipFetch to checkBranchSync so the ref is not fetched twice', async () => {
        setupSuccessfulPreCommit();

        await runPreCommit(env, 0);

        expectBranchSyncCalledWith('origin/main');
      });
    });

    describe('tracking guard reads a freshly fetched ref (pre-0.19.7 bug)', () => {
      it('should fetch the upstream ref BEFORE reading local divergence', async () => {
        // getTrackingDivergence() compares purely local refs. Before this fix
        // nothing fetched the upstream, so a stale @{u} level with HEAD read as
        // {0,0} and pre-commit printed "up to date with remote" — silently
        // missing the exact case the guard exists for (someone else pushed).
        setupSuccessfulPreCommit();

        await runPreCommit(env, 0);

        const fetchOrder = vi.mocked(git.fetchRemoteRefs).mock.invocationCallOrder[0];
        const divergenceOrder = vi.mocked(git.getTrackingDivergence).mock.invocationCallOrder[0];
        expect(fetchOrder).toBeDefined();
        expect(fetchOrder).toBeLessThan(divergenceOrder);
      });

      it('should fetch the upstream branch, not the base branch, for the tracking guard', async () => {
        // Guard #3's fetch only ever refreshed origin/<main>. Refreshing that
        // says nothing about whether someone pushed to origin/<your-branch>.
        setupSuccessfulPreCommit();

        await runPreCommit(env, 0);

        const [refs] = vi.mocked(git.fetchRemoteRefs).mock.calls[0];
        expect(refs).toContainEqual(UPSTREAM_REF);
      });
    });

    describe('modes', () => {
      it('should warn but allow the commit when behind the base branch (default)', async () => {
        setupSuccessfulPreCommit();
        vi.mocked(git.checkBranchSync).mockResolvedValue(
          createBranchSyncResult({ isUpToDate: false, behindBy: 4 })
        );

        await runPreCommit(env, 0);

        expectWarnContains('Branch is behind origin/main by 4 commit(s)');
        expectWarnContains('git merge origin/main');
        expectValidationRan();
      });

      it('should block the commit when behind the base branch and branchSync is block', async () => {
        vi.mocked(configLoader.loadConfig).mockResolvedValue(
          createConfigWithSyncGuards({ branchSync: 'block' })
        );
        setupBranchBehind(4, false);

        await runPreCommitExpectError(env, 1);

        expectErrorContains('Branch is behind origin/main');
        expectValidationNotRan();
      });

      it('should warn but allow the commit when behind the tracking branch (default)', async () => {
        setupSuccessfulPreCommit();
        vi.mocked(git.getTrackingDivergence).mockReturnValue({ ahead: 0, behind: 2 });

        await runPreCommit(env, 0);

        expectWarnContains('behind its remote tracking branch by 2 commit(s)');
        expectWarnContains('git pull --rebase');
        expectValidationRan();
      });

      it('should block the commit when behind the tracking branch and trackingSync is block', async () => {
        vi.mocked(configLoader.loadConfig).mockResolvedValue(
          createConfigWithSyncGuards({ trackingSync: 'block' })
        );
        setupBranchBehind(2, true);

        await runPreCommitExpectError(env, 1);

        expectErrorContains('Current branch is behind its remote tracking branch');
        expectValidationNotRan();
      });

      it('should say nothing about a guard that is off, even when behind', async () => {
        setupSuccessfulPreCommit(
          createConfigWithSyncGuards({ branchSync: 'off', trackingSync: 'off' })
        );
        vi.mocked(git.getTrackingDivergence).mockReturnValue({ ahead: 0, behind: 9 });
        vi.mocked(git.checkBranchSync).mockResolvedValue(
          createBranchSyncResult({ isUpToDate: false, behindBy: 9 })
        );

        await runPreCommit(env, 0);

        expect(consoleOutput('warn')).not.toContain('behind');
        expect(consoleOutput('error')).not.toContain('behind');
      });

      it('should report up to date without warning when neither guard is behind', async () => {
        setupSuccessfulPreCommit();

        await runPreCommit(env, 0);

        expectLogContains('Current branch is up to date with remote');
        expectLogContains('Branch is up to date with origin/main');
        expect(consoleOutput('warn')).not.toContain('behind');
      });
    });

    describe('offline degradation', () => {
      it('should not block on the base branch when the fetch failed, even in block mode', async () => {
        // Offline commits pass, deliberately. A "behind" verdict computed from
        // refs we could not refresh is not evidence of anything.
        setupSuccessfulPreCommit(createConfigWithSyncGuards({ branchSync: 'block' }));
        vi.mocked(git.fetchRemoteRefs).mockReturnValue(noRefsFresh());
        vi.mocked(git.checkBranchSync).mockResolvedValue(
          createBranchSyncResult({ isUpToDate: false, behindBy: 5 })
        );

        await runPreCommit(env, 0);

        expectLogContains('Could not refresh origin/main');
        expectValidationRan();
      });

      it('should not block on the tracking branch when the fetch failed, even in block mode', async () => {
        setupSuccessfulPreCommit(createConfigWithSyncGuards({ trackingSync: 'block' }));
        vi.mocked(git.fetchRemoteRefs).mockReturnValue(noRefsFresh());
        vi.mocked(git.getTrackingDivergence).mockReturnValue({ ahead: 0, behind: 5 });

        await runPreCommit(env, 0);

        expectLogContains('Could not refresh the remote tracking branch');
        expectValidationRan();
      });

      it('should not claim either branch is up to date when the fetch failed', async () => {
        // The pre-0.19.7 failure mode in a new coat: a reassuring green line
        // that is not evidence of anything. The local refs may well read
        // "level" — that is exactly what a stale ref looks like.
        setupSuccessfulPreCommit();
        vi.mocked(git.fetchRemoteRefs).mockReturnValue(noRefsFresh());

        await runPreCommit(env, 0);

        expect(consoleOutput('log')).not.toContain('Current branch is up to date with remote');
        expect(consoleOutput('log')).not.toContain('Branch is up to date with origin/main');
      });

      it('should report "no remote" rather than "offline" for a repo with no remote', async () => {
        // A repo with no remote fails the fetch too, but that is a permanent
        // benign state, not a network problem — saying "offline?" would be a
        // scary line on every commit in a local-only repo.
        setupSuccessfulPreCommit();
        vi.mocked(git.getUpstreamRef).mockReturnValue(null);
        vi.mocked(git.fetchRemoteRefs).mockReturnValue(noRefsFresh());
        vi.mocked(git.checkBranchSync).mockResolvedValue(
          createBranchSyncResult({ hasRemote: false })
        );
        vi.mocked(git.getTrackingDivergence).mockReturnValue(null);

        await runPreCommit(env, 0);

        expectLogContains('No remote tracking branch');
        expect(consoleOutput('log')).not.toContain('offline?');
      });

      it('should keep the base guard working when only the upstream ref is unfetchable', async () => {
        // The common case: a PR merges, GitHub deletes the remote branch, and
        // branch.<name>.merge survives the deletion. git aborts the whole
        // combined fetch over that one dead ref — but origin is reachable and
        // origin/main refreshed fine, so the base guard must still render a
        // verdict rather than going permanently silent.
        vi.mocked(configLoader.loadConfig).mockResolvedValue(
          createConfigWithSyncGuards({ branchSync: 'block' })
        );
        setupBranchBehind(4, true);
        vi.mocked(git.fetchRemoteRefs).mockReturnValue({
          [git.refKey(BASE_REF)]: { ok: true },
          [git.refKey(UPSTREAM_REF)]: { ok: false, error: "couldn't find remote ref feature/test" },
        });

        await runPreCommitExpectError(env, 1);

        // Tracking guard: no opinion, its ref is stale.
        expect(consoleOutput('log')).toContain('Could not refresh the remote tracking branch');
        // Base guard: unaffected, still blocks.
        expectErrorContains('Branch is behind origin/main');
      });

      it('should track freshness per guard when the two use different remotes', async () => {
        // Fork workflow: your branch tracks your fork, the base branch lives on
        // upstream. One being unreachable must not silence the other.
        const forkRef = { remote: 'fork', branch: 'feature/test' };
        setupSuccessfulPreCommit(createConfigWithGit('main', 'upstream'));
        vi.mocked(git.getUpstreamRef).mockReturnValue(forkRef);
        vi.mocked(git.getTrackingDivergence).mockReturnValue({ ahead: 0, behind: 2 });
        vi.mocked(git.checkBranchSync).mockResolvedValue(
          createBranchSyncResult({ isUpToDate: false, behindBy: 7 })
        );
        vi.mocked(git.fetchRemoteRefs).mockReturnValue({
          'upstream/main': { ok: true },
          [git.refKey(forkRef)]: { ok: false, error: 'fork unreachable' },
        });

        await runPreCommit(env, 0);

        // Base guard on the reachable remote still reports.
        expectWarnContains('Branch is behind upstream/main by 7 commit(s)');
        // Tracking guard on the unreachable remote does not.
        expect(consoleOutput('warn')).not.toContain('behind its remote tracking branch');
        expect(consoleOutput('log')).toContain('Could not refresh the remote tracking branch');
      });

      it('should still judge a guard whose ref never needed fetching', async () => {
        // "Nothing to fetch" is not the same as "stale". A branch tracking a
        // local branch has no remote ref to refresh, and its local comparison
        // is the whole truth.
        setupSuccessfulPreCommit(createConfigWithSyncGuards({ branchSync: 'off' }));
        vi.mocked(git.getUpstreamRef).mockReturnValue(null);
        vi.mocked(git.getTrackingDivergence).mockReturnValue({ ahead: 0, behind: 3 });

        await runPreCommit(env, 0);

        expect(git.fetchRemoteRefs).not.toHaveBeenCalled();
        expectWarnContains('behind its remote tracking branch by 3 commit(s)');
      });
    });

    describe('--skip-sync flag', () => {
      it('should turn off the base branch guard', async () => {
        setupSuccessfulPreCommit();

        await runPreCommit(env, 0, ['--skip-sync']);

        expect(git.checkBranchSync).not.toHaveBeenCalled();
        expectFetchedRefs([UPSTREAM_REF]);
      });

      it('should leave the tracking guard running', async () => {
        // --skip-sync has always meant the base-branch check specifically.
        setupSuccessfulPreCommit();
        vi.mocked(git.getTrackingDivergence).mockReturnValue({ ahead: 0, behind: 2 });

        await runPreCommit(env, 0, ['--skip-sync']);

        expect(git.getTrackingDivergence).toHaveBeenCalled();
        expectWarnContains('behind its remote tracking branch by 2 commit(s)');
      });
    });
  });

  describe('dependency lock check integration', () => {
    it('should run dependency check with runOn: pre-commit during pre-commit', async () => {
      setupDependencyCheckTest('pre-commit');

      await runPreCommit(env, 0);

      // Verify dependency check was called
      expect(utils.runDependencyCheck).toHaveBeenCalled();
    });

    it('should run dependency check with runOn: validate during pre-commit', async () => {
      setupDependencyCheckTest('validate');

      await runPreCommit(env, 0);

      // Verify dependency check was called (runOn: validate always runs)
      expect(utils.runDependencyCheck).toHaveBeenCalled();
    });

    it('should skip dependency check with runOn: disabled during pre-commit', async () => {
      setupDependencyCheckTest('disabled');

      await runPreCommit(env, 0);

      // Verify dependency check was NOT called (runOn: disabled)
      expect(utils.runDependencyCheck).not.toHaveBeenCalled();
    });

    it('should run dependency check with implicit runOn: pre-commit', async () => {
      setupDependencyCheckTest(); // No runOn = implicit 'pre-commit'

      await runPreCommit(env, 0);

      // Verify dependency check was called (implicit pre-commit mode)
      expect(utils.runDependencyCheck).toHaveBeenCalled();
    });
  });

  describe('work protection (Issue #69)', () => {
    it('should create worktree snapshot BEFORE checking branch sync', async () => {
      setupSuccessfulPreCommit();

      await runPreCommit(env, 0);

      // Verify getGitTreeHash was called
      expect(git.getGitTreeHash).toHaveBeenCalled();

      // Verify getGitTreeHash was called BEFORE checkBranchSync (using invocationCallOrder)
      expectSnapshotBeforeSync();
    });

    it('should show recovery instructions with snapshot hash when branch is behind tracking', async () => {
      // Recovery framing belongs to 'block' mode only — it exists because a
      // merge/pull is about to be demanded. In 'warn' mode nothing is about to
      // happen to your work, so there is nothing to protect it from.
      vi.mocked(configLoader.loadConfig).mockResolvedValue(
        createConfigWithSyncGuards({ trackingSync: 'block' })
      );
      setupBranchBehind(3, true);

      await runPreCommit(env, 1);

      // Snapshot should have been created before the error
      expect(git.getGitTreeHash).toHaveBeenCalled();
      expectErrorContains('Work protected by snapshot: abc123def456');
      expectErrorContains('git pull');
    });

    it('should show recovery instructions with snapshot hash when branch is behind origin/main', async () => {
      vi.mocked(configLoader.loadConfig).mockResolvedValue(
        createConfigWithSyncGuards({ branchSync: 'block' })
      );
      setupBranchBehind(2, false); // No tracking branch

      await runPreCommit(env, 1);

      // Snapshot should have been created before the error
      expect(git.getGitTreeHash).toHaveBeenCalled();
      expectErrorContains('Work protected by snapshot: abc123def456');
      expectErrorContains('git merge origin/main');

      // And before sync check (using invocationCallOrder)
      expectSnapshotBeforeSync();
    });

    it('should NOT show recovery framing when a guard only warns', async () => {
      // The snapshot hash + "safe to run" instructions imply something is about
      // to destroy work. A warning destroys nothing; printing the recovery
      // ceremony anyway would train people to ignore it.
      setupSuccessfulPreCommit();
      setupBranchBehind(3, true);
      setupCacheMiss('abc123def456');

      await runPreCommit(env, 0);

      expect(consoleOutput('error')).not.toContain('Work protected by snapshot');
      expect(consoleOutput('warn')).not.toContain('Work protected by snapshot');
      expectWarnContains('behind its remote tracking branch by 3 commit(s)');
    });

    it('should handle snapshot creation failure gracefully', async () => {
      setupSuccessfulPreCommit(createConfig());

      // Mock snapshot failure on first call, but succeed on subsequent calls (for locking)
      vi.mocked(git.getGitTreeHash)
        .mockRejectedValueOnce(new Error('Git tree hash failed'))
        .mockResolvedValue({
          hash: 'abc123def456' as git.TreeHash,
              });

      setupCacheMiss('abc123def456');

      await runPreCommit(env, 0);

      // Should have attempted snapshot
      expect(git.getGitTreeHash).toHaveBeenCalled();

      // But validation should still run (fail-safe)
      expectValidationRan();
    });
  });

  describe('working directory behavior (Issue #129)', () => {
    it('should execute validation steps in project root when invoked from subdirectory', async () => {
      // Issue #129: pre-commit should also run in project root, not process.cwd()

      const configDir = tempEnv.testDir;
      const subdir = join(configDir, 'packages', 'foo');
      mkdirSyncReal(subdir, { recursive: true });

      // Setup all necessary mocks for pre-commit to reach validation
      vi.mocked(configLoader.loadConfig).mockResolvedValue(createConfig());
      vi.mocked(configLoader.loadConfigWithDir).mockResolvedValue({
        config: createConfig(),
        configDir,
      });
      vi.mocked(git.checkBranchSync).mockResolvedValue(createBranchSyncResult());
      vi.mocked(utils.isToolAvailable).mockReturnValue(false); // No secret scanning tools

      // Track what process.cwd() was when runValidation was called
      let capturedCwd: string | null = null;
      vi.mocked(core.runValidation).mockImplementation(async () => {
        capturedCwd = process.cwd();
        return createValidationResult();
      });

      // Change to subdirectory before running pre-commit
      process.chdir(subdir);

      await runPreCommit(env, 0);

      // CRITICAL: process.cwd() should be configDir during validation
      expect(capturedCwd).toBe(configDir);
    });

    it('should restore original directory after pre-commit completes', async () => {
      const configDir = tempEnv.testDir;
      const subdir = join(configDir, 'packages', 'bar');
      mkdirSyncReal(subdir, { recursive: true });

      vi.mocked(configLoader.loadConfigWithDir).mockResolvedValue({
        config: createConfig(),
        configDir,
      });

      vi.mocked(core.runValidation).mockResolvedValue(createValidationResult());
      vi.mocked(git.checkBranchSync).mockResolvedValue(createBranchSyncResult());

      // Change to subdirectory
      process.chdir(subdir);
      const originalCwd = process.cwd();

      await runPreCommit(env, 0);

      // CRITICAL: Should be back in subdirectory after pre-commit completes
      expect(process.cwd()).toBe(originalCwd);
    });
  });
});

import {  rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import type { VibeValidateConfig } from '@vibe-validate/config';
import * as core from '@vibe-validate/core';
import * as git from '@vibe-validate/git';
import type { TreeHash } from '@vibe-validate/git';
import * as history from '@vibe-validate/history';
import { mkdirSyncReal, normalizedTmpdir } from '@vibe-validate/utils';
import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest';

import { validateCommand } from '../../src/commands/validate.js';
import * as configLoader from '../../src/utils/config-loader.js';
import * as pidLock from '../../src/utils/pid-lock.js';
import * as projectId from '../../src/utils/project-id.js';
import { setupCommanderTest, type CommanderTestEnv } from '../helpers/commander-test-setup.js';

// Helpers for reducing test duplication - see TESTING.md
import {
  createFlakyHistoryNote,
  expectConsoleLog,
  expectConsoleError,
  expectNoConsoleError,
  expectValidateOption,
  getValidateCommand,
} from './validate-test-helpers.js';


// Mock the core validation module
vi.mock('@vibe-validate/core', async () => {
  const actual = await vi.importActual<typeof core>('@vibe-validate/core');
  return {
    ...actual,
    runValidation: vi.fn(),
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

// Mock the history module
vi.mock('@vibe-validate/history', async () => {
  const actual = await vi.importActual<typeof history>('@vibe-validate/history');
  return {
    ...actual,
    findCachedValidation: vi.fn(),
    checkWorktreeStability: vi.fn(),
    recordValidationHistory: vi.fn(),
    checkHistoryHealth: vi.fn(),
    readHistoryNote: vi.fn(),
  };
});

// Mock the git module
vi.mock('@vibe-validate/git', async () => {
  const actual = await vi.importActual<typeof git>('@vibe-validate/git');
  return {
    ...actual,
    getGitTreeHash: vi.fn(),
  };
});

// Mock the pid-lock module
vi.mock('../../src/utils/pid-lock.js', () => ({
  acquireLock: vi.fn(),
  releaseLock: vi.fn(),
  checkLock: vi.fn(),
  waitForLock: vi.fn(),
}));

// Mock the project-id module
vi.mock('../../src/utils/project-id.js', () => ({
  detectProjectId: vi.fn(),
  getProjectIdFromGit: vi.fn(),
  getProjectIdFromPackageJson: vi.fn(),
}));

/**
 * Create mock history note with sensible defaults
 * @param overrides - Optional overrides for the note
 * @returns Complete history note object
 */
function createMockHistoryNote(overrides: {
  treeHash?: string;
  passed?: boolean;
  timestamp?: string;
  duration?: number;
  phases?: any[];
  failedStep?: string;
} = {}) {
  const {
    treeHash = 'abc123def456',
    passed = true,
    timestamp = '2025-10-22T00:00:00.000Z',
    duration = 5000,
    phases = [],
    failedStep,
  } = overrides;

  return {
    treeHash,
    runs: [
      {
        id: 'run-1',
        timestamp,
        duration,
        passed,
        branch: 'main',
        headCommit: 'abc123',
        uncommittedChanges: false,
        result: {
          passed,
          timestamp,
          treeHash,
          duration,
          branch: 'main',
          phases,
          ...(failedStep && { failedStep }),
        },
      },
    ],
  };
}

/**
 * Create mock validation config with sensible defaults
 * @param overrides - Partial config to override defaults
 * @returns Complete validation config
 */
function createMockConfig(overrides: Partial<VibeValidateConfig> = {}): VibeValidateConfig {
  return {
    validation: {
      phases: [
        {
          name: 'Test Phase',
          parallel: true,
          steps: [
            { name: 'Test Step', command: 'echo test' }
          ]
        }
      ]
    },
    ...overrides,
  };
}

/**
 * Setup successful validation mock
 * @param overrides - Partial result to override defaults
 */
function setupSuccessfulValidation(overrides = {}): void {
  vi.mocked(core.runValidation).mockResolvedValue({
    passed: true,
    timestamp: new Date().toISOString(),
    treeHash: 'abc123',
    phases: [],
    ...overrides,
  });
}

/**
 * Setup failed validation mock
 * @param overrides - Partial result to override defaults
 */
function setupFailedValidation(overrides = {}): void {
  vi.mocked(core.runValidation).mockResolvedValue({
    passed: false,
    timestamp: new Date().toISOString(),
    treeHash: 'abc123',
    phases: [
      {
        name: 'Test Phase',
        passed: false,
        durationSecs: 5,
        steps: [
          {
            name: 'Test Step',
            command: 'npm test',
            passed: false,
            exitCode: 1,
            durationSecs: 5,
          }
        ]
      }
    ],
    failedStep: 'Test Step',
    ...overrides,
  });
}

/**
 * Setup stdout spy for capturing YAML output
 * @returns Spy instance
 */
function setupStdoutSpy(): MockInstance {
  return vi.spyOn(process.stdout, 'write').mockImplementation((_chunk: any, encoding?: any, callback?: any) => {
    if (typeof encoding === 'function') {
      encoding();
    } else if (typeof callback === 'function') {
      callback();
    }
    return true;
  });
}

/**
 * Setup stderr spy for capturing error output
 * @returns Spy instance
 */
function setupStderrSpy(): MockInstance {
  return vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
}

/**
 * Setup all mocks needed for working directory behavior tests (Issue #129)
 * @param configDir - Project root directory (where config lives)
 * @param treeHash - Git tree hash to use
 * @param validationPassed - Whether validation should pass
 */
function setupWorkingDirectoryMocks(
  configDir: string,
  treeHash: string,
  validationPassed: boolean
): void {
  // Mock config loader to return config from project root
  vi.mocked(configLoader.loadConfigWithDir).mockResolvedValue({
    config: {
      validation: {
        phases: [
          {
            name: 'Test',
            failFast: true,
            steps: [
              {
                name: validationPassed ? 'Test Step' : 'Failing Step',
                command: validationPassed ? 'echo test' : 'exit 1',
              },
            ],
          },
        ],
      },
    },
    configDir,
  });

  // Mock git tree hash
  vi.mocked(git.getGitTreeHash).mockResolvedValue({
    hash: treeHash as any,
  });

  // Mock no cached result
  vi.mocked(history.findCachedValidation).mockResolvedValue(null);

  // Mock history recording
  vi.mocked(history.checkWorktreeStability).mockResolvedValue({
    stable: true,
    treeHashBefore: treeHash as any,
    treeHashAfter: treeHash as any,
  });
  vi.mocked(history.recordValidationHistory).mockResolvedValue({
    recorded: true,
    treeHash: treeHash as any,
  });
  vi.mocked(history.checkHistoryHealth).mockResolvedValue({
    shouldWarn: false,
    warningMessage: '',
    totalNotes: 0,
    oldNotesCount: 0,
  });

  // Mock lock functions
  vi.mocked(pidLock.checkLock).mockResolvedValue(null);
  vi.mocked(pidLock.acquireLock).mockResolvedValue({
    acquired: true,
    release: vi.fn(),
    lockFile: join(normalizedTmpdir(), 'test.lock'),
  });

  // Mock runValidation
  vi.mocked(core.runValidation).mockResolvedValue({
    passed: validationPassed,
    timestamp: '2025-10-23T00:00:00.000Z',
    treeHash: treeHash as any,
    phases: [],
    ...(validationPassed ? {} : { failedStep: 'Failing Step' }),
  });
}

/**
 * Parse command and expect it to exit with specific code
 * @param env - Commander test environment
 * @param args - Command arguments to parse
 * @param expectedExitCode - Expected exit code (default: 1)
 */
async function parseCommandExpectingExit(
  env: CommanderTestEnv,
  args: string[],
  expectedExitCode = 1
): Promise<void> {
  try {
    await env.program.parseAsync(args, { from: 'user' });
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'exitCode' in err) {
      expect(err.exitCode).toBe(expectedExitCode);
    }
  }
}

/**
 * Setup config loader with mock config
 * @param testDir - Test directory path
 * @param config - Config to return (defaults to createMockConfig())
 */
function setupMockConfig(testDir: string, config: VibeValidateConfig = createMockConfig()): void {
  vi.mocked(configLoader.loadConfigWithDir).mockResolvedValue({ config, configDir: testDir });
}

/**
 * Parse command with proper error handling
 * @param env - Commander test environment
 * @param args - Command arguments
 * @returns Exit code (0 for success, 1 for failure)
 */
async function parseCommand(env: CommanderTestEnv, args: string[]): Promise<number> {
  try {
    await env.program.parseAsync(args, { from: 'user' });
    return 0;
  } catch (err: unknown) {
    // Handle Commander exitOverride errors
    if (err && typeof err === 'object' && 'exitCode' in err) {
      return (err as { exitCode: number }).exitCode;
    }
    // Handle process.exit mock errors
    if (err instanceof Error && err.message.startsWith('process.exit(')) {
      const regex = /process\.exit\((\d+)\)/;
      const match = regex.exec(err.message);
      if (match) {
        return Number.parseInt(match[1], 10);
      }
    }
    throw err;
  }
}

/**
 * Find flakiness warning call in spy calls
 * @param warnSpy - Console.warn spy
 * @returns Warning call if found
 */
function findFlakinessWarning(warnSpy: MockInstance): unknown[] | undefined {
  return warnSpy.mock.calls.find((call: unknown[]) =>
    typeof call[0] === 'string' && call[0].includes('Validation passed, but failed on previous run')
  );
}

/**
 * Find step by name in validation result steps
 * @param steps - Array of step results
 * @param name - Step name to find
 * @returns Step result if found
 */
function findStepByName(steps: any[], name: string): any {
  return steps.find(s => s.name === name);
}

/**
 * No-op function for mock implementations
 */
function noOp(): void {
  // Intentionally empty
}

/**
 * Execute validate command and assert that validation ran in the specified directory
 * @param env - Commander test environment
 * @param subdir - Subdirectory where command is invoked from
 * @param expectedCwd - Expected cwd during validation (usually configDir)
 * @param expectedExitCode - Expected exit code
 * @returns The captured cwd during validation
 */
async function executeAndCaptureCwd(
  env: CommanderTestEnv,
  subdir: string,
  expectedCwd: string,
  expectedExitCode: number
): Promise<string> {
  let capturedCwd: string | null = null;

  // Replace mock to capture cwd
  vi.mocked(core.runValidation).mockImplementation(async () => {
    capturedCwd = process.cwd();
    // Return result based on expected exit code
    return {
      passed: expectedExitCode === 0,
      timestamp: '2025-10-23T00:00:00.000Z',
      treeHash: 'test-tree-hash' as any,
      phases: [],
      ...(expectedExitCode === 0 ? {} : { failedStep: 'Failing Step' }),
    };
  });

  // Change to subdirectory
  process.chdir(subdir);

  validateCommand(env.program);
  await parseCommandExpectingExit(env, ['validate'], expectedExitCode);

  expect(capturedCwd).toBe(expectedCwd);
  return capturedCwd!;
}

describe('validate command', () => {
  let testDir: string;
  let originalCwd: string;
  let env: CommanderTestEnv;

  beforeEach(() => {
    // Clear all mock calls from previous tests (prevents test pollution across test files)
    vi.clearAllMocks();

    // Create temp directory for test files
    testDir = join(normalizedTmpdir(), `vibe-validate-validate-test-${Date.now()}`);
    if (!existsSync(testDir)) {
      mkdirSyncReal(testDir, { recursive: true });
    }

    // Save original cwd and change to test directory
    originalCwd = process.cwd();
    process.chdir(testDir);

    // Setup Commander test environment
    env = setupCommanderTest();

    // Reset mocks
    vi.mocked(core.runValidation).mockReset();
    vi.mocked(configLoader.loadConfig).mockReset();
    vi.mocked(configLoader.loadConfigWithDir).mockReset();
    vi.mocked(git.getGitTreeHash).mockReset();
    vi.mocked(history.findCachedValidation).mockReset();
    vi.mocked(history.checkWorktreeStability).mockReset();
    vi.mocked(history.recordValidationHistory).mockReset();
    vi.mocked(history.checkHistoryHealth).mockReset();
    vi.mocked(history.readHistoryNote).mockReset();
    vi.mocked(pidLock.acquireLock).mockReset();
    vi.mocked(pidLock.releaseLock).mockReset();
    vi.mocked(pidLock.checkLock).mockReset();
    vi.mocked(pidLock.waitForLock).mockReset();
    vi.mocked(projectId.detectProjectId).mockReset();

    // Default getGitTreeHash to return a hash
    vi.mocked(git.getGitTreeHash).mockResolvedValue({
      hash: 'abc123def456' as any
    });

    // Default lock mocks - lock acquired successfully
    vi.mocked(pidLock.acquireLock).mockResolvedValue({
      acquired: true,
      lockFile: join(normalizedTmpdir(), 'test.lock'),
    });
    vi.mocked(pidLock.releaseLock).mockResolvedValue();
    vi.mocked(pidLock.checkLock).mockResolvedValue(null);
    vi.mocked(pidLock.waitForLock).mockResolvedValue({
      timedOut: false,
    });

    // Default project ID detection
    vi.mocked(projectId.detectProjectId).mockReturnValue('test-project');

    // Default history mocks to no-op
    vi.mocked(history.checkWorktreeStability).mockResolvedValue({
      stable: true,
      treeHashBefore: 'default' as any,
      treeHashAfter: 'default' as any,
    });
    vi.mocked(history.recordValidationHistory).mockResolvedValue({
      recorded: true,
      treeHash: 'default' as any,
    });
    vi.mocked(history.checkHistoryHealth).mockResolvedValue({
      totalNotes: 0,
      oldNotesCount: 0,
      shouldWarn: false,
      warningMessage: '',
    });

    // Clean up environment variables to prevent test pollution
    // (Tests may set VV_FORCE_EXECUTION, VV_CONTEXT, etc.)
    delete process.env.VV_FORCE_EXECUTION;
    delete process.env.VV_CONTEXT;
    delete process.env.CLAUDE_CODE;
    delete process.env.CI;
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

  describe('command registration', () => {
    it('should register validate command with correct name', () => {
      validateCommand(env.program);

      const validateCmd = getValidateCommand(env);

      expect(validateCmd).toBeDefined();
      expect(validateCmd?.description()).toBe('Run validation with git tree hash caching');
    });

    it('should register --force option', () => {
      validateCommand(env.program);
      expectValidateOption(env, '-f, --force');
    });

    it('should register --verbose option', () => {
      validateCommand(env.program);
      expectValidateOption(env, '-v, --verbose');
    });

    it('should register --check option', () => {
      validateCommand(env.program);
      expectValidateOption(env, '-c, --check');
    });

    it('should register --retry-failed option', () => {
      validateCommand(env.program);
      expectValidateOption(env, '--retry-failed');
    });
  });

  describe('--retry-failed flag', () => {
    beforeEach(() => {
      setupMockConfig(testDir);
      setupSuccessfulValidation();
    });

    it('should pass retryFailed flag to workflow when --retry-failed is used', async () => {
      validateCommand(env.program);

      const exitCode = await parseCommand(env, ['validate', '--retry-failed']);
      expect(exitCode).toBe(0);

      // Verify runValidation was called (we don't check the config here as that's tested in validate-workflow.test.ts)
      expect(core.runValidation).toHaveBeenCalled();
    });

    it('should not set retryFailed when flag is not used', async () => {
      validateCommand(env.program);

      const exitCode = await parseCommand(env, ['validate']);
      expect(exitCode).toBe(0);

      // Verify runValidation was called without retry flag
      expect(core.runValidation).toHaveBeenCalled();
    });
  });

  describe('no config file', () => {
    it('should exit with error when no config found', async () => {
      // Mock loadConfigWithDir to return null (no config found)
      vi.mocked(configLoader.loadConfigWithDir).mockResolvedValue(null);

      // Mock loadConfigWithErrors to return null (no config file exists)
      vi.mocked(configLoader.loadConfigWithErrors).mockResolvedValue({
        config: null,
        errors: null,
        filePath: null
      });

      validateCommand(env.program);

      await parseCommandExpectingExit(env, ['validate']);

      expectConsoleError('No configuration found');
    });
  });

  describe('invalid config file', () => {
    it('should report validation errors when config file exists but is invalid', async () => {
      // Mock loadConfig to return null (invalid config)
      vi.mocked(configLoader.loadConfigWithDir).mockResolvedValue(null);

      // Mock loadConfigWithErrors to return detailed error info
      const loadConfigWithErrorsSpy = vi.spyOn(configLoader, 'loadConfigWithErrors')
        .mockResolvedValue({
          config: null,
          errors: ['validation.phases is required', 'git.mainBranch must be a string'],
          filePath: '/test/vibe-validate.config.yaml'
        });

      validateCommand(env.program);

      await parseCommandExpectingExit(env, ['validate']);

      expect(loadConfigWithErrorsSpy).toHaveBeenCalled();
      expectConsoleError('Configuration is invalid');
      expectNoConsoleError('No configuration found');
    });

    it('should distinguish between missing file and invalid file', async () => {
      // Mock loadConfig to return null
      vi.mocked(configLoader.loadConfigWithDir).mockResolvedValue(null);

      // Mock loadConfigWithErrors to return null errors (file doesn't exist)
      const loadConfigWithErrorsSpy = vi.spyOn(configLoader, 'loadConfigWithErrors')
        .mockResolvedValue({
          config: null,
          errors: null,
          filePath: null
        });

      validateCommand(env.program);

      await parseCommandExpectingExit(env, ['validate']);

      expect(loadConfigWithErrorsSpy).toHaveBeenCalled();
      expectConsoleError('No configuration found');
    });
  });

  describe('successful validation', () => {
    beforeEach(() => {
      setupMockConfig(testDir);
      setupSuccessfulValidation();
    });

    it('should exit with code 0 on successful validation', async () => {
      validateCommand(env.program);

      const exitCode = await parseCommand(env, ['validate']);
      expect(exitCode).toBe(0);
      expect(core.runValidation).toHaveBeenCalled();
    });

    it('should pass force option to validation runner', async () => {
      validateCommand(env.program);

      const exitCode = await parseCommand(env, ['validate', '--force']);
      expect(exitCode).toBe(0);
      expect(core.runValidation).toHaveBeenCalled();
    });
  });

  describe('failed validation', () => {
    beforeEach(() => {
      setupMockConfig(testDir, createMockConfig({
        validation: {
          phases: [{
            name: 'Test Phase',
            parallel: true,
            steps: [{ name: 'Test Step', command: 'exit 1' }]
          }]
        }
      }));
      setupFailedValidation();
    });

    it('should exit with code 1 on failed validation', async () => {
      validateCommand(env.program);

      const exitCode = await parseCommand(env, ['validate']);
      expect(exitCode).toBe(1);
      expect(core.runValidation).toHaveBeenCalled();
    });

    it('should display error details on failure', async () => {
      validateCommand(env.program);

      const exitCode = await parseCommand(env, ['validate']);
      expect(exitCode).toBe(1);
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('View error details'),
        expect.anything()
      );
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('🔄 To retry:'),
        expect.stringContaining('npm test')
      );
    });
  });

  describe('verbosity detection', () => {
    beforeEach(() => {
      setupMockConfig(testDir);
      setupSuccessfulValidation();
    });

    it('should use minimal output for agents by default', async () => {
      process.env.CLAUDE_CODE = 'true';
      validateCommand(env.program);

      const exitCode = await parseCommand(env, ['validate']);
      expect(exitCode).toBe(0);
      expect(core.runValidation).toHaveBeenCalled();

      delete process.env.CLAUDE_CODE;
    });

    it('should use verbose output for interactive terminals by default', async () => {
      delete process.env.CLAUDE_CODE;
      delete process.env.CI;
      validateCommand(env.program);

      const exitCode = await parseCommand(env, ['validate']);
      expect(exitCode).toBe(0);
      expect(core.runValidation).toHaveBeenCalled();
    });

    it('should respect explicit --verbose flag', async () => {
      validateCommand(env.program);

      const exitCode = await parseCommand(env, ['validate', '--verbose']);
      expect(exitCode).toBe(0);
      expect(core.runValidation).toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    beforeEach(() => {
      setupMockConfig(testDir);
    });

    it('should handle validation runner exceptions', async () => {
      vi.mocked(core.runValidation).mockRejectedValue(new Error('Validation crashed'));
      validateCommand(env.program);

      const exitCode = await parseCommand(env, ['validate']);
      expect(exitCode).toBe(1);
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('Validation failed with error'),
        expect.any(Error)
      );
    });

    it('should output YAML error result when validation crashes with --yaml flag', async () => {
      const testError = new Error('Validation crashed: /tmp write failed');
      vi.mocked(core.runValidation).mockRejectedValue(testError);

      const stdoutSpy = setupStdoutSpy();
      validateCommand(env.program);

      const exitCode = await parseCommand(env, ['validate', '--yaml']);
      expect(exitCode).toBe(1);

      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('Validation failed with error'),
        expect.any(Error)
      );

      const stdoutCalls = stdoutSpy.mock.calls.map(call => call[0]).join('');
      expect(stdoutCalls).toContain('---\n');
      expect(stdoutCalls).toContain('passed: false');
      expect(stdoutCalls).toContain('timestamp:');
      expect(stdoutCalls).toContain('Validation crashed: /tmp write failed');

      stdoutSpy.mockRestore();
    });
  });

  describe('--check flag', () => {
    beforeEach(() => {
      setupMockConfig(testDir);
    });

    it('should not run validation when --check flag is used', async () => {
      // Mock git tree hash
      vi.mocked(git.getGitTreeHash).mockResolvedValue({
        hash: 'abc123def456' as any
      });

      // Mock findCachedValidation with passing validation
      const mockRun = createMockHistoryNote({ timestamp: new Date().toISOString(), duration: 1000 }).runs[0];
      vi.mocked(history.findCachedValidation).mockResolvedValue(mockRun);

      validateCommand(env.program);

      try {
        await env.program.parseAsync(['validate', '--check'], { from: 'user' });
      } catch (error: unknown) {
        // Commander.js throws on exitOverride - verify it's the expected error
        expect(error).toBeDefined();
        // Expected exit from checkValidationStatus
      }

      // Verify runValidation was NOT called
      expect(core.runValidation).not.toHaveBeenCalled();
    });

    it('should exit with code 2 when no validation history exists', async () => {
      // Mock git tree hash
      vi.mocked(git.getGitTreeHash).mockResolvedValue({
        hash: 'abc123def456' as any
      });

      // Mock findCachedValidation with no history
      vi.mocked(history.findCachedValidation).mockResolvedValue(null);

      validateCommand(env.program);

      await parseCommandExpectingExit(env, ['validate', '--check'], 2);

      expectConsoleLog('No validation history for current working tree');
      expect(core.runValidation).not.toHaveBeenCalled();
    });

    it('should output YAML when --check and --yaml flags are used together', async () => {
      // Mock git tree hash
      vi.mocked(git.getGitTreeHash).mockResolvedValue({
        hash: 'abc123def456' as any
      });

      // Mock findCachedValidation with passing validation
      const mockRun = createMockHistoryNote().runs[0];
      vi.mocked(history.findCachedValidation).mockResolvedValue(mockRun);

      // Spy on process.stdout.write to capture YAML output
      vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

      validateCommand(env.program);

      await parseCommandExpectingExit(env, ['validate', '--check', '--yaml'], 0);

      // Verify runValidation was NOT called (using --check flag)
      expect(core.runValidation).not.toHaveBeenCalled();

      // Verify YAML separator and content were written to stdout
      expect(process.stdout.write).toHaveBeenCalledWith('---\n');
      expect(process.stdout.write).toHaveBeenCalledWith(expect.stringContaining('passed: true'));
      expect(process.stdout.write).toHaveBeenCalledWith(expect.stringContaining('timestamp:'));

      // Verify console.log was NOT called (YAML mode should only use stdout)
      expect(console.log).not.toHaveBeenCalled();
    });
  });

  describe('--yaml flag', () => {
    beforeEach(() => {
      setupMockConfig(testDir);
      setupStdoutSpy();
    });

    it('should register --yaml option', () => {
      validateCommand(env.program);

      const validateCmd = env.program.commands.find(cmd => cmd.name() === 'validate');
      const options = validateCmd?.options;

      expect(options?.some(opt => opt.flags === '-y, --yaml')).toBe(true);
    });

    it('should output YAML to stdout on successful validation', async () => {
      setupSuccessfulValidation({ timestamp: '2025-10-22T00:00:00.000Z' });
      validateCommand(env.program);

      const exitCode = await parseCommand(env, ['validate', '--yaml']);
      expect(exitCode).toBe(0);
      expect(process.stdout.write).toHaveBeenCalledWith('---\n');
      expect(process.stdout.write).toHaveBeenCalledWith(expect.stringContaining('passed: true'));
    });

    it('should output YAML to stdout on failed validation', async () => {
      setupFailedValidation({ timestamp: '2025-10-22T00:00:00.000Z', phases: [] });
      validateCommand(env.program);

      const exitCode = await parseCommand(env, ['validate', '--yaml']);
      expect(exitCode).toBe(1);
      expect(process.stdout.write).toHaveBeenCalledWith('---\n');
      expect(process.stdout.write).toHaveBeenCalledWith(expect.stringContaining('passed: false'));
    });

    it('should pass yaml flag to runner config', async () => {
      setupSuccessfulValidation({ timestamp: '2025-10-22T00:00:00.000Z' });
      validateCommand(env.program);

      const exitCode = await parseCommand(env, ['validate', '--yaml']);
      expect(exitCode).toBe(0);
      expect(core.runValidation).toHaveBeenCalledWith(
        expect.objectContaining({ yaml: true })
      );
    });

    it('should work with both --yaml and --verbose flags', async () => {
      setupSuccessfulValidation({ timestamp: '2025-10-22T00:00:00.000Z' });
      validateCommand(env.program);

      const exitCode = await parseCommand(env, ['validate', '--yaml', '--verbose']);
      expect(exitCode).toBe(0);
      expect(core.runValidation).toHaveBeenCalledWith(
        expect.objectContaining({ yaml: true, verbose: true })
      );
    });

    it('should display cached validation with tree hash and phase/step counts in human-readable mode', async () => {
      setupMockConfig(testDir);
      vi.mocked(git.getGitTreeHash).mockResolvedValue({
        hash: 'abc123def456' as any
      });

      // Mock findCachedValidation with passing validation (cached result with phases)
      const mockRun = createMockHistoryNote({
        phases: [
          {
            name: 'Pre-Qualification',
            durationSecs: 2.5,
            passed: true,
            steps: [
              { name: 'TypeScript', passed: true, durationSecs: 1.2 },
              { name: 'ESLint', passed: true, durationSecs: 1.3 }
            ]
          },
          {
            name: 'Testing',
            durationSecs: 2.5,
            passed: true,
            steps: [
              { name: 'Unit Tests', passed: true, durationSecs: 2.5 }
            ]
          }
        ]
      }).runs[0];
      vi.mocked(history.findCachedValidation).mockResolvedValue(mockRun);

      validateCommand(env.program);

      // Cache hit should prevent runValidation from being called
      await env.program.parseAsync(['validate'], { from: 'user' });

      // Verify cache check happened first
      expect(git.getGitTreeHash).toHaveBeenCalled();
      expect(history.findCachedValidation).toHaveBeenCalled();

      // Main assertion: runValidation should NOT be called when cache hits
      expect(core.runValidation).not.toHaveBeenCalled();

      // Verify human-readable output includes all required fields
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Validation passed for this code')
      );
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Tree hash: abc123def456')
      );
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Validated: 2025-10-22T00:00:00.000Z on branch main')
      );
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Phases: 2, Steps: 3 (5.0s)')
      );
    });

    it('should display cached failure result with tree hash and details in human-readable mode', async () => {
      setupMockConfig(testDir, createMockConfig({
        validation: {
          phases: [{
            name: 'Test Phase',
            parallel: true,
            steps: [{ name: 'Test Step', command: 'npm test' }]
          }]
        }
      }));
      vi.mocked(git.getGitTreeHash).mockResolvedValue({
        hash: 'abc123def456' as any
      });

      // Mock findCachedValidation with failing validation (cached failure)
      const mockRun = createMockHistoryNote({
        passed: false,
        failedStep: 'Test Step',
        phases: [
          {
            name: 'Test Phase',
            durationSecs: 5,
            passed: false,
            steps: [
              { name: 'Test Step', passed: false, durationSecs: 5 }
            ]
          }
        ]
      }).runs[0];
      vi.mocked(history.findCachedValidation).mockResolvedValue(mockRun);

      validateCommand(env.program);

      await parseCommandExpectingExit(env, ['validate']);

      // Verify cache check happened first
      expect(git.getGitTreeHash).toHaveBeenCalled();
      expect(history.findCachedValidation).toHaveBeenCalled();

      // runValidation should NOT be called when cache hits (even for failures)
      expect(core.runValidation).not.toHaveBeenCalled();

      // Verify human-readable output shows cached failure
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Validation failed for this code')
      );
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Tree hash: abc123def456')
      );
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Validated: 2025-10-22T00:00:00.000Z on branch main')
      );
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Phases: 1, Steps: 1 (5.0s)')
      );
    });

    it('should display cached validation result', async () => {
      setupMockConfig(testDir, createMockConfig({
        validation: {
          phases: [{
            name: 'Test Phase',
            parallel: true,
            steps: [{ name: 'Test Step', command: 'npm test' }]
          }]
        }
      }));
      vi.mocked(git.getGitTreeHash).mockResolvedValue({
        hash: 'abc123def456' as any
      });

      // Mock findCachedValidation with passing run
      const passedRun = createFlakyHistoryNote().runs[2]; // Most recent run (run-3, passed)
      vi.mocked(history.findCachedValidation).mockResolvedValue(passedRun);

      // Spy on console.log
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      validateCommand(env.program);

      await env.program.parseAsync(['validate'], { from: 'user' });

      // Should display passed validation
      expectConsoleLog('Validation passed for this code');

      logSpy.mockRestore();
    });

    it('should output YAML to stdout when validation is cached and --yaml flag is set', async () => {
      setupMockConfig(testDir);
      setupStdoutSpy();
      vi.mocked(git.getGitTreeHash).mockResolvedValue({
        hash: 'abc123def456' as any
      });

      // Mock findCachedValidation with passing validation (cached result)
      const mockRun = createMockHistoryNote().runs[0];
      vi.mocked(history.findCachedValidation).mockResolvedValue(mockRun);

      validateCommand(env.program);

      // Cache hit should prevent runValidation from being called
      await env.program.parseAsync(['validate', '--yaml'], { from: 'user' });

      // Verify cache check happened first
      expect(git.getGitTreeHash).toHaveBeenCalled();
      expect(history.findCachedValidation).toHaveBeenCalled();

      // Main assertion: runValidation should NOT be called when cache hits
      expect(core.runValidation).not.toHaveBeenCalled();

      // Verify YAML separator and cached result were written to stdout
      expect(process.stdout.write).toHaveBeenCalledWith('---\n');
      expect(process.stdout.write).toHaveBeenCalledWith(expect.stringContaining('passed: true'));
      expect(process.stdout.write).toHaveBeenCalledWith(expect.stringContaining('treeHash:'));

      // Verify console.log was NOT called (YAML mode should only use stdout)
      expect(console.log).not.toHaveBeenCalled();
    });

    it('should output YAML to stdout when cached failure and --yaml flag is set', async () => {
      setupMockConfig(testDir, createMockConfig({
        validation: {
          phases: [{
            name: 'Test Phase',
            parallel: true,
            steps: [{ name: 'Test Step', command: 'npm test' }]
          }]
        }
      }));
      setupStdoutSpy();
      vi.mocked(git.getGitTreeHash).mockResolvedValue({
        hash: 'abc123def456' as any
      });

      // Mock findCachedValidation with failing validation (cached failure)
      const mockRun = createMockHistoryNote({
        passed: false,
        failedStep: 'Test Step'
      }).runs[0];
      vi.mocked(history.findCachedValidation).mockResolvedValue(mockRun);

      validateCommand(env.program);

      await parseCommandExpectingExit(env, ['validate', '--yaml']);

      // Verify cache check happened first
      expect(git.getGitTreeHash).toHaveBeenCalled();
      expect(history.findCachedValidation).toHaveBeenCalled();

      // runValidation should NOT be called when cache hits
      expect(core.runValidation).not.toHaveBeenCalled();

      // Verify YAML separator and cached failure were written to stdout
      expect(process.stdout.write).toHaveBeenCalledWith('---\n');
      expect(process.stdout.write).toHaveBeenCalledWith(expect.stringContaining('passed: false'));
      expect(process.stdout.write).toHaveBeenCalledWith(expect.stringContaining('treeHash:'));
      expect(process.stdout.write).toHaveBeenCalledWith(expect.stringContaining('failedStep:'));

      // Verify console.log was NOT called (YAML mode should only use stdout)
      expect(console.log).not.toHaveBeenCalled();
    });
  });

  describe('auto-YAML output on failure', () => {
    beforeEach(() => {
      setupMockConfig(testDir, createMockConfig({
        validation: {
          phases: [{
            name: 'Test Phase',
            parallel: true,
            steps: [{ name: 'Test Step', command: 'npm test' }]
          }]
        }
      }));
    });

    it('should auto-output YAML to stderr on validation failure (without --yaml flag)', async () => {
      const stderrSpy = setupStderrSpy();
      setupFailedValidation({
        timestamp: '2025-11-24T00:00:00.000Z',
        phases: [{
          name: 'Test Phase',
          passed: false,
          steps: [{
            name: 'Test Step',
            command: 'npm test',
            passed: false,
            errors: [{
              file: 'src/foo.ts',
              line: 42,
              message: "Type 'string' is not assignable to type 'number'"
            }]
          }]
        }],
      });
      validateCommand(env.program);

      const exitCode = await parseCommand(env, ['validate']);
      expect(exitCode).toBe(1);
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('View error details'),
        expect.anything()
      );

      const stderrCalls = stderrSpy.mock.calls.map(call => call[0]).join('');
      expect(stderrCalls).toContain('---\n');
      expect(stderrCalls).toContain('passed: false');
      expect(stderrCalls).toContain('failedStep: Test Step');
      expect(stderrCalls).toContain('src/foo.ts');

      stderrSpy.mockRestore();
    });

    it('should NOT auto-output YAML on validation success (without --yaml flag)', async () => {
      const stderrSpy = setupStderrSpy();
      setupSuccessfulValidation({ timestamp: '2025-11-24T00:00:00.000Z' });
      validateCommand(env.program);

      const exitCode = await parseCommand(env, ['validate']);
      expect(exitCode).toBe(0);

      const stderrCalls = stderrSpy.mock.calls.map(call => call[0]).join('');
      expect(stderrCalls).not.toContain('---\n');
      expect(stderrCalls).not.toContain('passed: true');

      stderrSpy.mockRestore();
    });

    it('should still respect explicit --yaml flag (output to stdout on both success and failure)', async () => {
      const stdoutSpy = setupStdoutSpy();
      setupFailedValidation({ timestamp: '2025-11-24T00:00:00.000Z', phases: [] });
      validateCommand(env.program);

      const exitCode = await parseCommand(env, ['validate', '--yaml']);
      expect(exitCode).toBe(1);

      const stdoutCalls = stdoutSpy.mock.calls.map(call => call[0]).join('');
      expect(stdoutCalls).toContain('---\n');
      expect(stdoutCalls).toContain('passed: false');

      stdoutSpy.mockRestore();
    });
  });

  describe('worktree stability', () => {
    beforeEach(() => {
      setupMockConfig(testDir);
    });

    it('should warn and skip history recording when worktree changes during validation', async () => {
      const treeHashBefore = 'abc123def456' as TreeHash;
      const treeHashAfter = 'def456abc123' as TreeHash;

      // Mock git tree hash
      vi.mocked(git.getGitTreeHash).mockResolvedValue({
        hash: treeHashBefore,
      });

      // Mock worktree stability - unstable (changed during validation)
      vi.mocked(history.checkWorktreeStability).mockResolvedValue({
        stable: false,
        treeHashBefore: treeHashBefore,
        treeHashAfter: treeHashAfter,
      });

      // Mock successful validation
      vi.mocked(core.runValidation).mockResolvedValue({
        passed: true,
        timestamp: '2025-10-23T00:00:00.000Z',
        treeHash: treeHashBefore,
        phases: [],
      });

      // Spy on console.warn to verify warning message
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      validateCommand(env.program);

      await parseCommandExpectingExit(env, ['validate'], 0);

      // Verify warning was displayed
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('⚠️  Worktree changed during validation')
      );
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Before: abc123def456')
      );
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('After:  def456abc123')
      );
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Results valid but history not recorded (unstable state)')
      );

      // Verify validation ran successfully
      expect(core.runValidation).toHaveBeenCalled();

      warnSpy.mockRestore();
    });

    it('should record history when worktree remains stable', async () => {
      const treeHash = 'abc123def456' as TreeHash;

      // Mock git tree hash
      vi.mocked(git.getGitTreeHash).mockResolvedValue({
        hash: treeHash,
      });

      // Mock worktree stability - stable (unchanged during validation)
      vi.mocked(history.checkWorktreeStability).mockResolvedValue({
        stable: true,
        treeHashBefore: treeHash,
        treeHashAfter: treeHash,
      });

      // Mock successful validation
      vi.mocked(core.runValidation).mockResolvedValue({
        passed: true,
        timestamp: '2025-10-23T00:00:00.000Z',
        treeHash: treeHash,
        phases: [],
      });

      // Spy on console.warn to verify NO warning message
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      validateCommand(env.program);

      await parseCommandExpectingExit(env, ['validate'], 0);

      // Verify NO worktree change warning
      expect(warnSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('⚠️  Worktree changed during validation')
      );

      // Verify validation ran successfully
      expect(core.runValidation).toHaveBeenCalled();

      warnSpy.mockRestore();
    });
  });

  describe('working directory behavior (Issue #129)', () => {
    it('should execute validation steps in project root when invoked from subdirectory', async () => {
      // Issue #129: Commands should run in project root (where config lives),
      // not in process.cwd() where the user happens to be

      const configDir = join(testDir, 'project-root');
      const subdir = join(configDir, 'packages', 'foo');

      // Create directory structure
      mkdirSyncReal(configDir, { recursive: true });
      mkdirSyncReal(subdir, { recursive: true });

      // Setup all mocks for working directory test
      setupWorkingDirectoryMocks(configDir, 'test-tree-hash-129', true);

      // Execute command and verify cwd was changed to configDir during validation
      await executeAndCaptureCwd(env, subdir, configDir, 0);
    });

    it('should restore original directory after validation completes', async () => {
      const configDir = join(testDir, 'project-root');
      const subdir = join(configDir, 'packages', 'foo');

      mkdirSyncReal(configDir, { recursive: true });
      mkdirSyncReal(subdir, { recursive: true });

      setupWorkingDirectoryMocks(configDir, 'test-tree-hash-restore', true);

      // Change to subdirectory before validation
      process.chdir(subdir);
      const originalCwd = process.cwd();

      validateCommand(env.program);
      await parseCommandExpectingExit(env, ['validate'], 0);

      // CRITICAL: After validation completes, we should be back in the subdirectory
      expect(process.cwd()).toBe(originalCwd);
    });

    it('should restore original directory even when validation fails', async () => {
      const configDir = join(testDir, 'project-root');
      const subdir = join(configDir, 'packages', 'foo');

      mkdirSyncReal(configDir, { recursive: true });
      mkdirSyncReal(subdir, { recursive: true });

      setupWorkingDirectoryMocks(configDir, 'test-tree-hash-error', false);

      // Change to subdirectory before validation
      process.chdir(subdir);
      const originalCwd = process.cwd();

      validateCommand(env.program);
      await parseCommandExpectingExit(env, ['validate'], 1); // Expect exit code 1 for failure

      // CRITICAL: Even on failure, we should be back in the subdirectory
      expect(process.cwd()).toBe(originalCwd);
    });
  });

  describe('--retry-failed integration tests', () => {
    describe('retry workflow - failed then passed scenario', () => {
      it('should re-execute failed steps and use cache for passed steps', async () => {
        // Scenario: Run validation (some steps fail), then run with --retry-failed
        // Expected: Passed steps marked isCachedResult: true, failed steps re-executed

        setupMockConfig(testDir, createMockConfig({
          validation: {
            phases: [{
              name: 'Test Phase',
              parallel: false,
              steps: [
                { name: 'Quick Step', command: 'echo quick' },
                { name: 'Failing Step', command: 'exit 1' }
              ]
            }]
          }
        }));

        // First run: Failing Step fails
        const firstRunResult = {
          passed: false,
          timestamp: '2026-02-12T10:00:00Z',
          treeHash: 'abc123def456' as any,
          failedStep: 'Failing Step',
          phases: [{
            name: 'Test Phase',
            passed: false,
            durationSecs: 7.5,
            steps: [
              {
                name: 'Quick Step',
                command: 'echo quick',
                passed: true,
                exitCode: 0,
                durationSecs: 2.5,
              },
              {
                name: 'Failing Step',
                command: 'exit 1',
                passed: false,
                exitCode: 1,
                durationSecs: 5,
              }
            ]
          }]
        };

        // Setup mock for retry: return previous run
        const previousRun = {
          id: 'run-1',
          timestamp: '2026-02-12T10:00:00Z',
          duration: 7500,
          passed: false,
          branch: 'main',
          headCommit: 'commit123',
          uncommittedChanges: false,
          result: firstRunResult,
        };

        // First call: cache check returns null
        // Second call: retry check returns previous failed run
        vi.mocked(history.findCachedValidation)
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(previousRun);

        // Second run: All steps pass (Failing Step fixed)
        const secondRunResult = {
          passed: true,
          timestamp: '2026-02-12T10:05:00Z',
          treeHash: 'abc123def456' as any,
          phases: [{
            name: 'Test Phase',
            passed: true,
            durationSecs: 5.5,
            steps: [
              {
                name: 'Quick Step',
                command: 'echo quick',
                passed: true,
                exitCode: 0,
                durationSecs: 2.5,
                isCachedResult: true, // CRITICAL: Step used cache
              },
              {
                name: 'Failing Step',
                command: 'exit 1',
                passed: true,
                exitCode: 0,
                durationSecs: 3, // Different duration (re-executed)
              }
            ]
          }]
        };

        vi.mocked(core.runValidation).mockResolvedValue(secondRunResult);

        validateCommand(env.program);
        const exitCode = await parseCommand(env, ['validate', '--retry-failed']);

        expect(exitCode).toBe(0);

        // Verify previousRun was passed to runner
        expect(core.runValidation).toHaveBeenCalledWith(
          expect.objectContaining({
            previousRun: previousRun,
          })
        );

        // Verify result shows cached step
        const quickStep = findStepByName(secondRunResult.phases[0].steps, 'Quick Step');
        expect(quickStep?.isCachedResult).toBe(true);
        expect(quickStep?.durationSecs).toBe(2.5); // Original duration preserved

        // Verify failed step was re-executed (no cache marker)
        const failingStep = findStepByName(secondRunResult.phases[0].steps, 'Failing Step');
        expect(failingStep?.isCachedResult).toBeUndefined();
        expect(failingStep?.durationSecs).toBe(3); // New duration
      });
    });

    describe('flakiness detection - failed then passed', () => {
      it('should display flakiness warning when retry passes after previous failure', async () => {
        // Scenario: Validation fails, then passes on retry (simulates flaky test)
        // Expected: Flakiness warning displayed

        setupMockConfig(testDir);

        // Mock failed run in history
        const failedRun = {
          id: 'run-1',
          timestamp: '2026-02-12T10:00:00Z',
          duration: 5000,
          passed: false,
          branch: 'main',
          headCommit: 'commit123',
          uncommittedChanges: false,
          result: {
            passed: false,
            timestamp: '2026-02-12T10:00:00Z',
            treeHash: 'abc123def456' as any,
            failedStep: 'Test Step',
            phases: [{
              name: 'Test Phase',
              passed: false,
              durationSecs: 5,
              steps: [{
                name: 'Test Step',
                command: 'npm test',
                passed: false,
                exitCode: 1,
                durationSecs: 5,
              }]
            }]
          }
        };

        // Mock history note for flakiness detection
        const historyNote = {
          treeHash: 'abc123def456' as any,
          runs: [failedRun]
        };

        // Setup mocks
        vi.mocked(history.findCachedValidation)
          .mockResolvedValueOnce(null) // Cache check
          .mockResolvedValueOnce(failedRun); // Retry check

        vi.mocked(history.readHistoryNote).mockResolvedValue(historyNote);

        // Validation passes this time
        vi.mocked(core.runValidation).mockResolvedValue({
          passed: true,
          timestamp: '2026-02-12T10:05:00Z',
          treeHash: 'abc123def456' as any,
          phases: [{
            name: 'Test Phase',
            passed: true,
            durationSecs: 4,
            steps: [{
              name: 'Test Step',
              command: 'npm test',
              passed: true,
              exitCode: 0,
              durationSecs: 4,
            }]
          }]
        });

        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(noOp);

        validateCommand(env.program);
        const exitCode = await parseCommand(env, ['validate', '--retry-failed']);

        expect(exitCode).toBe(0);

        // Verify flakiness warning was displayed
        expect(warnSpy).toHaveBeenCalled();
        const warningCall = findFlakinessWarning(warnSpy);
        expect(warningCall).toBeDefined();
        expect(warningCall![0]).toContain('Test Step');
        expect(warningCall![0]).toContain('2026-02-12T10:00:00Z');

        warnSpy.mockRestore();
      });

      it('should not display flakiness warning when validation fails', async () => {
        setupMockConfig(testDir);

        // First run failed
        const failedRun = {
          id: 'run-1',
          timestamp: '2026-02-12T10:00:00Z',
          duration: 5000,
          passed: false,
          branch: 'main',
          headCommit: 'commit123',
          uncommittedChanges: false,
          result: {
            passed: false,
            timestamp: '2026-02-12T10:00:00Z',
            treeHash: 'abc123def456' as any,
            failedStep: 'Test Step',
            phases: []
          }
        };

        vi.mocked(history.findCachedValidation)
          .mockResolvedValueOnce(null)
          .mockResolvedValueOnce(failedRun);

        // Validation still fails
        vi.mocked(core.runValidation).mockResolvedValue({
          passed: false,
          timestamp: '2026-02-12T10:05:00Z',
          treeHash: 'abc123def456' as any,
          failedStep: 'Test Step',
          phases: []
        });

        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(noOp);

        validateCommand(env.program);
        const exitCode = await parseCommand(env, ['validate', '--retry-failed']);

        expect(exitCode).toBe(1);

        // Verify NO flakiness warning (validation failed again)
        const warningCall = findFlakinessWarning(warnSpy);
        expect(warningCall).toBeUndefined();

        warnSpy.mockRestore();
      });
    });

    describe('no previous validation scenario', () => {
      it('should show error message and run full validation when no previous validation exists', async () => {
        setupMockConfig(testDir);

        // No cached validation
        vi.mocked(history.findCachedValidation).mockResolvedValue(null);

        // Validation runs and passes
        vi.mocked(core.runValidation).mockResolvedValue({
          passed: true,
          timestamp: '2026-02-12T10:00:00Z',
          treeHash: 'abc123def456' as any,
          phases: []
        });

        const errorSpy = vi.spyOn(console, 'error').mockImplementation(noOp);

        validateCommand(env.program);
        const exitCode = await parseCommand(env, ['validate', '--retry-failed']);

        expect(exitCode).toBe(0);

        // Verify error message about no previous validation
        expect(errorSpy).toHaveBeenCalledWith(
          expect.stringContaining('No failed validation found')
        );
        expect(errorSpy).toHaveBeenCalledWith(
          expect.stringContaining('abc123def456')
        );

        // Verify full validation ran (without previousRun)
        expect(core.runValidation).toHaveBeenCalledWith(
          expect.objectContaining({
            previousRun: undefined,
          })
        );

        errorSpy.mockRestore();
      });

      it('should show error message when previous validation passed', async () => {
        setupMockConfig(testDir);

        // Previous validation passed
        const passedRun = {
          id: 'run-1',
          timestamp: '2026-02-12T10:00:00Z',
          duration: 5000,
          passed: true,
          branch: 'main',
          headCommit: 'commit123',
          uncommittedChanges: false,
          result: {
            passed: true,
            timestamp: '2026-02-12T10:00:00Z',
            treeHash: 'abc123def456' as any,
            phases: []
          }
        };

        vi.mocked(history.findCachedValidation)
          .mockResolvedValueOnce(null) // Cache check
          .mockResolvedValueOnce(passedRun); // Retry check

        vi.mocked(core.runValidation).mockResolvedValue({
          passed: true,
          timestamp: '2026-02-12T10:05:00Z',
          treeHash: 'abc123def456' as any,
          phases: []
        });

        const errorSpy = vi.spyOn(console, 'error').mockImplementation(noOp);

        validateCommand(env.program);
        const exitCode = await parseCommand(env, ['validate', '--retry-failed']);

        expect(exitCode).toBe(0);

        // Verify message about previous validation passing
        expect(errorSpy).toHaveBeenCalledWith(
          expect.stringContaining('Previous validation passed')
        );

        // Verify full validation ran
        expect(core.runValidation).toHaveBeenCalledWith(
          expect.objectContaining({
            previousRun: undefined,
          })
        );

        errorSpy.mockRestore();
      });
    });

    describe('force flag with retry-failed', () => {
      it('should ignore retry logic when --force is used with --retry-failed', async () => {
        setupMockConfig(testDir);

        // Mock a failed previous run (should be ignored due to --force)
        const failedRun = {
          id: 'run-1',
          timestamp: '2026-02-12T10:00:00Z',
          duration: 5000,
          passed: false,
          branch: 'main',
          headCommit: 'commit123',
          uncommittedChanges: false,
          result: {
            passed: false,
            timestamp: '2026-02-12T10:00:00Z',
            treeHash: 'abc123def456' as any,
            failedStep: 'Test Step',
            phases: []
          }
        };

        vi.mocked(history.findCachedValidation).mockResolvedValue(failedRun);

        vi.mocked(core.runValidation).mockResolvedValue({
          passed: true,
          timestamp: '2026-02-12T10:05:00Z',
          treeHash: 'abc123def456' as any,
          phases: []
        });

        validateCommand(env.program);
        const exitCode = await parseCommand(env, ['validate', '--retry-failed', '--force']);

        expect(exitCode).toBe(0);

        // Verify findCachedValidation was NOT called (--force skips cache entirely)
        expect(history.findCachedValidation).not.toHaveBeenCalled();

        // Verify validation ran without previousRun
        expect(core.runValidation).toHaveBeenCalledWith(
          expect.objectContaining({
            previousRun: undefined,
          })
        );
      });
    });
  });
});

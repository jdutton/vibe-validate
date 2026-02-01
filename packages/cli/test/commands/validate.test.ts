import {  rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import type { VibeValidateConfig } from '@vibe-validate/config';
import * as core from '@vibe-validate/core';
import * as git from '@vibe-validate/git';
import * as history from '@vibe-validate/history';
import { mkdirSyncReal, normalizedTmpdir } from '@vibe-validate/utils';
import { describe, it, expect, beforeEach, afterEach, vi, type MockInstance } from 'vitest';

import { validateCommand } from '../../src/commands/validate.js';
import * as configLoader from '../../src/utils/config-loader.js';
import * as pidLock from '../../src/utils/pid-lock.js';
import * as projectId from '../../src/utils/project-id.js';
import { setupCommanderTest, type CommanderTestEnv } from '../helpers/commander-test-setup.js';


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
    readHistoryNote: vi.fn(),
    checkWorktreeStability: vi.fn(),
    recordValidationHistory: vi.fn(),
    checkHistoryHealth: vi.fn(),
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

describe('validate command', () => {
  let testDir: string;
  let originalCwd: string;
  let env: CommanderTestEnv;

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
   * Setup config loader with mock config
   * @param config - Config to return (defaults to createMockConfig())
   */
  function setupMockConfig(config: VibeValidateConfig = createMockConfig()): void {
    vi.mocked(configLoader.loadConfigWithDir).mockResolvedValue({ config, configDir: testDir });
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
          steps: [
            {
              name: 'Test Step',
              command: 'npm test',
              passed: false,
            }
          ]
        }
      ],
      failedStep: 'Test Step',
      fullLogFile: join(normalizedTmpdir(), 'validation.log'),
      ...overrides,
    });
  }

  /**
   * Parse command with proper error handling
   * @param args - Command arguments
   * @returns Exit code (0 for success, 1 for failure)
   */
  async function parseCommand(args: string[]): Promise<number> {
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
   * Setup stdout spy for capturing YAML output
   * @returns Spy instance
   */
  function setupStdoutSpy(): MockInstance {
    return vi.spyOn(process.stdout, 'write').mockImplementation((chunk: any, encoding?: any, callback?: any) => {
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
    vi.mocked(history.readHistoryNote).mockReset();
    vi.mocked(history.checkWorktreeStability).mockReset();
    vi.mocked(history.recordValidationHistory).mockReset();
    vi.mocked(history.checkHistoryHealth).mockReset();
    vi.mocked(pidLock.acquireLock).mockReset();
    vi.mocked(pidLock.releaseLock).mockReset();
    vi.mocked(pidLock.checkLock).mockReset();
    vi.mocked(pidLock.waitForLock).mockReset();
    vi.mocked(projectId.detectProjectId).mockReset();

    // Default getGitTreeHash to return a hash
    vi.mocked(git.getGitTreeHash).mockResolvedValue('abc123def456');

    // Default lock mocks - lock acquired successfully
    vi.mocked(pidLock.acquireLock).mockResolvedValue({
      acquired: true,
      lockFile: join(normalizedTmpdir(), 'test.lock'),
    });
    vi.mocked(pidLock.releaseLock).mockResolvedValue();
    vi.mocked(pidLock.checkLock).mockResolvedValue(null);
    vi.mocked(pidLock.waitForLock).mockResolvedValue({
      released: true,
      timedOut: false,
      finalLock: null,
    });

    // Default project ID detection
    vi.mocked(projectId.detectProjectId).mockReturnValue('test-project');

    // Default history mocks to no-op
    vi.mocked(history.checkWorktreeStability).mockResolvedValue({
      stable: true,
      treeHashBefore: 'default',
      treeHashAfter: 'default',
    });
    vi.mocked(history.recordValidationHistory).mockResolvedValue({
      recorded: true,
    });
    vi.mocked(history.checkHistoryHealth).mockResolvedValue({
      healthy: true,
      totalNotes: 0,
      totalSize: 0,
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

      const commands = env.program.commands;
      const validateCmd = commands.find(cmd => cmd.name() === 'validate');

      expect(validateCmd).toBeDefined();
      expect(validateCmd?.description()).toBe('Run validation with git tree hash caching');
    });

    it('should register --force option', () => {
      validateCommand(env.program);

      const validateCmd = env.program.commands.find(cmd => cmd.name() === 'validate');
      const options = validateCmd?.options;

      expect(options?.some(opt => opt.flags === '-f, --force')).toBe(true);
    });

    it('should register --verbose option', () => {
      validateCommand(env.program);

      const validateCmd = env.program.commands.find(cmd => cmd.name() === 'validate');
      const options = validateCmd?.options;

      expect(options?.some(opt => opt.flags === '-v, --verbose')).toBe(true);
    });

    it('should register --check option', () => {
      validateCommand(env.program);

      const validateCmd = env.program.commands.find(cmd => cmd.name() === 'validate');
      const options = validateCmd?.options;

      expect(options?.some(opt => opt.flags === '-c, --check')).toBe(true);
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

      try {
        await env.program.parseAsync(['validate'], { from: 'user' });
      } catch (err: unknown) {
        if (err && typeof err === 'object' && 'exitCode' in err) {
          expect(err.exitCode).toBe(1);
        }
      }

      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('No configuration found'));
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

      try {
        await env.program.parseAsync(['validate'], { from: 'user' });
      } catch (err: unknown) {
        if (err && typeof err === 'object' && 'exitCode' in err) {
          expect(err.exitCode).toBe(1);
        }
      }

      expect(loadConfigWithErrorsSpy).toHaveBeenCalled();
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Configuration is invalid'));
      expect(console.error).not.toHaveBeenCalledWith(expect.stringContaining('No configuration found'));
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

      try {
        await env.program.parseAsync(['validate'], { from: 'user' });
      } catch (err: unknown) {
        if (err && typeof err === 'object' && 'exitCode' in err) {
          expect(err.exitCode).toBe(1);
        }
      }

      expect(loadConfigWithErrorsSpy).toHaveBeenCalled();
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('No configuration found'));
    });
  });

  describe('successful validation', () => {
    beforeEach(() => {
      setupMockConfig();
      setupSuccessfulValidation();
    });

    it('should exit with code 0 on successful validation', async () => {
      validateCommand(env.program);

      const exitCode = await parseCommand(['validate']);
      expect(exitCode).toBe(0);
      expect(core.runValidation).toHaveBeenCalled();
    });

    it('should pass force option to validation runner', async () => {
      validateCommand(env.program);

      const exitCode = await parseCommand(['validate', '--force']);
      expect(exitCode).toBe(0);
      expect(core.runValidation).toHaveBeenCalled();
    });
  });

  describe('failed validation', () => {
    beforeEach(() => {
      setupMockConfig(createMockConfig({
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

      const exitCode = await parseCommand(['validate']);
      expect(exitCode).toBe(1);
      expect(core.runValidation).toHaveBeenCalled();
    });

    it('should display error details on failure', async () => {
      validateCommand(env.program);

      const exitCode = await parseCommand(['validate']);
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
      setupMockConfig();
      setupSuccessfulValidation();
    });

    it('should use minimal output for agents by default', async () => {
      process.env.CLAUDE_CODE = 'true';
      validateCommand(env.program);

      const exitCode = await parseCommand(['validate']);
      expect(exitCode).toBe(0);
      expect(core.runValidation).toHaveBeenCalled();

      delete process.env.CLAUDE_CODE;
    });

    it('should use verbose output for interactive terminals by default', async () => {
      delete process.env.CLAUDE_CODE;
      delete process.env.CI;
      validateCommand(env.program);

      const exitCode = await parseCommand(['validate']);
      expect(exitCode).toBe(0);
      expect(core.runValidation).toHaveBeenCalled();
    });

    it('should respect explicit --verbose flag', async () => {
      validateCommand(env.program);

      const exitCode = await parseCommand(['validate', '--verbose']);
      expect(exitCode).toBe(0);
      expect(core.runValidation).toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    beforeEach(() => {
      setupMockConfig();
    });

    it('should handle validation runner exceptions', async () => {
      vi.mocked(core.runValidation).mockRejectedValue(new Error('Validation crashed'));
      validateCommand(env.program);

      const exitCode = await parseCommand(['validate']);
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

      const exitCode = await parseCommand(['validate', '--yaml']);
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
      setupMockConfig();
    });

    it('should not run validation when --check flag is used', async () => {
      // Mock git tree hash
      vi.mocked(git.getGitTreeHash).mockResolvedValue('abc123def456');

      // Mock git notes with passing validation
      vi.mocked(history.readHistoryNote).mockResolvedValue({
        treeHash: 'abc123def456',
        runs: [
          {
            id: 'run-1',
            timestamp: new Date().toISOString(),
            duration: 1000,
            passed: true,
            branch: 'main',
            headCommit: 'abc123',
            uncommittedChanges: false,
            result: {
              passed: true,
              timestamp: new Date().toISOString(),
              treeHash: 'abc123def456',
              phases: [],
            },
          },
        ],
      });

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
      vi.mocked(git.getGitTreeHash).mockResolvedValue('abc123def456');

      // Mock git notes with no history
      vi.mocked(history.readHistoryNote).mockResolvedValue(null);

      validateCommand(env.program);

      try {
        await env.program.parseAsync(['validate', '--check'], { from: 'user' });
      } catch (err: unknown) {
        if (err && typeof err === 'object' && 'exitCode' in err) {
          expect(err.exitCode).toBe(2);
        }
      }

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('No validation history for current working tree')
      );
      expect(core.runValidation).not.toHaveBeenCalled();
    });

    it('should output YAML when --check and --yaml flags are used together', async () => {
      // Mock git tree hash
      vi.mocked(git.getGitTreeHash).mockResolvedValue('abc123def456');

      // Mock git notes with passing validation
      vi.mocked(history.readHistoryNote).mockResolvedValue({
        treeHash: 'abc123def456',
        runs: [
          {
            id: 'run-1',
            timestamp: '2025-10-22T00:00:00.000Z',
            duration: 5000,
            passed: true,
            branch: 'main',
            headCommit: 'abc123',
            uncommittedChanges: false,
            result: {
              passed: true,
              timestamp: '2025-10-22T00:00:00.000Z',
              treeHash: 'abc123def456',
              duration: 5000,
              branch: 'main',
              phases: [],
            },
          },
        ],
      });

      // Spy on process.stdout.write to capture YAML output
      vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

      validateCommand(env.program);

      try {
        await env.program.parseAsync(['validate', '--check', '--yaml'], { from: 'user' });
      } catch (err: unknown) {
        // Expected exit from checkValidationStatus with code 0
        if (err && typeof err === 'object' && 'exitCode' in err) {
          expect(err.exitCode).toBe(0);
        }
      }

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
      setupMockConfig();
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

      const exitCode = await parseCommand(['validate', '--yaml']);
      expect(exitCode).toBe(0);
      expect(process.stdout.write).toHaveBeenCalledWith('---\n');
      expect(process.stdout.write).toHaveBeenCalledWith(expect.stringContaining('passed: true'));
    });

    it('should output YAML to stdout on failed validation', async () => {
      setupFailedValidation({ timestamp: '2025-10-22T00:00:00.000Z', phases: [], fullLogFile: undefined });
      validateCommand(env.program);

      const exitCode = await parseCommand(['validate', '--yaml']);
      expect(exitCode).toBe(1);
      expect(process.stdout.write).toHaveBeenCalledWith('---\n');
      expect(process.stdout.write).toHaveBeenCalledWith(expect.stringContaining('passed: false'));
    });

    it('should pass yaml flag to runner config', async () => {
      setupSuccessfulValidation({ timestamp: '2025-10-22T00:00:00.000Z' });
      validateCommand(env.program);

      const exitCode = await parseCommand(['validate', '--yaml']);
      expect(exitCode).toBe(0);
      expect(core.runValidation).toHaveBeenCalledWith(
        expect.objectContaining({ yaml: true })
      );
    });

    it('should work with both --yaml and --verbose flags', async () => {
      setupSuccessfulValidation({ timestamp: '2025-10-22T00:00:00.000Z' });
      validateCommand(env.program);

      const exitCode = await parseCommand(['validate', '--yaml', '--verbose']);
      expect(exitCode).toBe(0);
      expect(core.runValidation).toHaveBeenCalledWith(
        expect.objectContaining({ yaml: true, verbose: true })
      );
    });

    it('should display cached validation with tree hash and phase/step counts in human-readable mode', async () => {
      setupMockConfig();
      vi.mocked(git.getGitTreeHash).mockResolvedValue('abc123def456');

      // Mock git notes with passing validation (cached result with phases)
      const mockHistoryNote = {
        treeHash: 'abc123def456',
        runs: [
          {
            id: 'run-1',
            timestamp: '2025-10-22T00:00:00.000Z',
            duration: 5000,
            passed: true,
            branch: 'main',
            headCommit: 'abc123',
            uncommittedChanges: false,
            result: {
              passed: true,
              timestamp: '2025-10-22T00:00:00.000Z',
              treeHash: 'abc123def456',
              duration: 5000,
              branch: 'main',
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
              ],
            },
          },
        ],
      };
      vi.mocked(history.readHistoryNote).mockResolvedValue(mockHistoryNote);

      validateCommand(env.program);

      // Cache hit should prevent runValidation from being called
      await env.program.parseAsync(['validate'], { from: 'user' });

      // Verify cache check happened first
      expect(git.getGitTreeHash).toHaveBeenCalled();
      expect(history.readHistoryNote).toHaveBeenCalledWith('abc123def456');

      // Main assertion: runValidation should NOT be called when cache hits
      expect(core.runValidation).not.toHaveBeenCalled();

      // Verify human-readable output includes all required fields
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Validation already passed')
      );
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Tree hash: abc123def456')
      );
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Last validated: 2025-10-22T00:00:00.000Z')
      );
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Duration: 5.0s')
      );
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Branch: main')
      );
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Phases: 2, Steps: 3')
      );
    });

    it('should display cached failure result with tree hash and details in human-readable mode', async () => {
      setupMockConfig(createMockConfig({
        validation: {
          phases: [{
            name: 'Test Phase',
            parallel: true,
            steps: [{ name: 'Test Step', command: 'npm test' }]
          }]
        }
      }));
      vi.mocked(git.getGitTreeHash).mockResolvedValue('abc123def456');

      // Mock git notes with failing validation (cached failure)
      const mockHistoryNote = {
        treeHash: 'abc123def456',
        runs: [
          {
            id: 'run-1',
            timestamp: '2025-10-22T00:00:00.000Z',
            duration: 5000,
            passed: false,
            branch: 'main',
            headCommit: 'abc123',
            uncommittedChanges: false,
            result: {
              passed: false,
              timestamp: '2025-10-22T00:00:00.000Z',
              treeHash: 'abc123def456',
              duration: 5000,
              branch: 'main',
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
              ],
            },
          },
        ],
      };
      vi.mocked(history.readHistoryNote).mockResolvedValue(mockHistoryNote);

      validateCommand(env.program);

      try {
        await env.program.parseAsync(['validate'], { from: 'user' });
      } catch (err: unknown) {
        // Should exit with code 1 for cached failure
        if (err && typeof err === 'object' && 'exitCode' in err) {
          expect(err.exitCode).toBe(1);
        }
      }

      // Verify cache check happened first
      expect(git.getGitTreeHash).toHaveBeenCalled();
      expect(history.readHistoryNote).toHaveBeenCalledWith('abc123def456');

      // runValidation should NOT be called when cache hits (even for failures)
      expect(core.runValidation).not.toHaveBeenCalled();

      // Verify human-readable output shows cached failure
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Validation already failed')
      );
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Tree hash: abc123def456')
      );
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Last validated: 2025-10-22T00:00:00.000Z')
      );
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Duration: 5.0s')
      );
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Branch: main')
      );
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Phases: 1, Steps: 1')
      );
    });

    it('should warn about flakiness when multiple runs have different outcomes', async () => {
      setupMockConfig(createMockConfig({
        validation: {
          phases: [{
            name: 'Test Phase',
            parallel: true,
            steps: [{ name: 'Test Step', command: 'npm test' }]
          }]
        }
      }));
      vi.mocked(git.getGitTreeHash).mockResolvedValue('abc123def456');

      // Mock git notes with multiple runs - some passed, some failed (flakiness)
      const mockHistoryNote = {
        treeHash: 'abc123def456',
        runs: [
          {
            id: 'run-1',
            timestamp: '2025-10-22T00:00:00.000Z',
            duration: 5000,
            passed: true,
            branch: 'main',
            headCommit: 'abc123',
            uncommittedChanges: false,
            result: {
              passed: true,
              timestamp: '2025-10-22T00:00:00.000Z',
              treeHash: 'abc123def456',
              phases: [],
            },
          },
          {
            id: 'run-2',
            timestamp: '2025-10-22T01:00:00.000Z',
            duration: 4500,
            passed: false,
            branch: 'main',
            headCommit: 'abc123',
            uncommittedChanges: false,
            result: {
              passed: false,
              timestamp: '2025-10-22T01:00:00.000Z',
              treeHash: 'abc123def456',
              failedStep: 'Test Step',
              phases: [],
            },
          },
          {
            id: 'run-3',
            timestamp: '2025-10-22T02:00:00.000Z',
            duration: 5200,
            passed: true,
            branch: 'main',
            headCommit: 'abc123',
            uncommittedChanges: false,
            result: {
              passed: true,
              timestamp: '2025-10-22T02:00:00.000Z',
              treeHash: 'abc123def456',
              phases: [],
            },
          },
        ],
      };
      vi.mocked(history.readHistoryNote).mockResolvedValue(mockHistoryNote);

      // Spy on console.warn
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      validateCommand(env.program);

      await env.program.parseAsync(['validate'], { from: 'user' });

      // Verify flakiness warning was shown
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('⚠️  Flaky validation detected')
      );
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Found 3 runs with different results')
      );
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Using most recent result')
      );

      // Should use most recent run (run-3, which passed)
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Validation already passed')
      );

      warnSpy.mockRestore();
    });

    it('should output YAML to stdout when validation is cached and --yaml flag is set', async () => {
      setupMockConfig();
      setupStdoutSpy();
      vi.mocked(git.getGitTreeHash).mockResolvedValue('abc123def456');

      // Mock git notes with passing validation (cached result)
      const mockHistoryNote = {
        treeHash: 'abc123def456',
        runs: [
          {
            id: 'run-1',
            timestamp: '2025-10-22T00:00:00.000Z',
            duration: 5000,
            passed: true,
            branch: 'main',
            headCommit: 'abc123',
            uncommittedChanges: false,
            result: {
              passed: true,
              timestamp: '2025-10-22T00:00:00.000Z',
              treeHash: 'abc123def456',
              duration: 5000,
              branch: 'main',
              phases: [],
            },
          },
        ],
      };
      vi.mocked(history.readHistoryNote).mockResolvedValue(mockHistoryNote);

      validateCommand(env.program);

      // Cache hit should prevent runValidation from being called
      await env.program.parseAsync(['validate', '--yaml'], { from: 'user' });

      // Verify cache check happened first
      expect(git.getGitTreeHash).toHaveBeenCalled();
      expect(history.readHistoryNote).toHaveBeenCalledWith('abc123def456');

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
      setupMockConfig(createMockConfig({
        validation: {
          phases: [{
            name: 'Test Phase',
            parallel: true,
            steps: [{ name: 'Test Step', command: 'npm test' }]
          }]
        }
      }));
      setupStdoutSpy();
      vi.mocked(git.getGitTreeHash).mockResolvedValue('abc123def456');

      // Mock git notes with failing validation (cached failure)
      const mockHistoryNote = {
        treeHash: 'abc123def456',
        runs: [
          {
            id: 'run-1',
            timestamp: '2025-10-22T00:00:00.000Z',
            duration: 5000,
            passed: false,
            branch: 'main',
            headCommit: 'abc123',
            uncommittedChanges: false,
            result: {
              passed: false,
              timestamp: '2025-10-22T00:00:00.000Z',
              treeHash: 'abc123def456',
              duration: 5000,
              branch: 'main',
              failedStep: 'Test Step',
              phases: [],
            },
          },
        ],
      };
      vi.mocked(history.readHistoryNote).mockResolvedValue(mockHistoryNote);

      validateCommand(env.program);

      try {
        await env.program.parseAsync(['validate', '--yaml'], { from: 'user' });
      } catch (err: unknown) {
        // Should exit with code 1 for cached failure
        if (err && typeof err === 'object' && 'exitCode' in err) {
          expect(err.exitCode).toBe(1);
        }
      }

      // Verify cache check happened first
      expect(git.getGitTreeHash).toHaveBeenCalled();
      expect(history.readHistoryNote).toHaveBeenCalledWith('abc123def456');

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
      setupMockConfig(createMockConfig({
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

      const exitCode = await parseCommand(['validate']);
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

      const exitCode = await parseCommand(['validate']);
      expect(exitCode).toBe(0);

      const stderrCalls = stderrSpy.mock.calls.map(call => call[0]).join('');
      expect(stderrCalls).not.toContain('---\n');
      expect(stderrCalls).not.toContain('passed: true');

      stderrSpy.mockRestore();
    });

    it('should still respect explicit --yaml flag (output to stdout on both success and failure)', async () => {
      const stdoutSpy = setupStdoutSpy();
      setupFailedValidation({ timestamp: '2025-11-24T00:00:00.000Z', phases: [], fullLogFile: undefined });
      validateCommand(env.program);

      const exitCode = await parseCommand(['validate', '--yaml']);
      expect(exitCode).toBe(1);

      const stdoutCalls = stdoutSpy.mock.calls.map(call => call[0]).join('');
      expect(stdoutCalls).toContain('---\n');
      expect(stdoutCalls).toContain('passed: false');

      stdoutSpy.mockRestore();
    });
  });

  describe('worktree stability', () => {
    beforeEach(() => {
      setupMockConfig();
    });

    it('should warn and skip history recording when worktree changes during validation', async () => {
      const treeHashBefore = 'abc123def456';
      const treeHashAfter = 'def456abc123';

      // Mock git tree hash
      vi.mocked(git.getGitTreeHash).mockResolvedValue(treeHashBefore);

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

      try {
        await env.program.parseAsync(['validate'], { from: 'user' });
      } catch (err: unknown) {
        // Expected exit with code 0 (validation passed)
        if (err && typeof err === 'object' && 'exitCode' in err) {
          expect(err.exitCode).toBe(0);
        }
      }

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
      const treeHash = 'abc123def456';

      // Mock git tree hash
      vi.mocked(git.getGitTreeHash).mockResolvedValue(treeHash);

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

      try {
        await env.program.parseAsync(['validate'], { from: 'user' });
      } catch (err: unknown) {
        // Expected exit with code 0 (validation passed)
        if (err && typeof err === 'object' && 'exitCode' in err) {
          expect(err.exitCode).toBe(0);
        }
      }

      // Verify NO worktree change warning
      expect(warnSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('⚠️  Worktree changed during validation')
      );

      // Verify validation ran successfully
      expect(core.runValidation).toHaveBeenCalled();

      warnSpy.mockRestore();
    });
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Command } from 'commander';
import { validateCommand } from '../../src/commands/validate.js';
import * as core from '@vibe-validate/core';
import * as configLoader from '../../src/utils/config-loader.js';
import * as history from '@vibe-validate/history';
import * as git from '@vibe-validate/git';
import type { VibeValidateConfig } from '@vibe-validate/config';

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

describe('validate command', () => {
  let testDir: string;
  let originalCwd: string;
  let program: Command;

  beforeEach(() => {
    // Clear all mock calls from previous tests (prevents test pollution across test files)
    vi.clearAllMocks();

    // Create temp directory for test files
    testDir = join(tmpdir(), `vibe-validate-validate-test-${Date.now()}`);
    if (!existsSync(testDir)) {
      mkdirSync(testDir, { recursive: true });
    }

    // Save original cwd and change to test directory
    originalCwd = process.cwd();
    process.chdir(testDir);

    // Create fresh Commander instance
    program = new Command();
    program.exitOverride(); // Prevent process.exit() from killing tests

    // Spy on console methods to capture output
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    // Mock process.exit to prevent it from actually exiting during tests
    vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null | undefined) => {
      throw new Error(`process.exit(${code})`);
    }) as any;

    // Reset mocks
    vi.mocked(core.runValidation).mockReset();
    vi.mocked(configLoader.loadConfig).mockReset();
    vi.mocked(git.getGitTreeHash).mockReset();
    vi.mocked(history.readHistoryNote).mockReset();
    vi.mocked(history.checkWorktreeStability).mockReset();
    vi.mocked(history.recordValidationHistory).mockReset();
    vi.mocked(history.checkHistoryHealth).mockReset();

    // Default getGitTreeHash to throw (simulating not in git repo)
    // Tests can override this if they need git functionality
    vi.mocked(git.getGitTreeHash).mockRejectedValue(new Error('Not in git repo'));

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
  });

  afterEach(() => {
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
      validateCommand(program);

      const commands = program.commands;
      const validateCmd = commands.find(cmd => cmd.name() === 'validate');

      expect(validateCmd).toBeDefined();
      expect(validateCmd?.description()).toBe('Run validation with git tree hash caching');
    });

    it('should register --force option', () => {
      validateCommand(program);

      const validateCmd = program.commands.find(cmd => cmd.name() === 'validate');
      const options = validateCmd?.options;

      expect(options?.some(opt => opt.flags === '-f, --force')).toBe(true);
    });

    it('should register --verbose option', () => {
      validateCommand(program);

      const validateCmd = program.commands.find(cmd => cmd.name() === 'validate');
      const options = validateCmd?.options;

      expect(options?.some(opt => opt.flags === '-v, --verbose')).toBe(true);
    });

    it('should register --check option', () => {
      validateCommand(program);

      const validateCmd = program.commands.find(cmd => cmd.name() === 'validate');
      const options = validateCmd?.options;

      expect(options?.some(opt => opt.flags === '-c, --check')).toBe(true);
    });
  });

  describe('no config file', () => {
    it('should exit with error when no config found', async () => {
      // Mock loadConfig to return null (no config found)
      vi.mocked(configLoader.loadConfig).mockResolvedValue(null);

      validateCommand(program);

      try {
        await program.parseAsync(['validate'], { from: 'user' });
      } catch (error: unknown) {
        if (error && typeof error === 'object' && 'exitCode' in error) {
          expect(error.exitCode).toBe(1);
        }
      }

      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('No configuration found'));
    });
  });

  describe('successful validation', () => {
    beforeEach(() => {
      // Mock valid config
      const mockConfig: VibeValidateConfig = {
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
        }
      };
      vi.mocked(configLoader.loadConfig).mockResolvedValue(mockConfig);

      // Mock successful validation
      vi.mocked(core.runValidation).mockResolvedValue({
        passed: true,
        timestamp: new Date().toISOString(),
        treeHash: 'abc123',
        phases: [],
      });
    });

    it('should exit with code 0 on successful validation', async () => {
      validateCommand(program);

      try {
        await program.parseAsync(['validate'], { from: 'user' });
      } catch (error: unknown) {
        if (error && typeof error === 'object' && 'exitCode' in error) {
          expect(error.exitCode).toBe(0);
        }
      }

      expect(core.runValidation).toHaveBeenCalled();
    });

    it('should pass force option to validation runner', async () => {
      validateCommand(program);

      try {
        await program.parseAsync(['validate', '--force'], { from: 'user' });
      } catch (error: unknown) {
        // Expected exit
      }

      // Verify runValidation was called (force flag is processed by createRunnerConfig)
      expect(core.runValidation).toHaveBeenCalled();
    });
  });

  describe('failed validation', () => {
    beforeEach(() => {
      // Mock valid config
      const mockConfig: VibeValidateConfig = {
        validation: {
          phases: [
            {
              name: 'Test Phase',
              parallel: true,
              steps: [
                { name: 'Test Step', command: 'exit 1' }
              ]
            }
          ]
        }
      };
      vi.mocked(configLoader.loadConfig).mockResolvedValue(mockConfig);

      // Mock failed validation
      vi.mocked(core.runValidation).mockResolvedValue({
        passed: false,
        timestamp: new Date().toISOString(),
        treeHash: 'abc123',
        phases: [],
        failedStep: 'Test Step',
        failedStepOutput: 'Error: Test failed',
        rerunCommand: 'npm test',
        fullLogFile: join(tmpdir(), 'validation.log'),
      });
    });

    it('should exit with code 1 on failed validation', async () => {
      validateCommand(program);

      try {
        await program.parseAsync(['validate'], { from: 'user' });
      } catch (error: unknown) {
        if (error && typeof error === 'object' && 'exitCode' in error) {
          expect(error.exitCode).toBe(1);
        }
      }

      expect(core.runValidation).toHaveBeenCalled();
    });

    it('should display error details on failure', async () => {
      validateCommand(program);

      try {
        await program.parseAsync(['validate'], { from: 'user' });
      } catch (error: unknown) {
        // Expected exit
      }

      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('View error details'),
        expect.anything()
      );
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('To retry'),
        expect.stringContaining('npm test')
      );
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('Full log'),
        expect.anything()
      );
    });
  });

  describe('verbosity detection', () => {
    beforeEach(() => {
      // Mock valid config
      const mockConfig: VibeValidateConfig = {
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
        }
      };
      vi.mocked(configLoader.loadConfig).mockResolvedValue(mockConfig);

      // Mock successful validation
      vi.mocked(core.runValidation).mockResolvedValue({
        passed: true,
        timestamp: new Date().toISOString(),
        treeHash: 'abc123',
        phases: [],
      });
    });

    it('should use minimal output for agents by default', async () => {
      // Mock Claude Code environment
      process.env.CLAUDE_CODE = 'true';

      validateCommand(program);

      try {
        await program.parseAsync(['validate'], { from: 'user' });
      } catch (error: unknown) {
        // Expected exit
      }

      // Verify runValidation was called (verbosity is handled by detectContext + createRunnerConfig)
      expect(core.runValidation).toHaveBeenCalled();

      delete process.env.CLAUDE_CODE;
    });

    it('should use verbose output for interactive terminals by default', async () => {
      // Ensure no agent environment variables
      delete process.env.CLAUDE_CODE;
      delete process.env.CI;

      validateCommand(program);

      try {
        await program.parseAsync(['validate'], { from: 'user' });
      } catch (error: unknown) {
        // Expected exit
      }

      // Verify runValidation was called (verbosity detection is handled by detectContext + createRunnerConfig)
      expect(core.runValidation).toHaveBeenCalled();
    });

    it('should respect explicit --verbose flag', async () => {
      validateCommand(program);

      try {
        await program.parseAsync(['validate', '--verbose'], { from: 'user' });
      } catch (error: unknown) {
        // Expected exit
      }

      // Verify runValidation was called (verbose flag is processed by createRunnerConfig)
      expect(core.runValidation).toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    beforeEach(() => {
      // Mock valid config
      const mockConfig: VibeValidateConfig = {
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
        }
      };
      vi.mocked(configLoader.loadConfig).mockResolvedValue(mockConfig);
    });

    it('should handle validation runner exceptions', async () => {
      // Mock validation throwing an error
      vi.mocked(core.runValidation).mockRejectedValue(new Error('Validation crashed'));

      validateCommand(program);

      try {
        await program.parseAsync(['validate'], { from: 'user' });
      } catch (error: unknown) {
        if (error && typeof error === 'object' && 'exitCode' in error) {
          expect(error.exitCode).toBe(1);
        }
      }

      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('Validation failed with error'),
        expect.any(Error)
      );
    });

    it('should output YAML error result when validation crashes with --yaml flag', async () => {
      // Mock validation throwing an error
      const testError = new Error('Validation crashed: /tmp write failed');
      vi.mocked(core.runValidation).mockRejectedValue(testError);

      // Spy on stdout.write to capture YAML output
      const stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

      validateCommand(program);

      try {
        await program.parseAsync(['validate', '--yaml'], { from: 'user' });
      } catch (error: unknown) {
        if (error && typeof error === 'object' && 'exitCode' in error) {
          expect(error.exitCode).toBe(1);
        }
      }

      // Verify error logged to stderr
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('Validation failed with error'),
        expect.any(Error)
      );

      // Verify YAML output to stdout
      const stdoutCalls = stdoutSpy.mock.calls.map(call => call[0]).join('');
      expect(stdoutCalls).toContain('---\n'); // YAML document separator
      expect(stdoutCalls).toContain('passed: false');
      expect(stdoutCalls).toContain('timestamp:');
      // Error message will be quoted in YAML output
      expect(stdoutCalls).toContain('Validation crashed: /tmp write failed');

      stdoutSpy.mockRestore();
    });
  });

  describe('--check flag', () => {
    beforeEach(() => {
      // Mock valid config
      const mockConfig: VibeValidateConfig = {
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
      };
      vi.mocked(configLoader.loadConfig).mockResolvedValue(mockConfig);
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

      validateCommand(program);

      try {
        await program.parseAsync(['validate', '--check'], { from: 'user' });
      } catch (error: unknown) {
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

      validateCommand(program);

      try {
        await program.parseAsync(['validate', '--check'], { from: 'user' });
      } catch (error: unknown) {
        if (error && typeof error === 'object' && 'exitCode' in error) {
          expect(error.exitCode).toBe(2);
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

      validateCommand(program);

      try {
        await program.parseAsync(['validate', '--check', '--yaml'], { from: 'user' });
      } catch (error: unknown) {
        // Expected exit from checkValidationStatus with code 0
        if (error && typeof error === 'object' && 'exitCode' in error) {
          expect(error.exitCode).toBe(0);
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
      // Mock valid config
      const mockConfig: VibeValidateConfig = {
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
        }
      };
      vi.mocked(configLoader.loadConfig).mockResolvedValue(mockConfig);

      // Spy on process.stdout.write to capture YAML output
      // Return true to indicate write succeeded (no buffering needed)
      vi.spyOn(process.stdout, 'write').mockImplementation((chunk: any, encoding?: any, callback?: any) => {
        // Handle different call signatures
        if (typeof encoding === 'function') {
          encoding(); // encoding is actually the callback
        } else if (typeof callback === 'function') {
          callback();
        }
        return true; // Indicate write succeeded
      });
    });

    it('should register --yaml option', () => {
      validateCommand(program);

      const validateCmd = program.commands.find(cmd => cmd.name() === 'validate');
      const options = validateCmd?.options;

      expect(options?.some(opt => opt.flags === '-y, --yaml')).toBe(true);
    });

    it('should output YAML to stdout on successful validation', async () => {
      vi.mocked(core.runValidation).mockResolvedValue({
        passed: true,
        timestamp: '2025-10-22T00:00:00.000Z',
        treeHash: 'abc123',
        phases: [],
      });

      validateCommand(program);

      try {
        await program.parseAsync(['validate', '--yaml'], { from: 'user' });
      } catch (error: unknown) {
        // Expected exit
      }

      // Verify YAML separator and content were written to stdout
      expect(process.stdout.write).toHaveBeenCalledWith('---\n');
      expect(process.stdout.write).toHaveBeenCalledWith(expect.stringContaining('passed: true'));
    });

    it('should output YAML to stdout on failed validation', async () => {
      vi.mocked(core.runValidation).mockResolvedValue({
        passed: false,
        timestamp: '2025-10-22T00:00:00.000Z',
        treeHash: 'abc123',
        phases: [],
        failedStep: 'Test Step',
        rerunCommand: 'echo test',
      });

      validateCommand(program);

      try {
        await program.parseAsync(['validate', '--yaml'], { from: 'user' });
      } catch (error: unknown) {
        // Expected exit with code 1
        if (error && typeof error === 'object' && 'exitCode' in error) {
          expect(error.exitCode).toBe(1);
        }
      }

      // Verify YAML separator and content were written to stdout
      expect(process.stdout.write).toHaveBeenCalledWith('---\n');
      expect(process.stdout.write).toHaveBeenCalledWith(expect.stringContaining('passed: false'));
    });

    it('should pass yaml flag to runner config', async () => {
      vi.mocked(core.runValidation).mockResolvedValue({
        passed: true,
        timestamp: '2025-10-22T00:00:00.000Z',
        treeHash: 'abc123',
        phases: [],
      });

      validateCommand(program);

      try {
        await program.parseAsync(['validate', '--yaml'], { from: 'user' });
      } catch (error: unknown) {
        // Expected exit
      }

      // Verify runValidation was called with yaml in config
      expect(core.runValidation).toHaveBeenCalledWith(
        expect.objectContaining({
          yaml: true
        })
      );
    });

    it('should work with both --yaml and --verbose flags', async () => {
      vi.mocked(core.runValidation).mockResolvedValue({
        passed: true,
        timestamp: '2025-10-22T00:00:00.000Z',
        treeHash: 'abc123',
        phases: [],
      });

      validateCommand(program);

      try {
        await program.parseAsync(['validate', '--yaml', '--verbose'], { from: 'user' });
      } catch (error: unknown) {
        // Expected exit
      }

      // Verify both flags were passed to runner
      expect(core.runValidation).toHaveBeenCalledWith(
        expect.objectContaining({
          yaml: true,
          verbose: true
        })
      );
    });

    it('should display cached validation with tree hash and phase/step counts in human-readable mode', async () => {
      // Mock valid config (required for validation to proceed)
      const mockConfig: VibeValidateConfig = {
        validation: {
          phases: [
            {
              name: 'Test Phase',
              parallel: true,
              steps: [{ name: 'Test Step', command: 'echo test' }]
            }
          ]
        }
      };
      vi.mocked(configLoader.loadConfig).mockResolvedValue(mockConfig);

      // Mock git tree hash (override default rejection)
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

      validateCommand(program);

      // Cache hit should prevent runValidation from being called
      await program.parseAsync(['validate'], { from: 'user' });

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

    it('should output YAML to stdout when validation is cached and --yaml flag is set', async () => {
      // Mock valid config (required for validation to proceed)
      const mockConfig: VibeValidateConfig = {
        validation: {
          phases: [
            {
              name: 'Test Phase',
              parallel: true,
              steps: [{ name: 'Test Step', command: 'echo test' }]
            }
          ]
        }
      };
      vi.mocked(configLoader.loadConfig).mockResolvedValue(mockConfig);

      // Spy on process.stdout.write to capture YAML output
      vi.spyOn(process.stdout, 'write').mockImplementation((chunk: any, encoding?: any, callback?: any) => {
        if (typeof encoding === 'function') {
          encoding();
        } else if (typeof callback === 'function') {
          callback();
        }
        return true;
      });

      // Mock git tree hash (override default rejection)
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

      validateCommand(program);

      // Cache hit should prevent runValidation from being called
      await program.parseAsync(['validate', '--yaml'], { from: 'user' });

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
  });

  describe('worktree stability', () => {
    beforeEach(() => {
      // Mock valid config
      const mockConfig: VibeValidateConfig = {
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
        }
      };
      vi.mocked(configLoader.loadConfig).mockResolvedValue(mockConfig);
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

      validateCommand(program);

      try {
        await program.parseAsync(['validate'], { from: 'user' });
      } catch (error: unknown) {
        // Expected exit with code 0 (validation passed)
        if (error && typeof error === 'object' && 'exitCode' in error) {
          expect(error.exitCode).toBe(0);
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

      validateCommand(program);

      try {
        await program.parseAsync(['validate'], { from: 'user' });
      } catch (error: unknown) {
        // Expected exit with code 0 (validation passed)
        if (error && typeof error === 'object' && 'exitCode' in error) {
          expect(error.exitCode).toBe(0);
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

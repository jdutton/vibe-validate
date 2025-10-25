import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Command } from 'commander';
import { preCommitCommand } from '../../src/commands/pre-commit.js';
import * as core from '@vibe-validate/core';
import * as git from '@vibe-validate/git';
import * as history from '@vibe-validate/history';
import * as configLoader from '../../src/utils/config-loader.js';
import type { VibeValidateConfig } from '@vibe-validate/config';

// Mock the core validation module
vi.mock('@vibe-validate/core', async () => {
  const actual = await vi.importActual<typeof core>('@vibe-validate/core');
  return {
    ...actual,
    runValidation: vi.fn(),
  };
});

// Mock the git module
vi.mock('@vibe-validate/git', async () => {
  const actual = await vi.importActual<typeof git>('@vibe-validate/git');
  return {
    ...actual,
    checkBranchSync: vi.fn(),
    getGitTreeHash: vi.fn(),
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
  let program: Command;

  beforeEach(() => {
    // Clear all mock calls from previous tests (prevents test pollution across test files)
    vi.clearAllMocks();

    // Create temp directory for test files
    testDir = join(tmpdir(), `vibe-validate-pre-commit-test-${Date.now()}`);
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

    // Reset mocks
    vi.mocked(core.runValidation).mockReset();
    vi.mocked(git.checkBranchSync).mockReset();
    vi.mocked(configLoader.loadConfig).mockReset();
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

  describe('branch sync check with custom git config', () => {
    it('should respect config.git.mainBranch when checking sync', async () => {
      const mockConfig: VibeValidateConfig = {
        version: '1.0',
        validation: {
          phases: [],
        },
        git: {
          mainBranch: 'develop', // Custom main branch
          remoteOrigin: 'upstream', // Custom remote
          autoSync: false,
          warnIfBehind: true,
        },
      };

      vi.mocked(configLoader.loadConfig).mockResolvedValue(mockConfig);
      vi.mocked(git.checkBranchSync).mockResolvedValue({
        isUpToDate: true,
        behindBy: 0,
        currentBranch: 'feature/test',
        hasRemote: true,
      });
      vi.mocked(core.runValidation).mockResolvedValue({
        passed: true,
        phasesRun: 0,
        stepsRun: 0,
        duration: 100,
      });

      preCommitCommand(program);

      try {
        await program.parseAsync(['pre-commit'], { from: 'user' });
      } catch (error: unknown) {
        // Commander throws on exitOverride, expected
        if (error && typeof error === 'object' && 'exitCode' in error) {
          expect(error.exitCode).toBe(0); // Should succeed
        }
      }

      // Should call checkBranchSync with upstream/develop instead of origin/main
      expect(git.checkBranchSync).toHaveBeenCalledWith({
        remoteBranch: 'upstream/develop',
      });
    });

    it('should default to origin/main when git config is not provided', async () => {
      const mockConfig: VibeValidateConfig = {
        version: '1.0',
        validation: {
          phases: [],
        },
        // No git config provided
      };

      vi.mocked(configLoader.loadConfig).mockResolvedValue(mockConfig);
      vi.mocked(git.checkBranchSync).mockResolvedValue({
        isUpToDate: true,
        behindBy: 0,
        currentBranch: 'feature/test',
        hasRemote: true,
      });
      vi.mocked(core.runValidation).mockResolvedValue({
        passed: true,
        phasesRun: 0,
        stepsRun: 0,
        duration: 100,
      });

      preCommitCommand(program);

      try {
        await program.parseAsync(['pre-commit'], { from: 'user' });
      } catch (error: unknown) {
        // Commander throws on exitOverride, expected
        if (error && typeof error === 'object' && 'exitCode' in error) {
          expect(error.exitCode).toBe(0); // Should succeed
        }
      }

      // Should default to origin/main
      expect(git.checkBranchSync).toHaveBeenCalledWith({
        remoteBranch: 'origin/main',
      });
    });

    it('should respect mainBranch but use default origin when remoteOrigin not provided', async () => {
      const mockConfig: VibeValidateConfig = {
        version: '1.0',
        validation: {
          phases: [],
        },
        git: {
          mainBranch: 'master', // Custom main branch
          // No remoteOrigin provided
          autoSync: false,
          warnIfBehind: true,
        },
      };

      vi.mocked(configLoader.loadConfig).mockResolvedValue(mockConfig);
      vi.mocked(git.checkBranchSync).mockResolvedValue({
        isUpToDate: true,
        behindBy: 0,
        currentBranch: 'feature/test',
        hasRemote: true,
      });
      vi.mocked(core.runValidation).mockResolvedValue({
        passed: true,
        phasesRun: 0,
        stepsRun: 0,
        duration: 100,
      });

      preCommitCommand(program);

      try {
        await program.parseAsync(['pre-commit'], { from: 'user' });
      } catch (error: unknown) {
        // Commander throws on exitOverride, expected
        if (error && typeof error === 'object' && 'exitCode' in error) {
          expect(error.exitCode).toBe(0); // Should succeed
        }
      }

      // Should use origin/master (custom branch with default origin)
      expect(git.checkBranchSync).toHaveBeenCalledWith({
        remoteBranch: 'origin/master',
      });
    });
  });

  describe('secret scanning integration', () => {
    it('should run secret scanning before validation when enabled', async () => {
      const mockConfig: VibeValidateConfig = {
        version: '1.0',
        validation: {
          phases: [],
        },
        hooks: {
          preCommit: {
            enabled: true,
            secretScanning: {
              enabled: true,
              scanCommand: 'echo "No secrets found"', // Mock command that exits 0
            },
          },
        },
      };

      vi.mocked(configLoader.loadConfig).mockResolvedValue(mockConfig);
      vi.mocked(git.checkBranchSync).mockResolvedValue({
        isUpToDate: true,
        behindBy: 0,
        currentBranch: 'feature/test',
        hasRemote: true,
      });
      vi.mocked(core.runValidation).mockResolvedValue({
        passed: true,
        phasesRun: 0,
        stepsRun: 0,
        duration: 100,
      });

      preCommitCommand(program);

      try {
        await program.parseAsync(['pre-commit'], { from: 'user' });
      } catch (error: unknown) {
        if (error && typeof error === 'object' && 'exitCode' in error) {
          expect(error.exitCode).toBe(0); // Should succeed
        }
      }

      // Validation should still run after successful secret scan
      expect(core.runValidation).toHaveBeenCalled();
    });

    it('should block commit when secret scanning finds secrets', async () => {
      const mockConfig: VibeValidateConfig = {
        version: '1.0',
        validation: {
          phases: [],
        },
        hooks: {
          preCommit: {
            enabled: true,
            secretScanning: {
              enabled: true,
              scanCommand: 'exit 1', // Mock command that exits 1 (secrets found)
            },
          },
        },
      };

      vi.mocked(configLoader.loadConfig).mockResolvedValue(mockConfig);
      vi.mocked(git.checkBranchSync).mockResolvedValue({
        isUpToDate: true,
        behindBy: 0,
        currentBranch: 'feature/test',
        hasRemote: true,
      });

      preCommitCommand(program);

      try {
        await program.parseAsync(['pre-commit'], { from: 'user' });
        throw new Error('Should have exited with error');
      } catch (error: unknown) {
        if (error && typeof error === 'object' && 'exitCode' in error) {
          expect(error.exitCode).toBe(1); // Should fail
        }
      }

      // Validation should NOT run when secret scanning fails
      expect(core.runValidation).not.toHaveBeenCalled();
    });

    it('should skip secret scanning when disabled', async () => {
      const mockConfig: VibeValidateConfig = {
        version: '1.0',
        validation: {
          phases: [],
        },
        hooks: {
          preCommit: {
            enabled: true,
            secretScanning: {
              enabled: false,
              scanCommand: 'exit 1', // Would fail if run
            },
          },
        },
      };

      vi.mocked(configLoader.loadConfig).mockResolvedValue(mockConfig);
      vi.mocked(git.checkBranchSync).mockResolvedValue({
        isUpToDate: true,
        behindBy: 0,
        currentBranch: 'feature/test',
        hasRemote: true,
      });
      vi.mocked(core.runValidation).mockResolvedValue({
        passed: true,
        phasesRun: 0,
        stepsRun: 0,
        duration: 100,
      });

      preCommitCommand(program);

      try {
        await program.parseAsync(['pre-commit'], { from: 'user' });
      } catch (error: unknown) {
        if (error && typeof error === 'object' && 'exitCode' in error) {
          expect(error.exitCode).toBe(0); // Should succeed
        }
      }

      // Validation should run since scanning was skipped
      expect(core.runValidation).toHaveBeenCalled();
    });

    it('should skip secret scanning when secretScanning config not provided', async () => {
      const mockConfig: VibeValidateConfig = {
        version: '1.0',
        validation: {
          phases: [],
        },
        hooks: {
          preCommit: {
            enabled: true,
            // No secretScanning config
          },
        },
      };

      vi.mocked(configLoader.loadConfig).mockResolvedValue(mockConfig);
      vi.mocked(git.checkBranchSync).mockResolvedValue({
        isUpToDate: true,
        behindBy: 0,
        currentBranch: 'feature/test',
        hasRemote: true,
      });
      vi.mocked(core.runValidation).mockResolvedValue({
        passed: true,
        phasesRun: 0,
        stepsRun: 0,
        duration: 100,
      });

      preCommitCommand(program);

      try {
        await program.parseAsync(['pre-commit'], { from: 'user' });
      } catch (error: unknown) {
        if (error && typeof error === 'object' && 'exitCode' in error) {
          expect(error.exitCode).toBe(0); // Should succeed
        }
      }

      // Validation should run since no scanning configured
      expect(core.runValidation).toHaveBeenCalled();
    });

    it('should handle missing scan tool gracefully', async () => {
      const mockConfig: VibeValidateConfig = {
        version: '1.0',
        validation: {
          phases: [],
        },
        hooks: {
          preCommit: {
            enabled: true,
            secretScanning: {
              enabled: true,
              scanCommand: 'nonexistent-tool --scan', // Command that doesn't exist
            },
          },
        },
      };

      vi.mocked(configLoader.loadConfig).mockResolvedValue(mockConfig);
      vi.mocked(git.checkBranchSync).mockResolvedValue({
        isUpToDate: true,
        behindBy: 0,
        currentBranch: 'feature/test',
        hasRemote: true,
      });

      preCommitCommand(program);

      try {
        await program.parseAsync(['pre-commit'], { from: 'user' });
        throw new Error('Should have exited with error');
      } catch (error: unknown) {
        if (error && typeof error === 'object' && 'exitCode' in error) {
          expect(error.exitCode).toBe(1); // Should fail
        }
      }

      // Should show error about missing tool
      expect(console.error).toHaveBeenCalled();
      // Validation should NOT run when tool is missing
      expect(core.runValidation).not.toHaveBeenCalled();
    });

    it('should allow custom scan commands (detect-secrets)', async () => {
      const mockConfig: VibeValidateConfig = {
        version: '1.0',
        validation: {
          phases: [],
        },
        hooks: {
          preCommit: {
            enabled: true,
            secretScanning: {
              enabled: true,
              scanCommand: 'echo "detect-secrets scan complete"',
            },
          },
        },
      };

      vi.mocked(configLoader.loadConfig).mockResolvedValue(mockConfig);
      vi.mocked(git.checkBranchSync).mockResolvedValue({
        isUpToDate: true,
        behindBy: 0,
        currentBranch: 'feature/test',
        hasRemote: true,
      });
      vi.mocked(core.runValidation).mockResolvedValue({
        passed: true,
        phasesRun: 0,
        stepsRun: 0,
        duration: 100,
      });

      preCommitCommand(program);

      try {
        await program.parseAsync(['pre-commit'], { from: 'user' });
      } catch (error: unknown) {
        if (error && typeof error === 'object' && 'exitCode' in error) {
          expect(error.exitCode).toBe(0); // Should succeed
        }
      }

      // Validation should run after successful scan
      expect(core.runValidation).toHaveBeenCalled();
    });

    it('should provide helpful error message when secrets detected', async () => {
      const mockConfig: VibeValidateConfig = {
        version: '1.0',
        validation: {
          phases: [],
        },
        hooks: {
          preCommit: {
            enabled: true,
            secretScanning: {
              enabled: true,
              scanCommand: 'echo "Found: AWS_SECRET_KEY=abc123" && exit 1',
            },
          },
        },
      };

      vi.mocked(configLoader.loadConfig).mockResolvedValue(mockConfig);
      vi.mocked(git.checkBranchSync).mockResolvedValue({
        isUpToDate: true,
        behindBy: 0,
        currentBranch: 'feature/test',
        hasRemote: true,
      });

      preCommitCommand(program);

      try {
        await program.parseAsync(['pre-commit'], { from: 'user' });
        throw new Error('Should have exited with error');
      } catch (error: unknown) {
        if (error && typeof error === 'object' && 'exitCode' in error) {
          expect(error.exitCode).toBe(1);
        }
      }

      // Should show error message about secrets
      expect(console.error).toHaveBeenCalled();
      const errorCalls = vi.mocked(console.error).mock.calls;
      const errorOutput = errorCalls.map(call => call.join(' ')).join('\n');
      expect(errorOutput).toContain('secret');
    });
  });

  describe('validation caching integration', () => {
    it('should use shared workflow which provides caching', async () => {
      const mockConfig: VibeValidateConfig = {
        version: '1.0',
        validation: {
          phases: [
            {
              name: 'Test',
              steps: [{ name: 'Test Step', command: 'echo test' }]
            }
          ]
        }
      };

      vi.mocked(configLoader.loadConfig).mockResolvedValue(mockConfig);
      vi.mocked(git.checkBranchSync).mockResolvedValue({
        isUpToDate: true,
        hasRemote: true,
        behindBy: 0,
        aheadBy: 0,
      });

      // Mock cache HIT scenario
      vi.mocked(git.getGitTreeHash).mockResolvedValue('abc123def456');

      const mockHistoryNote = {
        treeHash: 'abc123def456',
        runs: [
          {
            timestamp: '2025-10-23T20:00:00Z',
            duration: 30000,
            passed: true,
            branch: 'feature/test',
            headCommit: 'abc123',
            uncommittedChanges: false,
            result: {
              passed: true,
              timestamp: '2025-10-23T20:00:00Z',
              treeHash: 'abc123def456',
              duration: 30000,
              phases: [
                {
                  name: 'Test',
                  passed: true,
                  steps: [{ name: 'Test Step', passed: true, duration: 1000 }]
                }
              ],
            },
          },
        ],
      };
      vi.mocked(history.readHistoryNote).mockResolvedValue(mockHistoryNote);

      preCommitCommand(program);

      try {
        await program.parseAsync(['pre-commit'], { from: 'user' });
      } catch (error: unknown) {
        // Expected exit
      }

      // CRITICAL: Verify runValidation was NOT called (cache hit)
      expect(core.runValidation).not.toHaveBeenCalled();

      // Verify cache hit message was displayed
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Validation already passed for current working tree')
      );
    });

    it('should run validation when cache misses', async () => {
      const mockConfig: VibeValidateConfig = {
        version: '1.0',
        validation: {
          phases: [
            {
              name: 'Test',
              steps: [{ name: 'Test Step', command: 'echo test' }]
            }
          ]
        }
      };

      vi.mocked(configLoader.loadConfig).mockResolvedValue(mockConfig);
      vi.mocked(git.checkBranchSync).mockResolvedValue({
        isUpToDate: true,
        hasRemote: true,
        behindBy: 0,
        aheadBy: 0,
      });

      // Mock cache MISS scenario
      vi.mocked(git.getGitTreeHash).mockResolvedValue('abc123def456');
      vi.mocked(history.readHistoryNote).mockResolvedValue(null); // No cache

      // Mock successful validation
      vi.mocked(core.runValidation).mockResolvedValue({
        passed: true,
        phasesRun: 0,
        stepsRun: 0,
        duration: 100,
      });

      vi.mocked(history.checkWorktreeStability).mockResolvedValue({
        stable: true,
        treeHashBefore: 'abc123def456',
        treeHashAfter: 'abc123def456',
      });

      vi.mocked(history.recordValidationHistory).mockResolvedValue({
        recorded: true,
      });

      preCommitCommand(program);

      try {
        await program.parseAsync(['pre-commit'], { from: 'user' });
      } catch (error: unknown) {
        // Expected exit
      }

      // Verify runValidation WAS called on cache miss
      expect(core.runValidation).toHaveBeenCalledOnce();
    });
  });
});

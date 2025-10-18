import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Command } from 'commander';
import { preCommitCommand } from '../../src/commands/pre-commit.js';
import * as core from '@vibe-validate/core';
import * as git from '@vibe-validate/git';
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
});

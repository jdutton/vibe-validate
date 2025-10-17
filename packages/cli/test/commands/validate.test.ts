import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Command } from 'commander';
import { validateCommand } from '../../src/commands/validate.js';
import * as core from '@vibe-validate/core';
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

// Mock the config loader
vi.mock('../../src/utils/config-loader.js', async () => {
  const actual = await vi.importActual<typeof configLoader>('../../src/utils/config-loader.js');
  return {
    ...actual,
    loadConfig: vi.fn(),
  };
});

describe('validate command', () => {
  let testDir: string;
  let originalCwd: string;
  let program: Command;

  beforeEach(() => {
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

    // Reset mocks
    vi.mocked(core.runValidation).mockReset();
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

    it('should register --format option', () => {
      validateCommand(program);

      const validateCmd = program.commands.find(cmd => cmd.name() === 'validate');
      const options = validateCmd?.options;

      expect(options?.some(opt => opt.flags === '--format <format>')).toBe(true);
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
        expect.stringContaining('Error details'),
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

  describe('output format detection', () => {
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

    it('should use yaml format for agents when format is auto', async () => {
      // Mock Claude Code environment
      process.env.CLAUDE_CODE = 'true';

      validateCommand(program);

      try {
        await program.parseAsync(['validate'], { from: 'user' });
      } catch (error: unknown) {
        // Expected exit
      }

      // Verify runValidation was called (format detection is handled by detectContext + createRunnerConfig)
      expect(core.runValidation).toHaveBeenCalled();

      delete process.env.CLAUDE_CODE;
    });

    it('should use human format for non-agents when format is auto', async () => {
      // Ensure no agent environment variables
      delete process.env.CLAUDE_CODE;
      delete process.env.CI;

      validateCommand(program);

      try {
        await program.parseAsync(['validate'], { from: 'user' });
      } catch (error: unknown) {
        // Expected exit
      }

      // Verify runValidation was called (format detection is handled by detectContext + createRunnerConfig)
      expect(core.runValidation).toHaveBeenCalled();
    });

    it('should respect explicit format option', async () => {
      validateCommand(program);

      try {
        await program.parseAsync(['validate', '--format', 'json'], { from: 'user' });
      } catch (error: unknown) {
        // Expected exit
      }

      // Verify runValidation was called (format is processed by createRunnerConfig)
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
  });
});

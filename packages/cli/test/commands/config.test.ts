import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Command } from 'commander';
import { configCommand } from '../../src/commands/config.js';
import * as configLoader from '../../src/utils/config-loader.js';
import type { VibeValidateConfig } from '@vibe-validate/config';

// Mock the config loader
vi.mock('../../src/utils/config-loader.js', async () => {
  const actual = await vi.importActual<typeof configLoader>('../../src/utils/config-loader.js');
  return {
    ...actual,
    loadConfig: vi.fn(),
    loadConfigWithErrors: vi.fn(),
    findConfigPath: vi.fn(),
  };
});

describe('config command', () => {
  let testDir: string;
  let originalCwd: string;
  let program: Command;

  beforeEach(() => {
    // Create temp directory for test files
    testDir = join(tmpdir(), `vibe-validate-config-test-${Date.now()}`);
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
    vi.mocked(configLoader.loadConfig).mockReset();
    vi.mocked(configLoader.loadConfigWithErrors).mockReset();
    vi.mocked(configLoader.findConfigPath).mockReset();
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
    it('should register config command with correct name', () => {
      configCommand(program);

      const commands = program.commands;
      const configCmd = commands.find(cmd => cmd.name() === 'config');

      expect(configCmd).toBeDefined();
      expect(configCmd?.description()).toBe('Show or validate vibe-validate configuration');
    });

    it('should register --validate option', () => {
      configCommand(program);

      const configCmd = program.commands.find(cmd => cmd.name() === 'config');
      const options = configCmd?.options;

      expect(options?.some(opt => opt.flags === '--validate')).toBe(true);
    });

    it('should register --verbose option', () => {
      configCommand(program);

      const configCmd = program.commands.find(cmd => cmd.name() === 'config');
      const options = configCmd?.options;

      expect(options?.some(opt => opt.flags === '-v, --verbose')).toBe(true);
    });
  });

  describe('no config file', () => {
    it('should exit with error when no config found', async () => {
      // Mock findConfigPath to return null (no config found)
      vi.mocked(configLoader.findConfigPath).mockReturnValue(null);

      configCommand(program);

      try {
        await program.parseAsync(['config'], { from: 'user' });
      } catch (error: unknown) {
        if (error && typeof error === 'object' && 'exitCode' in error) {
          expect(error.exitCode).toBe(1);
        }
      }

      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('No configuration file found'));
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('vibe-validate init'));
    });
  });

  describe('valid config file', () => {
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

      vi.mocked(configLoader.findConfigPath).mockReturnValue(join(testDir, 'vibe-validate.config.js'));
      vi.mocked(configLoader.loadConfig).mockResolvedValue(mockConfig);
      vi.mocked(configLoader.loadConfigWithErrors).mockResolvedValue({ config: mockConfig, errors: [] });
    });

    it('should validate config successfully with --validate flag', async () => {
      configCommand(program);

      try {
        await program.parseAsync(['config', '--validate'], { from: 'user' });
      } catch (error: unknown) {
        if (error && typeof error === 'object' && 'exitCode' in error) {
          expect(error.exitCode).toBe(0);
        }
      }

      // With the new error reporting, success message goes to stdout
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Configuration is valid'));
    });
  });

  describe('invalid config file', () => {
    beforeEach(() => {
      // Mock findConfigPath returning a path and loadConfigWithErrors returning errors
      const configPath = join(testDir, 'vibe-validate.config.js');
      vi.mocked(configLoader.findConfigPath).mockReturnValue(configPath);
      vi.mocked(configLoader.loadConfig).mockResolvedValue(null);
      vi.mocked(configLoader.loadConfigWithErrors).mockResolvedValue({
        config: null,
        errors: ['validation.phases: Required'],
        filePath: configPath
      });
    });

    it('should exit with error for invalid config', async () => {
      configCommand(program);

      try {
        await program.parseAsync(['config'], { from: 'user' });
      } catch (error: unknown) {
        if (error && typeof error === 'object' && 'exitCode' in error) {
          expect(error.exitCode).toBe(1);
        }
      }

      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('Configuration is invalid')
      );
    });
  });

  describe('output verbosity', () => {
    beforeEach(() => {
      // Mock valid config with all sections
      const mockConfig: VibeValidateConfig = {
        validation: {
          phases: [
            { name: 'Phase 1', parallel: false, steps: [] }
          ]
        },
        git: {
          mainBranch: 'main',
          autoSync: false
        }
      };

      vi.mocked(configLoader.findConfigPath).mockReturnValue(join(testDir, 'vibe-validate.config.yaml'));
      vi.mocked(configLoader.loadConfig).mockResolvedValue(mockConfig);
      vi.mocked(configLoader.loadConfigWithErrors).mockResolvedValue({ config: mockConfig, errors: [] });
    });

    it('should display config in minimal YAML format by default', async () => {
      configCommand(program);

      try {
        await program.parseAsync(['config'], { from: 'user' });
      } catch (error: unknown) {
        if (error && typeof error === 'object' && 'exitCode' in error) {
          expect(error.exitCode).toBe(0);
        }
      }

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('validation:'));
    });

    it('should display config in verbose format when requested', async () => {
      configCommand(program);

      try {
        await program.parseAsync(['config', '--verbose'], { from: 'user' });
      } catch (error: unknown) {
        if (error && typeof error === 'object' && 'exitCode' in error) {
          expect(error.exitCode).toBe(0);
        }
      }

      // Verbose mode should include both YAML and explanatory text
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('validation:'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Vibe-Validate Configuration'));
    });
  });

  describe('error handling', () => {
    it('should handle config loading errors gracefully', async () => {
      // Mock loadConfig throwing an error
      vi.mocked(configLoader.findConfigPath).mockReturnValue(join(testDir, 'vibe-validate.config.js'));
      vi.mocked(configLoader.loadConfig).mockRejectedValue(new Error('Config parse error'));

      configCommand(program);

      try {
        await program.parseAsync(['config'], { from: 'user' });
      } catch (error: unknown) {
        if (error && typeof error === 'object' && 'exitCode' in error) {
          expect(error.exitCode).toBe(1);
        }
      }

      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to load configuration'),
        expect.anything()
      );
    });
  });
});

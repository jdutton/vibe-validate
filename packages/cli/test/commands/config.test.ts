import { rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import type { VibeValidateConfig } from '@vibe-validate/config';
import { mkdirSyncReal, normalizedTmpdir } from '@vibe-validate/utils';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { configCommand } from '../../src/commands/config.js';
import * as configLoader from '../../src/utils/config-loader.js';
import { setupCommanderTest, type CommanderTestEnv } from '../helpers/commander-test-setup.js';

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

/**
 * Helper functions for config command testing
 */

/**
 * Creates a test configuration object with sensible defaults
 * @param overrides - Optional partial config to override defaults
 * @returns Complete VibeValidateConfig object
 */
function createTestConfig(overrides?: Partial<VibeValidateConfig>): VibeValidateConfig {
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
    ...overrides
  };
}

/**
 * Mocks config loader to return a valid config
 * @param config - Config object to return
 * @param configPath - Path to config file (defaults to testDir/vibe-validate.config.js)
 */
function mockValidConfig(config: VibeValidateConfig, configPath: string): void {
  vi.mocked(configLoader.findConfigPath).mockReturnValue(configPath);
  vi.mocked(configLoader.loadConfig).mockResolvedValue(config);
  vi.mocked(configLoader.loadConfigWithErrors).mockResolvedValue({
    config,
    errors: [],
    filePath: configPath
  });
}

/**
 * Mocks config loader to return no config found
 */
function mockNoConfig(): void {
  vi.mocked(configLoader.findConfigPath).mockReturnValue(null);
}

/**
 * Mocks config loader to return invalid config with errors
 * @param errors - Array of validation error messages
 * @param configPath - Path to config file
 */
function mockInvalidConfig(errors: string[], configPath: string): void {
  vi.mocked(configLoader.findConfigPath).mockReturnValue(configPath);
  vi.mocked(configLoader.loadConfig).mockResolvedValue(null);
  vi.mocked(configLoader.loadConfigWithErrors).mockResolvedValue({
    config: null,
    errors,
    filePath: configPath
  });
}

/**
 * Executes a config command and returns the exit code
 * @param program - Commander program instance
 * @param args - Command arguments
 * @returns Exit code (0 for success, 1+ for error)
 */
async function executeConfigCommand(program: CommanderTestEnv['program'], args: string[]): Promise<number> {
  try {
    await program.parseAsync(args, { from: 'user' });
    return 0;
  } catch (err: unknown) {
    // Commander exitOverride throws CommanderError with exitCode
    if (err && typeof err === 'object' && 'exitCode' in err) {
      return (err as { exitCode: number }).exitCode;
    }
    // process.exit throws Error with message "process.exit(code)"
    if (err instanceof Error && err.message.startsWith('process.exit(')) {
      const match = err.message.match(/process\.exit\((\d+)\)/);
      if (match) {
        return Number.parseInt(match[1], 10);
      }
      // Handle process.exit(undefined), process.exit(null), etc. - default to 0
      return 0;
    }
    // Unexpected error
    return 1;
  }
}

/**
 * Asserts that console.error was called with a message containing the given text
 * @param expectedText - Text that should be in the error message
 */
function expectErrorMessage(expectedText: string): void {
  expect(console.error).toHaveBeenCalledWith(expect.stringContaining(expectedText));
}

/**
 * Asserts that console.log was called with a message containing the given text
 * @param expectedText - Text that should be in the log message
 */
function expectLogMessage(expectedText: string): void {
  expect(console.log).toHaveBeenCalledWith(expect.stringContaining(expectedText));
}

describe('config command', () => {
  let testDir: string;
  let originalCwd: string;
  let env: CommanderTestEnv;

  beforeEach(() => {
    // Create temp directory for test files (Windows-safe: no 8.3 short names)
    const targetDir = join(normalizedTmpdir(), `vibe-validate-config-test-${Date.now()}`);
    testDir = mkdirSyncReal(targetDir, { recursive: true });

    // Save original cwd and change to test directory
    originalCwd = process.cwd();
    process.chdir(testDir);

    // Setup Commander test environment
    env = setupCommanderTest();

    // Reset mocks
    vi.mocked(configLoader.loadConfig).mockReset();
    vi.mocked(configLoader.loadConfigWithErrors).mockReset();
    vi.mocked(configLoader.findConfigPath).mockReset();
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
    it('should register config command with correct name', () => {
      configCommand(env.program);

      const commands = env.program.commands;
      const configCmd = commands.find(cmd => cmd.name() === 'config');

      expect(configCmd).toBeDefined();
      expect(configCmd?.description()).toBe('Show or validate vibe-validate configuration');
    });

    it('should register --validate option', () => {
      configCommand(env.program);

      const configCmd = env.program.commands.find(cmd => cmd.name() === 'config');
      const options = configCmd?.options;

      expect(options?.some(opt => opt.flags === '--validate')).toBe(true);
    });

    it('should register --verbose option', () => {
      configCommand(env.program);

      const configCmd = env.program.commands.find(cmd => cmd.name() === 'config');
      const options = configCmd?.options;

      expect(options?.some(opt => opt.flags === '-v, --verbose')).toBe(true);
    });
  });

  describe('no config file', () => {
    it('should exit with error when no config found', async () => {
      mockNoConfig();
      configCommand(env.program);

      const exitCode = await executeConfigCommand(env.program, ['config']);

      expect(exitCode).toBe(1);
      expectErrorMessage('No configuration file found');
      // Command name could be "vv" or "vibe-validate" depending on execution context
      expect(console.error).toHaveBeenCalledWith(expect.stringMatching(/(vv|vibe-validate) init/));
    });
  });

  describe('valid config file', () => {
    beforeEach(() => {
      const mockConfig = createTestConfig();
      mockValidConfig(mockConfig, join(testDir, 'vibe-validate.config.js'));
    });

    it('should validate config successfully with --validate flag', async () => {
      configCommand(env.program);

      const exitCode = await executeConfigCommand(env.program, ['config', '--validate']);

      expect(exitCode).toBe(0);
      expectLogMessage('Configuration is valid');
    });
  });

  describe('invalid config file', () => {
    beforeEach(() => {
      const configPath = join(testDir, 'vibe-validate.config.js');
      mockInvalidConfig(['validation.phases: Required'], configPath);
    });

    it('should exit with error for invalid config', async () => {
      configCommand(env.program);

      const exitCode = await executeConfigCommand(env.program, ['config']);

      expect(exitCode).toBe(1);
      expectErrorMessage('Configuration is invalid');
    });
  });

  describe('output verbosity', () => {
    beforeEach(() => {
      const mockConfig = createTestConfig({
        git: {
          mainBranch: 'main',
          autoSync: false
        }
      });
      mockValidConfig(mockConfig, join(testDir, 'vibe-validate.config.yaml'));
    });

    it('should display config in minimal YAML format by default', async () => {
      configCommand(env.program);

      const exitCode = await executeConfigCommand(env.program, ['config']);

      expect(exitCode).toBe(0);
      expectLogMessage('validation:');
    });

    it('should display config in verbose format when requested', async () => {
      configCommand(env.program);

      const exitCode = await executeConfigCommand(env.program, ['config', '--verbose']);

      expect(exitCode).toBe(0);
      expectLogMessage('validation:');
      expectLogMessage('Vibe-Validate Configuration');
    });
  });

  describe('error handling', () => {
    it('should handle config loading errors gracefully', async () => {
      vi.mocked(configLoader.findConfigPath).mockReturnValue(join(testDir, 'vibe-validate.config.js'));
      vi.mocked(configLoader.loadConfig).mockRejectedValue(new Error('Config parse error'));

      configCommand(env.program);

      const exitCode = await executeConfigCommand(env.program, ['config']);

      expect(exitCode).toBe(1);
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to load configuration'),
        expect.anything()
      );
    });
  });
});

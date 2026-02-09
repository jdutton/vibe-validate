import { join } from 'node:path';

import type { VibeValidateConfig } from '@vibe-validate/config';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { configCommand } from '../../src/commands/config.js';
import * as configLoader from '../../src/utils/config-loader.js';
import {
  setupCommanderTest,
  setupTempDirTest,
  executeCommandAndGetExitCode,
  hasOption,
  type CommanderTestEnv,
  type TempDirTestEnv,
} from '../helpers/commander-test-setup.js';

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
 * @param configPath - Path to config file (defaults to tempEnv.testDir/vibe-validate.config.js)
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
  let tempEnv: TempDirTestEnv;
  let env: CommanderTestEnv;

  beforeEach(() => {
    // Setup temp directory
    tempEnv = setupTempDirTest('vibe-validate-config-test');

    // Setup Commander test environment
    env = setupCommanderTest();

    // Reset mocks
    vi.mocked(configLoader.loadConfig).mockReset();
    vi.mocked(configLoader.loadConfigWithErrors).mockReset();
    vi.mocked(configLoader.findConfigPath).mockReset();
  });

  afterEach(() => {
    env.cleanup();
    tempEnv.cleanup();
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
      expect(hasOption(env.program, 'config', '--validate')).toBe(true);
    });

    it('should register --verbose option', () => {
      configCommand(env.program);
      expect(hasOption(env.program, 'config', '-v, --verbose')).toBe(true);
    });
  });

  describe('no config file', () => {
    it('should exit with error when no config found', async () => {
      mockNoConfig();
      configCommand(env.program);

      const exitCode = await executeCommandAndGetExitCode(env.program,['config']);

      expect(exitCode).toBe(1);
      expectErrorMessage('No configuration file found');
      // Command name could be "vv" or "vibe-validate" depending on execution context
      expect(console.error).toHaveBeenCalledWith(expect.stringMatching(/(vv|vibe-validate) init/));
    });
  });

  describe('valid config file', () => {
    beforeEach(() => {
      const mockConfig = createTestConfig();
      mockValidConfig(mockConfig, join(tempEnv.testDir, 'vibe-validate.config.js'));
    });

    it('should validate config successfully with --validate flag', async () => {
      configCommand(env.program);

      const exitCode = await executeCommandAndGetExitCode(env.program,['config', '--validate']);

      expect(exitCode).toBe(0);
      expectLogMessage('Configuration is valid');
    });
  });

  describe('invalid config file', () => {
    beforeEach(() => {
      const configPath = join(tempEnv.testDir, 'vibe-validate.config.js');
      mockInvalidConfig(['validation.phases: Required'], configPath);
    });

    it('should exit with error for invalid config', async () => {
      configCommand(env.program);

      const exitCode = await executeCommandAndGetExitCode(env.program,['config']);

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
      mockValidConfig(mockConfig, join(tempEnv.testDir, 'vibe-validate.config.yaml'));
    });

    it('should display config in minimal YAML format by default', async () => {
      configCommand(env.program);

      const exitCode = await executeCommandAndGetExitCode(env.program,['config']);

      expect(exitCode).toBe(0);
      expectLogMessage('validation:');
    });

    it('should display config in verbose format when requested', async () => {
      configCommand(env.program);

      const exitCode = await executeCommandAndGetExitCode(env.program,['config', '--verbose']);

      expect(exitCode).toBe(0);
      expectLogMessage('validation:');
      expectLogMessage('Vibe-Validate Configuration');
    });
  });

  describe('error handling', () => {
    it('should handle config loading errors gracefully', async () => {
      vi.mocked(configLoader.findConfigPath).mockReturnValue(join(tempEnv.testDir, 'vibe-validate.config.js'));
      vi.mocked(configLoader.loadConfig).mockRejectedValue(new Error('Config parse error'));

      configCommand(env.program);

      const exitCode = await executeCommandAndGetExitCode(env.program,['config']);

      expect(exitCode).toBe(1);
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to load configuration'),
        expect.anything()
      );
    });
  });
});

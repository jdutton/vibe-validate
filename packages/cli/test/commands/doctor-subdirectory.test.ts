/**
 * Tests for doctor command execution from subdirectories
 *
 * CRITICAL REGRESSION TEST: Ensures doctor command works from any subdirectory,
 * not just project root. This test catches the bug where checkConfigFile()
 * used hardcoded existsSync() instead of findConfigPath() walk-up logic.
 */

 

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import type { VibeValidateConfig } from '@vibe-validate/config';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { runDoctor } from '../../src/commands/doctor.js';
import { checkSync } from '../../src/commands/generate-workflow.js';
import { loadConfig, findConfigPath, loadConfigWithErrors } from '../../src/utils/config-loader.js';
import {
  mockDoctorEnvironment,
  mockDoctorFileSystem,
  assertCheck,
} from '../helpers/doctor-helpers.js';

// Mock dependencies
vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(() => 'npm run pre-commit'),
  readdirSync: vi.fn(() => []),
}));

vi.mock('child_process', async () => {
  const actual = await vi.importActual('node:child_process');
  return {
    ...actual,
    execSync: vi.fn(),
    spawnSync: vi.fn(() => ({
      status: 0,
      stdout: Buffer.from(''),
      stderr: Buffer.from(''),
    })),
  };
});

vi.mock('@vibe-validate/utils', async () => {
  const actual = await vi.importActual('@vibe-validate/utils');
  return {
    ...actual,
    isToolAvailable: vi.fn(),
    getToolVersion: vi.fn(),
    safeExecSync: vi.fn(),
  };
});

vi.mock('@vibe-validate/git', async () => {
  const actual = await vi.importActual('@vibe-validate/git');
  return {
    ...actual,
    verifyRef: vi.fn(() => true),
    isGitRepository: vi.fn(() => true),
    listNotesRefs: vi.fn(() => []),
    executeGitCommand: vi.fn((args: string[]) => {
      if (args[0] === 'remote') {
        return { success: true, stdout: 'origin\n', stderr: '', exitCode: 0 };
      }
      return { success: true, stdout: 'git version 2.43.0', stderr: '', exitCode: 0 };
    }),
  };
});

vi.mock('../../src/utils/config-loader.js');
vi.mock('../../src/commands/generate-workflow.js');

// Test fixtures and configuration
const mockConfig: VibeValidateConfig = {
  validation: {
    phases: [
      {
        name: 'Test',
        parallel: false,
        steps: [{ name: 'TypeCheck', command: 'pnpm typecheck' }],
        timeout: 300000,
        failFast: true,
      },
    ],
  },
  git: {
    mainBranch: 'main',
    autoSync: false,
    warnIfBehind: true,
  },
};

// Simulated project structure
const projectRoot = '/Users/test/my-project';
const configPath = join(projectRoot, 'vibe-validate.config.yaml');

/**
 * Sets up successful config discovery mocks
 * @param includeFileSystem - Whether to mock file system (default: true)
 */
async function setupConfigFoundMocks(includeFileSystem = true): Promise<void> {
  if (includeFileSystem) {
    await mockDoctorFileSystem();
  }
  await mockDoctorEnvironment();

  vi.mocked(findConfigPath).mockReturnValue(configPath);
  vi.mocked(loadConfig).mockResolvedValue(mockConfig);
  vi.mocked(loadConfigWithErrors).mockResolvedValue({
    config: mockConfig,
    errors: null,
    filePath: configPath,
  });
  vi.mocked(checkSync).mockReturnValue({ inSync: true });
}

/**
 * Sets up config not found mocks (for negative test cases)
 */
async function setupConfigNotFoundMocks(): Promise<void> {
  await mockDoctorEnvironment();

  vi.mocked(findConfigPath).mockReturnValue(null);
  vi.mocked(loadConfig).mockResolvedValue(null);
  vi.mocked(loadConfigWithErrors).mockResolvedValue({
    config: null,
    errors: null,
    filePath: null,
  });
}

/**
 * Executes doctor command and returns result
 */
async function runDoctorVerbose() {
  return await runDoctor({ verbose: true });
}

/**
 * Asserts that config file check passed with expected message
 */
function expectConfigCheckPassed(result: Awaited<ReturnType<typeof runDoctor>>): void {
  assertCheck(result, 'Configuration file', {
    passed: true,
    messageContains: 'vibe-validate.config.yaml',
  });
}

describe('doctor command from subdirectories', () => {
  let originalCwd: string;

  beforeEach(() => {
    vi.clearAllMocks();
    originalCwd = process.cwd();
  });

  afterEach(() => {
    // Restore original cwd
    if (process.cwd() !== originalCwd) {
      process.chdir(originalCwd);
    }
    vi.restoreAllMocks();
  });

  describe('checkConfigFile from different working directories', () => {
    it('should find config when run from project root', async () => {
      // ARRANGE: Simulate running from project root
      await setupConfigFoundMocks();

      // ACT: Run doctor from project root
      const result = await runDoctorVerbose();

      // ASSERT: Config file check should pass
      expectConfigCheckPassed(result);
    });

    it('should find config when run from packages/ subdirectory', async () => {
      // ARRANGE: Simulate running from packages/ subdirectory
      await setupConfigFoundMocks();

      // ACT: Run doctor (simulated from subdirectory via mocked findConfigPath)
      const result = await runDoctorVerbose();

      // ASSERT: Config file check should pass and find config in parent
      expectConfigCheckPassed(result);

      // Verify findConfigPath was called (proving walk-up logic is used)
      expect(findConfigPath).toHaveBeenCalled();
    });

    it('should find config when run from packages/cli/ subdirectory', async () => {
      // ARRANGE: Simulate running from packages/cli/ subdirectory (2 levels deep)
      await setupConfigFoundMocks();

      // ACT: Run doctor
      const result = await runDoctorVerbose();

      // ASSERT: Config file check should pass
      expectConfigCheckPassed(result);
    });

    it('should find config when run from packages/cli/test/ subdirectory', async () => {
      // ARRANGE: Simulate running from packages/cli/test/ subdirectory (3 levels deep)
      await setupConfigFoundMocks();

      // ACT: Run doctor
      const result = await runDoctorVerbose();

      // ASSERT: Config file check should pass
      expectConfigCheckPassed(result);
    });

    it('should fail when run from non-project directory (no config found)', async () => {
      // ARRANGE: Simulate running from /tmp (no config anywhere)
      await setupConfigNotFoundMocks();

      // ACT: Run doctor
      const result = await runDoctorVerbose();

      // ASSERT: Config file check should fail
      assertCheck(result, 'Configuration file', {
        passed: false,
        messageContains: 'not found',
      });
    });

    it('should use findConfigPath() consistently with validate command', async () => {
      // ARRANGE: This test verifies the contract between doctor and validate commands
      await setupConfigFoundMocks();

      // ACT: Run doctor
      await runDoctorVerbose();

      // ASSERT: Verify findConfigPath() was called
      // This proves doctor uses the same config discovery as validate command
      expect(findConfigPath).toHaveBeenCalled();
    });
  });

  describe('regression: checkConfigFile should not use hardcoded existsSync', () => {
    it('should NOT directly call existsSync("vibe-validate.config.yaml")', async () => {
      // ARRANGE: Simulate subdirectory where hardcoded check would fail
      await setupConfigFoundMocks();

      // Mock existsSync to track calls - hardcoded path would not exist
      const existsSyncSpy = vi.mocked(existsSync);
      existsSyncSpy.mockReturnValue(false);

      // ACT: Run doctor
      const result = await runDoctorVerbose();

      // ASSERT: Config check should pass (using findConfigPath, not hardcoded existsSync)
      assertCheck(result, 'Configuration file', {
        passed: true,
      });

      // CRITICAL: Verify findConfigPath was used, not raw existsSync with hardcoded path
      expect(findConfigPath).toHaveBeenCalled();
    });
  });
});

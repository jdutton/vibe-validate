import * as git from '@vibe-validate/git';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { syncCheckCommand } from '../../src/commands/sync-check.js';
import * as configLoader from '../../src/utils/config-loader.js';
import { setupCommanderTest, type CommanderTestEnv } from '../helpers/commander-test-setup.js';

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

// Type alias for process.exit mock parameter
type ProcessExitCode = string | number | null | undefined;

/**
 * Helper: Create mock branch sync result with defaults
 */
function createMockResult(overrides: Partial<{
  hasRemote: boolean;
  isUpToDate: boolean;
  currentBranch: string;
  behindBy: number;
}> = {}) {
  return {
    hasRemote: true,
    isUpToDate: true,
    currentBranch: 'main',
    behindBy: 0,
    ...overrides,
  };
}

/**
 * Helper: Create process.exit spy that throws on exit
 */
function createExitSpy() {
  return vi.spyOn(process, 'exit').mockImplementation((code?: ProcessExitCode) => {
    throw new Error(`process.exit(${code})`);
  }) as any;
}

/**
 * Helper: Verify YAML output was written with separator
 */
function expectYamlOutput(contains?: string) {
  const writeCalls = vi.mocked(process.stdout.write).mock.calls;
  const separatorCall = writeCalls.find(call => call[0] === '---\n');
  expect(separatorCall).toBeDefined();

  if (contains) {
    const yamlContent = writeCalls
      .filter(call => typeof call[0] === 'string')
      .map(call => call[0])
      .join('');
    expect(yamlContent).toContain(contains);
  }
}

describe('sync-check command', () => {
  let env: CommanderTestEnv;

  beforeEach(() => {
    env = setupCommanderTest();

    // Reset mocks
    vi.mocked(git.checkBranchSync).mockReset();
    vi.mocked(configLoader.loadConfig).mockReset();

    // Default config mock
    vi.mocked(configLoader.loadConfig).mockResolvedValue({
      git: {
        mainBranch: 'main',
        remoteOrigin: 'origin',
      },
      phases: [],
    });
  });

  afterEach(() => {
    env.cleanup();
  });

  /**
   * Helper: Run sync-check command and optionally verify exit code
   */
  async function runSyncCheck(args: string[] = [], expectedExitCode?: number) {
    const exitSpy = expectedExitCode === undefined ? null : createExitSpy();

    syncCheckCommand(env.program);

    try {
      await env.program.parseAsync(['sync-check', ...args], { from: 'user' });
    } catch (error) { // NOSONAR - Commander.js throws on exitOverride, caught to test exit codes
      // Expected exception from Commander.js exitOverride
      expect(error).toBeDefined();
    }

    if (exitSpy) {
      expect(exitSpy).toHaveBeenCalledWith(expectedExitCode);
      exitSpy.mockRestore();
    }
  }

  /**
   * Helper: Get the sync-check command from program
   */
  function getCommand() {
    syncCheckCommand(env.program);
    const command = env.program.commands.find(cmd => cmd.name() === 'sync-check');
    expect(command).toBeDefined();
    return command!;
  }

  describe('command registration', () => {
    it('should register sync-check command', () => {
      getCommand();
    });

    it('should have correct description', () => {
      const command = getCommand();
      expect(command.description()).toBe('Check if branch is behind remote main branch');
    });

    it('should register --main-branch option', () => {
      const command = getCommand();
      const option = command.options.find(opt => opt.long === '--main-branch');
      expect(option).toBeDefined();
    });

    it('should register --remote-origin option', () => {
      const command = getCommand();
      const option = command.options.find(opt => opt.long === '--remote-origin');
      expect(option).toBeDefined();
    });

    it('should register --yaml option', () => {
      const command = getCommand();
      const option = command.options.find(opt => opt.long === '--yaml');
      expect(option).toBeDefined();
    });
  });

  describe('sync check when up to date', () => {
    it('should exit with code 0 when up to date', async () => {
      vi.mocked(git.checkBranchSync).mockResolvedValue(createMockResult());
      await runSyncCheck([], 0);
    });

    it('should display success message when up to date', async () => {
      vi.mocked(git.checkBranchSync).mockResolvedValue(
        createMockResult({ currentBranch: 'feature/test' })
      );
      await runSyncCheck();
      expect(console.log).toHaveBeenCalled();
    });
  });

  describe('sync check when behind', () => {
    it('should exit with code 1 when behind remote', async () => {
      vi.mocked(git.checkBranchSync).mockResolvedValue(
        createMockResult({ isUpToDate: false, currentBranch: 'feature/test', behindBy: 3 })
      );
      await runSyncCheck([], 1);
    });

    it('should display warning message when behind', async () => {
      vi.mocked(git.checkBranchSync).mockResolvedValue(
        createMockResult({ isUpToDate: false, currentBranch: 'feature/test', behindBy: 5 })
      );
      await runSyncCheck();
      expect(console.log).toHaveBeenCalled();
    });
  });

  describe('sync check with no remote', () => {
    it('should exit with code 0 when no remote', async () => {
      vi.mocked(git.checkBranchSync).mockResolvedValue(
        createMockResult({ hasRemote: false, currentBranch: 'feature/new' })
      );
      await runSyncCheck([], 0);
    });

    it('should display message when no remote', async () => {
      vi.mocked(git.checkBranchSync).mockResolvedValue(
        createMockResult({ hasRemote: false, currentBranch: 'feature/new' })
      );
      await runSyncCheck();
      expect(console.log).toHaveBeenCalled();
    });
  });

  describe('--yaml flag', () => {
    it('should output YAML with --- separator when up to date', async () => {
      vi.mocked(git.checkBranchSync).mockResolvedValue(createMockResult());
      await runSyncCheck(['--yaml']);
      expectYamlOutput('isUpToDate:');
    });

    it('should output YAML with --- separator when behind', async () => {
      vi.mocked(git.checkBranchSync).mockResolvedValue(
        createMockResult({ isUpToDate: false, currentBranch: 'feature/test', behindBy: 3 })
      );
      await runSyncCheck(['--yaml']);
      expectYamlOutput('behindBy:');
    });

    it('should output YAML with --- separator when no remote', async () => {
      vi.mocked(git.checkBranchSync).mockResolvedValue(
        createMockResult({ hasRemote: false, currentBranch: 'feature/new' })
      );
      await runSyncCheck(['--yaml']);
      expectYamlOutput('hasRemote: false');
    });
  });

  describe('option overrides', () => {
    it('should override main branch with --main-branch option', async () => {
      vi.mocked(git.checkBranchSync).mockResolvedValue(
        createMockResult({ currentBranch: 'feature/test' })
      );
      await runSyncCheck(['--main-branch', 'develop']);
      expect(git.checkBranchSync).toHaveBeenCalledWith({
        remoteBranch: 'origin/develop',
      });
    });

    it('should override remote origin with --remote-origin option', async () => {
      vi.mocked(git.checkBranchSync).mockResolvedValue(
        createMockResult({ currentBranch: 'feature/test' })
      );
      await runSyncCheck(['--remote-origin', 'upstream']);
      expect(git.checkBranchSync).toHaveBeenCalledWith({
        remoteBranch: 'upstream/main',
      });
    });

    it('should override both main branch and remote origin', async () => {
      vi.mocked(git.checkBranchSync).mockResolvedValue(
        createMockResult({ currentBranch: 'feature/test' })
      );
      await runSyncCheck(['--main-branch', 'develop', '--remote-origin', 'upstream']);
      expect(git.checkBranchSync).toHaveBeenCalledWith({
        remoteBranch: 'upstream/develop',
      });
    });
  });

  describe('human-readable output', () => {
    it('should display human-friendly output when no --yaml flag', async () => {
      vi.mocked(git.checkBranchSync).mockResolvedValue(createMockResult());
      await runSyncCheck();
      expect(console.log).toHaveBeenCalled();

      // Verify YAML separator was NOT written to stdout
      const writeCalls = vi.mocked(process.stdout.write).mock.calls;
      const separatorCall = writeCalls.find(call => call[0] === '---\n');
      expect(separatorCall).toBeUndefined();
    });

    it('should display current branch in human output', async () => {
      vi.mocked(git.checkBranchSync).mockResolvedValue(
        createMockResult({ currentBranch: 'feature/test' })
      );
      await runSyncCheck();
      expect(console.log).toHaveBeenCalled();
    });

    it('should display behind count in human output', async () => {
      vi.mocked(git.checkBranchSync).mockResolvedValue(
        createMockResult({ isUpToDate: false, currentBranch: 'feature/test', behindBy: 7 })
      );
      await runSyncCheck();
      expect(console.log).toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('should handle sync check errors gracefully', async () => {
      const error = new Error('Git command failed');
      vi.mocked(git.checkBranchSync).mockRejectedValue(error);
      await runSyncCheck([], 2);
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('Sync check failed with error:'),
        error
      );
    });

    it('should handle config loading errors gracefully', async () => {
      const error = new Error('Config not found');
      vi.mocked(configLoader.loadConfig).mockRejectedValue(error);
      await runSyncCheck([], 2);
      expect(console.error).toHaveBeenCalled();
    });
  });
});

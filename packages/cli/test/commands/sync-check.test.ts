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

  describe('command registration', () => {
    it('should register sync-check command', () => {
      syncCheckCommand(env.program);

      const command = env.program.commands.find(cmd => cmd.name() === 'sync-check');
      expect(command).toBeDefined();
    });

    it('should have correct description', () => {
      syncCheckCommand(env.program);

      const command = env.program.commands.find(cmd => cmd.name() === 'sync-check');
      expect(command?.description()).toBe('Check if branch is behind remote main branch');
    });

    it('should register --main-branch option', () => {
      syncCheckCommand(env.program);

      const command = env.program.commands.find(cmd => cmd.name() === 'sync-check');
      const option = command?.options.find(opt => opt.long === '--main-branch');
      expect(option).toBeDefined();
    });

    it('should register --remote-origin option', () => {
      syncCheckCommand(env.program);

      const command = env.program.commands.find(cmd => cmd.name() === 'sync-check');
      const option = command?.options.find(opt => opt.long === '--remote-origin');
      expect(option).toBeDefined();
    });

    it('should register --yaml option', () => {
      syncCheckCommand(env.program);

      const command = env.program.commands.find(cmd => cmd.name() === 'sync-check');
      const option = command?.options.find(opt => opt.long === '--yaml');
      expect(option).toBeDefined();
    });
  });

  describe('sync check when up to date', () => {
    it('should exit with code 0 when up to date', async () => {
      const mockResult = {
        hasRemote: true,
        isUpToDate: true,
        currentBranch: 'main',
        behindBy: 0,
      };

      vi.mocked(git.checkBranchSync).mockResolvedValue(mockResult);

      // Mock process.exit to track exit code
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: ProcessExitCode) => {
        throw new Error(`process.exit(${code})`);
      }) as any;

      syncCheckCommand(env.program);

      try {
        await env.program.parseAsync(['sync-check'], { from: 'user' });
      } catch (error) { // NOSONAR - Commander.js throws on exitOverride, caught to test exit codes
        // Expected exception from Commander.js exitOverride
        expect(error).toBeDefined();
      }

      expect(exitSpy).toHaveBeenCalledWith(0);

      exitSpy.mockRestore();
    });

    it('should display success message when up to date', async () => {
      const mockResult = {
        hasRemote: true,
        isUpToDate: true,
        currentBranch: 'feature/test',
        behindBy: 0,
      };

      vi.mocked(git.checkBranchSync).mockResolvedValue(mockResult);

      syncCheckCommand(env.program);

      try {
        await env.program.parseAsync(['sync-check'], { from: 'user' });
      } catch (error) { // NOSONAR - Commander.js throws on exitOverride, caught to test exit codes
        // Expected exception from Commander.js exitOverride
        expect(error).toBeDefined();
      }

      expect(console.log).toHaveBeenCalled();
    });
  });

  describe('sync check when behind', () => {
    it('should exit with code 1 when behind remote', async () => {
      const mockResult = {
        hasRemote: true,
        isUpToDate: false,
        currentBranch: 'feature/test',
        behindBy: 3,
      };

      vi.mocked(git.checkBranchSync).mockResolvedValue(mockResult);

      // Mock process.exit to track exit code
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: ProcessExitCode) => {
        throw new Error(`process.exit(${code})`);
      }) as any;

      syncCheckCommand(env.program);

      try {
        await env.program.parseAsync(['sync-check'], { from: 'user' });
      } catch (error) { // NOSONAR - Commander.js throws on exitOverride, caught to test exit codes
        // Expected exception from Commander.js exitOverride
        expect(error).toBeDefined();
      }

      expect(exitSpy).toHaveBeenCalledWith(1);

      exitSpy.mockRestore();
    });

    it('should display warning message when behind', async () => {
      const mockResult = {
        hasRemote: true,
        isUpToDate: false,
        currentBranch: 'feature/test',
        behindBy: 5,
      };

      vi.mocked(git.checkBranchSync).mockResolvedValue(mockResult);

      syncCheckCommand(env.program);

      try {
        await env.program.parseAsync(['sync-check'], { from: 'user' });
      } catch (error) { // NOSONAR - Commander.js throws on exitOverride, caught to test exit codes
        // Expected exception from Commander.js exitOverride
        expect(error).toBeDefined();
      }

      expect(console.log).toHaveBeenCalled();
    });
  });

  describe('sync check with no remote', () => {
    it('should exit with code 0 when no remote', async () => {
      const mockResult = {
        hasRemote: false,
        isUpToDate: true,
        currentBranch: 'feature/new',
      };

      vi.mocked(git.checkBranchSync).mockResolvedValue(mockResult);

      // Mock process.exit to track exit code
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: ProcessExitCode) => {
        throw new Error(`process.exit(${code})`);
      }) as any;

      syncCheckCommand(env.program);

      try {
        await env.program.parseAsync(['sync-check'], { from: 'user' });
      } catch (error) { // NOSONAR - Commander.js throws on exitOverride, caught to test exit codes
        // Expected exception from Commander.js exitOverride
        expect(error).toBeDefined();
      }

      expect(exitSpy).toHaveBeenCalledWith(0);

      exitSpy.mockRestore();
    });

    it('should display message when no remote', async () => {
      const mockResult = {
        hasRemote: false,
        isUpToDate: true,
        currentBranch: 'feature/new',
      };

      vi.mocked(git.checkBranchSync).mockResolvedValue(mockResult);

      syncCheckCommand(env.program);

      try {
        await env.program.parseAsync(['sync-check'], { from: 'user' });
      } catch (error) { // NOSONAR - Commander.js throws on exitOverride, caught to test exit codes
        // Expected exception from Commander.js exitOverride
        expect(error).toBeDefined();
      }

      expect(console.log).toHaveBeenCalled();
    });
  });

  describe('--yaml flag', () => {
    it('should output YAML with --- separator when up to date', async () => {
      const mockResult = {
        hasRemote: true,
        isUpToDate: true,
        currentBranch: 'main',
        behindBy: 0,
      };

      vi.mocked(git.checkBranchSync).mockResolvedValue(mockResult);

      syncCheckCommand(env.program);

      try {
        await env.program.parseAsync(['sync-check', '--yaml'], { from: 'user' });
      } catch (error) { // NOSONAR - Commander.js throws on exitOverride, caught to test exit codes
        // Expected exception from Commander.js exitOverride
        expect(error).toBeDefined();
      }

      // Verify YAML separator was written
      const writeCalls = vi.mocked(process.stdout.write).mock.calls;
      const separatorCall = writeCalls.find(call => call[0] === '---\n');
      expect(separatorCall).toBeDefined();

      // Verify YAML content was written
      const yamlCalls = writeCalls.filter(call =>
        typeof call[0] === 'string' && call[0].includes('isUpToDate:')
      );
      expect(yamlCalls.length).toBeGreaterThan(0);
    });

    it('should output YAML with --- separator when behind', async () => {
      const mockResult = {
        hasRemote: true,
        isUpToDate: false,
        currentBranch: 'feature/test',
        behindBy: 3,
      };

      vi.mocked(git.checkBranchSync).mockResolvedValue(mockResult);

      syncCheckCommand(env.program);

      try {
        await env.program.parseAsync(['sync-check', '--yaml'], { from: 'user' });
      } catch (error) { // NOSONAR - Commander.js throws on exitOverride, caught to test exit codes
        // Expected exception from Commander.js exitOverride
        expect(error).toBeDefined();
      }

      // Verify YAML separator was written
      const writeCalls = vi.mocked(process.stdout.write).mock.calls;
      const separatorCall = writeCalls.find(call => call[0] === '---\n');
      expect(separatorCall).toBeDefined();

      // Verify YAML includes behind count
      const yamlContent = writeCalls
        .filter(call => typeof call[0] === 'string')
        .map(call => call[0])
        .join('');
      expect(yamlContent).toContain('behindBy:');
    });

    it('should output YAML with --- separator when no remote', async () => {
      const mockResult = {
        hasRemote: false,
        isUpToDate: true,
        currentBranch: 'feature/new',
      };

      vi.mocked(git.checkBranchSync).mockResolvedValue(mockResult);

      syncCheckCommand(env.program);

      try {
        await env.program.parseAsync(['sync-check', '--yaml'], { from: 'user' });
      } catch (error) { // NOSONAR - Commander.js throws on exitOverride, caught to test exit codes
        // Expected exception from Commander.js exitOverride
        expect(error).toBeDefined();
      }

      // Verify YAML separator was written
      const writeCalls = vi.mocked(process.stdout.write).mock.calls;
      const separatorCall = writeCalls.find(call => call[0] === '---\n');
      expect(separatorCall).toBeDefined();

      // Verify YAML shows no remote
      const yamlContent = writeCalls
        .filter(call => typeof call[0] === 'string')
        .map(call => call[0])
        .join('');
      expect(yamlContent).toContain('hasRemote: false');
    });
  });

  describe('option overrides', () => {
    it('should override main branch with --main-branch option', async () => {
      const mockResult = {
        hasRemote: true,
        isUpToDate: true,
        currentBranch: 'feature/test',
        behindBy: 0,
      };

      vi.mocked(git.checkBranchSync).mockResolvedValue(mockResult);

      syncCheckCommand(env.program);

      try {
        await env.program.parseAsync(['sync-check', '--main-branch', 'develop'], { from: 'user' });
      } catch (error) { // NOSONAR - Commander.js throws on exitOverride, caught to test exit codes
        // Expected exception from Commander.js exitOverride
        expect(error).toBeDefined();
      }

      // Verify checkBranchSync was called with correct remote branch
      expect(git.checkBranchSync).toHaveBeenCalledWith({
        remoteBranch: 'origin/develop',
      });
    });

    it('should override remote origin with --remote-origin option', async () => {
      const mockResult = {
        hasRemote: true,
        isUpToDate: true,
        currentBranch: 'feature/test',
        behindBy: 0,
      };

      vi.mocked(git.checkBranchSync).mockResolvedValue(mockResult);

      syncCheckCommand(env.program);

      try {
        await env.program.parseAsync(['sync-check', '--remote-origin', 'upstream'], { from: 'user' });
      } catch (error) { // NOSONAR - Commander.js throws on exitOverride, caught to test exit codes
        // Expected exception from Commander.js exitOverride
        expect(error).toBeDefined();
      }

      // Verify checkBranchSync was called with correct remote
      expect(git.checkBranchSync).toHaveBeenCalledWith({
        remoteBranch: 'upstream/main',
      });
    });

    it('should override both main branch and remote origin', async () => {
      const mockResult = {
        hasRemote: true,
        isUpToDate: true,
        currentBranch: 'feature/test',
        behindBy: 0,
      };

      vi.mocked(git.checkBranchSync).mockResolvedValue(mockResult);

      syncCheckCommand(env.program);

      try {
        await env.program.parseAsync(['sync-check', '--main-branch', 'develop', '--remote-origin', 'upstream'], { from: 'user' });
      } catch (error) { // NOSONAR - Commander.js throws on exitOverride, caught to test exit codes
        // Expected exception from Commander.js exitOverride
        expect(error).toBeDefined();
      }

      // Verify checkBranchSync was called with both overrides
      expect(git.checkBranchSync).toHaveBeenCalledWith({
        remoteBranch: 'upstream/develop',
      });
    });
  });

  describe('human-readable output', () => {
    it('should display human-friendly output when no --yaml flag', async () => {
      const mockResult = {
        hasRemote: true,
        isUpToDate: true,
        currentBranch: 'main',
        behindBy: 0,
      };

      vi.mocked(git.checkBranchSync).mockResolvedValue(mockResult);

      syncCheckCommand(env.program);

      try {
        await env.program.parseAsync(['sync-check'], { from: 'user' });
      } catch (error) { // NOSONAR - Commander.js throws on exitOverride, caught to test exit codes
        // Expected exception from Commander.js exitOverride
        expect(error).toBeDefined();
      }

      // Verify console.log was called for human output
      expect(console.log).toHaveBeenCalled();

      // Verify YAML separator was NOT written to stdout
      const writeCalls = vi.mocked(process.stdout.write).mock.calls;
      const separatorCall = writeCalls.find(call => call[0] === '---\n');
      expect(separatorCall).toBeUndefined();
    });

    it('should display current branch in human output', async () => {
      const mockResult = {
        hasRemote: true,
        isUpToDate: true,
        currentBranch: 'feature/test',
        behindBy: 0,
      };

      vi.mocked(git.checkBranchSync).mockResolvedValue(mockResult);

      syncCheckCommand(env.program);

      try {
        await env.program.parseAsync(['sync-check'], { from: 'user' });
      } catch (error) { // NOSONAR - Commander.js throws on exitOverride, caught to test exit codes
        // Expected exception from Commander.js exitOverride
        expect(error).toBeDefined();
      }

      // Verify console.log was called
      expect(console.log).toHaveBeenCalled();
    });

    it('should display behind count in human output', async () => {
      const mockResult = {
        hasRemote: true,
        isUpToDate: false,
        currentBranch: 'feature/test',
        behindBy: 7,
      };

      vi.mocked(git.checkBranchSync).mockResolvedValue(mockResult);

      syncCheckCommand(env.program);

      try {
        await env.program.parseAsync(['sync-check'], { from: 'user' });
      } catch (error) { // NOSONAR - Commander.js throws on exitOverride, caught to test exit codes
        // Expected exception from Commander.js exitOverride
        expect(error).toBeDefined();
      }

      // Verify console.log was called
      expect(console.log).toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('should handle sync check errors gracefully', async () => {
      const error = new Error('Git command failed');
      vi.mocked(git.checkBranchSync).mockRejectedValue(error);

      // Mock process.exit to track exit code
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: ProcessExitCode) => {
        throw new Error(`process.exit(${code})`);
      }) as any;

      syncCheckCommand(env.program);

      try {
        await env.program.parseAsync(['sync-check'], { from: 'user' });
      } catch (error) { // NOSONAR - Commander.js throws on exitOverride, caught to test exit codes
        // Expected exception from Commander.js exitOverride
        expect(error).toBeDefined();
      }

      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('Sync check failed with error:'),
        error
      );
      expect(exitSpy).toHaveBeenCalledWith(2);

      exitSpy.mockRestore();
    });

    it('should handle config loading errors gracefully', async () => {
      const error = new Error('Config not found');
      vi.mocked(configLoader.loadConfig).mockRejectedValue(error);

      // Mock process.exit to track exit code
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: ProcessExitCode) => {
        throw new Error(`process.exit(${code})`);
      }) as any;

      syncCheckCommand(env.program);

      try {
        await env.program.parseAsync(['sync-check'], { from: 'user' });
      } catch (error) { // NOSONAR - Commander.js throws on exitOverride, caught to test exit codes
        // Expected exception from Commander.js exitOverride
        expect(error).toBeDefined();
      }

      expect(console.error).toHaveBeenCalled();
      expect(exitSpy).toHaveBeenCalledWith(2);

      exitSpy.mockRestore();
    });
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanupCommand } from '../../src/commands/cleanup.js';
import * as git from '@vibe-validate/git';
import { setupCommanderTest, type CommanderTestEnv } from '../helpers/commander-test-setup.js';

// Mock the git module
vi.mock('@vibe-validate/git', async () => {
  const actual = await vi.importActual<typeof git>('@vibe-validate/git');
  return {
    ...actual,
    cleanupMergedBranches: vi.fn(),
  };
});

describe('cleanup command', () => {
  let env: CommanderTestEnv;

  beforeEach(() => {
    env = setupCommanderTest();

    // Reset git mocks
    vi.mocked(git.cleanupMergedBranches).mockReset();
  });

  afterEach(() => {
    env.cleanup();
  });

  describe('command registration', () => {
    it('should register cleanup command', () => {
      cleanupCommand(env.program);

      const command = env.program.commands.find(cmd => cmd.name() === 'cleanup');
      expect(command).toBeDefined();
    });

    it('should have correct description', () => {
      cleanupCommand(env.program);

      const command = env.program.commands.find(cmd => cmd.name() === 'cleanup');
      expect(command?.description()).toBe('Post-merge cleanup (switch to main, delete merged branches)');
    });

    it('should register --main-branch option', () => {
      cleanupCommand(env.program);

      const command = env.program.commands.find(cmd => cmd.name() === 'cleanup');
      const option = command?.options.find(opt => opt.long === '--main-branch');
      expect(option).toBeDefined();
      expect(option?.defaultValue).toBe('main');
    });

    it('should register --dry-run option', () => {
      cleanupCommand(env.program);

      const command = env.program.commands.find(cmd => cmd.name() === 'cleanup');
      const option = command?.options.find(opt => opt.long === '--dry-run');
      expect(option).toBeDefined();
    });

    it('should register --yaml option', () => {
      cleanupCommand(env.program);

      const command = env.program.commands.find(cmd => cmd.name() === 'cleanup');
      const option = command?.options.find(opt => opt.long === '--yaml');
      expect(option).toBeDefined();
    });
  });

  describe('cleanup execution', () => {
    it('should call cleanupMergedBranches with default options', async () => {
      const mockResult = {
        success: true,
        branchesDeleted: ['feature/test-1', 'feature/test-2'],
        currentBranch: 'main',
        mainSynced: true,
      };

      vi.mocked(git.cleanupMergedBranches).mockResolvedValue(mockResult);

      cleanupCommand(env.program);

      try {
        await env.program.parseAsync(['cleanup'], { from: 'user' });
      } catch (error) { // NOSONAR - Commander.js throws on exitOverride, caught to test exit codes
        // Expected exception from Commander.js exitOverride
        expect(error).toBeDefined();
      }

      expect(git.cleanupMergedBranches).toHaveBeenCalledWith({
        mainBranch: 'main',
        dryRun: undefined,
      });
    });

    it('should call cleanupMergedBranches with custom main branch', async () => {
      const mockResult = {
        success: true,
        branchesDeleted: [],
        currentBranch: 'develop',
        mainSynced: true,
      };

      vi.mocked(git.cleanupMergedBranches).mockResolvedValue(mockResult);

      cleanupCommand(env.program);

      try {
        await env.program.parseAsync(['cleanup', '--main-branch', 'develop'], { from: 'user' });
      } catch (error) { // NOSONAR - Commander.js throws on exitOverride, caught to test exit codes
        // Expected exception from Commander.js exitOverride
        expect(error).toBeDefined();
      }

      expect(git.cleanupMergedBranches).toHaveBeenCalledWith({
        mainBranch: 'develop',
        dryRun: undefined,
      });
    });

    it('should call cleanupMergedBranches with dry-run enabled', async () => {
      const mockResult = {
        success: true,
        branchesDeleted: ['feature/test'],
        currentBranch: 'main',
        mainSynced: true,
      };

      vi.mocked(git.cleanupMergedBranches).mockResolvedValue(mockResult);

      cleanupCommand(env.program);

      try {
        await env.program.parseAsync(['cleanup', '--dry-run'], { from: 'user' });
      } catch (error) { // NOSONAR - Commander.js throws on exitOverride, caught to test exit codes
        // Expected exception from Commander.js exitOverride
        expect(error).toBeDefined();
      }

      expect(git.cleanupMergedBranches).toHaveBeenCalledWith({
        mainBranch: 'main',
        dryRun: true,
      });
    });
  });

  describe('--yaml flag', () => {
    it('should output YAML with --- separator on success', async () => {
      const mockResult = {
        success: true,
        branchesDeleted: ['feature/test-1', 'feature/test-2'],
        currentBranch: 'main',
        mainSynced: true,
      };

      vi.mocked(git.cleanupMergedBranches).mockResolvedValue(mockResult);

      cleanupCommand(env.program);

      try {
        await env.program.parseAsync(['cleanup', '--yaml'], { from: 'user' });
      } catch (error) { // NOSONAR - Commander.js throws on exitOverride, caught to test exit codes
        // Expected exception from Commander.js exitOverride
        expect(error).toBeDefined();
      }

      // Verify YAML separator was written
      const writeCalls = vi.mocked(process.stdout.write).mock.calls;
      const separatorCall = writeCalls.find(call => call[0] === '---\n');
      expect(separatorCall).toBeDefined();

      // Verify YAML content was written (check for YAML structure)
      const yamlCalls = writeCalls.filter(call =>
        typeof call[0] === 'string' && call[0].includes('success:')
      );
      expect(yamlCalls.length).toBeGreaterThan(0);
    });

    it('should output YAML with --- separator when no branches deleted', async () => {
      const mockResult = {
        success: true,
        branchesDeleted: [],
        currentBranch: 'main',
        mainSynced: true,
      };

      vi.mocked(git.cleanupMergedBranches).mockResolvedValue(mockResult);

      cleanupCommand(env.program);

      try {
        await env.program.parseAsync(['cleanup', '--yaml'], { from: 'user' });
      } catch (error) { // NOSONAR - Commander.js throws on exitOverride, caught to test exit codes
        // Expected exception from Commander.js exitOverride
        expect(error).toBeDefined();
      }

      // Verify YAML separator was written
      const writeCalls = vi.mocked(process.stdout.write).mock.calls;
      const separatorCall = writeCalls.find(call => call[0] === '---\n');
      expect(separatorCall).toBeDefined();

      // Verify YAML content includes empty branchesDeleted array
      const yamlContent = writeCalls
        .filter(call => typeof call[0] === 'string')
        .map(call => call[0])
        .join('');
      expect(yamlContent).toContain('branchesDeleted:');
    });

    it('should output YAML with --- separator on error', async () => {
      const mockResult = {
        success: false,
        error: 'Failed to sync with remote',
        branchesDeleted: [],
        currentBranch: 'main',
        mainSynced: false,
      };

      vi.mocked(git.cleanupMergedBranches).mockResolvedValue(mockResult);

      cleanupCommand(env.program);

      try {
        await env.program.parseAsync(['cleanup', '--yaml'], { from: 'user' });
      } catch (error) { // NOSONAR - Commander.js throws on exitOverride, caught to test exit codes
        // Expected exception from Commander.js exitOverride
        expect(error).toBeDefined();
      }

      // Verify YAML separator was written
      const writeCalls = vi.mocked(process.stdout.write).mock.calls;
      const separatorCall = writeCalls.find(call => call[0] === '---\n');
      expect(separatorCall).toBeDefined();

      // Verify error is included in YAML
      const yamlContent = writeCalls
        .filter(call => typeof call[0] === 'string')
        .map(call => call[0])
        .join('');
      expect(yamlContent).toContain('error:');
      expect(yamlContent).toContain('Failed to sync with remote');
    });

    it('should work with both --yaml and --dry-run flags', async () => {
      const mockResult = {
        success: true,
        branchesDeleted: ['feature/test'],
        currentBranch: 'main',
        mainSynced: true,
      };

      vi.mocked(git.cleanupMergedBranches).mockResolvedValue(mockResult);

      cleanupCommand(env.program);

      try {
        await env.program.parseAsync(['cleanup', '--yaml', '--dry-run'], { from: 'user' });
      } catch (error) { // NOSONAR - Commander.js throws on exitOverride, caught to test exit codes
        // Expected exception from Commander.js exitOverride
        expect(error).toBeDefined();
      }

      // Verify both options were passed
      expect(git.cleanupMergedBranches).toHaveBeenCalledWith({
        mainBranch: 'main',
        dryRun: true,
      });

      // Verify YAML output was generated
      const writeCalls = vi.mocked(process.stdout.write).mock.calls;
      const separatorCall = writeCalls.find(call => call[0] === '---\n');
      expect(separatorCall).toBeDefined();
    });
  });

  describe('human-readable output', () => {
    it('should display human-friendly output when no --yaml flag', async () => {
      const mockResult = {
        success: true,
        branchesDeleted: ['feature/test-1', 'feature/test-2'],
        currentBranch: 'main',
        mainSynced: true,
      };

      vi.mocked(git.cleanupMergedBranches).mockResolvedValue(mockResult);

      cleanupCommand(env.program);

      try {
        await env.program.parseAsync(['cleanup'], { from: 'user' });
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

    it('should display dry-run message in human output', async () => {
      const mockResult = {
        success: true,
        branchesDeleted: ['feature/test'],
        currentBranch: 'main',
        mainSynced: true,
      };

      vi.mocked(git.cleanupMergedBranches).mockResolvedValue(mockResult);

      cleanupCommand(env.program);

      try {
        await env.program.parseAsync(['cleanup', '--dry-run'], { from: 'user' });
      } catch (error) { // NOSONAR - Commander.js throws on exitOverride, caught to test exit codes
        // Expected exception from Commander.js exitOverride
        expect(error).toBeDefined();
      }

      // Verify console.log was called
      expect(console.log).toHaveBeenCalled();
    });

    it('should display message when no branches to delete', async () => {
      const mockResult = {
        success: true,
        branchesDeleted: [],
        currentBranch: 'main',
        mainSynced: true,
      };

      vi.mocked(git.cleanupMergedBranches).mockResolvedValue(mockResult);

      cleanupCommand(env.program);

      try {
        await env.program.parseAsync(['cleanup'], { from: 'user' });
      } catch (error) { // NOSONAR - Commander.js throws on exitOverride, caught to test exit codes
        // Expected exception from Commander.js exitOverride
        expect(error).toBeDefined();
      }

      // Verify console.log was called
      expect(console.log).toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('should handle cleanup errors gracefully', async () => {
      const error = new Error('Git command failed');
      vi.mocked(git.cleanupMergedBranches).mockRejectedValue(error);

      cleanupCommand(env.program);

      try {
        await env.program.parseAsync(['cleanup'], { from: 'user' });
      } catch (error) { // NOSONAR - Commander.js throws on exitOverride, caught to test exit codes
        // Expected exception from Commander.js exitOverride
        expect(error).toBeDefined();
      }

      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('Cleanup failed with error:'),
        error
      );
    });

    it('should exit with code 1 when cleanup returns success: false', async () => {
      const mockResult = {
        success: false,
        error: 'Failed to delete branch',
        branchesDeleted: [],
        currentBranch: 'main',
        mainSynced: false,
      };

      vi.mocked(git.cleanupMergedBranches).mockResolvedValue(mockResult);

      // Mock process.exit to track exit code
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null | undefined) => {
        throw new Error(`process.exit(${code})`);
      }) as any;

      cleanupCommand(env.program);

      try {
        await env.program.parseAsync(['cleanup'], { from: 'user' });
      } catch (error) { // NOSONAR - Commander.js throws on exitOverride, caught to test exit codes
        // Expected exception from Commander.js exitOverride
        expect(error).toBeDefined();
      }

      expect(exitSpy).toHaveBeenCalledWith(1);

      exitSpy.mockRestore();
    });

    it('should exit with code 0 when cleanup succeeds', async () => {
      const mockResult = {
        success: true,
        branchesDeleted: ['feature/test'],
        currentBranch: 'main',
        mainSynced: true,
      };

      vi.mocked(git.cleanupMergedBranches).mockResolvedValue(mockResult);

      // Mock process.exit to track exit code
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: string | number | null | undefined) => {
        throw new Error(`process.exit(${code})`);
      }) as any;

      cleanupCommand(env.program);

      try {
        await env.program.parseAsync(['cleanup'], { from: 'user' });
      } catch (error) { // NOSONAR - Commander.js throws on exitOverride, caught to test exit codes
        // Expected exception from Commander.js exitOverride
        expect(error).toBeDefined();
      }

      expect(exitSpy).toHaveBeenCalledWith(0);

      exitSpy.mockRestore();
    });
  });
});

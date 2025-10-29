import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Command } from 'commander';
import { registerWatchPRCommand } from '../../src/commands/watch-pr.js';
import { CIProviderRegistry } from '../../src/services/ci-provider-registry.js';
import type { CIProvider, CheckStatus } from '../../src/services/ci-provider.js';

// Mock the CI provider registry
vi.mock('../../src/services/ci-provider-registry.js', () => {
  const mockProvider: CIProvider = {
    name: 'mock-provider',
    detectPullRequest: vi.fn(),
    fetchCheckStatus: vi.fn(),
    fetchFailureLogs: vi.fn(),
  };

  return {
    CIProviderRegistry: vi.fn().mockImplementation(() => ({
      detectProvider: vi.fn().mockResolvedValue(mockProvider),
      getProvider: vi.fn().mockReturnValue(mockProvider),
      getProviderNames: vi.fn().mockReturnValue(['github-actions', 'gitlab-ci']),
    })),
  };
});

// Type alias for process.exit mock parameter
type ProcessExitCode = string | number | null | undefined;

describe('watch-pr command', () => {
  let program: Command;
  let mockProvider: CIProvider;

  beforeEach(() => {
    // Create fresh Commander instance
    program = new Command();
    program.exitOverride(); // Prevent process.exit() from killing tests

    // Spy on console methods to capture output
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

    // Create mock provider with vi.fn() methods
    mockProvider = {
      name: 'mock-provider',
      detectPullRequest: vi.fn(),
      fetchCheckStatus: vi.fn(),
      fetchFailureLogs: vi.fn(),
    };

    // Reset and setup mock implementation for CIProviderRegistry
    // The registry mock is already set up in vi.mock() above
    // We just need to update the mock implementation for each test
    vi.mocked(CIProviderRegistry).mockImplementation(() => ({
      detectProvider: vi.fn().mockResolvedValue(mockProvider),
      getProvider: vi.fn().mockReturnValue(mockProvider),
      getProviderNames: vi.fn().mockReturnValue(['github-actions', 'gitlab-ci']),
    }));
  });

  describe('command registration', () => {
    it('should register watch-pr command', () => {
      registerWatchPRCommand(program);

      const command = program.commands.find(cmd => cmd.name() === 'watch-pr');
      expect(command).toBeDefined();
    });

    it('should have correct description', () => {
      registerWatchPRCommand(program);

      const command = program.commands.find(cmd => cmd.name() === 'watch-pr');
      expect(command?.description()).toBe('Watch CI checks for a pull/merge request in real-time');
    });

    it('should register --provider option', () => {
      registerWatchPRCommand(program);

      const command = program.commands.find(cmd => cmd.name() === 'watch-pr');
      const option = command?.options.find(opt => opt.long === '--provider');
      expect(option).toBeDefined();
    });

    it('should register --yaml option', () => {
      registerWatchPRCommand(program);

      const command = program.commands.find(cmd => cmd.name() === 'watch-pr');
      const option = command?.options.find(opt => opt.long === '--yaml');
      expect(option).toBeDefined();
    });

    it('should register --timeout option', () => {
      registerWatchPRCommand(program);

      const command = program.commands.find(cmd => cmd.name() === 'watch-pr');
      const option = command?.options.find(opt => opt.long === '--timeout');
      expect(option).toBeDefined();
      expect(option?.defaultValue).toBe('3600');
    });

    it('should register --poll-interval option', () => {
      registerWatchPRCommand(program);

      const command = program.commands.find(cmd => cmd.name() === 'watch-pr');
      const option = command?.options.find(opt => opt.long === '--poll-interval');
      expect(option).toBeDefined();
      expect(option?.defaultValue).toBe('10');
    });

    it('should register --fail-fast option', () => {
      registerWatchPRCommand(program);

      const command = program.commands.find(cmd => cmd.name() === 'watch-pr');
      const option = command?.options.find(opt => opt.long === '--fail-fast');
      expect(option).toBeDefined();
    });
  });

  describe('PR detection', () => {
    it('should use provided PR number', async () => {
      const mockStatus: CheckStatus = {
        pr: {
          id: 123,
          title: 'Test PR',
          url: 'https://github.com/test/repo/pull/123',
        },
        status: 'completed',
        result: 'success',
        checks: [
          {
            id: 'check-1',
            name: 'Test Check',
            status: 'completed',
            conclusion: 'success',
          },
        ],
      };

      vi.mocked(mockProvider.fetchCheckStatus).mockResolvedValue(mockStatus);
      vi.mocked(mockProvider.fetchFailureLogs).mockResolvedValue({
        errorSummary: '',
        validationResult: null,
      });

      registerWatchPRCommand(program);

      // Mock process.exit to track exit code
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: ProcessExitCode) => {
        throw new Error(`process.exit(${code})`);
      }) as any;

      try {
        await program.parseAsync(['watch-pr', '123'], { from: 'user' });
      } catch (error) { // NOSONAR - Commander.js throws on exitOverride, caught to test exit codes
        // Expected exception from Commander.js exitOverride
        expect(error).toBeDefined();
      }

      expect(mockProvider.fetchCheckStatus).toHaveBeenCalledWith('123');

      exitSpy.mockRestore();
    });

    it('should auto-detect PR from branch when no number provided', async () => {
      const mockDetectedPR = {
        id: 456,
        title: 'Auto-detected PR',
        url: 'https://github.com/test/repo/pull/456',
      };

      const mockStatus: CheckStatus = {
        pr: mockDetectedPR,
        status: 'completed',
        result: 'success',
        checks: [],
      };

      vi.mocked(mockProvider.detectPullRequest).mockResolvedValue(mockDetectedPR);
      vi.mocked(mockProvider.fetchCheckStatus).mockResolvedValue(mockStatus);
      vi.mocked(mockProvider.fetchFailureLogs).mockResolvedValue({
        errorSummary: '',
        validationResult: null,
      });

      registerWatchPRCommand(program);

      // Mock process.exit to track exit code
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: ProcessExitCode) => {
        throw new Error(`process.exit(${code})`);
      }) as any;

      try {
        await program.parseAsync(['watch-pr'], { from: 'user' });
      } catch (error) { // NOSONAR - Commander.js throws on exitOverride, caught to test exit codes
        // Expected exception from Commander.js exitOverride
        expect(error).toBeDefined();
      }

      expect(mockProvider.detectPullRequest).toHaveBeenCalled();
      expect(mockProvider.fetchCheckStatus).toHaveBeenCalledWith('456');

      exitSpy.mockRestore();
    });

    it('should error when no PR detected and no number provided', async () => {
      vi.mocked(mockProvider.detectPullRequest).mockResolvedValue(null);

      registerWatchPRCommand(program);

      // Mock process.exit to track exit code
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: ProcessExitCode) => {
        throw new Error(`process.exit(${code})`);
      }) as any;

      try {
        await program.parseAsync(['watch-pr'], { from: 'user' });
      } catch (error) { // NOSONAR - Commander.js throws on exitOverride, caught to test exit codes
        // Expected exception from Commander.js exitOverride
        expect(error).toBeDefined();
      }

      expect(exitSpy).toHaveBeenCalledWith(1);

      exitSpy.mockRestore();
    });
  });

  describe('successful checks', () => {
    it('should exit with code 0 when all checks pass', async () => {
      const mockStatus: CheckStatus = {
        pr: {
          id: 123,
          title: 'Test PR',
          url: 'https://github.com/test/repo/pull/123',
        },
        status: 'completed',
        result: 'success',
        checks: [
          {
            id: 'check-1',
            name: 'Test Check',
            status: 'completed',
            conclusion: 'success',
          },
        ],
      };

      vi.mocked(mockProvider.fetchCheckStatus).mockResolvedValue(mockStatus);
      vi.mocked(mockProvider.fetchFailureLogs).mockResolvedValue({
        errorSummary: '',
        validationResult: null,
      });

      registerWatchPRCommand(program);

      // Mock process.exit to track exit code
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: ProcessExitCode) => {
        throw new Error(`process.exit(${code})`);
      }) as any;

      try {
        await program.parseAsync(['watch-pr', '123'], { from: 'user' });
      } catch (error) { // NOSONAR - Commander.js throws on exitOverride, caught to test exit codes
        // Expected exception from Commander.js exitOverride
        expect(error).toBeDefined();
      }

      expect(exitSpy).toHaveBeenCalledWith(0);

      exitSpy.mockRestore();
    });
  });

  describe('failed checks', () => {
    it('should exit with code 1 when checks fail', async () => {
      const mockStatus: CheckStatus = {
        pr: {
          id: 123,
          title: 'Test PR',
          url: 'https://github.com/test/repo/pull/123',
        },
        status: 'completed',
        result: 'failure',
        checks: [
          {
            id: 'check-1',
            name: 'Test Check',
            status: 'completed',
            conclusion: 'failure',
          },
        ],
      };

      vi.mocked(mockProvider.fetchCheckStatus).mockResolvedValue(mockStatus);
      vi.mocked(mockProvider.fetchFailureLogs).mockResolvedValue({
        errorSummary: 'Test failed',
        validationResult: null,
      });

      registerWatchPRCommand(program);

      // Mock process.exit to track exit code
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: ProcessExitCode) => {
        throw new Error(`process.exit(${code})`);
      }) as any;

      try {
        await program.parseAsync(['watch-pr', '123'], { from: 'user' });
      } catch (error) { // NOSONAR - Commander.js throws on exitOverride, caught to test exit codes
        // Expected exception from Commander.js exitOverride
        expect(error).toBeDefined();
      }

      expect(exitSpy).toHaveBeenCalledWith(1);

      exitSpy.mockRestore();
    });

    it('should fetch failure logs for failed checks', async () => {
      const mockStatus: CheckStatus = {
        pr: {
          id: 123,
          title: 'Test PR',
          url: 'https://github.com/test/repo/pull/123',
        },
        status: 'completed',
        result: 'failure',
        checks: [
          {
            id: 'check-1',
            name: 'Failed Check',
            status: 'completed',
            conclusion: 'failure',
          },
        ],
      };

      vi.mocked(mockProvider.fetchCheckStatus).mockResolvedValue(mockStatus);
      vi.mocked(mockProvider.fetchFailureLogs).mockResolvedValue({
        errorSummary: 'Error details',
        validationResult: null,
      });

      registerWatchPRCommand(program);

      // Mock process.exit to track exit code
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: ProcessExitCode) => {
        throw new Error(`process.exit(${code})`);
      }) as any;

      try {
        await program.parseAsync(['watch-pr', '123'], { from: 'user' });
      } catch (error) { // NOSONAR - Commander.js throws on exitOverride, caught to test exit codes
        // Expected exception from Commander.js exitOverride
        expect(error).toBeDefined();
      }

      expect(mockProvider.fetchFailureLogs).toHaveBeenCalledWith('check-1');

      exitSpy.mockRestore();
    });
  });

  describe('--yaml flag', () => {
    it('should output YAML with --- separator on success', async () => {
      const mockStatus: CheckStatus = {
        pr: {
          id: 123,
          title: 'Test PR',
          url: 'https://github.com/test/repo/pull/123',
        },
        status: 'completed',
        result: 'success',
        checks: [
          {
            id: 'check-1',
            name: 'Test Check',
            status: 'completed',
            conclusion: 'success',
          },
        ],
      };

      vi.mocked(mockProvider.fetchCheckStatus).mockResolvedValue(mockStatus);
      vi.mocked(mockProvider.fetchFailureLogs).mockResolvedValue({
        errorSummary: '',
        validationResult: null,
      });

      registerWatchPRCommand(program);

      // Mock process.exit to track exit code
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: ProcessExitCode) => {
        throw new Error(`process.exit(${code})`);
      }) as any;

      try {
        await program.parseAsync(['watch-pr', '123', '--yaml'], { from: 'user' });
      } catch (error) { // NOSONAR - Commander.js throws on exitOverride, caught to test exit codes
        // Expected exception from Commander.js exitOverride
        expect(error).toBeDefined();
      }

      // Verify YAML separator was written
      const writeCalls = vi.mocked(process.stdout.write).mock.calls;
      const separatorCall = writeCalls.find(call => call[0] === '---\n');
      expect(separatorCall).toBeDefined();

      exitSpy.mockRestore();
    });

    it('should output YAML with --- separator on failure', async () => {
      const mockStatus: CheckStatus = {
        pr: {
          id: 123,
          title: 'Test PR',
          url: 'https://github.com/test/repo/pull/123',
        },
        status: 'completed',
        result: 'failure',
        checks: [
          {
            id: 'check-1',
            name: 'Failed Check',
            status: 'completed',
            conclusion: 'failure',
          },
        ],
      };

      vi.mocked(mockProvider.fetchCheckStatus).mockResolvedValue(mockStatus);
      vi.mocked(mockProvider.fetchFailureLogs).mockResolvedValue({
        errorSummary: 'Test failed',
        validationResult: null,
      });

      registerWatchPRCommand(program);

      // Mock process.exit to track exit code
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: ProcessExitCode) => {
        throw new Error(`process.exit(${code})`);
      }) as any;

      try {
        await program.parseAsync(['watch-pr', '123', '--yaml'], { from: 'user' });
      } catch (error) { // NOSONAR - Commander.js throws on exitOverride, caught to test exit codes
        // Expected exception from Commander.js exitOverride
        expect(error).toBeDefined();
      }

      // Verify YAML separator was written
      const writeCalls = vi.mocked(process.stdout.write).mock.calls;
      const separatorCall = writeCalls.find(call => call[0] === '---\n');
      expect(separatorCall).toBeDefined();

      // Verify failures are included
      const yamlContent = writeCalls
        .filter(call => typeof call[0] === 'string')
        .map(call => call[0])
        .join('');
      expect(yamlContent).toContain('failures:');

      exitSpy.mockRestore();
    });

    it('should output error as YAML when error occurs', async () => {
      vi.mocked(mockProvider.detectPullRequest).mockResolvedValue(null);

      registerWatchPRCommand(program);

      // Mock process.exit to track exit code
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: ProcessExitCode) => {
        throw new Error(`process.exit(${code})`);
      }) as any;

      try {
        await program.parseAsync(['watch-pr', '--yaml'], { from: 'user' });
      } catch (error) { // NOSONAR - Commander.js throws on exitOverride, caught to test exit codes
        // Expected exception from Commander.js exitOverride
        expect(error).toBeDefined();
      }

      // Verify YAML separator was written
      const writeCalls = vi.mocked(process.stdout.write).mock.calls;
      const separatorCall = writeCalls.find(call => call[0] === '---\n');
      expect(separatorCall).toBeDefined();

      // Verify error is in YAML
      const yamlContent = writeCalls
        .filter(call => typeof call[0] === 'string')
        .map(call => call[0])
        .join('');
      expect(yamlContent).toContain('error:');

      exitSpy.mockRestore();
    });
  });

  describe('timeout handling', () => {
    it('should exit with code 2 when timeout is reached', async () => {
      const mockStatus: CheckStatus = {
        pr: {
          id: 123,
          title: 'Test PR',
          url: 'https://github.com/test/repo/pull/123',
        },
        status: 'in_progress',
        result: 'unknown',
        checks: [
          {
            id: 'check-1',
            name: 'Slow Check',
            status: 'in_progress',
            conclusion: null,
          },
        ],
      };

      vi.mocked(mockProvider.fetchCheckStatus).mockResolvedValue(mockStatus);

      registerWatchPRCommand(program);

      // Mock process.exit to track exit code
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: ProcessExitCode) => {
        throw new Error(`process.exit(${code})`);
      }) as any;

      try {
        // Use very short timeout to trigger timeout quickly
        await program.parseAsync(['watch-pr', '123', '--timeout', '0'], { from: 'user' });
      } catch (error) { // NOSONAR - Commander.js throws on exitOverride, caught to test exit codes
        // Expected exception from Commander.js exitOverride
        expect(error).toBeDefined();
      }

      expect(exitSpy).toHaveBeenCalledWith(2);

      exitSpy.mockRestore();
    });
  });

  describe('--fail-fast flag', () => {
    it('should exit immediately when first check fails with --fail-fast', async () => {
      const mockStatusWithFailure: CheckStatus = {
        pr: {
          id: 123,
          title: 'Test PR',
          url: 'https://github.com/test/repo/pull/123',
        },
        status: 'in_progress',
        result: 'unknown',
        checks: [
          {
            id: 'check-1',
            name: 'Failed Check',
            status: 'completed',
            conclusion: 'failure',
          },
          {
            id: 'check-2',
            name: 'Pending Check',
            status: 'in_progress',
            conclusion: null,
          },
        ],
      };

      vi.mocked(mockProvider.fetchCheckStatus).mockResolvedValue(mockStatusWithFailure);
      vi.mocked(mockProvider.fetchFailureLogs).mockResolvedValue({
        errorSummary: 'Test failed',
        validationResult: null,
      });

      registerWatchPRCommand(program);

      // Mock process.exit to track exit code
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: ProcessExitCode) => {
        throw new Error(`process.exit(${code})`);
      }) as any;

      try {
        await program.parseAsync(['watch-pr', '123', '--fail-fast'], { from: 'user' });
      } catch (error) { // NOSONAR - Commander.js throws on exitOverride, caught to test exit codes
        // Expected exception from Commander.js exitOverride
        expect(error).toBeDefined();
      }

      expect(exitSpy).toHaveBeenCalledWith(1);

      exitSpy.mockRestore();
    });
  });

  describe('--provider option', () => {
    it('should use specified provider when --provider is provided', async () => {
      const mockStatus: CheckStatus = {
        pr: {
          id: 123,
          title: 'Test PR',
          url: 'https://github.com/test/repo/pull/123',
        },
        status: 'completed',
        result: 'success',
        checks: [],
      };

      vi.mocked(mockProvider.fetchCheckStatus).mockResolvedValue(mockStatus);
      vi.mocked(mockProvider.fetchFailureLogs).mockResolvedValue({
        errorSummary: '',
        validationResult: null,
      });

      registerWatchPRCommand(program);

      // Mock process.exit to track exit code
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: ProcessExitCode) => {
        throw new Error(`process.exit(${code})`);
      }) as any;

      try {
        await program.parseAsync(['watch-pr', '123', '--provider', 'github-actions'], { from: 'user' });
      } catch (error) { // NOSONAR - Commander.js throws on exitOverride, caught to test exit codes
        // Expected exception from Commander.js exitOverride
        expect(error).toBeDefined();
      }

      // Verify the provider option was used (command should succeed)
      expect(exitSpy).toHaveBeenCalled();

      exitSpy.mockRestore();
    });
  });

  describe('error handling', () => {
    it('should handle provider detection failure', async () => {
      // Update the mock to return null for detectProvider
      vi.mocked(CIProviderRegistry).mockImplementation(() => ({
        detectProvider: vi.fn().mockResolvedValue(null),
        getProvider: vi.fn().mockReturnValue(null),
        getProviderNames: vi.fn().mockReturnValue(['github-actions', 'gitlab-ci']),
      }));

      registerWatchPRCommand(program);

      // Mock process.exit to track exit code
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: ProcessExitCode) => {
        throw new Error(`process.exit(${code})`);
      }) as any;

      try {
        await program.parseAsync(['watch-pr', '123'], { from: 'user' });
      } catch (error) { // NOSONAR - Commander.js throws on exitOverride, caught to test exit codes
        // Expected exception from Commander.js exitOverride
        expect(error).toBeDefined();
      }

      expect(exitSpy).toHaveBeenCalledWith(1);

      exitSpy.mockRestore();
    });

    it('should handle check status fetch errors', async () => {
      const error = new Error('API error');
      vi.mocked(mockProvider.fetchCheckStatus).mockRejectedValue(error);

      registerWatchPRCommand(program);

      // Mock process.exit to track exit code
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: ProcessExitCode) => {
        throw new Error(`process.exit(${code})`);
      }) as any;

      try {
        await program.parseAsync(['watch-pr', '123'], { from: 'user' });
      } catch (error) { // NOSONAR - Commander.js throws on exitOverride, caught to test exit codes
        // Expected exception from Commander.js exitOverride
        expect(error).toBeDefined();
      }

      expect(exitSpy).toHaveBeenCalledWith(1);

      exitSpy.mockRestore();
    });
  });
});

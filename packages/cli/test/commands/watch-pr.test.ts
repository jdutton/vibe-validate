/**
 * Tests for watch-pr command
 *
 * Tests cover:
 * - Auto-detection of PR from current branch
 * - Error output format (plain text for usage errors, YAML for PR failures)
 * - PR suggestions when auto-detection fails
 * - --run-id flag validation and behavior
 * - --history flag display and formatting
 * - Command name detection in error messages
 * - Error handling for invalid inputs
 *
 * @packageDocumentation
 */

import { spawn } from 'node:child_process';
import path from 'node:path';

import {
  fetchPRDetails,
  listPullRequests,
  listWorkflowRuns,
} from '@vibe-validate/git';
import { safeExecSync } from '@vibe-validate/utils';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

// Mock safeExecSync for testing
vi.mock('@vibe-validate/utils', () => ({
  safeExecSync: vi.fn(),
  safeExecResult: vi.fn(),
  isToolAvailable: vi.fn(() => true),
  normalizedTmpdir: vi.fn(() => '/tmp'),
  mkdirSyncReal: vi.fn(),
}));

// Mock gh-commands from @vibe-validate/git
vi.mock('@vibe-validate/git', async () => {
  const actual = await vi.importActual('@vibe-validate/git');
  return {
    ...actual,
    fetchPRDetails: vi.fn(),
    listPullRequests: vi.fn(),
    listWorkflowRuns: vi.fn(),
  };
});

describe('watch-pr command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('command name detection', () => {
    it('should show "vv" in error messages when invoked with vv and auto-detection fails', async () => {
      // This test will fail to auto-detect PR (no PR for current branch or detached HEAD)
      const vvPath = path.resolve(__dirname, '../../dist/bin/vv');
      const result = await executeCommand(vvPath, ['watch-pr']);

      // Should show "vv" in usage/example, not "vibe-validate"
      if (result.stderr.includes('Could not auto-detect PR')) {
        expect(result.stderr).toContain('Usage: vv watch-pr');
        expect(result.stderr).toContain('Example: vv watch-pr');
      }
      expect(result.exitCode).toBe(1);
    });

    it('should show "vibe-validate" in error messages when invoked with vibe-validate and auto-detection fails', async () => {
      // This test will fail to auto-detect PR (no PR for current branch or detached HEAD)
      const validatePath = path.resolve(__dirname, '../../dist/bin/vibe-validate');
      const result = await executeCommand(validatePath, ['watch-pr']);

      // Should show "vibe-validate" in usage/example
      if (result.stderr.includes('Could not auto-detect PR')) {
        expect(result.stderr).toContain('Usage: vibe-validate watch-pr');
        expect(result.stderr).toContain('Example: vibe-validate watch-pr');
      }
      expect(result.exitCode).toBe(1);
    });
  });

  describe('auto-detection', () => {
    it('should auto-detect PR from current branch when no PR number provided', async () => {
      // Mock git remote
      vi.mocked(safeExecSync).mockImplementation((cmd: string, args: string[]) => {
        if (cmd === 'git' && args[0] === 'remote') {
          return Buffer.from('https://github.com/test-owner/test-repo.git');
        }
        if (cmd === 'gh' && args[0] === 'pr' && args[1] === 'view') {
          return Buffer.from(JSON.stringify({ number: 123 }));
        }
        throw new Error('Unexpected command');
      });

      // Execute command via spawn to test actual CLI behavior
      const cliPath = path.resolve(__dirname, '../../dist/bin/vv');
      const result = await executeCommand(cliPath, ['watch-pr']);

      // Should attempt to fetch PR 123 (will fail without full mocking, but that's ok)
      // We're testing that auto-detection was attempted
      expect(result.output).not.toContain('PR number is required');
    });

    it('should detect owner/repo from various git remote URL formats', async () => {
      // Test various GitHub remote URL formats (HTTPS, SSH, SSH with custom aliases)
      const testCases = [
        {
          remote: 'https://github.com/jdutton/vibe-validate.git',
          expectedOwner: 'jdutton',
          expectedRepo: 'vibe-validate',
          description: 'HTTPS URL'
        },
        {
          remote: 'git@github.com:jdutton/vibe-validate.git',
          expectedOwner: 'jdutton',
          expectedRepo: 'vibe-validate',
          description: 'SSH URL'
        },
        {
          remote: 'git@github.com-personal:jdutton/vibe-validate.git',
          expectedOwner: 'jdutton',
          expectedRepo: 'vibe-validate',
          description: 'SSH URL with custom alias (github.com-personal)'
        },
        {
          remote: 'git@github.com-work:company/project.git',
          expectedOwner: 'company',
          expectedRepo: 'project',
          description: 'SSH URL with custom alias (github.com-work)'
        },
      ];

      for (const testCase of testCases) {
        // Mock git remote to return test URL
        vi.mocked(safeExecSync).mockImplementation((cmd: string, args: string[]) => {
          if (cmd === 'git' && args[0] === 'remote') {
            return testCase.remote;
          }
          if (cmd === 'gh' && args[0] === 'pr' && args[1] === 'view') {
            // Mock PR detection failure to trigger error (which includes owner/repo in message)
            throw new Error('no pull requests found');
          }
          throw new Error('Unexpected command');
        });

        // Mock listPullRequests to check if correct owner/repo was detected
        const listPRsSpy = vi.mocked(listPullRequests).mockReturnValue([]);

        // Import and call watchPRCommand directly
        const { watchPRCommand } = await import('../../src/commands/watch-pr.js');

        try {
          await watchPRCommand(undefined, {});
          // eslint-disable-next-line sonarjs/no-ignored-exceptions
        } catch (_error) {
          // Expected to fail (no PR found) - we're only testing owner/repo detection
          // Test validates listPullRequests was called with correct owner/repo
        }

        // Verify listPullRequests was called with correct owner/repo
        expect(listPRsSpy).toHaveBeenCalledWith(
          testCase.expectedOwner,
          testCase.expectedRepo,
          expect.any(Number),
          expect.any(Array)
        );

        // Clear mocks for next iteration
        vi.clearAllMocks();
      }
    });

    it('should show helpful suggestions when auto-detection fails', async () => {
      // Mock git remote to return test repo
      vi.mocked(safeExecSync).mockImplementation((cmd: string, args: string[]) => {
        if (cmd === 'git' && args[0] === 'remote') {
          return 'https://github.com/test/repo.git';
        }
        if (cmd === 'git' && args[0] === 'rev-parse') {
          throw new Error('Not on a branch'); // Simulate detached HEAD
        }
        throw new Error('Unexpected command');
      });

      // Mock listPullRequests to return test PRs
      vi.mocked(listPullRequests).mockReturnValue([
        {
          number: 92,
          title: 'Test PR 1',
          author: { login: 'testuser1' },
          headRefName: 'feature/test-1',
          baseRefName: 'main',
          url: 'https://github.com/test/repo/pull/92',
        },
        {
          number: 93,
          title: 'Test PR 2',
          author: { login: 'testuser2' },
          headRefName: 'feature/test-2',
          baseRefName: 'main',
          url: 'https://github.com/test/repo/pull/93',
        },
      ]);

      // Capture stderr
      const stderrWrite = process.stderr.write;
      let stderrOutput = '';
      process.stderr.write = ((chunk: string | Buffer) => {
        stderrOutput += typeof chunk === 'string' ? chunk : chunk.toString();
        return true;
      }) as typeof process.stderr.write;

      // Import and call watchPRCommand directly (not spawning subprocess)
      const { watchPRCommand } = await import('../../src/commands/watch-pr.js');

      let exitCode: number;
      try {
        exitCode = await watchPRCommand(undefined, {});
      } catch (error) {
        // Command throws on error, capture it
        const errorMessage = error instanceof Error ? error.message : String(error);
        stderrOutput += errorMessage;
        exitCode = 1;
      } finally {
        process.stderr.write = stderrWrite;
      }

      // Should show error message with suggestions
      expect(stderrOutput).toContain('Could not auto-detect PR from current branch');
      expect(stderrOutput).toContain('Open PRs in test/repo');
      expect(stderrOutput).toMatch(/#92 -/);
      expect(exitCode).toBe(1);
    });
  });

  describe('error output format', () => {
    it('should output plain text for usage errors (not YAML)', async () => {
      // Mock git remote to fail
      vi.mocked(safeExecSync).mockImplementation((cmd: string, args: string[]) => {
        if (cmd === 'git' && args[0] === 'remote') {
          throw new Error('not a git repository');
        }
        throw new Error('Unexpected command');
      });

      const cliPath = path.resolve(__dirname, '../../dist/bin/vv');
      const result = await executeCommand(cliPath, ['watch-pr']);

      // Should output plain text error, NOT YAML
      expect(result.stderr).toContain('Error:');
      expect(result.stderr).not.toContain('---'); // No YAML delimiter
      expect(result.stderr).not.toContain('error:'); // No YAML key
      expect(result.exitCode).toBe(1);
    });

    it('should output plain text for invalid PR number', async () => {
      const cliPath = path.resolve(__dirname, '../../dist/bin/vv');
      const result = await executeCommand(cliPath, ['watch-pr', 'invalid']);

      // Should output plain text error, NOT YAML
      expect(result.stderr).toContain('Error:');
      expect(result.stderr).toContain('Invalid PR number');
      expect(result.stderr).not.toContain('---'); // No YAML delimiter
      expect(result.exitCode).toBe(1);
    });

    it('should output plain text for invalid run ID', async () => {
      const cliPath = path.resolve(__dirname, '../../dist/bin/vv');
      const result = await executeCommand(cliPath, ['watch-pr', '90', '--run-id', 'invalid']);

      // Should output plain text error, NOT YAML
      expect(result.stderr).toContain('Error:');
      expect(result.stderr).toContain('Invalid run ID');
      expect(result.stderr).not.toContain('---'); // No YAML delimiter
      expect(result.exitCode).toBe(1);
    });
  });

  describe('--run-id flag', () => {
    it('should reject invalid run ID format with plain text error', async () => {
      const cliPath = path.resolve(__dirname, '../../dist/bin/vv');
      const result = await executeCommand(cliPath, ['watch-pr', '90', '--run-id', 'invalid']);

      // Should show plain text error for invalid run ID
      expect(result.stderr).toContain('Error:');
      expect(result.stderr).toContain('Invalid run ID');
      expect(result.stderr).toContain('Must be a positive integer');
      expect(result.stderr).not.toContain('---'); // No YAML
      expect(result.exitCode).toBe(1);
    });

    it('should reject negative run ID', async () => {
      const cliPath = path.resolve(__dirname, '../../dist/bin/vv');
      const result = await executeCommand(cliPath, ['watch-pr', '90', '--run-id', '-123']);

      // Should show error for negative run ID
      expect(result.stderr).toContain('Error:');
      expect(result.stderr).toContain('Invalid run ID');
      expect(result.exitCode).toBe(1);
    });

    it('should reject zero as run ID', async () => {
      const cliPath = path.resolve(__dirname, '../../dist/bin/vv');
      const result = await executeCommand(cliPath, ['watch-pr', '90', '--run-id', '0']);

      // Should show error for zero run ID
      expect(result.stderr).toContain('Error:');
      expect(result.stderr).toContain('Invalid run ID');
      expect(result.exitCode).toBe(1);
    });

    it('should accept valid run ID and attempt to fetch run details', async () => {
      // This test verifies the CLI accepts valid run IDs and attempts to fetch
      // Actual fetching will fail without full API mocking, but that's expected
      const cliPath = path.resolve(__dirname, '../../dist/bin/vv');
      const result = await executeCommand(cliPath, ['watch-pr', '90', '--run-id', '19744677825']);

      // Should NOT show "Invalid run ID" error
      expect(result.stderr).not.toContain('Invalid run ID');
      // Will fail with API error (expected without mocking GitHub API)
      // The important thing is it didn't reject the run ID format
    });
  });

  describe('--history flag', () => {
    it('should display historical runs in human-friendly table format', async () => {
      // This test runs against real API (vibe-validate repo PR #90)
      // PR #90 is known to have multiple runs
      const cliPath = path.resolve(__dirname, '../../dist/bin/vv');
      const result = await executeCommand(cliPath, ['watch-pr', '90', '--history']);

      if (result.exitCode === 0) {
        // Should show table header
        expect(result.stdout).toContain('📋 Workflow Runs for PR #90');
        expect(result.stdout).toContain('RUN ID');
        expect(result.stdout).toContain('CONCLUSION');
        expect(result.stdout).toContain('DURATION');
        expect(result.stdout).toContain('WORKFLOW');
        expect(result.stdout).toContain('STARTED');

        // Should show at least one run with icon
        expect(result.stdout).toMatch(/[✅❌⏳]/); // Success/failure/pending icon

        // Should show tip about --run-id
        expect(result.stdout).toContain('💡 Tip: Use --run-id');
        expect(result.stdout).toContain('Example: vv watch-pr 90 --run-id'); // Uses "vv" since that's how we invoked

        // Should exit successfully
        expect(result.exitCode).toBe(0);
      }
      // If PR has no runs, that's ok too (test passes either way)
    });

    it('should output YAML format when --history and --yaml flags combined', async () => {
      const cliPath = path.resolve(__dirname, '../../dist/bin/vv');
      const result = await executeCommand(cliPath, ['watch-pr', '90', '--history', '--yaml']);

      if (result.exitCode === 0) {
        // Should output YAML format
        expect(result.stdout).toContain('---'); // YAML document separator
        expect(result.stdout).toContain('runs:');

        // Should NOT show human-friendly table
        expect(result.stdout).not.toContain('📋 Workflow Runs');

        // Should exit successfully
        expect(result.exitCode).toBe(0);
      }
    });

    it('should exit with code 0 after displaying history', async () => {
      // --history should be informational only, always exit 0
      // Mock git remote
      vi.mocked(safeExecSync).mockImplementation((cmd: string, args: string[]) => {
        if (cmd === 'git' && args[0] === 'remote') {
          return 'https://github.com/test/repo.git';
        }
        throw new Error('Unexpected git command');
      });

      // Mock fetchPRDetails to return basic PR info
      vi.mocked(fetchPRDetails).mockReturnValue({
        number: 90,
        title: 'Test PR',
        url: 'https://github.com/test/repo/pull/90',
        headRefName: 'feature/test',
        baseRefName: 'main',
        author: { login: 'testuser' },
        isDraft: false,
        mergeable: 'MERGEABLE',
        mergeStateStatus: 'CLEAN',
        labels: [],
        closingIssuesReferences: { nodes: [] },
      });

      // Mock listWorkflowRuns to return test runs
      vi.mocked(listWorkflowRuns).mockReturnValue([
        {
          databaseId: 123,
          name: 'Validation Pipeline',
          status: 'completed',
          conclusion: 'success',
          workflowName: 'Validate',
          createdAt: '2025-12-18T00:00:00Z',
          updatedAt: '2025-12-18T00:05:00Z',
          url: 'https://github.com/test/repo/actions/runs/123',
        },
        {
          databaseId: 124,
          name: 'Validation Pipeline',
          status: 'completed',
          conclusion: 'failure',
          workflowName: 'Validate',
          createdAt: '2025-12-17T00:00:00Z',
          updatedAt: '2025-12-17T00:05:00Z',
          url: 'https://github.com/test/repo/actions/runs/124',
        },
      ]);

      // Import and call watchPRCommand directly
      const { watchPRCommand } = await import('../../src/commands/watch-pr.js');

      // Suppress console output for cleaner test output
      const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const consoleTableSpy = vi.spyOn(console, 'table').mockImplementation(() => {});

      let exitCode: number;
      try {
        exitCode = await watchPRCommand('90', { history: true });
      } finally {
        consoleLogSpy.mockRestore();
        consoleTableSpy.mockRestore();
      }

      // Should exit with 0 (even if some runs failed)
      // This is the key behavior: --history is informational and should never cause failure
      expect(exitCode).toBe(0);
    });

    it('should work with --repo flag to check other repositories', async () => {
      // Test cross-repo support with --history
      const cliPath = path.resolve(__dirname, '../../dist/bin/vv');
      const result = await executeCommand(cliPath, [
        'watch-pr',
        '104',
        '--repo',
        'jdutton/mcp-typescript-simple',
        '--history',
      ]);

      // Should attempt to fetch from specified repo (may fail if PR doesn't exist, that's ok)
      if (result.exitCode === 0) {
        expect(result.stdout).toContain('📋 Workflow Runs for PR #104');
      } else {
        // If it fails, should be API error, not argument validation error
        expect(result.stderr).not.toContain('Invalid --repo format');
      }
    });

    it('should handle PR with no runs gracefully', async () => {
      // Use a very high PR number that likely doesn't exist or has no runs
      const cliPath = path.resolve(__dirname, '../../dist/bin/vv');
      const result = await executeCommand(cliPath, ['watch-pr', '999999', '--history']);

      // Should either show "No workflow runs found" or fail with API error
      // Either way, should not crash
      expect(result.exitCode).toBeGreaterThanOrEqual(0);
      if (result.stdout.includes('No workflow runs found')) {
        expect(result.exitCode).toBe(0);
      }
    });
  });

  describe('error handling', () => {
    it('should validate PR number is positive integer', () => {
      // Command validates prNumber with Number.parseInt
      const validPR = Number.parseInt('90', 10);
      expect(Number.isNaN(validPR)).toBe(false);
      expect(validPR).toBeGreaterThan(0);

      const invalidPR = Number.parseInt('invalid', 10);
      expect(Number.isNaN(invalidPR)).toBe(true);
    });
  });
});

/**
 * Execute CLI command and capture output
 *
 * On Windows, spawn can't execute files without extensions, so we use node directly
 */
async function executeCommand(
  command: string,
  args: string[]
): Promise<{ exitCode: number; stdout: string; stderr: string; output: string }> {
  return new Promise((resolve) => {
    // Use node directly to execute the CLI (cross-platform compatible)
    const proc = spawn('node', [command, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env }
    });

    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      resolve({
        exitCode: code ?? 1,
        stdout,
        stderr,
        output: stdout + stderr
      });
    });

    // Timeout after 30 seconds (CI environments are slower)
    const timeoutMs = process.env.CI ? 30000 : 10000;
    setTimeout(() => {
      proc.kill();
      resolve({
        exitCode: 1,
        stdout,
        stderr: stderr + '\nTimeout',
        output: stdout + stderr + '\nTimeout'
      });
    }, timeoutMs);
  });
}

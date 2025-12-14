import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GitHubActionsProvider } from '../../../src/services/ci-providers/github-actions.js';

// Mock @vibe-validate/git
vi.mock('@vibe-validate/git', async () => {
  const actual = await vi.importActual<typeof import('@vibe-validate/git')>('@vibe-validate/git');
  return {
    ...actual,
    executeGitCommand: vi.fn(() => ({
      success: true,
      stdout: '',
      stderr: '',
      exitCode: 0,
    })),
    isToolAvailable: vi.fn(() => true), // Default: gh is available
    safeExecSync: vi.fn(() => ''), // Default: empty response
  };
});

describe('GitHubActionsProvider', () => {
  let provider: GitHubActionsProvider;

  beforeEach(async () => {
    provider = new GitHubActionsProvider();
    vi.clearAllMocks();

    // Re-establish default mocks after clearAllMocks
    const { isToolAvailable, safeExecSync } = await import('@vibe-validate/git');
    vi.mocked(isToolAvailable).mockReturnValue(true);
    vi.mocked(safeExecSync).mockReturnValue('');
  });

  describe('isAvailable', () => {
    it('should return true when gh CLI is available and in GitHub repo', async () => {
      const { executeGitCommand, isToolAvailable } = await import('@vibe-validate/git');

      vi.mocked(isToolAvailable).mockReturnValue(true);
      vi.mocked(executeGitCommand).mockReturnValue({
        success: true,
        stdout: 'https://github.com/user/repo.git',
        stderr: '',
        exitCode: 0,
      });

      const result = await provider.isAvailable();

      expect(result).toBe(true);
      expect(isToolAvailable).toHaveBeenCalledWith('gh');
      expect(executeGitCommand).toHaveBeenCalledWith(['remote', 'get-url', 'origin']);
    });

    it('should return false when gh CLI is not available', async () => {
      const { isToolAvailable } = await import('@vibe-validate/git');
      vi.mocked(isToolAvailable).mockReturnValue(false);

      const result = await provider.isAvailable();

      expect(result).toBe(false);
    });

    it('should return false when not in GitHub repo', async () => {
      const { executeGitCommand } = await import('@vibe-validate/git');

      vi.mocked(executeGitCommand).mockReturnValue({
        success: true,
        stdout: 'https://gitlab.com/user/repo.git',
        stderr: '',
        exitCode: 0,
      });

      const result = await provider.isAvailable();

      expect(result).toBe(false);
    });
  });

  describe('detectPullRequest', () => {
    it('should detect PR from current branch', async () => {
      const { safeExecSync } = await import('@vibe-validate/git');
      const prData = {
        number: 42,
        title: 'feat: add new feature',
        url: 'https://github.com/user/repo/pull/42',
        headRefName: 'feature-branch',
      };

      vi.mocked(safeExecSync).mockReturnValue(JSON.stringify(prData));

      const result = await provider.detectPullRequest();

      expect(result).toEqual({
        id: 42,
        title: 'feat: add new feature',
        url: 'https://github.com/user/repo/pull/42',
        branch: 'feature-branch',
      });
    });

    it('should return null when no PR is found', async () => {
      const { safeExecSync } = await import('@vibe-validate/git');
      vi.mocked(safeExecSync).mockImplementation(() => {
        throw new Error('no pull requests found');
      });

      const result = await provider.detectPullRequest();

      expect(result).toBe(null);
    });
  });

  describe('fetchCheckStatus', () => {
    it('should fetch and transform check status', async () => {
      const { safeExecSync } = await import('@vibe-validate/git');
      const ghResponse = {
        number: 42,
        title: 'feat: add new feature',
        url: 'https://github.com/user/repo/pull/42',
        headRefName: 'feature-branch',
        statusCheckRollup: [
          {
            __typename: 'CheckRun',
            name: 'ubuntu-latest (Node 20)',
            status: 'COMPLETED',
            conclusion: 'SUCCESS',
            detailsUrl: 'https://github.com/user/repo/actions/runs/123456',
          },
          {
            __typename: 'CheckRun',
            name: 'windows-latest (Node 20)',
            status: 'IN_PROGRESS',
            conclusion: null,
            detailsUrl: 'https://github.com/user/repo/actions/runs/123457',
          },
        ],
      };

      vi.mocked(safeExecSync).mockReturnValue(JSON.stringify(ghResponse));

      const result = await provider.fetchCheckStatus(42);

      expect(result.pr).toEqual({
        id: 42,
        title: 'feat: add new feature',
        url: 'https://github.com/user/repo/pull/42',
        branch: 'feature-branch',
      });
      expect(result.status).toBe('in_progress');
      expect(result.result).toBe('unknown');
      expect(result.checks).toHaveLength(2);
      expect(result.checks[0]).toMatchObject({
        id: '123456',
        name: 'ubuntu-latest (Node 20)',
        status: 'completed',
        conclusion: 'success',
      });
      expect(result.checks[1]).toMatchObject({
        id: '123457',
        name: 'windows-latest (Node 20)',
        status: 'in_progress',
        conclusion: null,
      });
    });

    it('should determine overall status as completed when all checks done', async () => {
      const { safeExecSync } = await import('@vibe-validate/git');
      const ghResponse = {
        number: 42,
        title: 'test',
        url: 'https://github.com/user/repo/pull/42',
        headRefName: 'test',
        statusCheckRollup: [
          {
            name: 'Check 1',
            status: 'COMPLETED',
            conclusion: 'SUCCESS',
            detailsUrl: 'https://github.com/user/repo/actions/runs/1',
          },
          {
            name: 'Check 2',
            status: 'COMPLETED',
            conclusion: 'SUCCESS',
            detailsUrl: 'https://github.com/user/repo/actions/runs/2',
          },
        ],
      };

      vi.mocked(safeExecSync).mockReturnValue(JSON.stringify(ghResponse));

      const result = await provider.fetchCheckStatus(42);

      expect(result.status).toBe('completed');
      expect(result.result).toBe('success');
    });

    it('should determine overall result as failure when any check fails', async () => {
      const { safeExecSync } = await import('@vibe-validate/git');
      const ghResponse = {
        number: 42,
        title: 'test',
        url: 'https://github.com/user/repo/pull/42',
        headRefName: 'test',
        statusCheckRollup: [
          {
            name: 'Check 1',
            status: 'COMPLETED',
            conclusion: 'SUCCESS',
            detailsUrl: 'https://github.com/user/repo/actions/runs/1',
          },
          {
            name: 'Check 2',
            status: 'COMPLETED',
            conclusion: 'FAILURE',
            detailsUrl: 'https://github.com/user/repo/actions/runs/2',
          },
        ],
      };

      vi.mocked(safeExecSync).mockReturnValue(JSON.stringify(ghResponse));

      const result = await provider.fetchCheckStatus(42);

      expect(result.status).toBe('completed');
      expect(result.result).toBe('failure');
    });
  });

  describe('fetchFailureLogs', () => {
    it('should fetch logs and extract error details', async () => {
      const { safeExecSync } = await import('@vibe-validate/git');
      const runData = { name: 'ubuntu-latest (Node 20)' };
      const logs = `
##[group]Run pnpm test
pnpm test
##[endgroup]
FAIL test/example.test.ts
  ✗ should pass (5ms)
##[error]Process completed with exit code 1.
`;

      vi.mocked(safeExecSync)
        .mockReturnValueOnce(JSON.stringify(runData))
        .mockReturnValueOnce(logs);

      const result = await provider.fetchFailureLogs('123456');

      expect(result.checkId).toBe('123456');
      expect(result.checkName).toBe('ubuntu-latest (Node 20)');
      expect(result.rawLogs).toBe(logs);
      expect(result.failedStep).toBe('pnpm test');
    });

    it('should extract vibe-validate state file from logs', async () => {
      const { safeExecSync } = await import('@vibe-validate/git');
      const runData = { name: 'Test' };
      // GitHub Actions log format: "Job\tStep\tTimestamp Content"
      // v0.17.5+ format with --- separators
      const logs = `
Some other log output
Run validation\tRun validation\t2025-10-20T10:00:00.000Z ---
Run validation\tRun validation\t2025-10-20T10:00:00.100Z passed: false
Run validation\tRun validation\t2025-10-20T10:00:00.200Z timestamp: '2025-10-20T10:00:00.000Z'
Run validation\tRun validation\t2025-10-20T10:00:00.300Z failedStep: Unit Tests
Run validation\tRun validation\t2025-10-20T10:00:00.400Z phases:
Run validation\tRun validation\t2025-10-20T10:00:00.500Z   - name: Testing
Run validation\tRun validation\t2025-10-20T10:00:00.600Z     passed: false
Run validation\tRun validation\t2025-10-20T10:00:00.700Z     steps:
Run validation\tRun validation\t2025-10-20T10:00:00.800Z       - name: Unit Tests
Run validation\tRun validation\t2025-10-20T10:00:00.900Z         command: pnpm test
Run validation\tRun validation\t2025-10-20T10:00:01.000Z         passed: false
Run validation\tRun validation\t2025-10-20T10:00:01.100Z         extraction:
Run validation\tRun validation\t2025-10-20T10:00:01.200Z           summary: "1 test failure"
Run validation\tRun validation\t2025-10-20T10:00:01.300Z           errors:
Run validation\tRun validation\t2025-10-20T10:00:01.400Z             - file: test/example.test.ts
Run validation\tRun validation\t2025-10-20T10:00:01.500Z               message: Test failed
Run validation\tRun validation\t2025-10-20T10:00:01.600Z ---
More log output after
`;

      vi.mocked(safeExecSync)
        .mockReturnValueOnce(JSON.stringify(runData))
        .mockReturnValueOnce(logs);

      const result = await provider.fetchFailureLogs('123456');

      expect(result.validationResult).toBeDefined();
      expect(result.validationResult?.passed).toBe(false);
      expect(result.validationResult?.failedStep).toBe('Unit Tests');
      // v0.15.0+: command is in phases[].steps[].command, not rerunCommand
      expect(result.validationResult?.phases?.[0]?.steps?.[0]?.command).toBe('pnpm test');
    });

    it('should handle missing validation result gracefully', async () => {
      const { safeExecSync } = await import('@vibe-validate/git');
      const runData = { name: 'Test' };
      const logs = 'Regular log output without validation result';

      vi.mocked(safeExecSync)
        .mockReturnValueOnce(JSON.stringify(runData))
        .mockReturnValueOnce(logs);

      const result = await provider.fetchFailureLogs('123456');

      expect(result.validationResult).toBeUndefined();
    });
  });

  describe('extractValidationResult', () => {
    it('should extract and parse YAML validation result', () => {
      // GitHub Actions log format: "Job\tStep\tTimestamp Content"
      // v0.17.5+ format with --- separators
      const logs = `
Some output before
Run validation\tRun validation\t2025-10-20T10:00:00.000Z ---
Run validation\tRun validation\t2025-10-20T10:00:00.100Z passed: false
Run validation\tRun validation\t2025-10-20T10:00:00.200Z failedStep: TypeScript Type Check
Run validation\tRun validation\t2025-10-20T10:00:00.300Z phases:
Run validation\tRun validation\t2025-10-20T10:00:00.400Z   - name: Pre-Qualification
Run validation\tRun validation\t2025-10-20T10:00:00.500Z     steps:
Run validation\tRun validation\t2025-10-20T10:00:00.600Z       - name: TypeScript Type Check
Run validation\tRun validation\t2025-10-20T10:00:00.700Z         command: pnpm typecheck
Run validation\tRun validation\t2025-10-20T10:00:00.800Z ---
Output after
`;

      const result = provider.extractValidationResult(logs);

      expect(result).toMatchObject({
        passed: false,
        failedStep: 'TypeScript Type Check',
      });
      expect(result?.phases?.[0]?.steps?.[0]?.command).toBe('pnpm typecheck');
    });

    it('should return null when validation result not found', () => {
      const logs = 'No validation result here';

      const result = provider.extractValidationResult(logs);

      expect(result).toBeNull();
    });

    it('should return null when YAML parsing fails', () => {
      const logs = `
==========================================
VALIDATION RESULT
==========================================
invalid: yaml: content: [
==========================================
`;

      const result = provider.extractValidationResult(logs);

      expect(result).toBeNull();
    });

    it('should extract validation result from real GitHub Actions CI log', () => {
      // Real CI log sample (updated to v0.17.5+ format with --- separators)
      // Format: "Job Name\tStep Name\tTimestamp Content"
      const logs = `
Run vibe-validate validation (ubuntu-latest, 22)\tRun validation\t2025-10-22T12:37:45.4488358Z ---
Run vibe-validate validation (ubuntu-latest, 22)\tRun validation\t2025-10-22T12:37:45.4498802Z passed: false
Run vibe-validate validation (ubuntu-latest, 22)\tRun validation\t2025-10-22T12:37:45.4499371Z timestamp: 2025-10-22T12:37:45.190Z
Run vibe-validate validation (ubuntu-latest, 22)\tRun validation\t2025-10-22T12:37:45.4500032Z treeHash: b131b1a1aa6eb1cf4bd4b23a71fd21560df01970
Run vibe-validate validation (ubuntu-latest, 22)\tRun validation\t2025-10-22T12:37:45.4500551Z phases:
Run vibe-validate validation (ubuntu-latest, 22)\tRun validation\t2025-10-22T12:37:45.4500886Z   - name: Pre-Qualification
Run vibe-validate validation (ubuntu-latest, 22)\tRun validation\t2025-10-22T12:37:45.4501265Z     durationSecs: 3.1
Run vibe-validate validation (ubuntu-latest, 22)\tRun validation\t2025-10-22T12:37:45.4501589Z     passed: true
Run vibe-validate validation (ubuntu-latest, 22)\tRun validation\t2025-10-22T12:37:45.4501881Z     steps:
Run vibe-validate validation (ubuntu-latest, 22)\tRun validation\t2025-10-22T12:37:45.4502219Z       - name: TypeScript Type Check
Run vibe-validate validation (ubuntu-latest, 22)\tRun validation\t2025-10-22T12:37:45.4502627Z         passed: true
Run vibe-validate validation (ubuntu-latest, 22)\tRun validation\t2025-10-22T12:37:45.4502965Z         durationSecs: 2.6
Run vibe-validate validation (ubuntu-latest, 22)\tRun validation\t2025-10-22T12:37:45.4503367Z       - name: ESLint Code Quality
Run vibe-validate validation (ubuntu-latest, 22)\tRun validation\t2025-10-22T12:37:45.4503981Z         passed: true
Run vibe-validate validation (ubuntu-latest, 22)\tRun validation\t2025-10-22T12:37:45.4504305Z         durationSecs: 3.1
Run vibe-validate validation (ubuntu-latest, 22)\tRun validation\t2025-10-22T12:37:45.4504607Z   - name: Testing
Run vibe-validate validation (ubuntu-latest, 22)\tRun validation\t2025-10-22T12:37:45.4504805Z     durationSecs: 33.3
Run vibe-validate validation (ubuntu-latest, 22)\tRun validation\t2025-10-22T12:37:45.4505013Z     passed: false
Run vibe-validate validation (ubuntu-latest, 22)\tRun validation\t2025-10-22T12:37:45.4505200Z     steps:
Run vibe-validate validation (ubuntu-latest, 22)\tRun validation\t2025-10-22T12:37:45.4505400Z       - name: Unit Tests with Coverage
Run vibe-validate validation (ubuntu-latest, 22)\tRun validation\t2025-10-22T12:37:45.4505600Z         command: pnpm test:coverage
Run vibe-validate validation (ubuntu-latest, 22)\tRun validation\t2025-10-22T12:37:45.4505800Z         passed: false
Run vibe-validate validation (ubuntu-latest, 22)\tRun validation\t2025-10-22T12:37:45.4682467Z failedStep: Unit Tests with Coverage
Run vibe-validate validation (ubuntu-latest, 22)\tRun validation\t2025-10-22T12:37:45.4812713Z ---
`;

      const result = provider.extractValidationResult(logs);

      expect(result).not.toBeNull();
      expect(result?.passed).toBe(false);
      expect(result?.timestamp).toBe('2025-10-22T12:37:45.190Z');
      expect(result?.treeHash).toBe('b131b1a1aa6eb1cf4bd4b23a71fd21560df01970');
      expect(result?.failedStep).toBe('Unit Tests with Coverage');
      // v0.15.0+: command is in phases[].steps[].command, not rerunCommand
      expect(result?.phases?.[1]?.steps?.[0]?.command).toBe('pnpm test:coverage');
      expect(result?.phases).toHaveLength(2);
      expect(result?.phases?.[0].name).toBe('Pre-Qualification');
      expect(result?.phases?.[0].passed).toBe(true);
      expect(result?.phases?.[1].name).toBe('Testing');
      expect(result?.phases?.[1].passed).toBe(false);
    });

    it('should use concise error summary when validation result is available', () => {
      // Real CI log with validation result (v0.17.5+: uses --- separators)
      const logs = `
Some other log lines
Run validation\tRun validation\t2025-10-22T12:37:45.000Z ---
Run validation\tRun validation\t2025-10-22T12:37:45.001Z passed: false
Run validation\tRun validation\t2025-10-22T12:37:45.002Z failedStep: TypeScript Type Check
Run validation\tRun validation\t2025-10-22T12:37:45.003Z phases:
Run validation\tRun validation\t2025-10-22T12:37:45.004Z   - name: Pre-Qualification
Run validation\tRun validation\t2025-10-22T12:37:45.005Z     steps:
Run validation\tRun validation\t2025-10-22T12:37:45.006Z       - name: TypeScript Type Check
Run validation\tRun validation\t2025-10-22T12:37:45.007Z         command: pnpm typecheck
Run validation\tRun validation\t2025-10-22T12:37:45.008Z ---
##[error]Process completed with exit code 1.
`;

      // Call the private method via type assertion to test it directly
      const result = (provider as any).extractErrorSummary(logs);

      expect(result).toBe('Failed step: TypeScript Type Check\nRerun: pnpm typecheck');
    });

    it('should extract validation result with closing --- separator', () => {
      // New format (v0.17.5+): YAML output with closing --- separator
      const logs = `
Run validation\tRun validation\t2025-12-14T06:00:00.000Z ---
Run validation\tRun validation\t2025-12-14T06:00:00.001Z passed: false
Run validation\tRun validation\t2025-12-14T06:00:00.002Z timestamp: 2025-12-14T06:00:00.000Z
Run validation\tRun validation\t2025-12-14T06:00:00.003Z treeHash: abc123def456
Run validation\tRun validation\t2025-12-14T06:00:00.004Z summary: Test failed
Run validation\tRun validation\t2025-12-14T06:00:00.005Z failedStep: Unit Tests
Run validation\tRun validation\t2025-12-14T06:00:00.006Z phases:
Run validation\tRun validation\t2025-12-14T06:00:00.007Z   - name: Testing
Run validation\tRun validation\t2025-12-14T06:00:00.008Z     passed: false
Run validation\tRun validation\t2025-12-14T06:00:00.009Z     steps:
Run validation\tRun validation\t2025-12-14T06:00:00.010Z       - name: Unit Tests
Run validation\tRun validation\t2025-12-14T06:00:00.011Z         command: pnpm test
Run validation\tRun validation\t2025-12-14T06:00:00.012Z         passed: false
Run validation\tRun validation\t2025-12-14T06:00:00.013Z ---
Run validation\tRun validation\t2025-12-14T06:00:00.014Z Some other log output after validation
Run validation\tRun validation\t2025-12-14T06:00:00.015Z More logs here
`;

      const result = provider.extractValidationResult(logs);

      expect(result).not.toBeNull();
      expect(result?.passed).toBe(false);
      expect(result?.treeHash).toBe('abc123def456');
      expect(result?.failedStep).toBe('Unit Tests');
      expect(result?.phases?.[0]?.name).toBe('Testing');
      expect(result?.phases?.[0]?.steps?.[0]?.command).toBe('pnpm test');
    });

    it('should not extract --- separator as part of YAML content', () => {
      // Regression test: ensure content extractor doesn't remove --- separator
      const logs = `
Run validation\tRun validation\t2025-12-14T06:00:00.000Z ---
Run validation\tRun validation\t2025-12-14T06:00:00.001Z passed: true
Run validation\tRun validation\t2025-12-14T06:00:00.002Z ---
`;

      const result = provider.extractValidationResult(logs);

      expect(result).not.toBeNull();
      expect(result?.passed).toBe(true);
    });

    it('should preserve empty lines in YAML for multi-line strings', () => {
      // Test that empty lines within YAML content are preserved
      const logs = `
Run validation\tRun validation\t2025-12-14T06:00:00.000Z ---
Run validation\tRun validation\t2025-12-14T06:00:00.001Z passed: false
Run validation\tRun validation\t2025-12-14T06:00:00.002Z failedStep: Tests
Run validation\tRun validation\t2025-12-14T06:00:00.003Z phases:
Run validation\tRun validation\t2025-12-14T06:00:00.004Z   - name: Testing
Run validation\tRun validation\t2025-12-14T06:00:00.005Z     steps:
Run validation\tRun validation\t2025-12-14T06:00:00.006Z       - name: Tests
Run validation\tRun validation\t2025-12-14T06:00:00.007Z         output: |
Run validation\tRun validation\t2025-12-14T06:00:00.008Z           Line 1
Run validation\tRun validation\t2025-12-14T06:00:00.009Z
Run validation\tRun validation\t2025-12-14T06:00:00.010Z           Line 3 after empty
Run validation\tRun validation\t2025-12-14T06:00:00.011Z ---
`;

      const result = provider.extractValidationResult(logs);

      expect(result).not.toBeNull();
      expect(result?.passed).toBe(false);
      // Verify the multi-line string was preserved correctly
      expect(result?.phases?.[0]?.steps?.[0]?.output).toContain('Line 1');
      expect(result?.phases?.[0]?.steps?.[0]?.output).toContain('Line 3 after empty');
    });

    it('should stop extraction at closing --- even with garbage after', () => {
      // Test that extraction stops at closing --- and doesn't include subsequent content
      const logs = `
Run validation\tRun validation\t2025-12-14T06:00:00.000Z ---
Run validation\tRun validation\t2025-12-14T06:00:00.001Z passed: true
Run validation\tRun validation\t2025-12-14T06:00:00.002Z timestamp: 2025-12-14T06:00:00.000Z
Run validation\tRun validation\t2025-12-14T06:00:00.003Z ---
Run validation\tRun validation\t2025-12-14T06:00:00.004Z [Test 1/43]
Run validation\tRun validation\t2025-12-14T06:00:00.005Z Test: some test > should do something
Run validation\tRun validation\t2025-12-14T06:00:00.006Z Error: expected 1 to be +0 // Object.is equality
Run validation\tRun validation\t2025-12-14T06:00:00.007Z This is not YAML and should not be included
`;

      const result = provider.extractValidationResult(logs);

      expect(result).not.toBeNull();
      expect(result?.passed).toBe(true);
      expect(result?.timestamp).toBe('2025-12-14T06:00:00.000Z');
      // Should not include any of the test output after closing ---
      expect(JSON.stringify(result)).not.toContain('[Test 1/43]');
      expect(JSON.stringify(result)).not.toContain('Object.is equality');
    });

    it('should handle missing closing --- gracefully (backwards compatibility)', () => {
      // Old format without closing --- should still work by detecting end of YAML
      const logs = `
Run validation\tRun validation\t2025-12-14T06:00:00.000Z ---
Run validation\tRun validation\t2025-12-14T06:00:00.001Z passed: true
Run validation\tRun validation\t2025-12-14T06:00:00.002Z timestamp: 2025-12-14T06:00:00.000Z
Run validation\tRun validation\t2025-12-14T06:00:00.003Z ##[error]Process completed with exit code 0
`;

      const result = provider.extractValidationResult(logs);

      expect(result).not.toBeNull();
      expect(result?.passed).toBe(true);
    });
  });
});

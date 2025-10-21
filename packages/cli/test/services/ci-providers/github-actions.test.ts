import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execSync } from 'node:child_process';
import { GitHubActionsProvider } from '../../../src/services/ci-providers/github-actions.js';

// Mock child_process
vi.mock('node:child_process');

describe('GitHubActionsProvider', () => {
  let provider: GitHubActionsProvider;

  beforeEach(() => {
    provider = new GitHubActionsProvider();
    vi.clearAllMocks();
  });

  describe('isAvailable', () => {
    it('should return true when gh CLI is available and in GitHub repo', async () => {
      vi.mocked(execSync)
        .mockReturnValueOnce(Buffer.from('gh version 2.40.0'))
        .mockReturnValueOnce(Buffer.from('https://github.com/user/repo.git'));

      const result = await provider.isAvailable();

      expect(result).toBe(true);
      expect(execSync).toHaveBeenCalledWith('gh --version', { stdio: 'ignore' });
      expect(execSync).toHaveBeenCalledWith('git remote get-url origin', { encoding: 'utf8' });
    });

    it('should return false when gh CLI is not available', async () => {
      vi.mocked(execSync).mockImplementationOnce(() => {
        throw new Error('gh: command not found');
      });

      const result = await provider.isAvailable();

      expect(result).toBe(false);
    });

    it('should return false when not in GitHub repo', async () => {
      vi.mocked(execSync)
        .mockReturnValueOnce(Buffer.from('gh version 2.40.0'))
        .mockReturnValueOnce(Buffer.from('https://gitlab.com/user/repo.git'));

      const result = await provider.isAvailable();

      expect(result).toBe(false);
    });
  });

  describe('detectPullRequest', () => {
    it('should detect PR from current branch', async () => {
      const prData = {
        number: 42,
        title: 'feat: add new feature',
        url: 'https://github.com/user/repo/pull/42',
        headRefName: 'feature-branch',
      };

      vi.mocked(execSync).mockReturnValueOnce(Buffer.from(JSON.stringify(prData)));

      const result = await provider.detectPullRequest();

      expect(result).toEqual({
        id: 42,
        title: 'feat: add new feature',
        url: 'https://github.com/user/repo/pull/42',
        branch: 'feature-branch',
      });
    });

    it('should return null when no PR is found', async () => {
      vi.mocked(execSync).mockImplementationOnce(() => {
        throw new Error('no pull requests found');
      });

      const result = await provider.detectPullRequest();

      expect(result).toBe(null);
    });
  });

  describe('fetchCheckStatus', () => {
    it('should fetch and transform check status', async () => {
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

      vi.mocked(execSync).mockReturnValueOnce(Buffer.from(JSON.stringify(ghResponse)));

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

      vi.mocked(execSync).mockReturnValueOnce(Buffer.from(JSON.stringify(ghResponse)));

      const result = await provider.fetchCheckStatus(42);

      expect(result.status).toBe('completed');
      expect(result.result).toBe('success');
    });

    it('should determine overall result as failure when any check fails', async () => {
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

      vi.mocked(execSync).mockReturnValueOnce(Buffer.from(JSON.stringify(ghResponse)));

      const result = await provider.fetchCheckStatus(42);

      expect(result.status).toBe('completed');
      expect(result.result).toBe('failure');
    });
  });

  describe('fetchFailureLogs', () => {
    it('should fetch logs and extract error details', async () => {
      const runData = { name: 'ubuntu-latest (Node 20)' };
      const logs = `
##[group]Run pnpm test
pnpm test
##[endgroup]
FAIL test/example.test.ts
  ✗ should pass (5ms)
##[error]Process completed with exit code 1.
`;

      vi.mocked(execSync)
        .mockReturnValueOnce(JSON.stringify(runData) as any)
        .mockReturnValueOnce(logs as any);

      const result = await provider.fetchFailureLogs('123456');

      expect(result.checkId).toBe('123456');
      expect(result.checkName).toBe('ubuntu-latest (Node 20)');
      expect(result.rawLogs).toBe(logs);
      expect(result.failedStep).toBe('pnpm test');
    });

    it('should extract vibe-validate state file from logs', async () => {
      const runData = { name: 'Test' };
      const logs = `
Some other log output
==========================================
📋 VALIDATION STATE FILE CONTENTS
==========================================
passed: false
timestamp: '2025-10-20T10:00:00.000Z'
failedStep: Unit Tests
rerunCommand: pnpm test
failedStepOutput: |
  FAIL test/example.test.ts
==========================================
More log output after
`;

      vi.mocked(execSync)
        .mockReturnValueOnce(JSON.stringify(runData) as any)
        .mockReturnValueOnce(logs as any);

      const result = await provider.fetchFailureLogs('123456');

      expect(result.stateFile).toBeDefined();
      expect(result.stateFile?.passed).toBe(false);
      expect(result.stateFile?.failedStep).toBe('Unit Tests');
      expect(result.stateFile?.rerunCommand).toBe('pnpm test');
    });

    it('should handle missing state file gracefully', async () => {
      const runData = { name: 'Test' };
      const logs = 'Regular log output without state file';

      vi.mocked(execSync)
        .mockReturnValueOnce(JSON.stringify(runData) as any)
        .mockReturnValueOnce(logs as any);

      const result = await provider.fetchFailureLogs('123456');

      expect(result.stateFile).toBeUndefined();
    });
  });

  describe('extractStateFile', () => {
    it('should extract and parse YAML state file', () => {
      const logs = `
Some output before
==========================================
📋 VALIDATION STATE FILE CONTENTS
==========================================
passed: false
failedStep: TypeScript Type Check
rerunCommand: pnpm typecheck
==========================================
Output after
`;

      const result = provider.extractStateFile(logs);

      expect(result).toEqual({
        passed: false,
        failedStep: 'TypeScript Type Check',
        rerunCommand: 'pnpm typecheck',
      });
    });

    it('should return null when state file not found', () => {
      const logs = 'No state file here';

      const result = provider.extractStateFile(logs);

      expect(result).toBeNull();
    });

    it('should return null when YAML parsing fails', () => {
      const logs = `
==========================================
📋 VALIDATION STATE FILE CONTENTS
==========================================
invalid: yaml: content: [
==========================================
`;

      const result = provider.extractStateFile(logs);

      expect(result).toBeNull();
    });
  });
});

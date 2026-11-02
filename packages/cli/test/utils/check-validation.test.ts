/**
 * Tests for check-validation utility
 *
 * This module uses git notes instead of state files. The note is served through
 * readHistoryNote; the cache and retry lookups are the real pure functions.
 */

import './validate-workflow-test-setup.js';

import type { VibeValidateConfig } from '@vibe-validate/config';
import * as git from '@vibe-validate/git';
import * as history from '@vibe-validate/history';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { checkValidationStatus } from '../../src/utils/check-validation.js';
import {
  createValidationRun,
  createPhaseResult,
  expectConsoleOutput,
  expectProcessExit,
  expectYamlOutput,
  expectNoConsoleOutput
} from '../helpers/validation-test-helpers.js';

/**
 * Helper: Mock getGitTreeHash with TreeHashResult
 */
function mockTreeHash(hash = 'abc123def456', submoduleHashes?: Record<string, string>): void {
  // Cast string hashes to TreeHash type for mock
  const typedSubmoduleHashes = submoduleHashes
    ? Object.fromEntries(
        Object.entries(submoduleHashes).map(([path, hash]) => [path, hash as git.TreeHash])
      )
    : undefined;

  vi.mocked(git.getGitTreeHash).mockResolvedValue({
    hash: hash as git.TreeHash,
    ...(typedSubmoduleHashes && { submoduleHashes: typedSubmoduleHashes })
  });
}

/**
 * Helper: Serve runs (oldest first) as the tree's history note, or no note at all
 */
function serveRuns(runs: Array<ReturnType<typeof createValidationRunFromNote>> | null, treeHash = 'abc123def456'): void {
  vi.mocked(history.readHistoryNote).mockResolvedValue(runs === null ? null : { treeHash, runs });
}

/** Every console.log call so far, each call's arguments joined, one line per call */
function loggedText(): string {
  return vi.mocked(console.log).mock.calls.map(call => call.join(' ')).join('\n');
}

const TWO_LEVELS: VibeValidateConfig = { validation: { levels: ['commit', 'full'], phases: [] } };

/**
 * Helper: Create common two-phase test structure (Pre-Qualification + Testing)
 * with flexible pass/fail settings for each step
 */
function createTwoPhaseStructure(testingPassed: boolean) {
  return [
    createPhaseResult({
      name: 'Pre-Qualification',
      passed: true,
      steps: [
        { name: 'TypeScript', passed: true, durationSecs: 1.2 },
        { name: 'ESLint', passed: true, durationSecs: 1.3 }
      ]
    }),
    createPhaseResult({
      name: 'Testing',
      passed: testingPassed,
      steps: [
        { name: 'Unit Tests', passed: testingPassed, durationSecs: 2.5 }
      ]
    })
  ];
}

/**
 * Helper: Create ValidationRun from ValidationRun options
 */
function createValidationRunFromNote(options: Parameters<typeof createValidationRun>[0]) {
  const run = createValidationRun(options);
  return {
    id: run.id,
    timestamp: run.timestamp,
    duration: run.duration,
    passed: run.passed,
    level: run.level,
    branch: run.branch,
    headCommit: run.headCommit,
    uncommittedChanges: run.uncommittedChanges,
    ...(run.submoduleHashes ? { submoduleHashes: run.submoduleHashes } : {}),
    result: run.result,
  };
}

/** Report a cached failed run of one parallel phase; return the logged lines. */
async function reportCachedFailure(
  steps: Array<{ name: string; passed: boolean; stoppedByFailFast?: boolean; durationSecs: number }>,
  config: VibeValidateConfig,
  failedStep?: string
): Promise<string[]> {
  const failedRun = createValidationRunFromNote({
    passed: false,
    phases: [createPhaseResult({ name: 'Checks', passed: false, steps })],
  });
  if (failedStep) {
    failedRun.result = { ...failedRun.result, failedStep };
  }

  mockTreeHash();
  serveRuns([failedRun]);

  await expect(checkValidationStatus(config, 'full')).rejects.toThrow(expectProcessExit(1));

  return vi.mocked(console.log).mock.calls.map(call => call.join(' '));
}

describe('checkValidationStatus', () => {
  let mockConfig: VibeValidateConfig;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let processExitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockConfig = {
      validation: {
        phases: []
      }
    };

    // Mock console.log
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    // Mock process.exit to prevent actual exit
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation((code?: number | string) => {
      throw new Error(`process.exit(${code ?? 0})`);
    });

    // Reset mocks
    vi.mocked(git.getGitTreeHash).mockReset();
    vi.mocked(history.readHistoryNote).mockReset();
  });

  describe('when not in git repository', () => {
    it('should exit with code 2 and show error', async () => {
      vi.mocked(git.getGitTreeHash).mockRejectedValue(new Error('Not a git repository'));

      await expect(checkValidationStatus(mockConfig, 'full')).rejects.toThrow(expectProcessExit(2));

      expectConsoleOutput(consoleLogSpy, ['Not in git repository']);
      expect(processExitSpy).toHaveBeenCalledWith(2);
    });
  });

  describe('when no validation history exists', () => {
    it('should exit with code 2 when there is no note', async () => {
      mockTreeHash();
      serveRuns(null);

      await expect(checkValidationStatus(mockConfig, 'full')).rejects.toThrow(expectProcessExit(2));

      expectConsoleOutput(consoleLogSpy, [
        'No validation at level full for current working tree',
        'Tree hash: abc123def456'
      ]);
      expect(processExitSpy).toHaveBeenCalledWith(2);
    });

    it('should exit with code 2 when the note holds no runs', async () => {
      mockTreeHash();
      serveRuns([]);

      await expect(checkValidationStatus(mockConfig, 'full')).rejects.toThrow(expectProcessExit(2));

      expect(processExitSpy).toHaveBeenCalledWith(2);
    });
  });

  describe('levels', () => {
    it('exits 2 when only an earlier level passed: a commit pass does not answer full', async () => {
      mockTreeHash();
      serveRuns([createValidationRunFromNote({ passed: true, level: 'commit' })]);

      await expect(checkValidationStatus(TWO_LEVELS, 'full')).rejects.toThrow(expectProcessExit(2));

      expectConsoleOutput(consoleLogSpy, ['No validation at level full for current working tree']);
    });

    it('exits 0 when a later level passed: a full pass covers commit', async () => {
      mockTreeHash();
      serveRuns([createValidationRunFromNote({ passed: true, level: 'full' })]);

      await expect(checkValidationStatus(TWO_LEVELS, 'commit')).rejects.toThrow(expectProcessExit(0));

      expectConsoleOutput(consoleLogSpy, ['Validation passed for this code', 'Level: full (covers commit)']);
    });

    it('exits 1 when the newest run failed at another level, and points at the requested level', async () => {
      mockTreeHash();
      serveRuns([createValidationRunFromNote({ passed: false, level: 'full' })]);

      await expect(checkValidationStatus(TWO_LEVELS, 'commit')).rejects.toThrow(expectProcessExit(1));

      const logged = loggedText();
      for (const expected of ['The newest run bearing on level commit failed for this code', 'It ran at level full', 'state --level commit', 'validate --level commit']) {
        expect(logged).toContain(expected);
      }
    });

    it('names the requested level when a newer pass at an earlier level does not decide', async () => {
      // commit red, then commit green: the green does not cover full, so the red decides full.
      // `state --level commit` would show the green; `state --level full` shows the red.
      mockTreeHash();
      serveRuns([
        createValidationRunFromNote({ passed: false, level: 'commit', timestamp: '2025-10-21T09:00:00Z' }),
        createValidationRunFromNote({ passed: true, level: 'commit', timestamp: '2025-10-21T10:00:00Z' }),
      ]);

      await expect(checkValidationStatus(TWO_LEVELS, 'full')).rejects.toThrow(expectProcessExit(1));

      const logged = loggedText();
      expect(logged).toContain('The newest run bearing on level full failed for this code');
      expect(logged).toContain('state --level full');
      expect(logged).not.toContain('state --level commit');
      expect(logged).not.toContain('Last validation');
    });

    it('exits 1 when a newer commit-level failure follows a full pass', async () => {
      mockTreeHash();
      serveRuns([
        createValidationRunFromNote({ passed: true, level: 'full', timestamp: '2025-10-21T09:00:00Z' }),
        createValidationRunFromNote({ passed: false, level: 'commit', timestamp: '2025-10-21T10:00:00Z' }),
      ]);

      await expect(checkValidationStatus(TWO_LEVELS, 'full')).rejects.toThrow(expectProcessExit(1));
    });

    it('the run-validation hint names a level that is not validate\'s default', async () => {
      mockTreeHash();
      serveRuns(null);

      await expect(checkValidationStatus(TWO_LEVELS, 'commit')).rejects.toThrow(expectProcessExit(2));

      expect(loggedText()).toContain('validate --level commit');
    });

    it('YAML: names the requested level when nothing is recorded at it', async () => {
      const stdoutWriteSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
      mockTreeHash();
      serveRuns([createValidationRunFromNote({ passed: true, level: 'commit' })]);

      await expect(checkValidationStatus(TWO_LEVELS, 'full', true)).rejects.toThrow(expectProcessExit(2));

      expectYamlOutput(stdoutWriteSpy, ['exists: false', 'treeHash: abc123def456', 'level: full']);
      stdoutWriteSpy.mockRestore();
    });
  });

  describe('when last validation failed', () => {
    it('should exit with code 1 and show failure details', async () => {
      const failedRun = createValidationRunFromNote({ passed: false });

      mockTreeHash();
      serveRuns([failedRun]);

      await expect(checkValidationStatus(mockConfig, 'full')).rejects.toThrow(expectProcessExit(1));

      expectConsoleOutput(consoleLogSpy, [
        'The newest run bearing on level full failed for this code',
        'Tree hash: abc123def456',
        'Recorded: 2025-10-21T10:00:00Z on branch main'
      ]);
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('carries no replayed-failure wording or cache-key hint', async () => {
      mockTreeHash();
      serveRuns([createValidationRunFromNote({ passed: false })]);

      await expect(checkValidationStatus(mockConfig, 'full')).rejects.toThrow(expectProcessExit(1));

      expectNoConsoleOutput(consoleLogSpy, ['Replayed', 'not re-run', '.gitignore', 'validate --force']);
    });

    it('exits 1 when a newer failure follows an older pass at the level', async () => {
      mockTreeHash();
      serveRuns([
        createValidationRunFromNote({ passed: true, timestamp: '2025-10-21T09:00:00Z' }),
        createValidationRunFromNote({ passed: false, timestamp: '2025-10-21T10:00:00Z' }),
      ]);

      await expect(checkValidationStatus(mockConfig, 'full')).rejects.toThrow(expectProcessExit(1));
    });

    it('should show the returned run details', async () => {
      const failedRun = createValidationRunFromNote({
        id: 'run-2',
        timestamp: '2025-10-21T10:00:00Z',
        passed: false,
        branch: 'feature-branch'
      });

      mockTreeHash();
      serveRuns([failedRun]);

      await expect(checkValidationStatus(mockConfig, 'full')).rejects.toThrow(expectProcessExit(1));

      // Should show the run details
      expectConsoleOutput(consoleLogSpy, [
        'Recorded: 2025-10-21T10:00:00Z on branch feature-branch'
      ]);
    });

    it('reports the newest failure when several are recorded', async () => {
      mockTreeHash();
      serveRuns([
        createValidationRunFromNote({ passed: false, timestamp: '2025-10-21T09:00:00Z', branch: 'older' }),
        createValidationRunFromNote({ passed: false, timestamp: '2025-10-21T10:00:00Z', branch: 'newer' }),
      ]);

      await expect(checkValidationStatus(mockConfig, 'full')).rejects.toThrow(expectProcessExit(1));

      expectConsoleOutput(consoleLogSpy, ['on branch newer']);
      expectNoConsoleOutput(consoleLogSpy, ['on branch older']);
    });

    it('should show failed phase and step details when available', async () => {
      const failedRunWithDetails = createValidationRunFromNote({
        passed: false,
        phases: createTwoPhaseStructure(false)
      });

      mockTreeHash();
      serveRuns([failedRunWithDetails]);

      await expect(checkValidationStatus(mockConfig, 'full')).rejects.toThrow(expectProcessExit(1));

      // Should show failed phase and step
      expectConsoleOutput(consoleLogSpy, [
        'Failed phase: Testing',
        'Failed step: Unit Tests'
      ]);

      // Check that both guidance messages are present (each is a separate console.log call)
      const allLogCalls = consoleLogSpy.mock.calls.map(call => call.join(' '));
      expect(allLogCalls.some(call => call.includes('View full error details'))).toBe(true);
      expect(allLogCalls.some(call => call.includes('vibe-validate state'))).toBe(true);
      expect(allLogCalls.some(call => call.includes('Fix errors and run validation'))).toBe(true);
    });

    it('names the step that failed, not a sibling fail-fast stopped ahead of it', async () => {
      const allLogCalls = await reportCachedFailure([
        { name: 'ESLint', passed: false, stoppedByFailFast: true, durationSecs: 0.4 },
        { name: 'Typecheck', passed: false, durationSecs: 0.3 },
      ], mockConfig);

      expect(allLogCalls.some(call => call.includes('Failed step: Typecheck'))).toBe(true);
      expect(allLogCalls.some(call => call.includes('Failed step: ESLint'))).toBe(false);
    });

    it('names the run\'s failedStep when several steps failed, whatever order their results finished in', async () => {
      const allLogCalls = await reportCachedFailure([
        { name: 'Fast Failure', passed: false, durationSecs: 0.1 },
        { name: 'Slow Failure', passed: false, durationSecs: 0.6 },
      ], mockConfig, 'Slow Failure');

      expect(allLogCalls.some(call => call.includes('Failed step: Slow Failure'))).toBe(true);
      expect(allLogCalls.some(call => call.includes('Failed step: Fast Failure'))).toBe(false);
    });

    it('outputs the recorded failure as YAML, not marked as a cached result (a failure is never replayed)', async () => {
      const stdoutWriteSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

      const failedRun = createValidationRunFromNote({ passed: false });

      mockTreeHash();
      serveRuns([failedRun]);

      await expect(checkValidationStatus(mockConfig, 'full', true)).rejects.toThrow(expectProcessExit(1));

      // Should output YAML to stdout (not console.log)
      expectYamlOutput(stdoutWriteSpy, [
        'passed: false',
        'treeHash: abc123def456',
        'level: full',
      ]);
      expect(stdoutWriteSpy.mock.calls.map(call => String(call[0])).join('')).not.toContain('isCachedResult');

      stdoutWriteSpy.mockRestore();
    });
  });

  describe('when last validation passed', () => {
    it('should output the stored result as YAML with isCachedResult when --yaml is used', async () => {
      const stdoutWriteSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
      mockTreeHash();
      serveRuns([createValidationRunFromNote({ passed: true })]);

      await expect(checkValidationStatus(mockConfig, 'full', true)).rejects.toThrow(expectProcessExit(0));

      expectYamlOutput(stdoutWriteSpy, ['passed: true', 'level: full', 'isCachedResult: true']);
      expectNoConsoleOutput(consoleLogSpy, ['Validation passed for this code']);
      stdoutWriteSpy.mockRestore();
    });

    it('names the level of the pass', async () => {
      mockTreeHash();
      serveRuns([createValidationRunFromNote({ passed: true })]);

      await expect(checkValidationStatus(mockConfig, 'full')).rejects.toThrow(expectProcessExit(0));

      expectConsoleOutput(consoleLogSpy, ['Level: full']);
      expectNoConsoleOutput(consoleLogSpy, ['covers']);
    });

    it('should exit with code 0 and show success', async () => {
      const passedRun = createValidationRunFromNote({ passed: true });

      mockTreeHash();
      serveRuns([passedRun]);

      await expect(checkValidationStatus(mockConfig, 'full')).rejects.toThrow(expectProcessExit(0));

      expectConsoleOutput(consoleLogSpy, [
        'Validation passed for this code',
        'Tree hash: abc123def456',
        'Validated: 2025-10-21T10:00:00Z',
        'Duration: 5.0s',
        'on branch main'
      ]);
      expect(processExitSpy).toHaveBeenCalledWith(0);
    });

    it('should show the passed run details returned by findCachedValidation', async () => {
      const passedRun = createValidationRunFromNote({
        id: 'run-3',
        timestamp: '2025-10-21T11:00:00Z',
        duration: 3500,
        passed: true
      });

      mockTreeHash();
      serveRuns([passedRun]);

      await expect(checkValidationStatus(mockConfig, 'full')).rejects.toThrow(expectProcessExit(0));

      // Should show the passed run details
      expectConsoleOutput(consoleLogSpy, [
        'Validated: 2025-10-21T11:00:00Z',
        'Duration: 3.5s'
      ]);
    });

    it('should show phase and step counts when result has phases', async () => {
      const passedRunWithPhases = createValidationRunFromNote({
        passed: true,
        phases: createTwoPhaseStructure(true)
      });

      mockTreeHash();
      serveRuns([passedRunWithPhases]);

      await expect(checkValidationStatus(mockConfig, 'full')).rejects.toThrow(expectProcessExit(0));

      expectConsoleOutput(consoleLogSpy, ['Phases: 2, Steps: 3']);
    });

    it('should handle result without phases gracefully', async () => {
      const passedRunNoPhases = createValidationRunFromNote({ passed: true, phases: undefined });

      mockTreeHash();
      serveRuns([passedRunNoPhases]);

      await expect(checkValidationStatus(mockConfig, 'full')).rejects.toThrow(expectProcessExit(0));

      // Should not throw, just not show phases/steps line
      expectConsoleOutput(consoleLogSpy, ['Validation passed for this code']);
    });
  });

  describe('edge cases', () => {
    it('should handle truncated tree hash display', async () => {
      const longHash = 'abcdef123456789012345678901234567890';
      mockTreeHash(longHash);
      vi.mocked(history.readHistoryNote).mockResolvedValue(null);

      await expect(checkValidationStatus(mockConfig, 'full')).rejects.toThrow(expectProcessExit(2));

      // Should show first 12 characters
      expectConsoleOutput(consoleLogSpy, [`Tree hash: ${longHash.substring(0, 12)}`]);
    });

    it('should handle short tree hash', async () => {
      const shortHash = 'abc123';
      mockTreeHash(shortHash);
      vi.mocked(history.readHistoryNote).mockResolvedValue(null);

      await expect(checkValidationStatus(mockConfig, 'full')).rejects.toThrow(expectProcessExit(2));

      // Should show full hash when < 12 chars
      expectConsoleOutput(consoleLogSpy, [`Tree hash: ${shortHash}`]);
    });
  });

  describe('YAML mode for error cases', () => {
    let stdoutWriteSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      stdoutWriteSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    });

    afterEach(() => {
      stdoutWriteSpy.mockRestore();
    });

    it('should output YAML when not in git repository with --yaml flag', async () => {
      vi.mocked(git.getGitTreeHash).mockRejectedValue(new Error('not a git repository'));

      await expect(checkValidationStatus(mockConfig, 'full', true)).rejects.toThrow(expectProcessExit(2));

      // Should output YAML to stdout (not console.log)
      expectYamlOutput(stdoutWriteSpy, [
        'exists: false',
        'error:'
      ]);

      // Should NOT use console.log for human-readable messages
      expectNoConsoleOutput(consoleLogSpy, ['⚠️']);
    });


    it('should output YAML when no validation history with --yaml flag', async () => {
      mockTreeHash();
      serveRuns(null);

      await expect(checkValidationStatus(mockConfig, 'full', true)).rejects.toThrow(expectProcessExit(2));

      // Should output YAML to stdout
      expectYamlOutput(stdoutWriteSpy, [
        'exists: false',
        'treeHash: abc123def456'
      ]);

      // Should NOT use console.log for human-readable messages
      expectNoConsoleOutput(consoleLogSpy, ['⚠️', '💡']);
    });
  });

  describe('submodule scenarios', () => {
    it('should read the note keyed by the worktree tree hash', async () => {
      const treeHash = 'abc123def456';
      const submoduleHashes = {
        'submodules/lib-a': 'sub111222333',
        'submodules/lib-b': 'sub444555666'
      };

      mockTreeHash(treeHash, submoduleHashes);
      serveRuns(null);

      await expect(checkValidationStatus(mockConfig, 'full', true)).rejects.toThrow(expectProcessExit(2));

      expect(history.readHistoryNote).toHaveBeenCalledTimes(1);
      expect(history.readHistoryNote).toHaveBeenCalledWith(treeHash);
    });

    it('should handle cache hit with matching submodules', async () => {
      const treeHash = 'abc123def456';
      const submoduleHashes = {
        'submodules/lib-a': 'sub111222333'
      };

      const passedRun = createValidationRunFromNote({
        passed: true,
        submoduleHashes
      });

      mockTreeHash(treeHash, submoduleHashes);
      serveRuns([passedRun]);

      await expect(checkValidationStatus(mockConfig, 'full')).rejects.toThrow(expectProcessExit(0));

      expectConsoleOutput(consoleLogSpy, ['Validation passed for this code']);
    });

    it('should handle cache miss when submodules changed', async () => {
      const stdoutWriteSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

      const treeHash = 'abc123def456';
      const submoduleHashes = {
        'submodules/lib-a': 'sub111222333'
      };

      mockTreeHash(treeHash, submoduleHashes);
      // A pass and a failure recorded with an older submodule state answer nothing
      serveRuns([
        createValidationRunFromNote({ passed: true, submoduleHashes: { 'submodules/lib-a': 'old000000000' } }),
        createValidationRunFromNote({ passed: false, submoduleHashes: { 'submodules/lib-a': 'old000000000' } }),
      ]);

      await expect(checkValidationStatus(mockConfig, 'full', true)).rejects.toThrow(expectProcessExit(2));

      expectYamlOutput(stdoutWriteSpy, [
        'exists: false',
        'treeHash: abc123def456'
      ]);

      stdoutWriteSpy.mockRestore();
    });
  });
});

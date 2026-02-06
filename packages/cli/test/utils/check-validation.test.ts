/**
 * Tests for check-validation utility
 *
 * This module uses git notes instead of state files.
 */

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

// Mock dependencies
vi.mock('@vibe-validate/git');
vi.mock('@vibe-validate/history');

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
    branch: run.branch,
    headCommit: run.headCommit,
    uncommittedChanges: run.uncommittedChanges,
    result: run.result,
  };
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
    vi.mocked(history.findCachedValidation).mockReset();
  });

  describe('when not in git repository', () => {
    it('should exit with code 2 and show error', async () => {
      vi.mocked(git.getGitTreeHash).mockRejectedValue(new Error('Not a git repository'));

      await expect(checkValidationStatus(mockConfig)).rejects.toThrow(expectProcessExit(2));

      expectConsoleOutput(consoleLogSpy, ['Not in git repository']);
      expect(processExitSpy).toHaveBeenCalledWith(2);
    });
  });

  describe('when git notes cannot be read', () => {
    it('should exit with code 2 and show error', async () => {
      mockTreeHash();
      vi.mocked(history.findCachedValidation).mockRejectedValue(new Error('Git notes error'));

      await expect(checkValidationStatus(mockConfig)).rejects.toThrow(expectProcessExit(2));

      expectConsoleOutput(consoleLogSpy, ['Failed to read validation history']);
      expect(processExitSpy).toHaveBeenCalledWith(2);
    });
  });

  describe('when no validation history exists', () => {
    it('should exit with code 2 when cached validation is null', async () => {
      mockTreeHash();
      vi.mocked(history.findCachedValidation).mockResolvedValue(null);

      await expect(checkValidationStatus(mockConfig)).rejects.toThrow(expectProcessExit(2));

      expectConsoleOutput(consoleLogSpy, [
        'No validation history for current working tree',
        'Tree hash: abc123def456'
      ]);
      expect(processExitSpy).toHaveBeenCalledWith(2);
    });
  });

  describe('when last validation failed', () => {
    it('should exit with code 1 and show failure details', async () => {
      const failedRun = createValidationRunFromNote({ passed: false });

      mockTreeHash();
      vi.mocked(history.findCachedValidation).mockResolvedValue(failedRun);

      await expect(checkValidationStatus(mockConfig)).rejects.toThrow(expectProcessExit(1));

      expectConsoleOutput(consoleLogSpy, [
        'Validation failed for this code',
        'Tree hash: abc123def456',
        'Validated: 2025-10-21T10:00:00Z on branch main'
      ]);
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('should show the returned run details', async () => {
      const failedRun = createValidationRunFromNote({
        id: 'run-2',
        timestamp: '2025-10-21T10:00:00Z',
        passed: false,
        branch: 'feature-branch'
      });

      mockTreeHash();
      vi.mocked(history.findCachedValidation).mockResolvedValue(failedRun);

      await expect(checkValidationStatus(mockConfig)).rejects.toThrow(expectProcessExit(1));

      // Should show the run details
      expectConsoleOutput(consoleLogSpy, [
        'Validated: 2025-10-21T10:00:00Z on branch feature-branch'
      ]);
    });

    it('should show failed phase and step details when available', async () => {
      const failedRunWithDetails = createValidationRunFromNote({
        passed: false,
        phases: createTwoPhaseStructure(false)
      });

      mockTreeHash();
      vi.mocked(history.findCachedValidation).mockResolvedValue(failedRunWithDetails);

      await expect(checkValidationStatus(mockConfig)).rejects.toThrow(expectProcessExit(1));

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

    it('should output YAML when --yaml flag is used with cached failure', async () => {
      const stdoutWriteSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

      const failedRun = createValidationRunFromNote({ passed: false });

      mockTreeHash();
      vi.mocked(history.findCachedValidation).mockResolvedValue(failedRun);

      await expect(checkValidationStatus(mockConfig, true)).rejects.toThrow(expectProcessExit(1));

      // Should output YAML to stdout (not console.log)
      expectYamlOutput(stdoutWriteSpy, [
        'passed: false',
        'treeHash: abc123def456'
      ]);

      stdoutWriteSpy.mockRestore();
    });
  });

  describe('when last validation passed', () => {
    it('should exit with code 0 and show success', async () => {
      const passedRun = createValidationRunFromNote({ passed: true });

      mockTreeHash();
      vi.mocked(history.findCachedValidation).mockResolvedValue(passedRun);

      await expect(checkValidationStatus(mockConfig)).rejects.toThrow(expectProcessExit(0));

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
      vi.mocked(history.findCachedValidation).mockResolvedValue(passedRun);

      await expect(checkValidationStatus(mockConfig)).rejects.toThrow(expectProcessExit(0));

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
      vi.mocked(history.findCachedValidation).mockResolvedValue(passedRunWithPhases);

      await expect(checkValidationStatus(mockConfig)).rejects.toThrow(expectProcessExit(0));

      expectConsoleOutput(consoleLogSpy, ['Phases: 2, Steps: 3']);
    });

    it('should handle result without phases gracefully', async () => {
      const passedRunNoPhases = createValidationRunFromNote({ passed: true, phases: undefined });

      mockTreeHash();
      vi.mocked(history.findCachedValidation).mockResolvedValue(passedRunNoPhases);

      await expect(checkValidationStatus(mockConfig)).rejects.toThrow(expectProcessExit(0));

      // Should not throw, just not show phases/steps line
      expectConsoleOutput(consoleLogSpy, ['Validation passed for this code']);
    });
  });

  describe('edge cases', () => {
    it('should handle truncated tree hash display', async () => {
      const longHash = 'abcdef123456789012345678901234567890';
      mockTreeHash(longHash);
      vi.mocked(history.readHistoryNote).mockResolvedValue(null);

      await expect(checkValidationStatus(mockConfig)).rejects.toThrow(expectProcessExit(2));

      // Should show first 12 characters
      expectConsoleOutput(consoleLogSpy, [`Tree hash: ${longHash.substring(0, 12)}`]);
    });

    it('should handle short tree hash', async () => {
      const shortHash = 'abc123';
      mockTreeHash(shortHash);
      vi.mocked(history.readHistoryNote).mockResolvedValue(null);

      await expect(checkValidationStatus(mockConfig)).rejects.toThrow(expectProcessExit(2));

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

      await expect(checkValidationStatus(mockConfig, true)).rejects.toThrow(expectProcessExit(2));

      // Should output YAML to stdout (not console.log)
      expectYamlOutput(stdoutWriteSpy, [
        'exists: false',
        'error:'
      ]);

      // Should NOT use console.log for human-readable messages
      expectNoConsoleOutput(consoleLogSpy, ['⚠️']);
    });

    it('should output YAML when failed to read history with --yaml flag', async () => {
      mockTreeHash();
      vi.mocked(history.findCachedValidation).mockRejectedValue(new Error('Git notes error'));

      await expect(checkValidationStatus(mockConfig, true)).rejects.toThrow(expectProcessExit(2));

      // Should output YAML to stdout
      expectYamlOutput(stdoutWriteSpy, [
        'exists: false',
        'treeHash: abc123def456',
        'error:'
      ]);

      // Should NOT use console.log for human-readable messages
      expectNoConsoleOutput(consoleLogSpy, ['⚠️']);
    });

    it('should output YAML when no validation history with --yaml flag', async () => {
      mockTreeHash();
      vi.mocked(history.findCachedValidation).mockResolvedValue(null);

      await expect(checkValidationStatus(mockConfig, true)).rejects.toThrow(expectProcessExit(2));

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
    it('should pass tree hash result with submodules to findCachedValidation', async () => {
      const treeHash = 'abc123def456';
      const submoduleHashes = {
        'submodules/lib-a': 'sub111222333',
        'submodules/lib-b': 'sub444555666'
      };

      mockTreeHash(treeHash, submoduleHashes);
      vi.mocked(history.findCachedValidation).mockResolvedValue(null);

      await expect(checkValidationStatus(mockConfig, true)).rejects.toThrow(expectProcessExit(2));

      // Verify findCachedValidation was called with TreeHashResult including submodules
      expect(history.findCachedValidation).toHaveBeenCalledWith({
        hash: treeHash,
        submoduleHashes
      });
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
      vi.mocked(history.findCachedValidation).mockResolvedValue(passedRun);

      await expect(checkValidationStatus(mockConfig)).rejects.toThrow(expectProcessExit(0));

      expectConsoleOutput(consoleLogSpy, ['Validation passed for this code']);
    });

    it('should handle cache miss when submodules changed', async () => {
      const stdoutWriteSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

      const treeHash = 'abc123def456';
      const submoduleHashes = {
        'submodules/lib-a': 'sub111222333'
      };

      mockTreeHash(treeHash, submoduleHashes);
      vi.mocked(history.findCachedValidation).mockResolvedValue(null);

      await expect(checkValidationStatus(mockConfig, true)).rejects.toThrow(expectProcessExit(2));

      expectYamlOutput(stdoutWriteSpy, [
        'exists: false',
        'treeHash: abc123def456'
      ]);

      stdoutWriteSpy.mockRestore();
    });
  });
});

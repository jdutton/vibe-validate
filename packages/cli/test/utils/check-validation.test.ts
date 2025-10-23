/**
 * Tests for check-validation utility
 *
 * This module uses git notes instead of state files.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { checkValidationStatus } from '../../src/utils/check-validation.js';
import * as git from '@vibe-validate/git';
import * as history from '@vibe-validate/history';
import type { VibeValidateConfig } from '@vibe-validate/config';
import type { HistoryNote } from '@vibe-validate/history';

// Mock dependencies
vi.mock('@vibe-validate/git');
vi.mock('@vibe-validate/history');

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
      throw new Error(`process.exit(${code})`);
    });

    // Reset mocks
    vi.mocked(git.getGitTreeHash).mockReset();
    vi.mocked(history.readHistoryNote).mockReset();
  });

  describe('when not in git repository', () => {
    it('should exit with code 2 and show error', async () => {
      vi.mocked(git.getGitTreeHash).mockRejectedValue(new Error('Not a git repository'));

      await expect(checkValidationStatus(mockConfig)).rejects.toThrow('process.exit(2)');

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Not in git repository')
      );
      expect(processExitSpy).toHaveBeenCalledWith(2);
    });
  });

  describe('when git notes cannot be read', () => {
    it('should exit with code 2 and show error', async () => {
      vi.mocked(git.getGitTreeHash).mockResolvedValue('abc123def456');
      vi.mocked(history.readHistoryNote).mockRejectedValue(new Error('Git notes error'));

      await expect(checkValidationStatus(mockConfig)).rejects.toThrow('process.exit(2)');

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to read validation history')
      );
      expect(processExitSpy).toHaveBeenCalledWith(2);
    });
  });

  describe('when no validation history exists', () => {
    it('should exit with code 2 when history note is null', async () => {
      vi.mocked(git.getGitTreeHash).mockResolvedValue('abc123def456');
      vi.mocked(history.readHistoryNote).mockResolvedValue(null);

      await expect(checkValidationStatus(mockConfig)).rejects.toThrow('process.exit(2)');

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('No validation history for current working tree')
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Tree hash: abc123def456')
      );
      expect(processExitSpy).toHaveBeenCalledWith(2);
    });

    it('should exit with code 2 when runs array is empty', async () => {
      vi.mocked(git.getGitTreeHash).mockResolvedValue('abc123def456');
      vi.mocked(history.readHistoryNote).mockResolvedValue({
        treeHash: 'abc123def456',
        runs: []
      });

      await expect(checkValidationStatus(mockConfig)).rejects.toThrow('process.exit(2)');

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('No validation history')
      );
      expect(processExitSpy).toHaveBeenCalledWith(2);
    });
  });

  describe('when last validation failed', () => {
    it('should exit with code 1 and show failure details', async () => {
      const failedNote: HistoryNote = {
        treeHash: 'abc123def456',
        runs: [
          {
            id: 'run-1',
            timestamp: '2025-10-21T10:00:00Z',
            duration: 5000,
            passed: false,
            branch: 'main',
            headCommit: 'commit123',
            uncommittedChanges: false,
            result: {
              passed: false,
              timestamp: '2025-10-21T10:00:00Z',
              treeHash: 'abc123def456',
              phases: [],
            }
          }
        ]
      };

      vi.mocked(git.getGitTreeHash).mockResolvedValue('abc123def456');
      vi.mocked(history.readHistoryNote).mockResolvedValue(failedNote);

      await expect(checkValidationStatus(mockConfig)).rejects.toThrow('process.exit(1)');

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Last validation failed')
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Tree hash: abc123def456')
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Last validated: 2025-10-21T10:00:00Z')
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Branch: main')
      );
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('should show most recent run when multiple runs exist', async () => {
      const multiRunNote: HistoryNote = {
        treeHash: 'abc123def456',
        runs: [
          {
            id: 'run-1',
            timestamp: '2025-10-21T09:00:00Z',
            duration: 5000,
            passed: false,
            branch: 'main',
            headCommit: 'commit123',
            uncommittedChanges: false,
            result: {
              passed: false,
              timestamp: '2025-10-21T09:00:00Z',
              treeHash: 'abc123def456',
              phases: [],
            }
          },
          {
            id: 'run-2',
            timestamp: '2025-10-21T10:00:00Z',
            duration: 5000,
            passed: false,
            branch: 'feature-branch',
            headCommit: 'commit456',
            uncommittedChanges: false,
            result: {
              passed: false,
              timestamp: '2025-10-21T10:00:00Z',
              treeHash: 'abc123def456',
              phases: [],
            }
          }
        ]
      };

      vi.mocked(git.getGitTreeHash).mockResolvedValue('abc123def456');
      vi.mocked(history.readHistoryNote).mockResolvedValue(multiRunNote);

      await expect(checkValidationStatus(mockConfig)).rejects.toThrow('process.exit(1)');

      // Should show most recent run (run-2)
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Last validated: 2025-10-21T10:00:00Z')
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Branch: feature-branch')
      );
    });

    it('should show failed phase and step details when available', async () => {
      const failedNoteWithDetails: HistoryNote = {
        treeHash: 'abc123def456',
        runs: [
          {
            id: 'run-1',
            timestamp: '2025-10-21T10:00:00Z',
            duration: 5000,
            passed: false,
            branch: 'main',
            headCommit: 'commit123',
            uncommittedChanges: false,
            result: {
              passed: false,
              timestamp: '2025-10-21T10:00:00Z',
              treeHash: 'abc123def456',
              phases: [
                {
                  name: 'Pre-Qualification',
                  durationSecs: 2.5,
                  passed: true,
                  steps: [
                    { name: 'TypeScript', passed: true, durationSecs: 1.2 },
                    { name: 'ESLint', passed: true, durationSecs: 1.3 }
                  ]
                },
                {
                  name: 'Testing',
                  durationSecs: 2.5,
                  passed: false,
                  steps: [
                    { name: 'Unit Tests', passed: false, durationSecs: 2.5 }
                  ]
                }
              ],
            }
          }
        ]
      };

      vi.mocked(git.getGitTreeHash).mockResolvedValue('abc123def456');
      vi.mocked(history.readHistoryNote).mockResolvedValue(failedNoteWithDetails);

      await expect(checkValidationStatus(mockConfig)).rejects.toThrow('process.exit(1)');

      // Should show failed phase and step
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed phase: Testing')
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed step: Unit Tests')
      );
      // Check that both guidance messages are present (each is a separate console.log call)
      const allLogCalls = consoleLogSpy.mock.calls.map(call => call.join(' '));
      expect(allLogCalls.some(call => call.includes('View full error details'))).toBe(true);
      expect(allLogCalls.some(call => call.includes('vibe-validate state'))).toBe(true);
      expect(allLogCalls.some(call => call.includes('Fix errors and run validation'))).toBe(true);
    });

    it('should output YAML when --yaml flag is used with cached failure', async () => {
      const stdoutWriteSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

      const failedNote: HistoryNote = {
        treeHash: 'abc123def456',
        runs: [
          {
            id: 'run-1',
            timestamp: '2025-10-21T10:00:00Z',
            duration: 5000,
            passed: false,
            branch: 'main',
            headCommit: 'commit123',
            uncommittedChanges: false,
            result: {
              passed: false,
              timestamp: '2025-10-21T10:00:00Z',
              treeHash: 'abc123def456',
              phases: [],
            }
          }
        ]
      };

      vi.mocked(git.getGitTreeHash).mockResolvedValue('abc123def456');
      vi.mocked(history.readHistoryNote).mockResolvedValue(failedNote);

      await expect(checkValidationStatus(mockConfig, true)).rejects.toThrow('process.exit(1)');

      // Should output YAML to stdout (not console.log)
      expect(stdoutWriteSpy).toHaveBeenCalled();
      const yamlOutput = stdoutWriteSpy.mock.calls[0][0] as string;
      expect(yamlOutput).toContain('passed: false');
      expect(yamlOutput).toContain('treeHash: abc123def456');

      stdoutWriteSpy.mockRestore();
    });
  });

  describe('when last validation passed', () => {
    it('should exit with code 0 and show success', async () => {
      const passedNote: HistoryNote = {
        treeHash: 'abc123def456',
        runs: [
          {
            id: 'run-1',
            timestamp: '2025-10-21T10:00:00Z',
            duration: 5000,
            passed: true,
            branch: 'main',
            headCommit: 'commit123',
            uncommittedChanges: false,
            result: {
              passed: true,
              timestamp: '2025-10-21T10:00:00Z',
              treeHash: 'abc123def456',
              phases: [],
            }
          }
        ]
      };

      vi.mocked(git.getGitTreeHash).mockResolvedValue('abc123def456');
      vi.mocked(history.readHistoryNote).mockResolvedValue(passedNote);

      await expect(checkValidationStatus(mockConfig)).rejects.toThrow('process.exit(0)');

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Validation already passed')
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Tree hash: abc123def456')
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Last validated: 2025-10-21T10:00:00Z')
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Duration: 5.0s')
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Branch: main')
      );
      expect(processExitSpy).toHaveBeenCalledWith(0);
    });

    it('should find most recent passing run when mixed with failures', async () => {
      const mixedNote: HistoryNote = {
        treeHash: 'abc123def456',
        runs: [
          {
            id: 'run-1',
            timestamp: '2025-10-21T09:00:00Z',
            duration: 5000,
            passed: false,
            branch: 'main',
            headCommit: 'commit123',
            uncommittedChanges: false,
            result: {
              passed: false,
              timestamp: '2025-10-21T09:00:00Z',
              treeHash: 'abc123def456',
              phases: [],
            }
          },
          {
            id: 'run-2',
            timestamp: '2025-10-21T10:00:00Z',
            duration: 3000,
            passed: true,
            branch: 'main',
            headCommit: 'commit456',
            uncommittedChanges: false,
            result: {
              passed: true,
              timestamp: '2025-10-21T10:00:00Z',
              treeHash: 'abc123def456',
              phases: [],
            }
          },
          {
            id: 'run-3',
            timestamp: '2025-10-21T11:00:00Z',
            duration: 3500,
            passed: true,
            branch: 'main',
            headCommit: 'commit789',
            uncommittedChanges: false,
            result: {
              passed: true,
              timestamp: '2025-10-21T11:00:00Z',
              treeHash: 'abc123def456',
              phases: [],
            }
          }
        ]
      };

      vi.mocked(git.getGitTreeHash).mockResolvedValue('abc123def456');
      vi.mocked(history.readHistoryNote).mockResolvedValue(mixedNote);

      await expect(checkValidationStatus(mockConfig)).rejects.toThrow('process.exit(0)');

      // Should show most recent passing run (run-3)
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Last validated: 2025-10-21T11:00:00Z')
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Duration: 3.5s')
      );
    });

    it('should show phase and step counts when result has phases', async () => {
      const passedNoteWithPhases: HistoryNote = {
        treeHash: 'abc123def456',
        runs: [
          {
            id: 'run-1',
            timestamp: '2025-10-21T10:00:00Z',
            duration: 5000,
            passed: true,
            branch: 'main',
            headCommit: 'commit123',
            uncommittedChanges: false,
            result: {
              passed: true,
              timestamp: '2025-10-21T10:00:00Z',
              treeHash: 'abc123def456',
              phases: [
                {
                  name: 'Pre-Qualification',
                  durationSecs: 2.5,
                  passed: true,
                  steps: [
                    { name: 'TypeScript', passed: true, durationSecs: 1.2 },
                    { name: 'ESLint', passed: true, durationSecs: 1.3 }
                  ]
                },
                {
                  name: 'Testing',
                  durationSecs: 2.5,
                  passed: true,
                  steps: [
                    { name: 'Unit Tests', passed: true, durationSecs: 2.5 }
                  ]
                }
              ],
            }
          }
        ]
      };

      vi.mocked(git.getGitTreeHash).mockResolvedValue('abc123def456');
      vi.mocked(history.readHistoryNote).mockResolvedValue(passedNoteWithPhases);

      await expect(checkValidationStatus(mockConfig)).rejects.toThrow('process.exit(0)');

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Phases: 2, Steps: 3')
      );
    });

    it('should handle result without phases gracefully', async () => {
      const passedNoteNoPhases: HistoryNote = {
        treeHash: 'abc123def456',
        runs: [
          {
            id: 'run-1',
            timestamp: '2025-10-21T10:00:00Z',
            duration: 5000,
            passed: true,
            branch: 'main',
            headCommit: 'commit123',
            uncommittedChanges: false,
            result: {
              passed: true,
              timestamp: '2025-10-21T10:00:00Z',
              treeHash: 'abc123def456',
              phases: undefined,
            }
          }
        ]
      };

      vi.mocked(git.getGitTreeHash).mockResolvedValue('abc123def456');
      vi.mocked(history.readHistoryNote).mockResolvedValue(passedNoteNoPhases);

      await expect(checkValidationStatus(mockConfig)).rejects.toThrow('process.exit(0)');

      // Should not throw, just not show phases/steps line
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining('Validation already passed')
      );
    });
  });

  describe('edge cases', () => {
    it('should handle truncated tree hash display', async () => {
      const longHash = 'abcdef123456789012345678901234567890';
      vi.mocked(git.getGitTreeHash).mockResolvedValue(longHash);
      vi.mocked(history.readHistoryNote).mockResolvedValue(null);

      await expect(checkValidationStatus(mockConfig)).rejects.toThrow('process.exit(2)');

      // Should show first 12 characters
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining(`Tree hash: ${longHash.substring(0, 12)}`)
      );
    });

    it('should handle short tree hash', async () => {
      const shortHash = 'abc123';
      vi.mocked(git.getGitTreeHash).mockResolvedValue(shortHash);
      vi.mocked(history.readHistoryNote).mockResolvedValue(null);

      await expect(checkValidationStatus(mockConfig)).rejects.toThrow('process.exit(2)');

      // Should show full hash when < 12 chars
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining(`Tree hash: ${shortHash}`)
      );
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

      await expect(checkValidationStatus(mockConfig, true)).rejects.toThrow('process.exit(2)');

      // Should output YAML to stdout (not console.log)
      expect(stdoutWriteSpy).toHaveBeenCalled();
      const yamlOutput = stdoutWriteSpy.mock.calls[0][0] as string;
      expect(yamlOutput).toContain('exists: false');
      expect(yamlOutput).toContain('error:');

      // Should NOT use console.log for human-readable messages
      expect(consoleLogSpy).not.toHaveBeenCalledWith(expect.stringContaining('⚠️'));
    });

    it('should output YAML when failed to read history with --yaml flag', async () => {
      vi.mocked(git.getGitTreeHash).mockResolvedValue('abc123def456');
      vi.mocked(history.readHistoryNote).mockRejectedValue(new Error('Git notes error'));

      await expect(checkValidationStatus(mockConfig, true)).rejects.toThrow('process.exit(2)');

      // Should output YAML to stdout
      expect(stdoutWriteSpy).toHaveBeenCalled();
      const yamlOutput = stdoutWriteSpy.mock.calls[0][0] as string;
      expect(yamlOutput).toContain('exists: false');
      expect(yamlOutput).toContain('treeHash: abc123def456');
      expect(yamlOutput).toContain('error:');

      // Should NOT use console.log for human-readable messages
      expect(consoleLogSpy).not.toHaveBeenCalledWith(expect.stringContaining('⚠️'));
    });

    it('should output YAML when no validation history with --yaml flag', async () => {
      vi.mocked(git.getGitTreeHash).mockResolvedValue('abc123def456');
      vi.mocked(history.readHistoryNote).mockResolvedValue(null);

      await expect(checkValidationStatus(mockConfig, true)).rejects.toThrow('process.exit(2)');

      // Should output YAML to stdout
      expect(stdoutWriteSpy).toHaveBeenCalled();
      const yamlOutput = stdoutWriteSpy.mock.calls[0][0] as string;
      expect(yamlOutput).toContain('exists: false');
      expect(yamlOutput).toContain('treeHash: abc123def456');

      // Should NOT use console.log for human-readable messages
      expect(consoleLogSpy).not.toHaveBeenCalledWith(expect.stringContaining('⚠️'));
      expect(consoleLogSpy).not.toHaveBeenCalledWith(expect.stringContaining('💡'));
    });
  });
});

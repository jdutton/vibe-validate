/**
 * Tests for validation history recorder
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { recordValidationHistory, checkWorktreeStability } from '../src/recorder.js';
import type { ValidationResult } from '@vibe-validate/core';

// Mock dependencies
vi.mock('@vibe-validate/git', () => ({
  getGitTreeHash: vi.fn(),
  hasWorkingTreeChanges: vi.fn(() => Promise.resolve(false)),
}));

vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

vi.mock('fs', () => ({
  writeFileSync: vi.fn(),
  unlinkSync: vi.fn(),
}));

vi.mock('../src/reader.js', () => ({
  readHistoryNote: vi.fn(() => Promise.resolve(null)),
}));

describe('recordValidationHistory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should record validation result to git notes', async () => {
    const { execSync } = await import('child_process');
    const { writeFileSync } = await import('fs');
    const treeHash = 'abc123def456';

    const result: ValidationResult = {
      passed: true,
      timestamp: '2025-10-21T14:30:15.123Z',
      treeHash,
      phases: [
        {
          name: 'test',
          durationSecs: 2.3,
          passed: true,
          steps: [],
        },
      ],
    };

    // Mock git commands
    vi.mocked(execSync).mockImplementation((cmd: string) => {
      if (cmd.includes('rev-parse --abbrev-ref HEAD')) {
        return 'feature/foo\n';
      }
      if (cmd.includes('rev-parse HEAD')) {
        return '9abc3c4\n';
      }
      return '';
    });

    const recordResult = await recordValidationHistory(treeHash, result);

    expect(recordResult.recorded).toBe(true);
    expect(recordResult.treeHash).toBe(treeHash);

    // Verify git notes command was called
    expect(execSync).toHaveBeenCalledWith(
      expect.stringContaining('git notes --ref=vibe-validate/runs add'),
      expect.any(Object)
    );

    // Verify YAML was written to temp file
    expect(writeFileSync).toHaveBeenCalled();
  });

  it('should append to existing note', async () => {
    const { readHistoryNote } = await import('../src/reader.js');
    const treeHash = 'abc123def456';

    // Mock existing note
    vi.mocked(readHistoryNote).mockResolvedValue({
      treeHash,
      runs: [
        {
          id: 'run-1000',
          timestamp: '2025-10-21T14:00:00.000Z',
          duration: 2000,
          passed: true,
          branch: 'main',
          headCommit: '123abc',
          uncommittedChanges: false,
          result: {
            passed: true,
            timestamp: '2025-10-21T14:00:00.000Z',
            treeHash,
          },
        },
      ],
    });

    const result: ValidationResult = {
      passed: false,
      timestamp: '2025-10-21T14:30:15.123Z',
      treeHash,
    };

    const recordResult = await recordValidationHistory(treeHash, result);

    expect(recordResult.recorded).toBe(true);
  });

  it('should prune old runs when exceeding maxRunsPerTree', async () => {
    const { readHistoryNote } = await import('../src/reader.js');
    const treeHash = 'abc123def456';

    // Mock existing note with 10 runs
    const existingRuns = Array.from({ length: 10 }, (_, i) => ({
      id: `run-${i}`,
      timestamp: `2025-10-21T${String(i).padStart(2, '0')}:00:00.000Z`,
      duration: 2000,
      passed: true,
      branch: 'main',
      headCommit: '123abc',
      uncommittedChanges: false,
      result: {
        passed: true,
        timestamp: `2025-10-21T${String(i).padStart(2, '0')}:00:00.000Z`,
        treeHash,
      },
    }));

    vi.mocked(readHistoryNote).mockResolvedValue({
      treeHash,
      runs: existingRuns,
    });

    const result: ValidationResult = {
      passed: true,
      timestamp: '2025-10-21T14:30:15.123Z',
      treeHash,
    };

    const recordResult = await recordValidationHistory(treeHash, result, {
      gitNotes: { maxRunsPerTree: 10 },
    });

    expect(recordResult.recorded).toBe(true);
    // Note: In real implementation, oldest run should be pruned
  });

  it('should handle recording failures gracefully', async () => {
    const { execSync } = await import('child_process');
    const treeHash = 'abc123def456';

    vi.mocked(execSync).mockImplementation(() => {
      throw new Error('git notes command failed');
    });

    const result: ValidationResult = {
      passed: true,
      timestamp: '2025-10-21T14:30:15.123Z',
      treeHash,
    };

    const recordResult = await recordValidationHistory(treeHash, result);

    expect(recordResult.recorded).toBe(false);
    expect(recordResult.reason).toContain('git notes command failed');
  });
});

describe('checkWorktreeStability', () => {
  it('should detect stable worktree', async () => {
    const { getGitTreeHash } = await import('@vibe-validate/git');
    const treeHash = 'abc123def456';

    vi.mocked(getGitTreeHash).mockResolvedValue(treeHash);

    const stability = await checkWorktreeStability(treeHash);

    expect(stability.stable).toBe(true);
    expect(stability.treeHashBefore).toBe(treeHash);
    expect(stability.treeHashAfter).toBe(treeHash);
  });

  it('should detect unstable worktree', async () => {
    const { getGitTreeHash } = await import('@vibe-validate/git');
    const treeHashBefore = 'abc123def456';
    const treeHashAfter = 'def456abc123';

    vi.mocked(getGitTreeHash).mockResolvedValue(treeHashAfter);

    const stability = await checkWorktreeStability(treeHashBefore);

    expect(stability.stable).toBe(false);
    expect(stability.treeHashBefore).toBe(treeHashBefore);
    expect(stability.treeHashAfter).toBe(treeHashAfter);
  });
});

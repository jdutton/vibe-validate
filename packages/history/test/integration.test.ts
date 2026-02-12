/**
 * Integration tests for validation history
 * These tests verify the full workflow works together
 */

import type { ValidationResult } from '@vibe-validate/core';
import type { TreeHash, TreeHashResult } from '@vibe-validate/git';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import {
  recordValidationHistory,
  checkWorktreeStability,
  checkHistoryHealth,
  pruneHistoryByAge,
} from '../src/index.js';

// Mock dependencies
vi.mock('@vibe-validate/git', () => ({
  getGitTreeHash: vi.fn(() => Promise.resolve({
    hash: 'abc123def456' as TreeHash,
  })),
  hasWorkingTreeChanges: vi.fn(() => Promise.resolve(false)),
  getCurrentBranch: vi.fn(() => 'main'),
  getHeadCommitSha: vi.fn(() => '9abc3c4'),
  addNote: vi.fn(() => true),
  mergeAppendRuns: vi.fn(), // merge strategy passed to addNote
  listNoteObjects: vi.fn(() => []),
  executeGitCommand: vi.fn(() => ({ success: false, stdout: '', stderr: '', exitCode: 1 })),
}));

vi.mock('child_process', () => ({
  execSync: vi.fn((cmd: string) => {
    if (cmd.includes('rev-parse --abbrev-ref HEAD')) return 'main\n';
    if (cmd.includes('rev-parse HEAD')) return '9abc3c4\n';
    if (cmd.includes('git notes')) return '';
    return '';
  }),
}));

// Integration test fs/reader mocks - broader scope than recorder (includes all reader exports)
vi.mock('fs', () => ({ writeFileSync: vi.fn(), unlinkSync: vi.fn(), existsSync: vi.fn(() => false) }));

vi.mock('../src/reader.js', () => ({
  readHistoryNote: vi.fn(() => Promise.resolve(null)),
  listHistoryTreeHashes: vi.fn(() => Promise.resolve([])),
  getAllHistoryNotes: vi.fn(() => Promise.resolve([])),
  hasHistoryForTree: vi.fn(() => Promise.resolve(false)),
}));

describe('History Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should complete full validation recording workflow', async () => {
    const { getGitTreeHash } = await import('@vibe-validate/git');
    const treeHash = 'abc123def456' as TreeHash;
    const treeHashResult: TreeHashResult = {
      hash: treeHash,
    };

    vi.mocked(getGitTreeHash).mockResolvedValue(treeHashResult);

    // 1. Get tree hash before validation
    const treeHashBefore = await getGitTreeHash();
    expect(treeHashBefore.hash).toBe(treeHash);

    // 2. Simulate validation
    const result: ValidationResult = {
      passed: true,
      timestamp: new Date().toISOString(),
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

    // 3. Check stability
    const stability = await checkWorktreeStability(treeHashBefore.hash);
    expect(stability.stable).toBe(true);

    // 4. Record if stable
    if (stability.stable) {
      const recordResult = await recordValidationHistory(treeHashBefore, result);
      expect(recordResult.recorded).toBe(true);
    }
  });

  it('should skip recording when worktree changes during validation', async () => {
    const { getGitTreeHash } = await import('@vibe-validate/git');
    const treeHashBefore = 'abc123def456' as TreeHash;
    const treeHashAfter = 'def456abc123' as TreeHash;
    const treeHashResultBefore: TreeHashResult = {
      hash: treeHashBefore,
    };
    const treeHashResultAfter: TreeHashResult = {
      hash: treeHashAfter,
    };

    // Mock tree hash changing
    vi.mocked(getGitTreeHash)
      .mockResolvedValueOnce(treeHashResultBefore)
      .mockResolvedValueOnce(treeHashResultAfter);

    // 1. Get tree hash before
    const before = await getGitTreeHash();

    // 2. Simulate validation (result would be recorded in real code)
    // const result: ValidationResult = {
    //   passed: true,
    //   timestamp: new Date().toISOString(),
    //   treeHash: before.hash,
    // };

    // 3. Check stability (should detect change)
    const stability = await checkWorktreeStability(before.hash);
    expect(stability.stable).toBe(false);

    // 4. Should NOT record
    // (In real code, we'd skip recording here)
  });

  it('should check history health', async () => {
    const health = await checkHistoryHealth();

    expect(health).toHaveProperty('totalNotes');
    expect(health).toHaveProperty('oldNotesCount');
    expect(health).toHaveProperty('shouldWarn');
  });

  it('should prune old history', async () => {
    const pruneResult = await pruneHistoryByAge(90, {}, true); // dry run

    expect(pruneResult).toHaveProperty('notesPruned');
    expect(pruneResult).toHaveProperty('runsPruned');
    expect(pruneResult).toHaveProperty('notesRemaining');
    expect(pruneResult).toHaveProperty('prunedTreeHashes');
  });
});

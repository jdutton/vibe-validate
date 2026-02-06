import type { TreeHashResult, TreeHash } from '@vibe-validate/git';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { findCachedValidation } from '../src/lookup.js';
import * as reader from '../src/reader.js';
import type { HistoryNote, ValidationRun } from '../src/types.js';

vi.mock('../src/reader.js');

/**
 * Helper: Create mock ValidationRun
 */
function createMockRun(overrides?: Partial<ValidationRun>): ValidationRun {
  return {
    id: 'run-1',
    timestamp: '2025-01-01T00:00:00Z',
    duration: 1000,
    passed: true,
    branch: 'main',
    headCommit: 'abc',
    uncommittedChanges: false,
    result: { passed: true, phases: [] } as any,
    ...overrides,
  };
}

/**
 * Helper: Mock readHistoryNote with runs
 */
function mockNoteWithRuns(runs: ValidationRun[]): void {
  const mockNote: HistoryNote = {
    treeHash: 'abc123',
    runs,
  };
  vi.mocked(reader.readHistoryNote).mockResolvedValue(mockNote);
}

describe('findCachedValidation', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should return null when no note exists', async () => {
    vi.mocked(reader.readHistoryNote).mockResolvedValue(null);

    const treeHashResult: TreeHashResult = { hash: 'abc123' as TreeHash };
    const result = await findCachedValidation(treeHashResult);

    expect(result).toBeNull();
  });

  it('should find exact match with no submodules', async () => {
    const mockRun = createMockRun();
    mockNoteWithRuns([mockRun]);

    const treeHashResult: TreeHashResult = { hash: 'abc123' as TreeHash };
    const result = await findCachedValidation(treeHashResult);

    expect(result).toBe(mockRun);
  });

  it('should find exact match with matching submodules', async () => {
    const mockRun = createMockRun({
      submoduleHashes: { 'libs/auth': 'def456' },
    });
    mockNoteWithRuns([mockRun]);

    const treeHashResult: TreeHashResult = {
      hash: 'abc123' as TreeHash,
      submoduleHashes: { 'libs/auth': 'def456' as TreeHash },
    };

    const result = await findCachedValidation(treeHashResult);

    expect(result).toBe(mockRun);
  });

  it('should return null when submodule hash differs', async () => {
    const mockRun = createMockRun({
      submoduleHashes: { 'libs/auth': 'def456' },
    });
    mockNoteWithRuns([mockRun]);

    const treeHashResult: TreeHashResult = {
      hash: 'abc123' as TreeHash,
      submoduleHashes: { 'libs/auth': '999aaa' as TreeHash }, // Different!
    };

    const result = await findCachedValidation(treeHashResult);

    expect(result).toBeNull();
  });

  it('should return null when submodule is added', async () => {
    const mockRun = createMockRun(); // No submoduleHashes
    mockNoteWithRuns([mockRun]);

    const treeHashResult: TreeHashResult = {
      hash: 'abc123' as TreeHash,
      submoduleHashes: { 'libs/auth': 'def456' as TreeHash }, // NEW submodule!
    };

    const result = await findCachedValidation(treeHashResult);

    expect(result).toBeNull();
  });

  it('should return null when submodule is removed', async () => {
    const mockRun = createMockRun({
      submoduleHashes: { 'libs/auth': 'def456' },
    });
    mockNoteWithRuns([mockRun]);

    const treeHashResult: TreeHashResult = {
      hash: 'abc123' as TreeHash,
      // No submoduleHashes - removed!
    };

    const result = await findCachedValidation(treeHashResult);

    expect(result).toBeNull();
  });

  it('should find correct run among multiple runs', async () => {
    const mockRun1 = createMockRun({
      id: 'run-1',
      submoduleHashes: { 'libs/auth': 'def456' },
    });

    const mockRun2 = createMockRun({
      id: 'run-2',
      timestamp: '2025-01-02T00:00:00Z',
      duration: 2000,
      headCommit: 'xyz',
      submoduleHashes: { 'libs/auth': '999aaa' }, // Different submodule state
    });

    mockNoteWithRuns([mockRun1, mockRun2]);

    const treeHashResult: TreeHashResult = {
      hash: 'abc123' as TreeHash,
      submoduleHashes: { 'libs/auth': '999aaa' as TreeHash },
    };

    const result = await findCachedValidation(treeHashResult);

    expect(result).toBe(mockRun2); // Should find second run
  });
});

// packages/history/test/schemas.test.ts
import { describe, it, expect } from 'vitest';

import { HistoryNoteSchema, ValidationRunSchema } from '../src/schemas.js';

describe('HistoryNoteSchema', () => {
  it('should accept note with treeHash and empty runs', () => {
    const note = {
      treeHash: 'abc123',
      runs: []
    };

    const result = HistoryNoteSchema.safeParse(note);
    expect(result.success).toBe(true);
  });

  it('should accept note without treeHash (inferred from ref path)', () => {
    const note = {
      runs: []
    };

    const result = HistoryNoteSchema.safeParse(note);
    expect(result.success).toBe(true);
  });

  it('should reject note missing runs array', () => {
    const note = {
      treeHash: 'hash'
    };

    const result = HistoryNoteSchema.safeParse(note);
    expect(result.success).toBe(false);
  });
});

describe('ValidationRunSchema', () => {
  it('should accept run without submoduleHashes', () => {
    const run = {
      id: 'run-123',
      timestamp: '2025-10-21T14:00:00.000Z',
      duration: 2000,
      passed: true,
      branch: 'main',
      headCommit: '123abc',
      uncommittedChanges: false,
      result: {
        passed: true,
        timestamp: '2025-10-21T14:00:00.000Z',
        treeHash: 'abc123'
      }
    };

    const result = ValidationRunSchema.safeParse(run);
    expect(result.success).toBe(true);
  });

  it('should accept run with submoduleHashes', () => {
    const run = {
      id: 'run-123',
      timestamp: '2025-10-21T14:00:00.000Z',
      duration: 2000,
      passed: true,
      branch: 'main',
      headCommit: '123abc',
      uncommittedChanges: false,
      submoduleHashes: {
        'libs/auth': 'sub-hash-def',
        'vendor/foo': 'sub-hash-ghi'
      },
      result: {
        passed: true,
        timestamp: '2025-10-21T14:00:00.000Z',
        treeHash: 'abc123'
      }
    };

    const result = ValidationRunSchema.safeParse(run);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.submoduleHashes).toBeDefined();
      expect(result.data.submoduleHashes).toEqual({
        'libs/auth': 'sub-hash-def',
        'vendor/foo': 'sub-hash-ghi'
      });
    }
  });
});

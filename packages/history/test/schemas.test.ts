// packages/history/test/schemas.test.ts
import { describe, it, expect } from 'vitest';

import { HistoryNoteSchema } from '../src/schemas.js';

describe('HistoryNoteSchema', () => {
  it('should accept note without repoTreeHashes (backward compat)', () => {
    const note = {
      treeHash: 'abc123',
      runs: []
    };

    const result = HistoryNoteSchema.safeParse(note);
    expect(result.success).toBe(true);
  });

  it('should accept note with repoTreeHashes', () => {
    const note = {
      treeHash: 'composite-hash',
      repoTreeHashes: {
        '.': 'main-hash',
        'libs/auth': 'sub-hash'
      },
      runs: []
    };

    const result = HistoryNoteSchema.safeParse(note);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.repoTreeHashes).toBeDefined();
      expect(result.data.repoTreeHashes).toEqual({
        '.': 'main-hash',
        'libs/auth': 'sub-hash'
      });
    }
  });

  it('should accept empty repoTreeHashes object', () => {
    const note = {
      treeHash: 'hash',
      repoTreeHashes: {},
      runs: []
    };

    const result = HistoryNoteSchema.safeParse(note);
    expect(result.success).toBe(true);
  });
});

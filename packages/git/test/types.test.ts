// packages/git/test/types.test.ts
import { describe, it, expect } from 'vitest';

import type { TreeHash, TreeHashResult } from '../src/types.js';

describe('TreeHashResult', () => {
  it('should be exported from types module', () => {
    // This test verifies the type exists at compile time
    const typeCheck = (result: TreeHashResult): TreeHashResult => result;
    expect(typeCheck).toBeDefined();
  });

  it('should have hash property of type TreeHash', () => {
    const result: TreeHashResult = {
      hash: 'abc123' as TreeHash
    };

    expect(result.hash).toBe('abc123');
    expect(result.submoduleHashes).toBeUndefined();
  });

  it('should support submoduleHashes with multiple submodule paths', () => {
    const result: TreeHashResult = {
      hash: 'mainHash' as TreeHash,
      submoduleHashes: {
        'libs/auth': 'sub1' as TreeHash,
        'vendor/foo': 'sub2' as TreeHash
      }
    };

    expect(result.hash).toBe('mainHash');
    expect(result.submoduleHashes).toBeDefined();
    expect(Object.keys(result.submoduleHashes!)).toHaveLength(2);
    expect(result.submoduleHashes!['libs/auth']).toBe('sub1');
    expect(result.submoduleHashes!['vendor/foo']).toBe('sub2');
  });
});

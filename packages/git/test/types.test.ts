// packages/git/test/types.test.ts
import { describe, it, expect } from 'vitest';

import type { TreeHash, TreeHashResult } from '../src/types.js';

describe('TreeHashResult', () => {
  it('should be exported from types module', () => {
    // This test verifies the type exists at compile time
    const typeCheck = (result: TreeHashResult): TreeHashResult => result;
    expect(typeCheck).toBeDefined();
  });

  it('should have hash property of type TreeHash and components array', () => {
    const result: TreeHashResult = {
      hash: 'abc123' as TreeHash,
      components: [
        { path: '.', treeHash: 'abc123' as TreeHash }
      ]
    };

    expect(result.hash).toBe('abc123');
    expect(result.components).toHaveLength(1);
    expect(result.components[0].path).toBe('.');
  });

  it('should support composite tree hashes with multiple component paths', () => {
    const result: TreeHashResult = {
      hash: 'composite' as TreeHash,
      components: [
        { path: '.', treeHash: 'main' as TreeHash },
        { path: 'libs/auth', treeHash: 'sub1' as TreeHash },
        { path: 'vendor/foo', treeHash: 'sub2' as TreeHash }
      ]
    };

    expect(result.components).toHaveLength(3);
  });
});

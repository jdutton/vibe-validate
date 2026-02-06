// packages/git/test/tree-hash-composite.test.ts
import { describe, it, expect } from 'vitest';

import { computeCompositeHash } from '../src/tree-hash.js';
import type { TreeHash } from '../src/types.js';

describe('computeCompositeHash', () => {
  it('should compute deterministic hash for single component', () => {
    const components = [
      { path: '.', treeHash: 'abc123' as TreeHash }
    ];

    const hash1 = computeCompositeHash(components);
    const hash2 = computeCompositeHash(components);

    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64); // SHA-256 = 64 hex chars
  });

  it('should compute deterministic hash for multiple components', () => {
    const components = [
      { path: '.', treeHash: 'main-hash' as TreeHash },
      { path: 'libs/auth', treeHash: 'sub1-hash' as TreeHash },
      { path: 'vendor/foo', treeHash: 'sub2-hash' as TreeHash }
    ];

    const hash1 = computeCompositeHash(components);
    const hash2 = computeCompositeHash(components);

    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64);
  });

  it('should produce same hash regardless of input order', () => {
    const components1 = [
      { path: '.', treeHash: 'main' as TreeHash },
      { path: 'libs/auth', treeHash: 'sub1' as TreeHash },
      { path: 'vendor/foo', treeHash: 'sub2' as TreeHash }
    ];

    const components2 = [
      { path: 'vendor/foo', treeHash: 'sub2' as TreeHash },
      { path: '.', treeHash: 'main' as TreeHash },
      { path: 'libs/auth', treeHash: 'sub1' as TreeHash }
    ];

    expect(computeCompositeHash(components1)).toBe(computeCompositeHash(components2));
  });

  it('should produce different hash when content changes', () => {
    const components1 = [
      { path: '.', treeHash: 'abc123' as TreeHash }
    ];

    const components2 = [
      { path: '.', treeHash: 'def456' as TreeHash }
    ];

    expect(computeCompositeHash(components1)).not.toBe(computeCompositeHash(components2));
  });

  it('should produce different hash when submodules change', () => {
    const components1 = [
      { path: '.', treeHash: 'main' as TreeHash },
      { path: 'libs/auth', treeHash: 'sub-v1' as TreeHash }
    ];

    const components2 = [
      { path: '.', treeHash: 'main' as TreeHash },
      { path: 'libs/auth', treeHash: 'sub-v2' as TreeHash }
    ];

    expect(computeCompositeHash(components1)).not.toBe(computeCompositeHash(components2));
  });
});

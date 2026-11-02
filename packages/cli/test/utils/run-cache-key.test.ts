/**
 * Tests for the nested `vv run` cache key
 */

import { encodeRunCacheKey, type TreeHash } from '@vibe-validate/git';
import { describe, it, expect } from 'vitest';

import { runCacheKeyFor } from '../../src/utils/run-cache-key.js';

const A = 'a'.repeat(40) as TreeHash;
const B = 'b'.repeat(40) as TreeHash;

describe('runCacheKeyFor', () => {
  it('is the plain command+workdir key when there are no submodules (existing keys unchanged)', () => {
    expect(runCacheKeyFor('npm test', 'packages/cli', {})).toBe(encodeRunCacheKey('npm test', 'packages/cli'));
    expect(runCacheKeyFor('npm test', '', { submoduleHashes: {} })).toBe(encodeRunCacheKey('npm test', ''));
  });

  it('changes when a submodule hash changes (a change inside a submodule is a new key)', () => {
    const before = runCacheKeyFor('npm test', '', { submoduleHashes: { 'libs/a': A } });
    const after = runCacheKeyFor('npm test', '', { submoduleHashes: { 'libs/a': B } });

    expect(after).not.toBe(before);
    expect(before).not.toBe(encodeRunCacheKey('npm test', ''));
  });

  it('changes when a submodule is added', () => {
    const one = runCacheKeyFor('npm test', '', { submoduleHashes: { 'libs/a': A } });
    const two = runCacheKeyFor('npm test', '', { submoduleHashes: { 'libs/a': A, 'libs/b': B } });

    expect(two).not.toBe(one);
  });

  it('does not depend on the order submodules are listed in', () => {
    const ab = runCacheKeyFor('npm test', '', { submoduleHashes: { 'libs/a': A, 'libs/b': B } });
    const ba = runCacheKeyFor('npm test', '', { submoduleHashes: { 'libs/b': B, 'libs/a': A } });

    expect(ba).toBe(ab);
  });

  it('is safe in a git ref path', () => {
    const key = runCacheKeyFor('npm test', '', { submoduleHashes: { 'libs/a': A } });

    expect(key).toMatch(/^[0-9a-f-]+$/);
  });
});

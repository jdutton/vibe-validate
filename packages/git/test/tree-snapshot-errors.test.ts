/**
 * How `getGitTreeSnapshot` CLASSIFIES a thrown error.
 *
 * `null` is a documented, ordinary outcome — "this is not a repository I can
 * answer about" — so every failure returning `null` looks identical at the call
 * site. The only thing separating an expected decline from a fault in our own
 * code is whether a warning was emitted, which makes `console.warn` the sole
 * observable and these tests the only place the distinction is pinned.
 *
 * Deliberately a UNIT test with `./temp-index.js` mocked, unlike
 * `tree-snapshot.integration.test.ts` next door. The block under test is pure
 * classification over an `Error.message`: a real repository cannot produce a
 * `TypeError` from our parser on demand, and the five message shapes below come
 * from git, from Node's spawn layer, and from a future defect respectively — no
 * fixture can emit all three. Mocking here restates nothing, because the
 * assertion is about the branch taken, not about what git said.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getGitTreeSnapshot } from '../src/tree-snapshot.js';

vi.mock('../src/temp-index.js', () => ({
  withStagedTempIndex: vi.fn(),
}));

const tempIndex = await import('../src/temp-index.js');

/** Make the next snapshot attempt fail the way `error` describes. */
function throwFromTempIndex(error: unknown): void {
  vi.mocked(tempIndex.withStagedTempIndex).mockImplementation(() => {
    throw error;
  });
}

describe('getGitTreeSnapshot error classification', () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  // Each of these is a real message from git or from Node's spawn layer, and
  // each means the same thing: there is no repository here to answer about.
  // Testing them individually is not redundancy — the regex has five
  // alternatives, and before these existed only the first was ever reached, so
  // deleting any of the other four was a free mutation.
  const expectedDeclines = [
    ['git, no repository', 'fatal: not a git repository (or any of the parent directories): .git'],
    ['git, no repository, uppercase', 'FATAL: Not A Git Repository (or any of the parent directories): .git'],
    ['git, bare repository', 'fatal: this operation must be run in a work tree'],
    ['git, not a work tree', 'fatal: not a git work tree'],
    ['spawn, missing directory', "spawn git ENOENT"],
    ['spawn, missing path', "ENOENT: no such file or directory, chdir '/nope'"],
  ] as const;

  it.each(expectedDeclines)(
    'returns null silently for an expected decline (%s)',
    (_label, message) => {
      throwFromTempIndex(new Error(message));

      expect(getGitTreeSnapshot({ cwd: '/some/path' })).toBeNull();
      expect(warn).not.toHaveBeenCalled();
    },
  );

  it('warns, and still returns null, when the fault is our own', () => {
    // A TypeError from the parser is the case the classification exists for: it
    // would otherwise reach every call site wearing the same `null` as "no
    // repository here", leaving no trace anywhere that a defect had run.
    throwFromTempIndex(new TypeError("Cannot read properties of undefined (reading 'split')"));

    expect(getGitTreeSnapshot({ cwd: '/some/path' })).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);

    const message = String(warn.mock.calls[0]?.[0]);
    // The cwd is the one piece of context that makes the warning actionable —
    // this function is called against many roots in one process.
    expect(message).toContain('/some/path');
    expect(message).toContain("Cannot read properties of undefined");
  });

  it('warns when a non-Error is thrown, which no message test can classify', () => {
    throwFromTempIndex('a bare string');

    expect(getGitTreeSnapshot({ cwd: '/some/path' })).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('a bare string');
  });

  it('classifies on the message, not on the error being a plain Error', () => {
    // Guards the inverse of the test above: a subclass carrying an expected
    // message must stay silent, or every ENOENT from a legitimately absent
    // directory becomes console noise on a normal run.
    class SpawnError extends Error {}
    throwFromTempIndex(new SpawnError('spawn git ENOENT'));

    expect(getGitTreeSnapshot({ cwd: '/some/path' })).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it('warns for a BROKEN SUBMODULE, which git also calls "not a git repository"', () => {
    // The message git emits when `.git/modules/<name>` is missing. The
    // repository itself is fine -- `write-tree` on it succeeds -- so classifying
    // this as an expected decline returned `null` for a corpus that exists, with
    // nothing logged anywhere. Git appends "(or any of the parent directories)"
    // only when discovery genuinely came up empty, and that is the whole
    // difference between the two.
    throwFromTempIndex(new Error('fatal: not a git repository: sub/../.git/modules/sub'));

    expect(getGitTreeSnapshot({ cwd: '/some/path' })).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('modules/sub');
  });
});

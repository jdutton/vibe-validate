/**
 * Run Cache Key
 *
 * The key a nested `vv run` result is stored and looked up under.
 */

import { createHash } from 'node:crypto';

import { encodeRunCacheKey, type TreeHashResult } from '@vibe-validate/git';

/**
 * The `vv run` cache key for a command in a worktree
 *
 * The note sits under the parent repo's tree hash, which does not change when
 * a file inside a submodule does. So the key also carries a digest of the
 * submodule hashes (sorted by path, so their order never matters); without it
 * a change inside a submodule would hit the old green.
 *
 * A worktree without submodules gets the plain command+workdir key, so the
 * keys already stored for such repos stay valid.
 *
 * @param command - The command (as `vv run` received it)
 * @param workdir - Working directory relative to the git root ('' for the root)
 * @param treeHashResult - The worktree's tree hash result (its submodule hashes, if any)
 * @returns A key safe for use in a git ref path
 */
export function runCacheKeyFor(
  command: string,
  workdir: string,
  treeHashResult: Pick<TreeHashResult, 'submoduleHashes'>
): string {
  const baseKey = encodeRunCacheKey(command, workdir);
  const entries = Object.entries(treeHashResult.submoduleHashes ?? {});
  if (entries.length === 0) {
    return baseKey;
  }

  const digestInput = entries
    .toSorted(([a], [b]) => (a < b ? -1 : Number(a > b)))
    .map(([path, hash]) => `${path}\0${hash}\n`)
    .join('');
  const submoduleDigest = createHash('sha256').update(digestInput).digest('hex').substring(0, 16);
  return `${baseKey}-${submoduleDigest}`;
}

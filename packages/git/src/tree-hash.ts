/**
 * Deterministic Git Tree Hash Calculation
 *
 * Provides content-based hashing of working tree state including:
 * - Staged changes (index)
 * - Unstaged changes (working tree modifications)
 * - Untracked files
 *
 * CRITICAL FIX: Uses git write-tree instead of git stash create for determinism.
 * git stash create includes timestamps, making hashes non-deterministic.
 * git write-tree produces content-based hashes only (no timestamps).
 *
 * The throwaway-index mechanism this relies on lives in `./temp-index.js` and is
 * shared with {@link "./tree-snapshot".getGitTreeSnapshot}.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { executeGitCommand } from './git-executor.js';
import { withStagedTempIndex } from './temp-index.js';
import type { TreeHash, TreeHashResult } from './types.js';

const GIT_TIMEOUT = 30000; // 30 seconds timeout for git operations

/**
 * Get deterministic git tree hash representing current working tree state
 *
 * Implementation:
 * 1. Stage the whole working tree into a throwaway index (see `./temp-index.js`)
 * 2. Calculate tree hash with git write-tree using that index
 * 3. Detect and process git submodules (recursive)
 * 4. Return parent hash + optional submodule hashes
 *
 * Why this is better than git stash create:
 * - git stash create: includes timestamps in commit → different hash each time
 * - git write-tree: content-based only → same content = same hash (deterministic)
 *
 * Submodule Support (Issue #120):
 * - Detects submodules via `git submodule status`
 * - Recursively calculates tree hash for each submodule
 * - Returns TreeHashResult with parent hash + submodule hashes
 * - Working tree changes in submodules invalidate cache
 * - Git notes store full result for state reconstruction
 *
 * IMPORTANT: This function returns a structured result object, NOT a composite hash.
 * Git notes store the TreeHashResult as-is. The hash field is the parent repo's
 * standard Git SHA-1 hash (40 hex characters). The optional submoduleHashes field
 * records each submodule's tree hash separately.
 *
 * Cache key format in git notes (v0.19.0+):
 * - Parent-only repos: Use parent hash directly (backward compatible)
 * - Repos with submodules: Use parent hash + submodule metadata
 * - Result structure stored in git notes for state reconstruction
 *
 * AMBIENT BY CONTRACT: this function takes no path, so it means "the repository
 * I am in" — and inside a git hook the exported `GIT_DIR` *is* the repository
 * the caller is in. It therefore honours the inherited git environment rather
 * than scrubbing it. A caller that has a specific path in mind wants
 * {@link "./tree-snapshot".getGitTreeSnapshot}, which takes a `cwd` and scrubs.
 *
 * @returns TreeHashResult containing:
 *   - hash: Parent repository tree hash (Git SHA-1, 40 hex chars)
 *   - submoduleHashes: Optional record of submodule paths to tree hashes
 *
 * @example
 * // Repository without submodules (0.18.x compatible)
 * const result = await getGitTreeHash();
 * // { hash: 'abc123...' }
 *
 * @example
 * // Repository with submodules (v0.19.0+)
 * const result = await getGitTreeHash();
 * // {
 * //   hash: 'abc123...',  // Parent repo hash
 * //   submoduleHashes: {
 * //     'libs/auth': 'xyz789...'
 * //   }
 * // }
 *
 * @throws Error if not in a git repository or git command fails
 */
export async function getGitTreeHash(): Promise<TreeHashResult> {
  try {
    // Content-based, no timestamps. The throwaway index is created, used and
    // removed entirely within this call.
    const parentHash = withStagedTempIndex(
      {},
      ({ runGit }) => runGit(['write-tree']).stdout.trim() as TreeHash,
    );

    // Detect submodules
    const submodules = getSubmodules();

    // No submodules - simple case (0.18.x compatible)
    if (submodules.length === 0) {
      return { hash: parentHash };
    }

    // Build submodule hashes record
    const submoduleHashes: Record<string, TreeHash> = {};

    // Add submodule hashes (sorted by path for determinism)
    const sortedSubmodules = submodules.toSorted((a, b) => a.path.localeCompare(b.path));
    for (const sub of sortedSubmodules) {
      // Skip uninitialized submodules (status '-')
      if (sub.status === '-') {
        continue;
      }

      try {
        const subResult = await getSubmoduleTreeHash(sub.path);
        // Store the submodule's hash in the record
        submoduleHashes[sub.path] = subResult.hash;
      } catch (error) {
        // Log warning but continue with other submodules
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.warn(`⚠️  Failed to hash submodule ${sub.path}: ${errorMsg}`);
      }
    }

    return {
      hash: parentHash,
      submoduleHashes,
    };
  } catch (error) {
    // Handle not-in-git-repo case
    const errorMessage = error instanceof Error ? error.message : String(error);

    if (errorMessage.includes('not a git repository')) {
      // Not in git repo - return "unknown" (caller should skip caching)
      return {
        hash: 'unknown' as TreeHash
      };
    }

    // Other git errors
    throw new Error(`Failed to calculate git tree hash: ${errorMessage}`);
  }
}

/**
 * Get tree hash for HEAD commit (committed state only, no working tree changes)
 *
 * This is useful for comparing committed state vs working tree state.
 *
 * @returns Git tree SHA-1 hash of HEAD commit as branded TreeHash type
 * @throws Error if not in a git repository or HEAD doesn't exist
 */
export async function getHeadTreeHash(): Promise<TreeHash> {
  try {
    const treeHash = executeGitCommand(['rev-parse', 'HEAD^{tree}'], {
      timeout: GIT_TIMEOUT
    }).stdout.trim();
    return treeHash as TreeHash;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to get HEAD tree hash: ${errorMessage}`);
  }
}

/**
 * Check if working tree has any changes compared to HEAD
 *
 * @returns true if working tree differs from HEAD, false if clean
 */
export async function hasWorkingTreeChanges(): Promise<boolean> {
  try {
    const workingTreeHash = await getGitTreeHash();
    const headTreeHash = await getHeadTreeHash();
    return workingTreeHash.hash !== headTreeHash;
  } catch {
    // If we can't determine, assume there are changes (safe default)
    return true;
  }
}

/**
 * Submodule information from git submodule status
 * @internal Exported for testing
 */
export interface SubmoduleInfo {
  /** Submodule path relative to repo root */
  path: string;
  /** Status character (' '=clean, '+'=modified, '-'=uninitialized, 'U'=conflict) */
  status: string;
}

/**
 * Get list of git submodules in current repository
 *
 * Parses output of `git submodule status` to detect submodules.
 * Returns empty array if no submodules or command fails.
 *
 * Output format: " abc123 libs/auth (heads/main)"
 *                 ^^^^^^  ^^^^^^^^^ (description)
 *                 hash    path
 *
 * @returns Array of submodule information
 *
 * @example
 * const submodules = getSubmodules();
 * // [{ path: 'libs/auth', status: ' ' }, { path: 'vendor/foo', status: '+' }]
 *
 * @internal Exported for testing
 */
export function getSubmodules(): SubmoduleInfo[] {
  // Fast path: if .gitmodules doesn't exist, there are no submodules
  // Avoids 684ms git submodule status call in repos without submodules
  try {
    const repoRoot = executeGitCommand(['rev-parse', '--show-toplevel'], {
      timeout: 5000,
      ignoreErrors: true,
    });
    if (repoRoot.success) {
      const gitmodulesPath = join(repoRoot.stdout.trim(), '.gitmodules');
      if (!existsSync(gitmodulesPath)) {
        return [];
      }
    }
  } catch (error) {
    // Fall through to git submodule status
    // Only log in debug mode to avoid noise
    if (process.env.VV_DEBUG === '1') {
      console.error('[vv debug] .gitmodules fast-path check failed:', error instanceof Error ? error.message : String(error));
    }
  }

  const result = executeGitCommand(['submodule', 'status'], {
    ignoreErrors: true,
    timeout: GIT_TIMEOUT
  });

  if (!result.success) {
    return []; // No submodules or error
  }

  const submodules: SubmoduleInfo[] = [];

  for (const line of result.stdout.split('\n')) {
    if (!line.trim()) continue;

    // Parse: " abc123 libs/auth (heads/main)"
    // Group 1: commit hash, Group 2: path
    const match = /^\s*[+-]?([a-f0-9]+)\s+(\S+)/.exec(line);
    if (!match) continue;

    submodules.push({
      path: match[2],
      status: line[0] || ' ' // First char is status
    });
  }

  return submodules;
}

/**
 * Calculate tree hash for a git submodule (recursive)
 *
 * Changes to submodule directory, calculates tree hash, then returns to original directory.
 * This is recursive - if the submodule has its own submodules, they will be included.
 *
 * @param submodulePath - Path to submodule relative to current directory
 * @returns Tree hash result for the submodule
 *
 * @example
 * const result = await getSubmoduleTreeHash('libs/auth');
 * // Returns TreeHashResult for libs/auth submodule
 *
 * @internal Exported for testing
 */
export async function getSubmoduleTreeHash(submodulePath: string): Promise<TreeHashResult> {
  const originalCwd = process.cwd();
  try {
    process.chdir(submodulePath);
    // Recursive! If submodule has submodules, they'll be included
    return await getGitTreeHash();
  } finally {
    process.chdir(originalCwd);
  }
}

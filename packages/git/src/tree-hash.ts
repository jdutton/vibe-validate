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
 */

import { execSync } from 'child_process';

const GIT_TIMEOUT = 30000; // 30 seconds timeout for git operations
const GIT_OPTIONS = {
  encoding: 'utf8' as const,
  timeout: GIT_TIMEOUT,
  stdio: ['pipe', 'pipe', 'ignore'] as ['pipe', 'pipe', 'ignore'],
};

/**
 * Get deterministic git tree hash representing current working tree state
 *
 * Implementation:
 * 1. Create temporary index file (doesn't affect real index)
 * 2. Copy current index to temporary index
 * 3. Mark untracked files with --intent-to-add in temp index
 * 4. Calculate tree hash with git write-tree using temp index
 * 5. Clean up temp index file
 *
 * Why this is better than git stash create:
 * - git stash create: includes timestamps in commit → different hash each time
 * - git write-tree: content-based only → same content = same hash (deterministic)
 *
 * CRITICAL: Uses GIT_INDEX_FILE to avoid corrupting real index during git commit hooks
 *
 * @returns Git tree SHA-1 hash (40 hex characters)
 * @throws Error if not in a git repository or git command fails
 */
export async function getGitTreeHash(): Promise<string> {
  try {
    // Check if we're in a git repository
    execSync('git rev-parse --is-inside-work-tree', GIT_OPTIONS);

    // Get git directory and create temp index path
    const gitDir = execSync('git rev-parse --git-dir', GIT_OPTIONS).trim();
    const tempIndexFile = `${gitDir}/vibe-validate-temp-index`;

    try {
      // Step 1: Copy current index to temp index
      const currentIndex = `${gitDir}/index`;
      execSync(`cp "${currentIndex}" "${tempIndexFile}"`, GIT_OPTIONS);

      // Step 2: Use temp index for all operations (doesn't affect real index)
      const tempIndexOptions: typeof GIT_OPTIONS & { env: NodeJS.ProcessEnv } = {
        ...GIT_OPTIONS,
        env: { ...process.env, GIT_INDEX_FILE: tempIndexFile }
      };

      // Step 3: Mark all untracked files with --intent-to-add in temp index
      try {
        execSync('git add --intent-to-add --all --force', {
          ...tempIndexOptions,
          stdio: ['pipe', 'pipe', 'pipe'] // Capture stderr for error handling
        });
      } catch (addError) {
        // If no untracked files, git add fails with "nothing to add"
        // This is fine - just means we only have tracked files
        const errorMessage = addError instanceof Error ? addError.message : String(addError);
        if (!errorMessage.includes('nothing')) {
          // Real error - re-throw
          throw addError;
        }
      }

      // Step 4: Get tree hash using temp index (content-based, no timestamps)
      const treeHash = execSync('git write-tree', tempIndexOptions).trim();

      return treeHash;

    } finally {
      // Step 5: Always clean up temp index file
      try {
        execSync(`rm -f "${tempIndexFile}"`, GIT_OPTIONS);
      } catch (_cleanupError) {
        // Ignore cleanup errors - temp file cleanup is best effort
      }
    }

  } catch (error) {
    // Handle not-in-git-repo case
    const errorMessage = error instanceof Error ? error.message : String(error);

    if (errorMessage.includes('not a git repository')) {
      // Not in git repo - fall back to timestamp-based hash
      console.warn('⚠️  Not in git repository, using timestamp-based hash');
      return `nogit-${Date.now()}`;
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
 * @returns Git tree SHA-1 hash of HEAD commit
 * @throws Error if not in a git repository or HEAD doesn't exist
 */
export async function getHeadTreeHash(): Promise<string> {
  try {
    const treeHash = execSync('git rev-parse HEAD^{tree}', GIT_OPTIONS).trim();
    return treeHash;
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
    return workingTreeHash !== headTreeHash;
  } catch (_error) {
    // If we can't determine, assume there are changes (safe default)
    return true;
  }
}

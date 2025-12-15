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

import { copyFileSync, unlinkSync } from 'node:fs';

import { executeGitCommand } from './git-executor.js';
import type { TreeHash } from './types.js';

const GIT_TIMEOUT = 30000; // 30 seconds timeout for git operations

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
 * @returns Git tree SHA-1 hash (40 hex characters) as branded TreeHash type
 * @throws Error if not in a git repository or git command fails
 */
export async function getGitTreeHash(): Promise<TreeHash> {
  try {
    // Check if we're in a git repository
    executeGitCommand(['rev-parse', '--is-inside-work-tree'], { timeout: GIT_TIMEOUT });

    // Get git directory and create temp index path
    const gitDir = executeGitCommand(['rev-parse', '--git-dir'], { timeout: GIT_TIMEOUT }).stdout.trim();
    const tempIndexFile = `${gitDir}/vibe-validate-temp-index`;

    try {
      // Step 1: Copy current index to temp index
      const currentIndex = `${gitDir}/index`;
      // SECURITY: Use Node.js fs.copyFileSync instead of shell cp command
      // Prevents potential command injection if gitDir contains malicious characters
      copyFileSync(currentIndex, tempIndexFile);

      // Step 2: Use temp index for all operations (doesn't affect real index)
      const tempIndexEnv = {
        ...process.env,
        GIT_INDEX_FILE: tempIndexFile
      };

      // Step 3: Stage all changes (tracked + untracked) in temp index
      // CRITICAL: Must use `git add --all` (NOT `--intent-to-add` or `--force`)
      //
      // Why NOT --intent-to-add:
      //   - Only adds empty placeholders, not actual file content
      //   - git write-tree skips intent-to-add entries (treats as non-existent)
      //   - Result: unstaged modifications NOT included in tree hash
      //
      // Why NOT --force:
      //   - Includes files in .gitignore (secrets, build artifacts, etc.)
      //   - Security risk: checksums API keys, passwords, credentials
      //   - Non-deterministic: different devs have different ignored files
      //   - Breaks cache sharing: same code produces different hashes
      //
      // We need actual content staged so git write-tree includes working directory changes
      const addResult = executeGitCommand(['add', '--all'], {
        timeout: GIT_TIMEOUT,
        env: tempIndexEnv,
        ignoreErrors: true
      });

      // If git add fails and it's not "nothing to add", throw error
      if (!addResult.success && !addResult.stderr.includes('nothing')) {
        // Real error - throw with details
        throw new Error(`git add failed: ${addResult.stderr}`);
      }

      // Step 4: Get tree hash using temp index (content-based, no timestamps)
      const treeHash = executeGitCommand(['write-tree'], {
        timeout: GIT_TIMEOUT,
        env: tempIndexEnv
      }).stdout.trim();

      return treeHash as TreeHash;

    } finally {
      // Step 5: Always clean up temp index file
      try {
        // SECURITY: Use Node.js fs.unlinkSync instead of shell rm command
        // Prevents potential command injection if tempIndexFile contains malicious characters
        unlinkSync(tempIndexFile);
      } catch {
        // Ignore cleanup errors - temp file cleanup is best effort
        // unlinkSync throws if file doesn't exist (same as rm -f behavior)
      }
    }

  } catch (error) {
    // Handle not-in-git-repo case
    const errorMessage = error instanceof Error ? error.message : String(error);

    if (errorMessage.includes('not a git repository')) {
      // Not in git repo - return "unknown" (caller should skip caching)
      return 'unknown' as TreeHash;
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
    return workingTreeHash !== headTreeHash;
  } catch {
    // If we can't determine, assume there are changes (safe default)
    return true;
  }
}

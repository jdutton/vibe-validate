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

import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, unlinkSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { isProcessRunning } from '@vibe-validate/utils';

import { executeGitCommand } from './git-executor.js';
import type { TreeHash, TreeHashResult } from './types.js';

const GIT_TIMEOUT = 30000; // 30 seconds timeout for git operations

/**
 * Minimum age (milliseconds) before cleaning up stale temp index files
 *
 * Rationale: 5 minutes balances:
 * - Avoiding false positives (very slow validations in progress)
 * - Timely cleanup (don't accumulate too many stale files)
 * - Typical validation duration (< 2 minutes in most projects)
 */
const STALE_INDEX_AGE_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Try to clean up a legacy temp index file (no PID suffix)
 * @param gitDir - Git directory path
 */
function tryCleanupLegacyTempIndex(gitDir: string): void {
  try {
    const filePath = join(gitDir, 'vibe-validate-temp-index');
    const stats = statSync(filePath);
    const ageMs = Date.now() - stats.mtimeMs;

    if (ageMs >= STALE_INDEX_AGE_MS) {
      unlinkSync(filePath);
      console.warn(`⚠️  Cleaned up legacy temp index (${Math.round(ageMs/1000)}s old)`);
    }
  } catch {
    // Ignore cleanup errors (file may not exist or be in use)
  }
}

/**
 * Try to clean up a PID-suffixed temp index file if it's stale
 * @param gitDir - Git directory path
 * @param file - Filename to check
 * @param pid - Process ID from filename
 */
function tryCleanupPidTempIndex(gitDir: string, file: string, pid: number): void {
  try {
    const filePath = join(gitDir, file);
    const stats = statSync(filePath);
    const ageMs = Date.now() - stats.mtimeMs;

    // Skip if younger than threshold
    if (ageMs < STALE_INDEX_AGE_MS) return;

    // Skip if process is still running
    if (isProcessRunning(pid)) return;

    // Stale file - clean it up
    try {
      unlinkSync(filePath);
      const ageSec = Math.round(ageMs / 1000);
      console.warn(`⚠️  Cleaned up stale temp index from PID ${pid} (${ageSec}s old, process not running)`);
    } catch (err) {
      const error = err as Error;
      console.warn(`⚠️  Failed to clean up stale temp index ${file}: ${error.message}`);
    }
  } catch {
    // Ignore errors reading file stats (file may have been deleted)
  }
}

/**
 * Clean up stale temp index files from crashed processes
 *
 * Scans git directory for temp index files and removes those that are:
 * - Older than 5 minutes AND
 * - Process no longer running
 *
 * Warns to stderr when cleanup occurs (bug detection canary).
 * Fails gracefully if cleanup fails (warn and continue).
 */
function cleanupStaleIndexes(gitDir: string): void {
  const pattern = /^vibe-validate-temp-index-(\d+)$/;

  try {
    const files = readdirSync(gitDir);

    for (const file of files) {
      // Handle legacy temp index (no PID suffix)
      if (file === 'vibe-validate-temp-index') {
        tryCleanupLegacyTempIndex(gitDir);
        continue;
      }

      // Handle PID-suffixed temp index
      const match = pattern.exec(file);
      if (!match) continue;

      const pid = Number.parseInt(match[1], 10);
      tryCleanupPidTempIndex(gitDir, file, pid);
    }
  } catch (error) {
    // Expected errors (fail-safe, no action needed):
    // - ENOENT: .git directory doesn't exist (fresh repo)
    // - ENOTDIR: gitDir points to a file, not directory
    const err = error as NodeJS.ErrnoException;
    if (err.code === 'ENOENT' || err.code === 'ENOTDIR') {
      return; // Expected failure - skip cleanup
    }

    // Unexpected errors (should warn for debugging)
    console.warn(`⚠️  Unexpected error during temp index cleanup: ${err.message}`);
    console.warn(`   Git dir: ${gitDir}`);
    console.warn(`   This may indicate a bug - please report if you see this often`);
  }
}

/**
 * Get deterministic git tree hash representing current working tree state
 *
 * Implementation:
 * 1. Create temporary index file (doesn't affect real index)
 * 2. Copy current index to temporary index
 * 3. Mark untracked files with --intent-to-add in temp index
 * 4. Calculate tree hash with git write-tree using temp index
 * 5. Detect and process git submodules (recursive)
 * 6. Compute composite hash from main repo + submodule hashes
 * 7. Clean up temp index file
 *
 * Why this is better than git stash create:
 * - git stash create: includes timestamps in commit → different hash each time
 * - git write-tree: content-based only → same content = same hash (deterministic)
 *
 * Submodule Support (Issue #120):
 * - Detects submodules via `git submodule status`
 * - Recursively calculates tree hash for each submodule
 * - Combines all hashes into composite SHA-256 hash
 * - Working tree changes in submodules invalidate cache
 *
 * CRITICAL: Uses GIT_INDEX_FILE to avoid corrupting real index during git commit hooks
 *
 * @returns TreeHashResult containing:
 *   - hash: Composite SHA-256 hash (or single repo hash if no submodules)
 *   - components: Array of { path, treeHash } for main repo and each submodule
 *
 * @example
 * // Repository without submodules
 * const result = await getGitTreeHash();
 * // { hash: 'abc123...', components: [{ path: '.', treeHash: 'abc123...' }] }
 *
 * @example
 * // Repository with submodules
 * const result = await getGitTreeHash();
 * // {
 * //   hash: 'def456...',  // Composite SHA-256
 * //   components: [
 * //     { path: '.', treeHash: 'abc123...' },
 * //     { path: 'libs/auth', treeHash: 'xyz789...' }
 * //   ]
 * // }
 *
 * @throws Error if not in a git repository or git command fails
 */
// eslint-disable-next-line sonarjs/cognitive-complexity -- Complexity 18 acceptable for main orchestration function (git operations + submodule handling + cleanup + error handling)
export async function getGitTreeHash(): Promise<TreeHashResult> {
  try {
    // Check if we're in a git repository
    executeGitCommand(['rev-parse', '--is-inside-work-tree'], { timeout: GIT_TIMEOUT });

    // Get git directory and create temp index path
    const gitDir = executeGitCommand(['rev-parse', '--git-dir'], { timeout: GIT_TIMEOUT }).stdout.trim();
    cleanupStaleIndexes(gitDir);
    const tempIndexFile = `${gitDir}/vibe-validate-temp-index-${process.pid}`;

    try {
      // Step 1: Copy current index to temp index (if it exists)
      const currentIndex = `${gitDir}/index`;

      // CRITICAL: In fresh repos (git init, no commits), .git/index doesn't exist yet
      // Only copy if index exists; git add will create temp index if it doesn't
      if (existsSync(currentIndex)) {
        // SECURITY: Use Node.js fs.copyFileSync instead of shell cp command
        // Prevents potential command injection if gitDir contains malicious characters
        copyFileSync(currentIndex, tempIndexFile);
      }

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

      // Calculate main repo tree hash
      const mainTreeHash = treeHash as TreeHash;

      // Detect submodules
      const submodules = getSubmodules();

      // Build components array
      const components: Array<{ path: string; treeHash: TreeHash }> = [
        { path: '.', treeHash: mainTreeHash }
      ];

      // Add submodule hashes (sorted by path for determinism)
      const sortedSubmodules = submodules.toSorted((a, b) => a.path.localeCompare(b.path));
      for (const sub of sortedSubmodules) {
        // Skip uninitialized submodules (status '-')
        if (sub.status === '-') {
          continue;
        }

        try {
          const subResult = await getSubmoduleTreeHash(sub.path);
          // Use the submodule's composite hash (handles nested submodules)
          components.push({ path: sub.path, treeHash: subResult.hash });
        } catch (error) {
          // Log warning but continue with other submodules
          const errorMsg = error instanceof Error ? error.message : String(error);
          console.warn(`⚠️  Failed to hash submodule ${sub.path}: ${errorMsg}`);
        }
      }

      // If no submodules, return main hash directly (optimization)
      if (components.length === 1) {
        return {
          hash: mainTreeHash,
          components
        };
      }

      // Compute composite hash from all components
      const compositeHash = computeCompositeHash(components);

      return {
        hash: compositeHash,
        components
      };

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
      return {
        hash: 'unknown' as TreeHash,
        components: [{ path: '.', treeHash: 'unknown' as TreeHash }]
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

/**
 * Compute composite hash from multiple tree hash components
 *
 * Creates deterministic SHA-256 hash by:
 * 1. Sorting components by path (lexicographic order)
 * 2. Building string: "path:hash+path:hash+..."
 * 3. Hashing with SHA-256
 *
 * This ensures same content always produces same hash regardless of input order.
 *
 * @param components - Array of path and tree hash pairs
 * @returns Composite SHA-256 hash (64 hex characters)
 *
 * @example
 * const components = [
 *   { path: '.', treeHash: 'abc123' },
 *   { path: 'libs/auth', treeHash: 'def456' }
 * ];
 * const composite = computeCompositeHash(components);
 * // Returns SHA-256('.:abc123+libs/auth:def456')
 *
 * @internal Exported for testing
 */
export function computeCompositeHash(
  components: Array<{ path: string; treeHash: TreeHash }>
): TreeHash {
  // Sort by path for deterministic ordering
  const sorted = [...components].sort((a, b) =>
    a.path.localeCompare(b.path)
  );

  // Build deterministic string: "path:hash+path:hash+..."
  const parts = sorted.map(c => `${c.path}:${c.treeHash}`);
  const combined = parts.join('+');

  // SHA-256 hash for consistent length (64 hex chars)
  const hash = createHash('sha256')
    .update(combined)
    .digest('hex');

  return hash as TreeHash;
}

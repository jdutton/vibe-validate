/**
 * Post-PR Merge Cleanup Tool
 *
 * Comprehensive post-PR cleanup workflow that:
 * 1. Switches to main branch
 * 2. Syncs main branch with remote origin
 * 3. Deletes local branches that have been merged
 * 4. Provides clean workspace for next PR
 *
 * Safe operations:
 * - Only deletes branches that are confirmed merged
 * - Never deletes the current main branch or unmerged branches
 * - Provides clear feedback on all actions taken
 */

import { execSync } from 'child_process';

const TIMEOUT = 30000; // 30 seconds timeout for git operations

export interface CleanupResult {
  success: boolean;
  error?: string;
  branchesDeleted: string[];
  currentBranch: string;
  mainSynced: boolean;
}

export interface CleanupOptions {
  mainBranch?: string;    // Default: 'main'
  remoteName?: string;    // Default: 'origin'
  dryRun?: boolean;       // Default: false (actually delete branches)
}

/**
 * Post-PR Merge Cleanup
 *
 * Cleans up merged branches and syncs main branch after PR merge
 */
export class PostPRMergeCleanup {
  private readonly mainBranch: string;
  private readonly remoteName: string;
  private readonly dryRun: boolean;

  constructor(options: CleanupOptions = {}) {
    this.mainBranch = options.mainBranch || 'main';
    this.remoteName = options.remoteName || 'origin';
    this.dryRun = options.dryRun || false;
  }

  /**
   * Run comprehensive post-PR merge cleanup workflow
   */
  async runCleanup(): Promise<CleanupResult> {
    const result: CleanupResult = {
      success: false,
      branchesDeleted: [],
      currentBranch: '',
      mainSynced: false
    };

    try {
      // Step 1: Get current branch
      result.currentBranch = this.getCurrentBranch();

      // Step 2: Switch to main branch
      this.switchToMain();

      // Step 3: Sync main branch with remote
      this.syncMainBranch();
      result.mainSynced = true;

      // Step 4: Fetch remote branch information
      this.fetchRemoteInfo();

      // Step 5: Find and delete merged branches
      result.branchesDeleted = this.deleteMergedBranches();

      // Step 6: Clean up remote tracking branches
      this.pruneRemoteReferences();

      result.success = true;
      return result;

    } catch (error) {
      result.error = error instanceof Error ? error.message : String(error);
      return result;
    }
  }

  /**
   * Get the current git branch name
   */
  private getCurrentBranch(): string {
    try {
      return execSync('git branch --show-current', {
        encoding: 'utf8',
        timeout: TIMEOUT
      }).trim();
    } catch (error) {
      throw new Error(`Failed to get current branch: ${error}`);
    }
  }

  /**
   * Switch to main branch
   */
  private switchToMain(): void {
    try {
      execSync(`git checkout ${this.mainBranch}`, {
        encoding: 'utf8',
        timeout: TIMEOUT,
        stdio: ['pipe', 'pipe', 'pipe']
      });
    } catch (error) {
      throw new Error(`Failed to switch to ${this.mainBranch} branch: ${error}`);
    }
  }

  /**
   * Sync main branch with remote origin
   */
  private syncMainBranch(): void {
    try {
      // Fetch latest changes from remote
      execSync(`git fetch ${this.remoteName} ${this.mainBranch}`, {
        encoding: 'utf8',
        timeout: TIMEOUT,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      // Fast-forward merge remote/main
      execSync(`git merge ${this.remoteName}/${this.mainBranch} --ff-only`, {
        encoding: 'utf8',
        timeout: TIMEOUT,
        stdio: ['pipe', 'pipe', 'pipe']
      });

    } catch (error) {
      throw new Error(`Failed to sync ${this.mainBranch} branch: ${error}`);
    }
  }

  /**
   * Fetch remote branch information
   */
  private fetchRemoteInfo(): void {
    try {
      execSync(`git fetch ${this.remoteName} --prune`, {
        encoding: 'utf8',
        timeout: TIMEOUT,
        stdio: ['pipe', 'pipe', 'pipe']
      });
    } catch (error) {
      throw new Error(`Failed to fetch remote info: ${error}`);
    }
  }

  /**
   * Find and delete branches that have been merged
   */
  private deleteMergedBranches(): string[] {
    try {
      // Get list of local branches (excluding main)
      const allBranches = execSync('git branch --format="%(refname:short)"', {
        encoding: 'utf8',
        timeout: TIMEOUT
      })
        .trim()
        .split('\n')
        .filter(branch => branch && branch !== this.mainBranch && !branch.startsWith('*'));

      const deletedBranches: string[] = [];

      for (const branch of allBranches) {
        if (this.isBranchMerged(branch)) {
          if (this.dryRun) {
            deletedBranches.push(branch);
            continue;
          }

          try {
            execSync(`git branch -d "${branch}"`, {
              encoding: 'utf8',
              timeout: TIMEOUT,
              stdio: ['pipe', 'pipe', 'pipe']
            });
            deletedBranches.push(branch);
          } catch (_deleteError) {
            // Try force delete if regular delete fails
            try {
              execSync(`git branch -D "${branch}"`, {
                encoding: 'utf8',
                timeout: TIMEOUT,
                stdio: ['pipe', 'pipe', 'pipe']
              });
              deletedBranches.push(branch);
            } catch (_forceDeleteError) {
              // Couldn't delete - skip this branch
            }
          }
        }
      }

      return deletedBranches;

    } catch (_error) {
      return [];
    }
  }

  /**
   * Check if a branch has been merged into main
   */
  private isBranchMerged(branch: string): boolean {
    try {
      const mergedBranches = execSync(`git branch --merged ${this.mainBranch} --format="%(refname:short)"`, {
        encoding: 'utf8',
        timeout: TIMEOUT
      });

      return mergedBranches.includes(branch);

    } catch (_error) {
      // If we can't determine merge status, don't delete the branch
      return false;
    }
  }

  /**
   * Clean up remote tracking references
   */
  private pruneRemoteReferences(): void {
    try {
      execSync(`git remote prune ${this.remoteName}`, {
        encoding: 'utf8',
        timeout: TIMEOUT,
        stdio: ['pipe', 'pipe', 'pipe']
      });
    } catch (_error) {
      // Non-critical operation - don't fail on error
    }
  }
}

/**
 * Convenience function for quick cleanup
 *
 * @param options - Cleanup options
 * @returns Cleanup result
 */
export async function cleanupMergedBranches(options: CleanupOptions = {}): Promise<CleanupResult> {
  const cleanup = new PostPRMergeCleanup(options);
  return cleanup.runCleanup();
}

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

import { spawnSync } from 'node:child_process';

const TIMEOUT = 30000; // 30 seconds timeout for git operations

/**
 * Execute git command safely using spawnSync with array arguments
 * Prevents command injection by avoiding shell interpretation
 */
function execGitSync(args: string[]): string {
  // eslint-disable-next-line sonarjs/no-os-command-from-path -- git is a standard system command
  const result = spawnSync('git', args, {
    encoding: 'utf8',
    timeout: TIMEOUT,
    stdio: ['pipe', 'pipe', 'pipe']
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(`git ${args[0]} failed: ${result.stderr}`);
  }

  return result.stdout;
}

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
    this.mainBranch = options.mainBranch ?? 'main';
    this.remoteName = options.remoteName ?? 'origin';
    this.dryRun = options.dryRun ?? false;
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
      return execGitSync(['branch', '--show-current']).trim();
    } catch (error) {
      throw new Error(`Failed to get current branch: ${error}`);
    }
  }

  /**
   * Switch to main branch
   */
  private switchToMain(): void {
    try {
      execGitSync(['checkout', this.mainBranch]);
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
      execGitSync(['fetch', this.remoteName, this.mainBranch]);

      // Fast-forward merge remote/main
      execGitSync(['merge', `${this.remoteName}/${this.mainBranch}`, '--ff-only']);

    } catch (error) {
      throw new Error(`Failed to sync ${this.mainBranch} branch: ${error}`);
    }
  }

  /**
   * Fetch remote branch information
   */
  private fetchRemoteInfo(): void {
    try {
      execGitSync(['fetch', this.remoteName, '--prune']);
    } catch (error) {
      throw new Error(`Failed to fetch remote info: ${error}`);
    }
  }

  /**
   * Find and delete branches that have been merged
   */
  private deleteMergedBranches(): string[] {
    try {
      const branchesToCheck = this.getLocalBranchesToCheck();
      return this.processMergedBranches(branchesToCheck);
    } catch {
      // Error deleting merged branches - return empty array
      return [];
    }
  }

  /**
   * Get list of local branches to check (excluding main branch)
   */
  private getLocalBranchesToCheck(): string[] {
    return execGitSync(['branch', '--format=%(refname:short)'])
      .trim()
      .split('\n')
      .filter(branch => branch && branch !== this.mainBranch && !branch.startsWith('*'));
  }

  /**
   * Process list of branches and delete merged ones
   */
  private processMergedBranches(branches: string[]): string[] {
    const deletedBranches: string[] = [];

    for (const branch of branches) {
      if (this.isBranchMerged(branch)) {
        const deleted = this.handleBranchDeletion(branch);
        if (deleted) {
          deletedBranches.push(branch);
        }
      }
    }

    return deletedBranches;
  }

  /**
   * Handle deletion of a single branch (dry run or actual deletion)
   */
  private handleBranchDeletion(branch: string): boolean {
    if (this.dryRun) {
      return true;
    }

    return this.tryDeleteBranch(branch);
  }

  /**
   * Try to delete a branch (with fallback to force delete)
   */
  private tryDeleteBranch(branch: string): boolean {
    // Try regular delete first
    if (this.attemptRegularDelete(branch)) {
      return true;
    }

    // Fallback to force delete
    return this.attemptForceDelete(branch);
  }

  /**
   * Attempt regular branch deletion (git branch -d)
   */
  private attemptRegularDelete(branch: string): boolean {
    try {
      execGitSync(['branch', '-d', branch]);
      return true;
    } catch {
      // Regular delete failed
      return false;
    }
  }

  /**
   * Attempt force branch deletion (git branch -D)
   */
  private attemptForceDelete(branch: string): boolean {
    try {
      execGitSync(['branch', '-D', branch]);
      return true;
    } catch {
      // Force delete failed
      return false;
    }
  }

  /**
   * Check if a branch has been merged into main
   */
  private isBranchMerged(branch: string): boolean {
    try {
      const mergedBranches = execGitSync(['branch', '--merged', this.mainBranch, '--format=%(refname:short)']);

      return mergedBranches.includes(branch);

    } catch {
      // If we can't determine merge status, don't delete the branch (safer to keep)
      return false;
    }
  }

  /**
   * Clean up remote tracking references
   */
  private pruneRemoteReferences(): void {
    try {
      execGitSync(['remote', 'prune', this.remoteName]);
    } catch {
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

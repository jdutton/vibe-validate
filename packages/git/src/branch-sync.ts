/**
 * Smart Branch Sync Checker
 *
 * Safely checks if the current branch is behind a remote branch without auto-merging.
 * Provides clear status reporting and next-step instructions.
 *
 * Key safety features:
 * - Never auto-merges (preserves conflict visibility)
 * - Clear exit codes for CI/agent integration
 * - Explicit instructions when manual intervention needed
 * - Cross-platform compatibility
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const GIT_TIMEOUT = 10000; // 10 seconds timeout for git operations
const GIT_OPTIONS = {
  timeout: GIT_TIMEOUT,
  encoding: 'utf8' as const,
  maxBuffer: 1024 * 1024 // 1MB buffer
};

export interface SyncCheckResult {
  isUpToDate: boolean;
  behindBy: number;
  currentBranch: string;
  hasRemote: boolean;
  error?: string;
}

// Type for the exec function (allows dependency injection for testing)
export type ExecAsyncFunction = (_command: string, _options: typeof GIT_OPTIONS) => Promise<{ stdout: string; stderr: string }>;

export interface SyncCheckOptions {
  remoteBranch?: string;  // Default: 'origin/main'
  execAsync?: ExecAsyncFunction;  // Inject custom exec for testing
}

/**
 * Branch Sync Checker
 *
 * Checks if current branch is behind a remote branch
 */
export class BranchSyncChecker {
  private readonly remoteBranch: string;
  private readonly execAsync: ExecAsyncFunction;

  constructor(options: SyncCheckOptions = {}) {
    this.remoteBranch = options.remoteBranch || 'origin/main';
    this.execAsync = options.execAsync || promisify(exec);
  }

  /**
   * Check if the current branch is synchronized with remote branch
   *
   * @returns Promise resolving to sync status information
   */
  async checkSync(): Promise<SyncCheckResult> {
    try {
      // Get current branch name
      const currentBranch = await this.getCurrentBranch();

      // Check if remote branch exists
      const hasRemote = await this.hasRemoteBranch();
      if (!hasRemote) {
        return {
          isUpToDate: true,
          behindBy: 0,
          currentBranch,
          hasRemote: false,
          error: `No remote branch ${this.remoteBranch} found`
        };
      }

      // Fetch latest from remote
      await this.fetchRemote();

      // Check how many commits behind
      const behindBy = await this.getCommitsBehind();

      return {
        isUpToDate: behindBy === 0,
        behindBy,
        currentBranch,
        hasRemote: true
      };

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        isUpToDate: false,
        behindBy: -1,
        currentBranch: 'unknown',
        hasRemote: false,
        error: errorMessage
      };
    }
  }

  private async getCurrentBranch(): Promise<string> {
    try {
      const { stdout } = await this.execAsync('git rev-parse --abbrev-ref HEAD', GIT_OPTIONS);
      return stdout.trim();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Not in a git repository or unable to determine current branch: ${errorMessage}`);
    }
  }

  private async hasRemoteBranch(): Promise<boolean> {
    try {
      await this.execAsync(`git rev-parse --verify ${this.remoteBranch}`, GIT_OPTIONS);
      return true;
    } catch (_error) {
      return false;
    }
  }

  private async fetchRemote(): Promise<void> {
    try {
      const [remote, branch] = this.remoteBranch.split('/');
      await this.execAsync(`git fetch --quiet ${remote} ${branch}`, GIT_OPTIONS);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to fetch from ${this.remoteBranch}: ${errorMessage}`);
    }
  }

  private async getCommitsBehind(): Promise<number> {
    try {
      const { stdout } = await this.execAsync(`git rev-list --count HEAD..${this.remoteBranch}`, GIT_OPTIONS);
      const count = parseInt(stdout.trim(), 10);
      return isNaN(count) ? 0 : count;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to check commits behind: ${errorMessage}`);
    }
  }

  /**
   * Get appropriate exit code based on sync result
   *
   * @param result - The sync check result
   * @returns Exit code (0=success, 1=needs merge, 2=error)
   */
  getExitCode(result: SyncCheckResult): number {
    if (result.error) return 2; // Error condition
    if (!result.hasRemote) return 0; // No remote, consider OK
    return result.isUpToDate ? 0 : 1; // 0 = up to date, 1 = needs merge
  }
}

/**
 * Convenience function for quick sync checking
 *
 * @param options - Sync check options
 * @returns Sync check result
 */
export async function checkBranchSync(options: SyncCheckOptions = {}): Promise<SyncCheckResult> {
  const checker = new BranchSyncChecker(options);
  return checker.checkSync();
}

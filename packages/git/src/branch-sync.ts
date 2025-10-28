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

import { spawn } from 'child_process';

const GIT_TIMEOUT = 30000; // 30 seconds timeout for git operations

export interface SyncCheckResult {
  isUpToDate: boolean;
  behindBy: number;
  currentBranch: string;
  hasRemote: boolean;
  error?: string;
}

// Type for git command executor (allows dependency injection for testing)
export type GitExecutor = (_args: string[]) => Promise<{ stdout: string; stderr: string }>;

export interface SyncCheckOptions {
  remoteBranch?: string;  // Default: 'origin/main'
  gitExecutor?: GitExecutor;  // Inject custom executor for testing
}

/**
 * Execute git command safely using spawn (prevents command injection)
 *
 * @param args - Git command arguments (e.g., ['rev-parse', '--abbrev-ref', 'HEAD'])
 * @returns Promise resolving to stdout and stderr
 */
function execGit(args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, {
      timeout: GIT_TIMEOUT
    });

    let stdout = '';
    let stderr = '';

    if (child.stdout) {
      child.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
      });
    }

    if (child.stderr) {
      child.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });
    }

    child.on('error', (error: Error) => {
      reject(error);
    });

    child.on('close', (code: number | null) => {
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(`git exited with code ${code}: ${stderr}`));
      }
    });
  });
}

/**
 * Branch Sync Checker
 *
 * Checks if current branch is behind a remote branch
 */
export class BranchSyncChecker {
  private readonly remoteBranch: string;
  private readonly gitExecutor: GitExecutor;

  constructor(options: SyncCheckOptions = {}) {
    this.remoteBranch = options.remoteBranch ?? 'origin/main';
    this.gitExecutor = options.gitExecutor ?? execGit;
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
      const { stdout } = await this.gitExecutor(['rev-parse', '--abbrev-ref', 'HEAD']);
      return stdout.trim();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Not in a git repository or unable to determine current branch: ${errorMessage}`);
    }
  }

  private async hasRemoteBranch(): Promise<boolean> {
    try {
      await this.gitExecutor(['rev-parse', '--verify', this.remoteBranch]);
      return true;
    } catch (error) {
      // Expected when remote branch doesn't exist
      console.debug(`Remote branch ${this.remoteBranch} not found: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  private async fetchRemote(): Promise<void> {
    try {
      const [remote, branch] = this.remoteBranch.split('/');
      await this.gitExecutor(['fetch', '--quiet', remote, branch]);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to fetch from ${this.remoteBranch}: ${errorMessage}`);
    }
  }

  private async getCommitsBehind(): Promise<number> {
    try {
      const { stdout } = await this.gitExecutor(['rev-list', '--count', `HEAD..${this.remoteBranch}`]);
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

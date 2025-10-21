import { execSync } from 'node:child_process';
import { parse as parseYaml } from 'yaml';
import type {
  CIProvider,
  PullRequest,
  CheckStatus,
  CheckResult,
  FailureLogs,
  StateFileContents,
} from '../ci-provider.js';

/**
 * GitHub Actions CI provider implementation
 *
 * Uses GitHub CLI (gh) to interact with GitHub API.
 * Requires:
 * - gh CLI installed and authenticated
 * - Git repository with github.com remote
 */
export class GitHubActionsProvider implements CIProvider {
  readonly name = 'github-actions';

  async isAvailable(): Promise<boolean> {
    try {
      // Check if gh CLI is available
      execSync('gh --version', { stdio: 'ignore' });

      // Check if we're in a GitHub repo
      const remote = execSync('git remote get-url origin', { encoding: 'utf8' });
      return remote.includes('github.com');
    } catch {
      return false;
    }
  }

  async detectPullRequest(): Promise<PullRequest | null> {
    try {
      const prData = JSON.parse(
        execSync('gh pr view --json number,title,url,headRefName', {
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'pipe'],
        })
      );

      return {
        id: prData.number,
        title: prData.title,
        url: prData.url,
        branch: prData.headRefName,
      };
    } catch {
      return null;
    }
  }

  async fetchCheckStatus(prId: number | string): Promise<CheckStatus> {
    const data = JSON.parse(
      execSync(`gh pr view ${prId} --json number,title,url,statusCheckRollup,headRefName`, {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      })
    );

    const checks = (data.statusCheckRollup || []).map((check: unknown) =>
      this.transformCheck(check)
    );

    return {
      pr: {
        id: data.number,
        title: data.title,
        url: data.url,
        branch: data.headRefName || '',
      },
      status: this.determineOverallStatus(checks),
      result: this.determineOverallResult(checks),
      checks,
    };
  }

  async fetchFailureLogs(runId: string): Promise<FailureLogs> {
    // Get run details to find the check name
    let checkName = 'Unknown';
    try {
      const runData = JSON.parse(
        execSync(`gh run view ${runId} --json name`, {
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'pipe'],
        })
      );
      checkName = runData.name || checkName;
    } catch {
      // Ignore error, use default name
    }

    // Fetch full logs
    const logs = execSync(`gh run view ${runId} --log`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const stateFile = this.extractStateFile(logs);

    return {
      checkId: runId,
      checkName,
      rawLogs: logs,
      failedStep: this.extractFailedStep(logs),
      errorSummary: this.extractErrorSummary(logs),
      stateFile: stateFile ?? undefined,
    };
  }

  extractStateFile(logs: string): StateFileContents | null {
    // Look for vibe-validate state file display in logs
    // This matches the format from .github/workflows/validate.yml
    // Format: ========================================== \n 📋 VALIDATION STATE FILE CONTENTS \n ========================================== \n <yaml> \n ==========================================
    const stateMatch = logs.match(
      /={40,}\s*\n.*?📋 VALIDATION STATE FILE CONTENTS\s*\n={40,}\s*\n([\s\S]+?)\n={40,}/
    );

    if (!stateMatch) {
      return null;
    }

    try {
      const stateYaml = stateMatch[1].trim();
      return parseYaml(stateYaml) as StateFileContents;
    } catch (_error) {
      // Failed to parse YAML, return null
      return null;
    }
  }

  /**
   * Transform GitHub check format to common CheckResult format
   */
  private transformCheck(ghCheck: unknown): CheckResult {
    // Type guard to ensure ghCheck is an object with expected properties
    const check = ghCheck as Record<string, unknown>;
    // GitHub check structure (from statusCheckRollup):
    // {
    //   __typename: "CheckRun" | "StatusContext",
    //   name: string,
    //   status: "QUEUED" | "IN_PROGRESS" | "COMPLETED",
    //   conclusion: "SUCCESS" | "FAILURE" | "CANCELLED" | etc,
    //   detailsUrl: string
    // }

    let status: CheckResult['status'];
    switch (check.status) {
      case 'QUEUED':
        status = 'queued';
        break;
      case 'IN_PROGRESS':
        status = 'in_progress';
        break;
      case 'COMPLETED':
        status = 'completed';
        break;
      default:
        status = 'queued';
    }

    let conclusion: CheckResult['conclusion'] = null;
    if (check.conclusion) {
      switch (check.conclusion) {
        case 'SUCCESS':
          conclusion = 'success';
          break;
        case 'FAILURE':
          conclusion = 'failure';
          break;
        case 'CANCELLED':
          conclusion = 'cancelled';
          break;
        case 'SKIPPED':
          conclusion = 'skipped';
          break;
        case 'NEUTRAL':
          conclusion = 'neutral';
          break;
      }
    }

    // Extract run ID from details URL if available
    let checkId = 'unknown';
    if (typeof check.detailsUrl === 'string') {
      const runIdMatch = check.detailsUrl.match(/\/runs\/(\d+)/);
      if (runIdMatch) {
        checkId = runIdMatch[1];
      }
    }

    return {
      id: checkId,
      name: (check.name as string) || 'Unknown',
      status,
      conclusion,
      url: check.detailsUrl as string | undefined,
    };
  }

  /**
   * Determine overall status from individual checks
   */
  private determineOverallStatus(checks: CheckResult[]): CheckStatus['status'] {
    if (checks.length === 0) {
      return 'pending';
    }

    const allCompleted = checks.every((c) => c.status === 'completed');
    if (allCompleted) {
      return 'completed';
    }

    const anyInProgress = checks.some((c) => c.status === 'in_progress');
    if (anyInProgress) {
      return 'in_progress';
    }

    return 'pending';
  }

  /**
   * Determine overall result from individual checks
   */
  private determineOverallResult(checks: CheckResult[]): CheckStatus['result'] {
    if (checks.length === 0) {
      return 'unknown';
    }

    const anyFailure = checks.some((c) => c.conclusion === 'failure');
    if (anyFailure) {
      return 'failure';
    }

    const anyCancelled = checks.some((c) => c.conclusion === 'cancelled');
    if (anyCancelled) {
      return 'cancelled';
    }

    const allSuccess = checks.every((c) => c.conclusion === 'success');
    if (allSuccess) {
      return 'success';
    }

    return 'unknown';
  }

  /**
   * Extract failed step name from GitHub Actions logs
   */
  private extractFailedStep(logs: string): string | undefined {
    // GitHub Actions marks failed steps with ##[error]
    const errorMatch = logs.match(/##\[error\]Process completed with exit code \d+\./);
    if (!errorMatch) {
      return undefined;
    }

    // Try to find the step name before the error
    // Look for lines like: "Run pnpm test" or "##[group]Run pnpm test"
    const lines = logs.split('\n');
    const errorIndex = lines.findIndex((line) => line.includes('##[error]'));

    if (errorIndex > 0) {
      // Look backwards for step name
      for (let i = errorIndex - 1; i >= 0; i--) {
        const runMatch = lines[i].match(/##\[group\]Run (.+)/);
        if (runMatch) {
          return runMatch[1];
        }
      }
    }

    return undefined;
  }

  /**
   * Extract concise error summary from logs
   */
  private extractErrorSummary(logs: string): string | undefined {
    // Look for vibe-validate state file first (most concise)
    const stateMatch = logs.match(
      /failedStep: (.+)\n[\s\S]*?failedStepOutput: \|\n([\s\S]{0,500})/
    );

    if (stateMatch) {
      return `Failed: ${stateMatch[1]}\n${stateMatch[2].trim()}`;
    }

    // Fallback: Look for ##[error] lines
    const errorLines = logs
      .split('\n')
      .filter((line) => line.includes('##[error]'))
      .slice(0, 10) // First 10 error lines
      .map((line) => line.replace(/##\[error\]/g, '').trim())
      .join('\n');

    return errorLines || undefined;
  }
}

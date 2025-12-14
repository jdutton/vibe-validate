import { parse as parseYaml } from 'yaml';
import { executeGitCommand, isToolAvailable, safeExecSync } from '@vibe-validate/git';
import type {
  CIProvider,
  PullRequest,
  CheckStatus,
  CheckResult,
  FailureLogs,
  ValidationResultContents,
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
      if (!isToolAvailable('gh')) {
        return false;
      }

      // Check if we're in a GitHub repo
      const result = executeGitCommand(['remote', 'get-url', 'origin']);
      return result.success && result.stdout.includes('github.com');
    } catch {
      return false;
    }
  }

  async detectPullRequest(): Promise<PullRequest | null> {
    try {
      const output = safeExecSync('gh', ['pr', 'view', '--json', 'number,title,url,headRefName'], {
        encoding: 'utf8',
        stdio: 'pipe',
      });

      const prData = JSON.parse(output.toString());

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
    const output = safeExecSync('gh', ['pr', 'view', String(prId), '--json', 'number,title,url,statusCheckRollup,headRefName'], {
      encoding: 'utf8',
      stdio: 'pipe',
    });

    const data = JSON.parse(output.toString());

    const checks = (data.statusCheckRollup ?? []).map((check: unknown) =>
      this.transformCheck(check)
    );

    return {
      pr: {
        id: data.number,
        title: data.title,
        url: data.url,
        branch: data.headRefName ?? '',
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
      const runOutput = safeExecSync('gh', ['run', 'view', runId, '--json', 'name'], {
        encoding: 'utf8',
        stdio: 'pipe',
      });
      const runData = JSON.parse(runOutput.toString());
      checkName = runData.name ?? checkName;
    } catch {
      // Ignore error, use default name
    }

    // Fetch full logs (includes "Display validation state on failure" step)
    const logs = safeExecSync('gh', ['run', 'view', runId, '--log'], {
      encoding: 'utf8',
      stdio: 'pipe',
      maxBuffer: 50 * 1024 * 1024, // 50MB buffer to handle large logs
    }).toString();

    const validationResult = this.extractValidationResult(logs);

    return {
      checkId: runId,
      checkName,
      rawLogs: logs,
      failedStep: this.extractFailedStep(logs),
      errorSummary: this.extractErrorSummary(logs),
      validationResult: validationResult ?? undefined,
    };
  }

  extractValidationResult(logs: string): ValidationResultContents | null {
    const lines = logs.split('\n');
    const extractContent = this.createContentExtractor();

    const boundaries = this.findValidationResultBoundaries(lines, extractContent);
    if (!boundaries) {
      return null;
    }

    const yamlContent = this.extractYamlContent(lines, boundaries, extractContent);
    return this.parseAndEnrichValidationResult(yamlContent);
  }

  /**
   * Create a function to extract content from GitHub Actions log lines
   * Format: "Run name\tStep name\tTimestamp <content>"
   */
  private createContentExtractor(): (_line: string) => string {
    return (line: string): string => {
      const parts = line.split('\t');
      if (parts.length < 3) return '';
      const contentWithTimestamp = parts.slice(2).join('\t');
      // Strip timestamp (format: "2025-10-21T00:56:24.8654285Z <content>")
      const afterTimestampRemoval = contentWithTimestamp.replace(/^[0-9T:.Z-]+ /, '');
      // Remove line if it's ONLY a timestamp (but keep "---" separator)
      if (/^[0-9T:.Z-]+$/.test(afterTimestampRemoval) && afterTimestampRemoval !== '---') {
        return '';
      }
      return afterTimestampRemoval;
    };
  }

  /**
   * Find the start and end indices of validation result YAML in logs
   */
  private findValidationResultBoundaries(
    lines: string[],
    extractContent: (_line: string) => string
  ): { startIdx: number; endIdx: number } | null {
    // Find start: line containing "---" (YAML document separator)
    // Must be followed by validation result fields like "passed:", "timestamp:", etc.
    let startIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      const content = extractContent(lines[i]).trim();
      if (content === '---') {
        // Check if next few lines look like validation result YAML
        if (this.looksLikeValidationResult(lines, i + 1, extractContent)) {
          startIdx = i;
          break;
        }
      }
    }

    if (startIdx < 0) {
      return null;
    }

    // Find end: next "---" separator or end of meaningful YAML content
    const endIdx = this.findYamlEnd(lines, startIdx + 1, extractContent);
    if (endIdx < 0) {
      return null;
    }

    return { startIdx, endIdx };
  }

  /**
   * Check if lines starting at startIdx look like validation result YAML
   */
  private looksLikeValidationResult(
    lines: string[],
    startIdx: number,
    extractContent: (_line: string) => string
  ): boolean {
    // Check first 10 lines for validation result fields
    for (let i = startIdx; i < Math.min(startIdx + 10, lines.length); i++) {
      const content = extractContent(lines[i]).trim();
      // Look for key validation result fields
      if (content.startsWith('passed:') ||
          content.startsWith('failedStep:') ||
          (content.startsWith('treeHash:') && content.length > 20)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Find the end of YAML content (next --- separator or end of document)
   */
  private findYamlEnd(
    lines: string[],
    startIdx: number,
    extractContent: (_line: string) => string
  ): number {
    let lastContentLine = startIdx;

    for (let i = startIdx; i < lines.length; i++) {
      const content = extractContent(lines[i]).trim();

      // Stop at next YAML document separator
      if (content === '---' || content === '...') {
        return i;
      }

      // Track last non-empty line
      if (content.length > 0) {
        lastContentLine = i;
      }

      // If we see GitHub Actions markers after YAML content, we're done
      if (content.startsWith('##[') && i > startIdx + 5) {
        return lastContentLine + 1;
      }
    }

    // Return last content line + 1 if we hit end of logs
    return lastContentLine + 1;
  }

  /**
   * Extract YAML content between boundaries
   */
  private extractYamlContent(
    lines: string[],
    boundaries: { startIdx: number; endIdx: number },
    extractContent: (_line: string) => string
  ): string {
    // YAML starts at startIdx + 1 (skip the "---" separator)
    const yamlStartIdx = boundaries.startIdx + 1;
    const yamlLines: string[] = [];

    for (let i = yamlStartIdx; i < boundaries.endIdx; i++) {
      const content = extractContent(lines[i]);
      // Include all lines (even empty ones) to preserve YAML structure
      // Only skip GitHub Actions markers
      if (!content.startsWith('##[')) {
        yamlLines.push(content);
      }
    }

    return yamlLines.join('\n').trim();
  }

  /**
   * Parse YAML validation result from log content
   */
  private parseAndEnrichValidationResult(yamlContent: string): ValidationResultContents | null {
    try {
      const result = parseYaml(yamlContent) as ValidationResultContents;
      return result;
    } catch {
      // Failed to parse validation YAML - return null
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
      const runIdMatch = /\/runs\/(\d+)/.exec(check.detailsUrl);
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
    const errorMatch = /##\[error\]Process completed with exit code \d+\./.exec(logs);
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
        const runMatch = /##\[group\]Run (.+)/.exec(lines[i]);
        if (runMatch) {
          return runMatch[1];
        }
      }
    }

    return undefined;
  }

  /**
   * Extract concise error summary from logs (LLM-friendly format)
   *
   * Returns just the failed step name and command - keeps output minimal.
   * Full details are in the validationResult field.
   */
  private extractErrorSummary(logs: string): string | undefined {
    // Use the validation result which already has parsed failures
    const validationResult = this.extractValidationResult(logs);

    if (validationResult && !validationResult.passed) {
      // Show concise summary: just the failed step and how to rerun
      if (validationResult.failedStep) {
        // Find the failed step's command (v0.15.0+: rerunCommand removed, use step.command)
        const failedStep = validationResult.phases
          ?.flatMap(phase => phase.steps ?? [])
          .find(step => step && step.name === validationResult.failedStep);

        const rerunCommand = failedStep?.command ?? 'see full logs';
        return `Failed step: ${validationResult.failedStep}\nRerun: ${rerunCommand}`;
      }
    }

    // Fallback: Look for ##[error] lines (for non-validation failures)
    const errorLines = logs
      .split('\n')
      .filter((line) => line.includes('##[error]'))
      .slice(0, 5) // First 5 error lines
      .map((line) => line.replace(/##\[error\]/g, '').trim())
      .join('\n');

    return errorLines || undefined;
  }
}

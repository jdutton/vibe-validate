import { execSync } from 'node:child_process';
import { parse as parseYaml } from 'yaml';
import { autoDetectAndExtract } from '@vibe-validate/extractors';
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
      const runData = JSON.parse(
        execSync(`gh run view ${runId} --json name`, {
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'pipe'],
        })
      );
      checkName = runData.name ?? checkName;
    } catch {
      // Ignore error, use default name
    }

    // Fetch full logs (includes "Display validation state on failure" step)
    const logs = execSync(`gh run view ${runId} --log`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      maxBuffer: 50 * 1024 * 1024, // 50MB buffer to handle large logs
    });

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
      return contentWithTimestamp.replace(/^[0-9T:.Z-]+ /, '').replace(/^[0-9T:.Z-]+$/, '');
    };
  }

  /**
   * Find the start and end indices of validation result YAML in logs
   */
  private findValidationResultBoundaries(
    lines: string[],
    extractContent: (_line: string) => string
  ): { startIdx: number; endIdx: number } | null {
    // Find start: line containing "VALIDATION RESULT" (skip ANSI-coded lines)
    const startIdx = lines.findIndex(l => {
      return l.includes('VALIDATION RESULT') && !l.includes('[36;1m') && !l.includes('[0m');
    });

    if (startIdx < 0) {
      return null;
    }

    // Find end: closing separator after YAML content
    const endIdx = this.findClosingSeparator(lines, startIdx, extractContent);
    if (endIdx < 0) {
      return null;
    }

    return { startIdx, endIdx };
  }

  /**
   * Find the closing separator (====) after YAML content
   */
  private findClosingSeparator(
    lines: string[],
    startIdx: number,
    extractContent: (_line: string) => string
  ): number {
    let foundYamlContent = false;

    for (let i = startIdx + 1; i < lines.length; i++) {
      const content = extractContent(lines[i]).trim();

      // Check if we've seen YAML content
      if (content.startsWith('passed:') || content.startsWith('timestamp:') || content.startsWith('treeHash:')) {
        foundYamlContent = true;
      }

      // Look for closing separator (40+ equals signs) after YAML content
      if (foundYamlContent && /^={40,}$/.exec(content)) {
        return i;
      }
    }

    return -1;
  }

  /**
   * Extract YAML content between boundaries
   */
  private extractYamlContent(
    lines: string[],
    boundaries: { startIdx: number; endIdx: number },
    extractContent: (_line: string) => string
  ): string {
    // YAML starts at startIdx + 2 (skip "VALIDATION RESULT" and separator)
    const yamlStartIdx = boundaries.startIdx + 2;
    const yamlLines: string[] = [];

    for (let i = yamlStartIdx; i < boundaries.endIdx; i++) {
      yamlLines.push(extractContent(lines[i]));
    }

    return yamlLines.join('\n').trim();
  }

  /**
   * Parse YAML and enrich with extractor results
   */
  private parseAndEnrichValidationResult(yamlContent: string): ValidationResultContents | null {
    try {
      const result = parseYaml(yamlContent) as ValidationResultContents;

      // Enrich with structured failure details if validation failed
      if (!result.passed && result.failedStep && result.failedStepOutput) {
        this.enrichWithFailedTests(result);
      }

      return result;
    } catch (error) {
      console.debug(`Failed to parse validation YAML: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  /**
   * Enrich validation result with failed test details from extractors
   */
  private enrichWithFailedTests(result: ValidationResultContents): void {
    // Type narrowing: we know these are defined due to the check in parseAndEnrichValidationResult
    const failedStep = result.failedStep;
    const failedStepOutput = result.failedStepOutput;

    if (!failedStep || !failedStepOutput) {
      return;
    }

    const extractorResult = autoDetectAndExtract(failedStep, failedStepOutput);

    if (extractorResult.errors.length > 0) {
      result.failedTests = extractorResult.errors
        .filter((e: { file?: string; line?: number }) => e.file && e.line)
        .map((e: { file?: string; line?: number; column?: number; message?: string }) => {
          const columnPart = e.column ? `:${e.column}` : '';
          return `${e.file}:${e.line}${columnPart} - ${e.message ?? 'Test failed'}`;
        })
        .slice(0, 10); // Limit to first 10 for display
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
        return `Failed step: ${validationResult.failedStep}\nRerun: ${validationResult.rerunCommand ?? 'see full logs'}`;
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

/**
 * Abstract CI provider interface for platform-agnostic PR/MR watching
 *
 * This allows vibe-validate to support multiple CI platforms:
 * - GitHub Actions (initial implementation)
 * - GitLab CI (future)
 * - Jenkins (future)
 * - CircleCI (future)
 */

/**
 * Pull/Merge Request information
 */
export interface PullRequest {
  /** PR/MR number or ID */
  id: number | string;
  /** PR/MR title */
  title: string;
  /** URL to view PR/MR in browser */
  url: string;
  /** Source branch name */
  branch: string;
}

/**
 * Individual check/job result
 */
export interface CheckResult {
  /** Unique identifier for this check/job */
  id: string;
  /** Human-readable name (e.g., "ubuntu-latest (Node 20)") */
  name: string;
  /** Current execution status */
  status: 'queued' | 'in_progress' | 'completed';
  /** Final result (null if not completed) */
  conclusion: 'success' | 'failure' | 'cancelled' | 'skipped' | 'neutral' | null;
  /** Duration string (e.g., "2m 15s") */
  duration?: string;
  /** URL to view check details */
  url?: string;
}

/**
 * Overall status of all checks for a PR/MR
 */
export interface CheckStatus {
  /** Associated PR/MR */
  pr: PullRequest;
  /** Overall status across all checks */
  status: 'pending' | 'in_progress' | 'completed';
  /** Overall result (only meaningful when status is 'completed') */
  result: 'success' | 'failure' | 'cancelled' | 'unknown';
  /** Individual check results */
  checks: CheckResult[];
}

/**
 * Parsed contents of vibe-validate state file
 */
export interface StateFileContents {
  /** Whether validation passed */
  passed: boolean;
  /** Timestamp of validation */
  timestamp?: string;
  /** Git tree hash */
  treeHash?: string;
  /** Name of step that failed */
  failedStep?: string;
  /** Command to re-run failed step */
  rerunCommand?: string;
  /** Output from failed step */
  failedStepOutput?: string;
  /** All phases (if available) */
  phases?: Array<{
    name: string;
    passed: boolean;
    durationSecs?: number;
    output?: string; // Output from the phase (if failed)
    steps?: Array<{
      name: string;
      passed: boolean;
      durationSecs?: number;
      output?: string;
    }>;
  }>;
}

/**
 * Detailed failure information including logs
 */
export interface FailureLogs {
  /** ID of the failed check/run */
  checkId: string;
  /** Name of the failed check */
  checkName: string;
  /** Raw log output (may be very large) */
  rawLogs: string;
  /** Name of the step that failed */
  failedStep?: string;
  /** Concise error summary */
  errorSummary?: string;
  /** Parsed vibe-validate state file (if present) */
  stateFile?: StateFileContents;
}

/**
 * Abstract CI provider interface
 *
 * Implementations must support:
 * - Detecting if the provider is available in current context
 * - Finding PR/MR from current branch
 * - Fetching check status
 * - Fetching failure logs with error extraction
 */
export interface CIProvider {
  /** Provider name (e.g., 'github-actions', 'gitlab-ci') */
  readonly name: string;

  /**
   * Detect if this provider is available in current context
   *
   * Should check:
   * - Required CLI tools (gh, glab, etc.)
   * - Git remote matches provider (github.com, gitlab.com, etc.)
   *
   * @returns true if provider is available and usable
   */
  isAvailable(): Promise<boolean>;

  /**
   * Detect PR/MR from current branch
   *
   * Uses provider CLI or API to find open PR/MR for current branch.
   *
   * @returns PR/MR info if found, null otherwise
   */
  detectPullRequest(): Promise<PullRequest | null>;

  /**
   * Fetch current check status for a PR/MR
   *
   * @param _prId - PR/MR number or ID
   * @returns Current status of all checks
   */
  fetchCheckStatus(_prId: number | string): Promise<CheckStatus>;

  /**
   * Fetch detailed logs for a failed check
   *
   * Should attempt to:
   * - Extract vibe-validate state file if present
   * - Identify failed step
   * - Provide concise error summary
   *
   * @param _checkId - Unique identifier for the check/run
   * @returns Detailed failure information
   */
  fetchFailureLogs(_checkId: string): Promise<FailureLogs>;

  /**
   * Extract vibe-validate state file from logs
   *
   * Looks for the state file display section in workflow logs.
   * This is provider-specific as log formats differ.
   *
   * @param _logs - Raw log output
   * @returns Parsed state file contents if found, null otherwise
   */
  extractStateFile(_logs: string): StateFileContents | null;
}

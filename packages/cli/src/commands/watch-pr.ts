import type { Command } from 'commander';
import { stringify as stringifyYaml } from 'yaml';
import { CIProviderRegistry } from '../services/ci-provider-registry.js';
import type {
  CIProvider,
  CheckStatus,
  CheckResult,
  ValidationResultContents,
} from '../services/ci-provider.js';

interface WatchPROptions {
  provider?: string;
  yaml?: boolean;
  timeout?: string;
  pollInterval?: string;
  failFast?: boolean;
}

interface FailureDetail {
  name: string;
  checkId: string;
  errorSummary?: string;
  validationResult?: ValidationResultContents;
  nextSteps: string[];
}

interface WatchPRResult {
  pr: {
    id: number | string;
    title: string;
    url: string;
  };
  status: 'pending' | 'in_progress' | 'completed' | 'timeout';
  result: 'success' | 'failure' | 'cancelled' | 'unknown';
  duration: string;
  summary: string;
  checks: Array<{
    name: string;
    status: string;
    conclusion: string | null;
    duration?: string;
    url?: string;
  }>;
  failures?: FailureDetail[];
}

/**
 * Register the watch-pr command
 */
export function registerWatchPRCommand(program: Command): void {
  program
    .command('watch-pr [pr-number]')
    .description('Watch CI checks for a pull/merge request in real-time')
    .option('--provider <name>', 'Force specific CI provider (github-actions, gitlab-ci)')
    .option('--yaml', 'Output YAML only (no interactive display)')
    .option('--timeout <seconds>', 'Maximum time to wait in seconds (default: 3600)', '3600')
    .option(
      '--poll-interval <seconds>',
      'Polling frequency in seconds (default: 10)',
      '10'
    )
    .option('--fail-fast', 'Exit immediately on first check failure')
    .action(async (prNumber: string | undefined, options: WatchPROptions) => {
      try {
        const exitCode = await watchPRCommand(prNumber, options);
        process.exit(exitCode);
      } catch (error) {
        if (!options.yaml) {
          console.error('❌ Error:', error instanceof Error ? error.message : String(error));
        } else {
          console.log(
            stringifyYaml({
              error: error instanceof Error ? error.message : String(error),
            })
          );
        }
        process.exit(1);
      }
    });
}

/**
 * Execute watch-pr command
 *
 * @returns Exit code (0 = success, 1 = failure, 2 = timeout)
 */
async function watchPRCommand(
  prNumber: string | undefined,
  options: WatchPROptions
): Promise<number> {
  const registry = new CIProviderRegistry();

  // Auto-detect or use specified provider
  const provider = options.provider
    ? registry.getProvider(options.provider)
    : await registry.detectProvider();

  if (!provider) {
    const availableProviders = registry.getProviderNames().join(', ');
    throw new Error(
      `No supported CI provider detected. Available: ${availableProviders}\n` +
        'GitHub Actions requires: gh CLI installed and github.com remote'
    );
  }

  // If no PR number, try to detect from current branch
  let prId = prNumber;
  if (!prId) {
    const pr = await provider.detectPullRequest();
    if (!pr) {
      throw new Error(
        'Could not detect PR from current branch.\n' +
          'Usage: vibe-validate watch-pr <pr-number>'
      );
    }
    prId = pr.id.toString();
  }

  // Watch the PR
  return await watchPR(provider, prId, options);
}

/**
 * Watch PR until completion or timeout
 */
async function watchPR(
  provider: CIProvider,
  prId: string,
  options: WatchPROptions
): Promise<number> {
  const timeoutMs = parseInt(options.timeout || '3600') * 1000;
  const pollIntervalMs = parseInt(options.pollInterval || '10') * 1000;
  const startTime = Date.now();

  let lastStatus: CheckStatus | null = null;
  let iteration = 0;

  while (true) {
    const elapsed = Date.now() - startTime;

    // Check timeout
    if (elapsed >= timeoutMs) {
      if (options.yaml && lastStatus) {
        const result: WatchPRResult = {
          pr: lastStatus.pr,
          status: 'timeout',
          result: 'unknown',
          duration: formatDuration(elapsed),
          summary: 'Timed out waiting for checks to complete',
          checks: lastStatus.checks.map((c) => ({
            name: c.name,
            status: c.status,
            conclusion: c.conclusion,
            duration: c.duration,
            url: c.url,
          })),
        };
        console.log(stringifyYaml(result));
      } else {
        console.log('\n⏱️  Timeout reached. Checks still pending.');
      }
      return 2;
    }

    // Fetch current status
    const status = await provider.fetchCheckStatus(prId);
    lastStatus = status;

    // Display current status
    if (!options.yaml) {
      displayHumanStatus(status, iteration === 0);
    }

    // Check if we should fail fast
    if (options.failFast) {
      const anyFailure = status.checks.some((c) => c.conclusion === 'failure');
      if (anyFailure) {
        return await handleCompletion(provider, status, options, elapsed);
      }
    }

    // Check if all checks are complete
    if (status.status === 'completed') {
      return await handleCompletion(provider, status, options, elapsed);
    }

    // Wait before next poll
    iteration++;
    await sleep(pollIntervalMs);
  }
}

/**
 * Handle completion - fetch failure details if needed and output result
 */
async function handleCompletion(
  provider: CIProvider,
  status: CheckStatus,
  options: WatchPROptions,
  elapsedMs: number
): Promise<number> {
  const failures = status.checks.filter((c) => c.conclusion === 'failure');

  // Fetch detailed failure information
  const failureDetails = await Promise.all(
    failures.map(async (check) => {
      try {
        const logs = await provider.fetchFailureLogs(check.id);
        return {
          name: check.name,
          checkId: check.id,
          errorSummary: logs.errorSummary,
          validationResult: logs.validationResult,
          nextSteps: generateNextSteps(check.id, logs.validationResult),
        };
      } catch (error) {
        return {
          name: check.name,
          checkId: check.id,
          errorSummary: `Failed to fetch logs: ${error}`,
          nextSteps: [`gh run view ${check.id} --log-failed`],
        };
      }
    })
  );

  // Output final result
  if (options.yaml) {
    const result: WatchPRResult = {
      pr: {
        id: status.pr.id,
        title: status.pr.title,
        url: status.pr.url,
      },
      status: status.status,
      result: status.result,
      duration: formatDuration(elapsedMs),
      summary: `${status.checks.filter((c) => c.conclusion === 'success').length}/${status.checks.length} checks passed`,
      checks: status.checks.map((c) => ({
        name: c.name,
        status: c.status,
        conclusion: c.conclusion,
        duration: c.duration,
        url: c.url,
      })),
      failures: failureDetails.length > 0 ? failureDetails : undefined,
    };
    console.log(stringifyYaml(result));
  } else {
    displayHumanCompletion(status, failureDetails, elapsedMs);
  }

  // Return appropriate exit code
  return status.result === 'success' ? 0 : 1;
}

/**
 * Display human-friendly status update
 */
function displayHumanStatus(status: CheckStatus, isFirst: boolean): void {
  if (isFirst) {
    console.log(`🔍 Watching PR #${status.pr.id}: ${status.pr.title}`);
    console.log(`   ${status.pr.url}\n`);
  }

  // Clear previous output (for live updating)
  if (!isFirst) {
    process.stdout.write('\x1B[2J\x1B[H'); // Clear screen and move cursor to top
    console.log(`🔍 Watching PR #${status.pr.id}: ${status.pr.title}\n`);
  }

  // Display checks
  for (const check of status.checks) {
    const icon = getCheckIcon(check);
    const statusStr = check.conclusion || check.status;
    const duration = check.duration || '';
    console.log(`${icon} ${check.name.padEnd(40)} ${statusStr.padEnd(12)} ${duration}`);
  }

  // Display summary
  const completed = status.checks.filter((c) => c.status === 'completed').length;
  const total = status.checks.length;
  const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;
  console.log(`\n${completed}/${total} checks complete (${percentage}%)`);
}

/**
 * Display human-friendly completion message
 */
function displayHumanCompletion(
  status: CheckStatus,
  failures: FailureDetail[],
  elapsedMs: number
): void {
  console.log('\n' + '='.repeat(60));

  if (status.result === 'success') {
    console.log('✅ All checks passed!');
    console.log(`   Duration: ${formatDuration(elapsedMs)}`);
    console.log(`   Ready to merge: ${status.pr.url}`);
  } else {
    console.log('❌ Some checks failed');
    console.log(`   Duration: ${formatDuration(elapsedMs)}`);

    for (const failure of failures) {
      console.log(`\n📋 ${failure.name}:`);

      if (failure.validationResult) {
        console.log(`   Failed step: ${failure.validationResult.failedStep}`);
        if (failure.validationResult.rerunCommand) {
          console.log(`   Re-run locally: ${failure.validationResult.rerunCommand}`);
        }

        // Show parsed test failures (extracted by extractors package)
        if (failure.validationResult.failedTests && failure.validationResult.failedTests.length > 0) {
          console.log(`\n   Failed tests:`);
          failure.validationResult.failedTests.forEach((test: string) => {
            console.log(`   ❌ ${test}`);
          });
        } else if (failure.validationResult.failedStepOutput) {
          // Fallback: show raw output if extractor didn't extract anything
          console.log(`\n   Error output:`);
          const lines = failure.validationResult.failedStepOutput.split('\n').slice(0, 10);
          lines.forEach((line: string) => console.log(`   ${line}`));
        }
      } else if (failure.errorSummary) {
        console.log(`   ${failure.errorSummary}`);
      }

      console.log(`\n   Next steps:`);
      failure.nextSteps.forEach((step: string) => console.log(`   - ${step}`));
    }

    // Suggest reporting extractor issues if extraction quality is poor
    console.log('\n💡 Error output unclear or missing details?');
    console.log(
      '   Help improve extraction: https://github.com/jdutton/vibe-validate/issues/new?template=extractor-improvement.yml'
    );
  }

  console.log('='.repeat(60));
}

/**
 * Get icon for check status
 */
function getCheckIcon(check: CheckResult): string {
  if (check.conclusion === 'success') return '✅';
  if (check.conclusion === 'failure') return '❌';
  if (check.conclusion === 'cancelled') return '🚫';
  if (check.conclusion === 'skipped') return '⏭️ ';
  if (check.status === 'in_progress') return '⏳';
  return '⏸️ ';
}

/**
 * Generate next steps for a failure
 */
function generateNextSteps(
  checkId: string,
  validationResult: ValidationResultContents | undefined
): string[] {
  const steps: string[] = [];

  if (validationResult?.rerunCommand) {
    steps.push(`Run locally: ${validationResult.rerunCommand}`);
  }

  steps.push(`View logs: gh run view ${checkId} --log-failed`);
  steps.push(`Re-run check: gh run rerun ${checkId} --failed`);

  return steps;
}

/**
 * Format duration in human-readable format
 */
function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  if (minutes > 0) {
    return `${minutes}m ${remainingSeconds}s`;
  }
  return `${seconds}s`;
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

import { listPullRequests } from '@vibe-validate/git';
import { safeExecSync } from '@vibe-validate/utils';
import type { Command } from 'commander';
import { stringify as stringifyYaml } from 'yaml';

import type { WatchPRResult } from '../schemas/watch-pr-result.schema.js';
import { WatchPROrchestrator } from '../services/watch-pr-orchestrator.js';
import { getCommandName } from '../utils/command-name.js';

interface WatchPROptions {
  yaml?: boolean;
  repo?: string;
  runId?: string;
  history?: boolean;
}

/**
 * Register the watch-pr command
 */
export function registerWatchPRCommand(program: Command): void {
  program
    .command('watch-pr [pr-number]')
    .description('Monitor PR checks with auto-polling, error extraction, and flaky test detection (use after creating PR, run after each push)')
    .option('--yaml', 'Force YAML output (auto-enabled on failure)')
    .option('--repo <owner/repo>', 'Repository (default: auto-detect from git remote)')
    .option('--history', 'Show historical runs for the PR with pass/fail summary')
    .option('--run-id <id>', 'Watch specific run ID instead of latest (useful for testing failed runs)')
    .action(async (prNumber: string | undefined, options: WatchPROptions) => {
      try {
        const exitCode = await watchPRCommand(prNumber, options);
        process.exit(exitCode);
      } catch (error) {
        // Only output YAML for PR failures, not for usage/argument errors
        // Check if this is a usage error (no PR detected, invalid args, etc.)
        const errorMessage = error instanceof Error ? error.message : String(error);
        const isUsageError =
          errorMessage.includes('Could not auto-detect') ||
          errorMessage.includes('Invalid PR number') ||
          errorMessage.includes('Invalid run ID') ||
          errorMessage.includes('Invalid --repo format') ||
          errorMessage.includes('Could not detect repository');

        if (isUsageError) {
          // Output as plain text for better UX
          process.stderr.write(`Error: ${errorMessage}\n`);
        } else {
          // Actual PR/API errors - output as YAML for parseability
          process.stdout.write('---\n');
          process.stdout.write(
            stringifyYaml({
              error: errorMessage,
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
 * @returns Exit code (0 = success, 1 = failure)
 */
export async function watchPRCommand(
  prNumber: string | undefined,
  options: WatchPROptions
): Promise<number> {
  // Detect owner/repo from git remote or --repo flag (do this early for auto-detection)
  const { owner, repo } = options.repo
    ? parseRepoFlag(options.repo)
    : detectOwnerRepo();

  // Auto-detect PR number if not provided
  let prNum: number;
  if (prNumber) {
    // Explicit PR number provided - parse and validate
    prNum = Number.parseInt(prNumber, 10);
    if (Number.isNaN(prNum) || prNum <= 0) {
      throw new Error(`Invalid PR number: ${prNumber}`);
    }
  } else {
    // No PR number - try to auto-detect from current branch
    prNum = await autoDetectPR(owner, repo);
  }

  // Create orchestrator
  const orchestrator = new WatchPROrchestrator(owner, repo);

  // Handle --history flag (list historical runs)
  if (options.history) {
    await displayHistoricalRuns(orchestrator, prNum, options.yaml ?? false);
    return 0; // Success exit code
  }

  // Build result (use buildResultForRun if --run-id provided)
  let result: Awaited<ReturnType<typeof orchestrator.buildResult>>;

  if (options.runId) {
    // Watch specific run ID mode (useful for testing extraction with failed runs)
    const runId = Number.parseInt(options.runId, 10);
    if (Number.isNaN(runId) || runId <= 0) {
      throw new Error(`Invalid run ID: ${options.runId}. Must be a positive integer.`);
    }
    result = await orchestrator.buildResultForRun(prNum, runId, { useCache: true });
  } else {
    // Normal mode: watch all checks for PR
    result = await orchestrator.buildResult(prNum);
  }

  // Determine output format
  const shouldYAML = orchestrator.shouldOutputYAML(result.status, options.yaml ?? false);

  if (shouldYAML) {
    // YAML output
    process.stdout.write('---\n');
    process.stdout.write(stringifyYaml(result));
  } else {
    // Human-friendly text output
    displayHumanResult(result);
  }

  // Return exit code
  return result.status === 'passed' ? 0 : 1;
}

/**
 * Auto-detect PR number from current branch
 *
 * @param owner - Repository owner
 * @param repo - Repository name
 * @returns PR number
 */
async function autoDetectPR(owner: string, repo: string): Promise<number> {
  try {
    // Try to get PR for current branch using gh CLI
    const prDataRaw = safeExecSync(
      'gh',
      ['pr', 'view', '--repo', `${owner}/${repo}`, '--json', 'number'],
      { encoding: 'utf8' }
    );
    const prData = JSON.parse(prDataRaw as string);

    if (prData.number && typeof prData.number === 'number') {
      return prData.number;
    }

    throw new Error('No PR number found');
  } catch {
    // Could not auto-detect PR - try to suggest open PRs
    const suggestions = await suggestOpenPRs(owner, repo);
    const cmd = getCommandName();

    throw new Error(
      `Could not auto-detect PR from current branch.\n\n` +
      `${suggestions}\n\n` +
      `Usage: ${cmd} watch-pr <pr-number>\n` +
      `Example: ${cmd} watch-pr 90`
    );
  }
}

/**
 * Suggest open PRs to help user choose
 *
 * @param owner - Repository owner
 * @param repo - Repository name
 * @returns Formatted suggestion text
 */
async function suggestOpenPRs(owner: string, repo: string): Promise<string> {
  try {
    const prsData = listPullRequests(owner, repo, 5, ['number', 'title', 'author', 'headRefName']);

    if (prsData.length === 0) {
      return 'No open PRs found in this repository.';
    }

    const prList = prsData
      .map((pr) =>
        `  #${pr.number} - ${pr.title}\n` +
        `         (${pr.headRefName} by ${pr.author.login})`
      )
      .join('\n');

    return `Open PRs in ${owner}/${repo}:\n${prList}`;
  } catch {
    return 'Could not fetch open PRs.';
  }
}

/**
 * Detect owner/repo from git remote
 *
 * @returns Owner and repo from GitHub remote
 */
function detectOwnerRepo(): { owner: string; repo: string } {
  try {
    const remote = safeExecSync('git', ['remote', 'get-url', 'origin'], {
      encoding: 'utf8',
    }) as string;

    // Parse GitHub URL (supports HTTPS, SSH, and SSH with custom host aliases)
    // HTTPS: https://github.com/owner/repo.git
    // SSH: git@github.com:owner/repo.git
    // SSH with alias: git@github.com-personal:owner/repo.git
    // SSH with alias: git@github.com-work:owner/repo.git
    const regex = /github\.com[^/:]*[/:]([\w-]+)\/([\w-]+)/;
    const match = regex.exec(remote);
    if (!match) {
      throw new Error('Could not parse GitHub owner/repo from remote URL');
    }

    const owner = match[1];
    const repo = match[2].replace(/\.git$/, '');

    return { owner, repo };
  } catch {
    // Error occurred - could not detect repo from git remote
    throw new Error(
      'Could not detect repository from git remote.\n' +
        'Ensure you are in a git repository with a GitHub remote.\n' +
        'Or specify --repo <owner/repo> explicitly.'
    );
  }
}

/**
 * Parse --repo flag (owner/repo format)
 *
 * @param repoFlag - Repository in owner/repo format
 * @returns Owner and repo
 */
function parseRepoFlag(repoFlag: string): { owner: string; repo: string } {
  const parts = repoFlag.split('/');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error(
      `Invalid --repo format: ${repoFlag}\n` +
        'Expected format: --repo owner/repo\n' +
        'Example: --repo jdutton/vibe-validate'
    );
  }

  return { owner: parts[0], repo: parts[1] };
}

/**
 * Display historical runs for a PR
 *
 * @param orchestrator - WatchPROrchestrator instance
 * @param prNumber - PR number
 * @param yaml - Output in YAML format
 */
async function displayHistoricalRuns(
  orchestrator: WatchPROrchestrator,
  prNumber: number,
  yaml: boolean
): Promise<void> {
  const runs = await orchestrator.fetchRunsForPR(prNumber);

  if (runs.length === 0) {
    console.log(`No workflow runs found for PR #${prNumber}`);
    return;
  }

  if (yaml) {
    // YAML output
    process.stdout.write('---\n');
    process.stdout.write(stringifyYaml({ runs }));
  } else {
    // Human-friendly table
    console.log(`\n📋 Workflow Runs for PR #${prNumber}\n`);
    console.log('   RUN ID       CONCLUSION  DURATION  WORKFLOW                      STARTED');
    console.log('   ' + '─'.repeat(95));

    for (const run of runs) {
      const runId = run.run_id.toString().padEnd(12);
      const conclusion = (run.conclusion ?? 'pending').padEnd(11);
      const duration = (run.duration ?? '?').padEnd(9);
      const workflow = run.workflow_name.slice(0, 29).padEnd(29);
      const startedAt = new Date(run.started_at).toLocaleString();

      // Color code by conclusion
      let icon = '⏳'; // pending
      if (run.conclusion === 'success') {
        icon = '✅';
      } else if (run.conclusion === 'failure') {
        icon = '❌';
      }

      console.log(`${icon}  ${runId} ${conclusion} ${duration} ${workflow} ${startedAt}`);
    }

    console.log('\n💡 Tip: Use --run-id <id> to drill into a specific run for extraction testing');
    const cmd = getCommandName();
    console.log(`   Example: ${cmd} watch-pr ${prNumber} --run-id ${runs[0].run_id}`);
  }
}

/**
 * Display human-friendly result
 *
 * @param result - WatchPRResult
 */
function displayHumanResult(result: WatchPRResult): void {
  console.log(`\n🔍 PR #${result.pr.number}: ${result.pr.title}`);
  console.log(`   ${result.pr.url}\n`);

  // Display checks
  const allChecks = [...result.checks.github_actions, ...result.checks.external_checks];
  for (const check of allChecks) {
    const icon = getCheckIcon(check.conclusion);
    const statusStr = check.conclusion ?? check.status;
    console.log(`${icon} ${check.name.padEnd(40)} ${statusStr}`);
  }

  // Display summary
  const failedSuffix = result.checks.failed > 0 ? ` (${result.checks.failed} failed)` : '';
  console.log(`\n${result.checks.passed}/${result.checks.total} checks passed${failedSuffix}`);

  // Display guidance
  if (result.guidance) {
    console.log(`\n${result.guidance.summary}`);
    if (result.guidance.next_steps) {
      console.log('\nNext steps:');
      for (const step of result.guidance.next_steps) {
        const icon = getStepIcon(step.severity);
        console.log(`${icon} ${step.action}`);
        if (step.reason) {
          console.log(`   ${step.reason}`);
        }
      }
    }
  }
}

/**
 * Get icon for step severity
 *
 * @param severity - Step severity
 * @returns Icon emoji
 */
function getStepIcon(severity: string): string {
  if (severity === 'error') return '❌';
  if (severity === 'warning') return '⚠️';
  return 'ℹ️';
}

/**
 * Get icon for check conclusion
 *
 * @param conclusion - Check conclusion
 * @returns Icon emoji
 */
function getCheckIcon(conclusion?: string): string {
  if (conclusion === 'success') return '✅';
  if (conclusion === 'failure') return '❌';
  if (conclusion === 'neutral') return 'ℹ️';
  if (conclusion === 'cancelled') return '🚫';
  if (conclusion === 'skipped') return '⏭️';
  if (conclusion === 'timed_out') return '⏱️';
  if (conclusion === 'action_required') return '⚠️';
  return '⏸️';
}

/**
 * Show verbose help with detailed documentation
 */
export function showWatchPRVerboseHelp(): void {
  console.log(`# watch-pr Command Reference

> Monitor PR checks with auto-polling, error extraction, and flaky test detection

## Overview

The \`watch-pr\` command monitors pull request CI checks with **automatic polling** until completion. It provides:
- **Auto-polling**: Waits for checks to complete (no manual refresh)
- **Error extraction**: Extracts file:line:message from failed GitHub Actions logs
- **Flaky test detection**: Tracks history to identify unstable tests (e.g., "Failed last 2 runs", 60% success rate)
- **External check summaries**: codecov coverage %, SonarCloud quality gates
- **PR metadata**: branch, labels, linked issues, mergeable state
- **File change context**: What files changed, insertions/deletions
- **Intelligent guidance**: Severity-based next steps

**YAML output is auto-enabled on failure** (consistent with validate command).

## When to Use

Use \`watch-pr\` after creating a PR and after each push:

\`\`\`bash
# Workflow:
git push                    # Push commits to PR branch
vibe-validate watch-pr 90   # Monitor CI (auto-polls until complete)
# → Returns structured result when checks finish
# → YAML output if failed (with extracted errors)
# → Text output if passed (human-friendly)
\`\`\`

**Note**: PR must exist on GitHub (watch-pr fetches data from GitHub API).

## How It Works

1. **Fetches PR metadata** and check results from GitHub
2. **Auto-polls** until checks complete (no manual refresh needed)
3. **Classifies checks** (GitHub Actions vs external)
4. **Extracts errors** from failed GitHub Actions logs (matrix + non-matrix mode)
5. **Extracts summaries** from external checks (codecov, SonarCloud)
6. **Builds history** (last 10 runs, success rate, patterns like "flaky")
7. **Outputs YAML on failure**, text on success (unless --yaml forced)

## Options

- \`--yaml\` - Force YAML output (auto-enabled on failure)
- \`--repo <owner/repo>\` - Repository (default: auto-detect from git remote)
- \`--run-id <id>\` - Watch specific run ID instead of latest (useful for testing failed runs)

## Exit Codes

- \`0\` - All checks passed
- \`1\` - One or more checks failed

## Examples

\`\`\`bash
# Watch PR (auto-detect repo from git remote)
vibe-validate watch-pr 90

# Force YAML output (even on success)
vibe-validate watch-pr 90 --yaml

# Watch PR in different repo
vibe-validate watch-pr 42 --repo jdutton/vibe-validate

# Watch specific failed run (useful for testing extraction with failures)
vibe-validate watch-pr 104 --run-id 19754182675 --repo jdutton/mcp-typescript-simple --yaml
\`\`\`

## Output Format

### YAML (auto on failure, or with --yaml)

\`\`\`yaml
pr:
  number: 90
  title: "Enhancement: Add watch-pr improvements"
  branch: "feature/watch-pr"
  mergeable: true
  labels: ["enhancement"]
  linked_issues:
    - number: 42
      title: "Improve watch-pr"

status: failed

checks:
  total: 3
  passed: 2
  failed: 1
  history_summary:
    total_runs: 5
    recent_pattern: "Failed last 2 runs"
    success_rate: "60%"

  github_actions:
    - name: "Test"
      conclusion: failure
      run_id: 123
      extraction:
        errors:
          - file: "test.ts"
            line: 42
            message: "Expected success"
        summary: "1 test failure"
        totalErrors: 1

  external_checks:
    - name: "codecov/patch"
      conclusion: success
      extracted:
        summary: "Coverage: 85%"

guidance:
  status: failed
  severity: error
  summary: "1 check(s) failed"
  next_steps:
    - action: "Fix Test failure"
      url: "https://github.com/.../runs/123"
      severity: error
\`\`\`

### Text (on success, unless --yaml)

\`\`\`
🔍 PR #90: Enhancement: Add watch-pr improvements
   https://github.com/jdutton/vibe-validate/pull/90

✅ Test                                     success
✅ Lint                                     success
✅ codecov/patch                            success

3/3 checks passed

All checks passed

Next steps:
ℹ️ Ready to merge
\`\`\`

## Extraction Modes

### Matrix Mode (vibe-validate repos)

If check uses \`vv run\` or \`vv validate\`, YAML output is parsed and extraction passed through:

\`\`\`yaml
extraction:
  errors:
    - file: "test.ts"
      line: 42
  summary: "1 test failure"
  totalErrors: 1
\`\`\`

### Non-Matrix Mode (other repos)

For raw test output, extractors detect tool (vitest, jest, eslint) and extract errors:

\`\`\`yaml
extraction:
  errors:
    - file: "test.integration.test.ts"
      line: 10
      message: "Connection refused"
  summary: "2 test failures"
  totalErrors: 2
  metadata:
    detection:
      extractor: vitest
\`\`\`

## Common Workflows

### Standard PR workflow

\`\`\`bash
# Check PR status
vibe-validate watch-pr 90

# If failed, view extraction
vibe-validate watch-pr 90 --yaml | yq '.checks.github_actions[0].extraction'

# Re-run failed check
gh run rerun <run-id> --failed
\`\`\`

### AI agent workflow

\`\`\`bash
# AI agent checks PR (always YAML for parsing)
vibe-validate watch-pr 90 --yaml

# Parse result
# - If passed: proceed with merge
# - If failed: extract errors and fix
\`\`\`

## Caching

Results are cached locally (5 minute TTL):
\`\`\`
/tmp/vibe-validate/watch-pr-cache/<repo>/<pr-number>/
  metadata.json       # Complete WatchPRResult
  logs/<run-id>.log   # Raw logs from GitHub Actions
  extractions/        # Extracted errors
\`\`\`

Cache location is included in YAML output (\`cache.location\` field).
`);
}

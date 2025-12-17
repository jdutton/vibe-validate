import { safeExecSync } from '@vibe-validate/utils';
import type { Command } from 'commander';
import { stringify as stringifyYaml } from 'yaml';

import type { WatchPRResult } from '../schemas/watch-pr-result.schema.js';
import { WatchPROrchestrator } from '../services/watch-pr-orchestrator.js';

interface WatchPROptions {
  yaml?: boolean;
  repo?: string;
  runId?: string;
}

/**
 * Register the watch-pr command
 */
export function registerWatchPRCommand(program: Command): void {
  program
    .command('watch-pr [pr-number]')
    .description('Watch CI checks for a pull/merge request with LLM-friendly output')
    .option('--yaml', 'Force YAML output (auto-enabled on failure)')
    .option('--repo <owner/repo>', 'Repository (default: auto-detect from git remote)')
    .option('--run-id <id>', 'Watch specific run ID instead of latest (useful for testing failed runs)')
    .action(async (prNumber: string | undefined, options: WatchPROptions) => {
      try {
        const exitCode = await watchPRCommand(prNumber, options);
        process.exit(exitCode);
      } catch (error) {
        // Always output errors as YAML for parseability
        process.stdout.write('---\n');
        process.stdout.write(
          stringifyYaml({
            error: error instanceof Error ? error.message : String(error),
          })
        );
        process.exit(1);
      }
    });
}

/**
 * Execute watch-pr command
 *
 * @returns Exit code (0 = success, 1 = failure)
 */
async function watchPRCommand(
  prNumber: string | undefined,
  options: WatchPROptions
): Promise<number> {
  // Validate PR number
  if (!prNumber) {
    throw new Error(
      'PR number is required.\n' +
        'Usage: vibe-validate watch-pr <pr-number>\n' +
        'Example: vibe-validate watch-pr 90'
    );
  }

  const prNum = Number.parseInt(prNumber, 10);
  if (Number.isNaN(prNum) || prNum <= 0) {
    throw new Error(`Invalid PR number: ${prNumber}`);
  }

  // Detect owner/repo from git remote or --repo flag
  const { owner, repo } = options.repo
    ? parseRepoFlag(options.repo)
    : detectOwnerRepo();

  // Create orchestrator
  const orchestrator = new WatchPROrchestrator(owner, repo);

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
 * Detect owner/repo from git remote
 *
 * @returns Owner and repo from GitHub remote
 */
function detectOwnerRepo(): { owner: string; repo: string } {
  try {
    const remote = safeExecSync('git', ['remote', 'get-url', 'origin'], {
      encoding: 'utf8',
    }) as string;

    // Parse GitHub URL (supports both HTTPS and SSH)
    // HTTPS: https://github.com/owner/repo.git
    // SSH: git@github.com:owner/repo.git
    const regex = /github\.com[/:]([\w-]+)\/([\w-]+)/;
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

> Watch CI checks for a pull request with LLM-friendly YAML output

## Overview

The \`watch-pr\` command fetches complete PR check status from GitHub, including:
- GitHub Actions check results with error extraction
- External checks (codecov, SonarCloud, etc.) with summaries
- PR metadata (branch, labels, linked issues)
- File change context
- History summary (success rate, recent pattern)
- Intelligent guidance with next steps

**YAML output is auto-enabled on failure** (like validate command).

## How It Works

1. Fetches PR metadata and check results from GitHub
2. Classifies checks (GitHub Actions vs external)
3. Extracts errors from failed GitHub Actions logs (matrix + non-matrix mode)
4. Extracts details from external checks (codecov, SonarCloud)
5. Builds history summary (last 10 runs)
6. Generates intelligent guidance
7. Outputs YAML on failure, text on success (unless --yaml forced)

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

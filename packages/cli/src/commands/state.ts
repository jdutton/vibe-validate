/**
 * State Command
 *
 * Display current validation state from git notes cache.
 */

import { getDefaultValidateLevel, getLevels, type VibeValidateConfig } from '@vibe-validate/config';
import type { ValidationResult } from '@vibe-validate/core';
import { getGitTreeHash, type TreeHashResult } from '@vibe-validate/git';
import {
  findDecidingRun,
  readHistoryNote,
  getAllRunCacheForTree,
  type RunCacheNote,
} from '@vibe-validate/history';
import chalk from 'chalk';
import type { Command } from 'commander';
import { stringify as stringifyYaml } from 'yaml';

import { getCommandName } from '../utils/command-name.js';
import { findConfigPath } from '../utils/config-loader.js';
import { stateCommandFor, validateCommandFor } from '../utils/level-commands.js';
import { resolveLevelOrExit } from '../utils/level-option.js';
import { formatTreeHashOutput, cleanRunCacheEntries } from '../utils/tree-hash-output.js';
import { loadConfigOrExit } from '../utils/validation-lock-wrapper.js';

export function stateCommand(program: Command): void {
  program
    .command('state')
    .description('Show current validation state from git notes (or run cache if no config)')
    .option('-l, --level <name>', 'Show the run deciding this level, as validate --check reads it (one of validation.levels; default: the level validate runs, the last)')
    .option('-v, --verbose', 'Show full error output without truncation')
    .option('--runs', 'Show only run cache (not validation history)')
    .option('--all', 'Show both validation history and run cache')
    .action(async (options) => {
      try {
        await executeStateCommand(options);
      } catch (error) {
        handleStateError(error, options.verbose);
      }
    });
}

/** Without a config there is one level, the implicit one */
const NO_CONFIG: VibeValidateConfig = { validation: { phases: [] } };

/** The config and the level state reports on */
interface StateLevel {
  config: VibeValidateConfig;
  level: string;
}

/**
 * The level state reports on: --level, else the level `validate` runs by default
 *
 * Exits 1 (as `validate --level` does) for a level the config does not declare.
 */
async function resolveStateLevel(hasConfig: boolean, requested: string | undefined): Promise<StateLevel> {
  const startupExit = { code: 1, yaml: false } as const;
  const config = hasConfig ? (await loadConfigOrExit(startupExit)).config : NO_CONFIG;
  return { config, level: await resolveLevelOrExit(config, requested, getDefaultValidateLevel(config), startupExit) };
}

/**
 * Execute the state command logic
 */
async function executeStateCommand(options: { level?: string; verbose?: boolean; runs?: boolean; all?: boolean }): Promise<void> {
  const hasConfig = findConfigPath() !== null;
  const showRunsOnly = options.runs === true;
  // The run cache has no levels: --runs needs no config, so a broken one cannot stop it
  const stateLevel = showRunsOnly ? null : await resolveStateLevel(hasConfig, options.level);

  const treeHashResult = await getGitTreeHash();
  const treeHash = treeHashResult.hash;

  // Fast path: not in a git repository — skip all history lookups
  if (treeHash === 'unknown') {
    displayNoDataMessage(treeHash, options.verbose);
    process.exit(0);
  }

  const showAll = options.all === true;

  // Load data
  const history = stateLevel ? await loadValidationHistory(treeHashResult, stateLevel) : null;
  const validationHistory = history?.run ?? null;
  const runCacheEntries = (showRunsOnly || showAll || (!hasConfig && !validationHistory))
    ? await getAllRunCacheForTree(treeHash)
    : [];

  // Determine output (passing treeHash for consistent structure)
  const output = determineOutput(treeHash, validationHistory, runCacheEntries, showRunsOnly, showAll);

  // Runs exist on this tree, but none at this level: say so, and where they are
  if (!output && stateLevel && history && history.levelsWithRuns.length > 0) {
    displayNoRunAtLevelMessage(treeHash, stateLevel.level, history, options.verbose);
    process.exit(0);
  }

  // Handle no data case
  if (!output) {
    displayNoDataMessage(treeHash, options.verbose);
    process.exit(0);
  }

  // Output YAML and optional verbose summary
  console.log(stringifyYaml(output));

  if (options.verbose) {
    // The re-run a failure needs is the level asked about, not the level of the run that decided it
    const rerunCommand = stateLevel ? validateCommandFor(stateLevel.config, stateLevel.level) : `${getCommandName()} validate`;
    displayVerboseOutput(validationHistory, runCacheEntries, { showRunsOnly, showAll, rerunCommand });
  }

  process.exit(0);
}

/** The run deciding the level (null when none bears on it), and what else the tree has */
interface LoadedHistory {
  run: ValidationResult | null;
  levelsWithRuns: string[];
  newestRunLevel: string;
}

/**
 * The run deciding `level` for the current tree, as `validate --check` and the
 * cache read it (see findDecidingRun), and every level that has a run on it
 *
 * The deciding run can be at another level: a newer red at an earlier level
 * overturns an older pass, and a pass at a later level answers an earlier one.
 */
async function loadValidationHistory(
  treeHashResult: TreeHashResult,
  { config, level }: StateLevel
): Promise<LoadedHistory | null> {
  // Call readHistoryNote directly (hasHistoryForTree just calls readHistoryNote internally,
  // so going through it would double the git subprocess cost)
  const historyNote = await readHistoryNote(treeHashResult.hash);
  const newestRun = historyNote?.runs.at(-1);
  if (!historyNote || !newestRun) return null;

  const levelsWithRuns = [...new Set(historyNote.runs.map(run => run.level))];
  const decidingRun = findDecidingRun(historyNote, treeHashResult, { level, levels: getLevels(config) });
  const loaded = { levelsWithRuns, newestRunLevel: newestRun.level };
  if (!decidingRun) return { run: null, ...loaded };

  return { run: {
    passed: decidingRun.passed && decidingRun.result.passed,
    level: decidingRun.level,
    timestamp: decidingRun.result.timestamp,
    treeHash: decidingRun.result.treeHash,
    summary: decidingRun.result.summary,
    failedStep: decidingRun.result.failedStep,
    phases: decidingRun.result.phases,
  }, ...loaded };
}

/**
 * Determine what output to show based on data and flags
 * Uses shared formatting logic from tree-hash-output.ts
 */
function determineOutput(
  treeHash: string,
  validationHistory: ValidationResult | null,
  runCacheEntries: RunCacheNote[],
  showRunsOnly: boolean,
  showAll: boolean
): ValidationResult | { runCache: RunCacheNote[] } | Record<string, unknown> | null {
  if (showRunsOnly) {
    return { runCache: cleanRunCacheEntries(runCacheEntries) };
  }

  if (showAll) {
    // Use shared formatting logic - matches history show --all structure exactly
    return formatTreeHashOutput(
      treeHash,
      validationHistory,
      runCacheEntries,
      {
        includeValidation: validationHistory !== null,
        includeRunCache: true,
      }
    );
  }

  if (validationHistory) {
    return validationHistory;
  }

  if (runCacheEntries.length > 0) {
    return { runCache: cleanRunCacheEntries(runCacheEntries) };
  }

  return null;
}

/**
 * Display message when no data is available
 */
function displayNoDataMessage(treeHash: string, verbose?: boolean): void {
  console.log(stringifyYaml({ exists: false, treeHash }));

  if (verbose) {
    const cmd = getCommandName();
    console.log(chalk.gray('ℹ️  No validation or run cache found for current worktree'));
    console.log(chalk.gray(`   Run: ${cmd} validate`));
    console.log(chalk.gray(`   Or:  ${cmd} run <command>`));
  }
}

/**
 * Display message when the tree has runs, but none bears on the requested level
 * (only passes at earlier levels)
 */
function displayNoRunAtLevelMessage(
  treeHash: string,
  level: string,
  { levelsWithRuns, newestRunLevel }: LoadedHistory,
  verbose?: boolean
): void {
  console.log(stringifyYaml({ exists: false, treeHash, level, levelsWithRuns }));

  if (verbose) {
    console.log(chalk.gray(`ℹ️  No validation at level ${level} for current worktree`));
    console.log(chalk.gray(`   Runs recorded at: ${levelsWithRuns.join(', ')}`));
    console.log(chalk.gray(`   Show the newest: ${stateCommandFor(newestRunLevel)}`));
  }
}

/**
 * Display verbose output summaries
 */
function displayVerboseOutput(
  validationHistory: ValidationResult | null,
  runCacheEntries: RunCacheNote[],
  { showRunsOnly, showAll, rerunCommand }: { showRunsOnly: boolean; showAll: boolean; rerunCommand: string }
): void {
  if (validationHistory && !showRunsOnly) {
    displayVerboseSummary(validationHistory, rerunCommand);
  }

  if (runCacheEntries.length > 0 && (showRunsOnly || showAll)) {
    displayRunCacheSummary(runCacheEntries);
  }
}

/**
 * Handle errors from state command
 */
function handleStateError(error: unknown, verbose?: boolean): void {
  if (error instanceof Error && error.message.includes('not a git repository')) {
    console.log(stringifyYaml({ exists: false, error: 'Not in git repository' }));

    if (verbose) {
      console.log(chalk.gray('ℹ️  Not in a git repository'));
      console.log(chalk.gray('   Validation history requires git'));
    }
    process.exit(0);
  }

  console.error(chalk.red('❌ Failed to read validation state:'), error);
  process.exit(1);
}

/**
 * Display validation summary in verbose format
 */
function displayVerboseSummary(state: ValidationResult, rerunCommand: string): void {
  console.log(chalk.gray('─'.repeat(50)));
  console.log(chalk.blue('📊 Validation State Summary'));
  console.log(chalk.gray('─'.repeat(50)));

  // Status
  if (state.passed) {
    console.log(chalk.green('✅ Status: PASSED'));
  } else {
    console.log(chalk.red('❌ Status: FAILED'));
  }

  // Level (a pass at an earlier level says nothing about the later steps)
  if (state.level) {
    console.log(chalk.gray(`🎚️  Level: ${state.level}`));
  }

  // Timestamp
  const timestamp = new Date(state.timestamp);
  console.log(chalk.gray(`⏰ Last Run: ${timestamp.toLocaleString()}`));

  // Tree hash
  // Note: treeHash is always populated by validation runner
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  console.log(chalk.gray(`🌳 Git Tree Hash: ${state.treeHash!.substring(0, 12)}...`));

  // Failed step details (if any)
  if (!state.passed && state.failedStep) {
    console.log(chalk.red(`\n❌ Failed Step: ${state.failedStep}`));
    console.log(chalk.gray('  See step-level extraction in phases for structured error details'));
  }

  console.log(chalk.gray('─'.repeat(50)));

  // Next steps
  if (state.passed) {
    console.log(chalk.green('\n✅ Validation passed! Safe to commit.'));
  } else {
    // A failure is never replayed, so the plain re-run executes it: --force adds nothing
    console.log(chalk.yellow('\nNext Steps:'));
    console.log(chalk.gray('  1. Fix the failed step'));
    console.log(chalk.gray(`  2. Re-run: ${rerunCommand}`));

    // Suggest reporting extractor issues
    console.log(chalk.gray('\n💡 Error output unclear or missing details?'));
    console.log(
      chalk.gray(
        '   Help improve extraction: https://github.com/jdutton/vibe-validate/issues/new?template=extractor-improvement.yml',
      ),
    );
  }

  const cmd = getCommandName();
  console.log(chalk.gray(`\n💡 Tip: View full history with: ${cmd} history list`));
}

/**
 * Display run cache summary in verbose format
 */
function displayRunCacheSummary(runCache: RunCacheNote[]): void {
  console.log(chalk.gray('─'.repeat(50)));
  console.log(chalk.blue('🏃 Run Cache Summary'));
  console.log(chalk.gray('─'.repeat(50)));

  console.log(chalk.gray(`📦 Total cached runs: ${runCache.length}`));

  if (runCache.length > 0) {
    const passed = runCache.filter(r => r.exitCode === 0).length;
    const failed = runCache.length - passed;

    console.log(chalk.green(`✅ Passed: ${passed}`));
    if (failed > 0) {
      console.log(chalk.red(`❌ Failed: ${failed}`));
    }

    // Show most recent run
    const mostRecent = runCache[0]; // Already sorted newest first
    console.log(chalk.gray(`\n⏰ Most recent: ${new Date(mostRecent.timestamp).toLocaleString()}`));
    console.log(chalk.gray(`   Command: ${mostRecent.command}`));
    console.log(chalk.gray(`   Status: ${mostRecent.exitCode === 0 ? '✓ PASSED' : '✗ FAILED'}`));
  }

  console.log(chalk.gray('─'.repeat(50)));
  const cmd = getCommandName();
  console.log(chalk.gray(`\n💡 Tip: View run history with: ${cmd} history show --all`));
}

/**
 * Show verbose help with detailed documentation
 */
export function showStateVerboseHelp(): void {
  console.log(`# state Command Reference

> View current validation state

## Overview

The \`state\` command shows the current validation status without re-running validation. It reads the cached validation result from git notes.

## How It Works

1. **Reads validation state** from git notes (if exists)
2. **Shows pass/fail status**
3. **Shows git tree hash** (cache key)
4. **Shows timestamp** of last validation
5. **Shows error summary** (if failed)

## Options

- \`-l, --level <name>\` - Show the run deciding this level, as \`validate --check\` and the cache read it (one of \`validation.levels\`; default: the level \`validate\` runs by default, the last). The tree's runs are read newest first; a pass at an earlier level is skipped; the first remaining run decides, so a newer failure at any level is shown over an older pass. When only earlier-level passes are recorded, the output says so (\`exists: false\`, \`levelsWithRuns\`). An unknown level exits 1, as \`validate --level\` does
- \`-v, --verbose\` - Show full error output and details
- \`-y, --yaml\` - Output as YAML (machine-readable)

## Exit Codes

- \`0\` - State read (including "nothing recorded", reported as \`exists: false\`)
- \`1\` - Unknown \`--level\`, invalid configuration (not with \`--runs\`, which reads no config), or the state could not be read

## Examples

\`\`\`bash
# Check current state
vibe-validate state

# See full error details
vibe-validate state --verbose

# Machine-readable output
vibe-validate state --yaml
\`\`\`

## Output Formats

### Standard Output
\`\`\`
✅ Validation Status: PASSED
📅 Last validated: 2025-10-23T14:30:00Z
🔑 Tree hash: 2b62c71a3f
⏱️  Duration: 62.4s
\`\`\`

### Verbose Output
Includes:
- Full error messages
- Stack traces (if available)
- Failed step details
- Recommendations for fixing

### YAML Output
\`\`\`yaml
exists: true
passed: true
timestamp: 2025-10-23T14:30:00Z
treeHash: 2b62c71a3f...
duration: 62.4
\`\`\`

## When to Use

**Use \`state\` when you want to:**
- Check validation status without re-running
- Debug why validation failed
- See what tree hash is cached
- Verify validation result before committing
- Get machine-readable validation status

**Don't use \`state\` when:**
- You want to force fresh validation (use \`validate --force\`)
- You want to run validation if cache is stale (use \`validate\`)

## Integration with Other Commands

- \`vibe-validate validate\` - Run validation (creates state)
- \`vibe-validate validate --check\` - Same as \`state\` but with different exit codes
- \`vibe-validate history list\` - View validation history timeline
- \`vibe-validate history show <hash>\` - View state for specific tree hash

## Common Workflows

### Debug validation failure
\`\`\`bash
# 1. Run validation
vibe-validate validate

# 2. If fails, see details
vibe-validate state --verbose

# 3. Fix errors

# 4. Re-run
vibe-validate validate
\`\`\`

### AI agent workflow
\`\`\`bash
# Run validation
vibe-validate validate --yaml > /dev/null 2>&1

# Get structured result
vibe-validate state --yaml
\`\`\`

### Pre-commit check
\`\`\`bash
# Check if validation already passed
if vibe-validate state --yaml | grep -q "passed: true"; then
  echo "Validation already passed, skipping"
else
  vibe-validate validate
fi
\`\`\`
`);
}

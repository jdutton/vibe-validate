/**
 * History command - View and manage validation history
 */

import { Command } from 'commander';
import { stringify as stringifyYaml } from 'yaml';
import {
  readHistoryNote,
  getAllHistoryNotes,
  pruneHistoryByAge,
  pruneAllHistory,
  checkHistoryHealth,
  type HistoryNote,
} from '@vibe-validate/history';

// Type for flattened validation run with tree hash
type ValidationRun = HistoryNote['runs'][0] & { treeHash: string };

/**
 * Register history command
 */
export function historyCommand(program: Command): void {
  const history = program
    .command('history')
    .description('View and manage validation history stored in git notes');

  // history list
  history
    .command('list')
    .description('List validation history')
    .option('-l, --limit <number>', 'Limit number of results', '20')
    .option('-b, --branch <name>', 'Filter by branch name')
    .option('--yaml', 'Output in YAML format (default: table)')
    .action(async (options) => {
      await listHistory(options);
    });

  // history show
  history
    .command('show <tree-hash>')
    .description('Show validation history for specific tree hash')
    .option('--yaml', 'Output in YAML format (default: pretty print)')
    .action(async (treeHash, options) => {
      await showHistory(treeHash, options);
    });

  // history prune
  history
    .command('prune')
    .description('Prune old validation history')
    .option('--older-than <days>', 'Remove notes older than N days (e.g., "90")', '90')
    .option('--all', 'Remove all history')
    .option('--dry-run', 'Show what would be deleted without actually deleting')
    .action(async (options) => {
      await pruneHistory(options);
    });

  // history health
  history
    .command('health')
    .description('Check validation history health')
    .action(async () => {
      await healthCheck();
    });
}

/**
 * Output history in YAML format
 */
async function outputHistoryYaml(runs: ValidationRun[]): Promise<void> {
  // Small delay to ensure stderr is flushed
  await new Promise(resolve => setTimeout(resolve, 10));

  // RFC 4627 separator
  process.stdout.write('---\n');

  // Write pure YAML
  process.stdout.write(stringifyYaml(runs));

  // CRITICAL: Wait for stdout to flush before exiting
  await new Promise<void>(resolve => {
    if (process.stdout.write('')) {
      resolve();
    } else {
      process.stdout.once('drain', resolve);
    }
  });
}

/**
 * Output history in pretty table format
 */
function outputHistoryTable(
  runs: ValidationRun[],
  allRunsCount: number,
  notesCount: number,
  filteredCount: number,
  branchFilter?: string
): void {
  console.log(`\nValidation History (showing ${runs.length} most recent)\n`);

  for (const run of runs) {
    const timestamp = new Date(run.timestamp).toLocaleString();
    const hash = run.treeHash.slice(0, 7);
    const status = run.passed ? '✓ PASSED' : '✗ FAILED';
    const duration = (run.duration / 1000).toFixed(1);

    console.log(`${timestamp}  ${hash}  ${run.branch.padEnd(20)}  ${status}  (${duration}s)`);
  }

  console.log(`\nTotal validation runs: ${allRunsCount}`);
  console.log(`Tree hashes tracked: ${notesCount}`);

  if (filteredCount < allRunsCount && !branchFilter) {
    console.log(`\nShowing ${runs.length} of ${filteredCount} runs`);
    console.log(`Use --limit to see more: vibe-validate history list --limit 50`);
  }
}

/**
 * List validation history
 */
async function listHistory(options: {
  limit: string;
  branch?: string;
  yaml?: boolean;
}): Promise<void> {
  try {
    const limit = Number.parseInt(options.limit, 10);
    const allNotes = await getAllHistoryNotes();

    if (allNotes.length === 0) {
      console.log('No validation history found');
      console.log('\nHistory is recorded automatically when you run `vibe-validate validate`');
      return;
    }

    // Flatten all runs from all notes
    const allRuns = allNotes.flatMap((note) =>
      note.runs.map((run) => ({
        treeHash: note.treeHash,
        ...run,
      }))
    );

    // Sort by timestamp (newest first)
    allRuns.sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );

    // Filter by branch if specified
    let filteredRuns = allRuns;
    if (options.branch) {
      filteredRuns = allRuns.filter((run) => run.branch === options.branch);

      if (filteredRuns.length === 0) {
        console.log(`No validation history found for branch: ${options.branch}`);
        return;
      }
    }

    // Limit results
    const limitedRuns = filteredRuns.slice(0, limit);

    if (options.yaml) {
      await outputHistoryYaml(limitedRuns);
    } else {
      outputHistoryTable(limitedRuns, allRuns.length, allNotes.length, filteredRuns.length, options.branch);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`Error listing history: ${errorMessage}`);
    process.exit(1);
  }
}

/**
 * Show history for specific tree hash
 */
// eslint-disable-next-line sonarjs/cognitive-complexity -- Complexity 16 acceptable for history display command (coordinates YAML vs pretty-print output, error handling, and metadata formatting)
async function showHistory(
  treeHash: string,
  options: { yaml?: boolean }
): Promise<void> {
  try {
    const note = await readHistoryNote(treeHash);

    if (!note) {
      console.error(`No validation history found for tree hash: ${treeHash}`);
      console.error(`\nRun 'vibe-validate history list' to see available tree hashes`);
      process.exit(1);
    }

    if (options.yaml) {
      // YAML mode: Output structured result to stdout
      // Small delay to ensure stderr is flushed
      await new Promise(resolve => setTimeout(resolve, 10));

      // RFC 4627 separator
      process.stdout.write('---\n');

      // Write pure YAML
      process.stdout.write(stringifyYaml(note));

      // CRITICAL: Wait for stdout to flush before exiting
      await new Promise<void>(resolve => {
        if (process.stdout.write('')) {
          resolve();
        } else {
          process.stdout.once('drain', resolve);
        }
      });
    } else {
      // Pretty print
      console.log(`\nValidation History for Tree Hash: ${note.treeHash}`);
      console.log(`Total Runs: ${note.runs.length}\n`);

      for (let i = 0; i < note.runs.length; i++) {
        const run = note.runs[i];
        const timestamp = new Date(run.timestamp).toLocaleString();
        const status = run.passed ? '✓ PASSED' : '✗ FAILED';
        const duration = (run.duration / 1000).toFixed(1);

        console.log(`Run #${i + 1} (${run.id}):`);
        console.log(`  Timestamp: ${timestamp}`);
        console.log(`  Status: ${status}`);
        console.log(`  Duration: ${duration}s`);
        console.log(`  Branch: ${run.branch}`);
        console.log(`  Commit: ${run.headCommit}`);
        console.log(`  Uncommitted Changes: ${run.uncommittedChanges ? 'yes' : 'no'}`);

        if (run.result.phases) {
          console.log(`  Phases:`);
          for (const phase of run.result.phases) {
            const phaseStatus = phase.passed ? '✓' : '✗';
            console.log(`    ${phaseStatus} ${phase.name} (${phase.durationSecs.toFixed(1)}s)`);
          }
        }

        console.log('');
      }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`Error showing history: ${errorMessage}`);
    process.exit(1);
  }
}

/**
 * Prune validation history
 */
// eslint-disable-next-line sonarjs/cognitive-complexity -- Complexity 18 acceptable for history prune command (handles multiple pruning modes, dry-run logic, and result formatting)
async function pruneHistory(options: {
  olderThan?: string;
  all?: boolean;
  dryRun?: boolean;
}): Promise<void> {
  try {
    const dryRun = options.dryRun ?? false;

    if (options.all) {
      console.log(dryRun ? 'Pruning all history (DRY RUN)...\n' : 'Pruning all history...\n');

      const result = await pruneAllHistory({}, dryRun);

      if (result.notesPruned === 0) {
        console.log('No history to prune');
        return;
      }

      console.log(`${dryRun ? 'Would prune' : 'Pruned'} ${result.notesPruned} tree hashes`);
      console.log(`${dryRun ? 'Would remove' : 'Removed'} ${result.runsPruned} validation runs`);

      if (dryRun) {
        console.log(`\nRun without --dry-run to execute: vibe-validate history prune --all`);
      }
    } else {
      const days = options.olderThan ? Number.parseInt(options.olderThan, 10) : 90;

      console.log(
        dryRun
          ? `Pruning history older than ${days} days (DRY RUN)...\n`
          : `Pruning history older than ${days} days...\n`
      );

      const result = await pruneHistoryByAge(days, {}, dryRun);

      if (result.notesPruned === 0) {
        console.log(`No history older than ${days} days found`);
        return;
      }

      console.log(`${dryRun ? 'Would prune' : 'Pruned'} ${result.notesPruned} tree hashes`);
      console.log(`${dryRun ? 'Would remove' : 'Removed'} ${result.runsPruned} validation runs`);
      console.log(`Remaining: ${result.notesRemaining} tree hashes`);

      if (dryRun) {
        console.log(`\nRun without --dry-run to execute: vibe-validate history prune --older-than ${days}`);
      }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`Error pruning history: ${errorMessage}`);
    process.exit(1);
  }
}

/**
 * Check history health
 */
async function healthCheck(): Promise<void> {
  try {
    const health = await checkHistoryHealth();

    console.log('\nValidation History Health Check\n');
    console.log(`Total tree hashes: ${health.totalNotes}`);
    console.log(`Old notes (>90 days): ${health.oldNotesCount}`);

    if (health.shouldWarn) {
      console.log('');
      console.log(health.warningMessage);
    } else {
      console.log('\n✓ History is healthy');
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`Error checking history health: ${errorMessage}`);
    process.exit(1);
  }
}

/**
 * Show verbose help with detailed documentation
 */
export function showHistoryVerboseHelp(): void {
  console.log(`# history Command Reference

> View and manage validation history stored in git notes

## Overview

The \`history\` command provides tools to inspect, manage, and maintain validation history records stored in git notes. Each validation run is tracked using the git tree hash as a key, allowing you to see when code states were validated and with what results.

## Subcommands

### \`list\` - List validation history

List all validation runs, sorted by timestamp (newest first).

**Options:**
- \`-l, --limit <number>\` - Limit results (default: 20)
- \`-b, --branch <name>\` - Filter by branch name
- \`--yaml\` - Output as YAML

**Examples:**
\`\`\`bash
vibe-validate history list                    # Last 20 runs
vibe-validate history list --limit 50         # Last 50 runs
vibe-validate history list --branch main      # Only main branch
vibe-validate history list --yaml             # Machine-readable output
\`\`\`

**Output fields:**
- Timestamp - When validation ran
- Tree hash - First 7 chars of git tree hash
- Branch - Branch name
- Status - PASSED or FAILED
- Duration - How long validation took

---

### \`show\` - Show detailed history for a tree hash

Display all validation runs for a specific git tree hash.

**Arguments:**
- \`<tree-hash>\` - Git tree hash (full or abbreviated)

**Options:**
- \`--yaml\` - Output as YAML

**Examples:**
\`\`\`bash
vibe-validate history show abc123d            # Show history for tree
vibe-validate history show abc123d --yaml     # Machine-readable
\`\`\`

**What you'll see:**
- All runs for this tree hash
- Timestamps and durations
- Pass/fail status
- Phase breakdown
- Uncommitted changes flag

---

### \`prune\` - Remove old validation history

Delete validation history to reduce git notes storage.

**Options:**
- \`--older-than <days>\` - Remove notes older than N days (default: 90)
- \`--all\` - Remove ALL history (use with caution)
- \`--dry-run\` - Preview what would be deleted

**Examples:**
\`\`\`bash
vibe-validate history prune                           # Remove >90 day old
vibe-validate history prune --older-than 30           # Remove >30 days
vibe-validate history prune --dry-run                 # Preview only
vibe-validate history prune --all --dry-run           # Preview full cleanup
\`\`\`

**What gets pruned:**
- Entire git notes (tree hash level) where ALL runs are older than threshold
- Partial runs are NOT pruned (keeps notes with any recent runs)

---

### \`health\` - Check history health

Check for history storage bloat and maintenance recommendations.

**Examples:**
\`\`\`bash
vibe-validate history health
\`\`\`

**Health indicators:**
- Total tree hashes tracked
- Notes older than 90 days
- Recommendations for pruning

## Storage Details

**Where history lives:**
- Git notes under \`refs/notes/vibe-validate/runs\`
- Keyed by git tree hash (content-based)
- Stored as YAML with full validation results

**Storage impact:**
- Each tree hash: ~1-5KB (depends on validation detail)
- Typical project: 50-200 tree hashes
- Total overhead: Usually <1MB

**When to prune:**
- Storage > 1MB
- Many old notes (>100 notes older than 90 days)
- Switching to new validation approach

## Exit Codes

- \`0\` - Success
- \`1\` - Error (git command failed, tree hash not found, etc.)

## Common Workflows

### View recent validation activity
\`\`\`bash
vibe-validate history list --limit 10
\`\`\`

### Investigate specific tree hash
\`\`\`bash
# From validation output, copy tree hash, then:
vibe-validate history show <tree-hash>
\`\`\`

### Clean up old history
\`\`\`bash
# Preview first
vibe-validate history prune --older-than 60 --dry-run

# If looks good, execute
vibe-validate history prune --older-than 60
\`\`\`

### Check storage health
\`\`\`bash
vibe-validate history health
\`\`\`

## Integration with CI

History is stored in git notes which are NOT pushed by default. To share validation history across team:

\`\`\`bash
# Push notes (one-time or in CI)
git push origin refs/notes/vibe-validate/runs

# Fetch notes (team members)
git fetch origin refs/notes/vibe-validate/runs:refs/notes/vibe-validate/runs
\`\`\`

**Recommendation:** Keep history local for development, don't push to remote unless team wants shared validation tracking.
`);
}

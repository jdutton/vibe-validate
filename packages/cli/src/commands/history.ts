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
} from '@vibe-validate/history';

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
 * List validation history
 */
async function listHistory(options: {
  limit: string;
  branch?: string;
  yaml?: boolean;
}): Promise<void> {
  try {
    const limit = parseInt(options.limit, 10);
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
      console.log(stringifyYaml(limitedRuns));
    } else {
      // Pretty table output
      console.log(`\nValidation History (showing ${limitedRuns.length} most recent)\n`);

      for (const run of limitedRuns) {
        const timestamp = new Date(run.timestamp).toLocaleString();
        const hash = run.treeHash.slice(0, 7);
        const status = run.passed ? '✓ PASSED' : '✗ FAILED';
        const duration = (run.duration / 1000).toFixed(1);

        console.log(`${timestamp}  ${hash}  ${run.branch.padEnd(20)}  ${status}  (${duration}s)`);
      }

      console.log(`\nTotal validation runs: ${allRuns.length}`);
      console.log(`Tree hashes tracked: ${allNotes.length}`);

      if (filteredRuns.length < allRuns.length && !options.branch) {
        console.log(`\nShowing ${limitedRuns.length} of ${filteredRuns.length} runs`);
        console.log(`Use --limit to see more: vibe-validate history list --limit 50`);
      }
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
      console.log(stringifyYaml(note));
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
async function pruneHistory(options: {
  olderThan?: string;
  all?: boolean;
  dryRun?: boolean;
}): Promise<void> {
  try {
    const dryRun = options.dryRun || false;

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
      const days = options.olderThan ? parseInt(options.olderThan, 10) : 90;

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

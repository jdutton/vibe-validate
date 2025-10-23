/**
 * State Command
 *
 * Display current validation state from git notes cache.
 */

import type { Command } from 'commander';
import chalk from 'chalk';
import { stringify as stringifyYaml } from 'yaml';
import { getGitTreeHash } from '@vibe-validate/git';
import { readHistoryNote, hasHistoryForTree } from '@vibe-validate/history';
import type { ValidationResult } from '@vibe-validate/core';

export function stateCommand(program: Command): void {
  program
    .command('state')
    .description('Show current validation state from git notes')
    .option('-v, --verbose', 'Show full error output without truncation')
    .action(async (options) => {
      try {
        // Get current tree hash
        const treeHash = await getGitTreeHash();

        // Check if history exists for current tree
        const hasHistory = await hasHistoryForTree(treeHash);

        if (!hasHistory) {
          // Always show tree hash, even when no history exists (helpful for debugging)
          const noStateOutput = {
            exists: false,
            treeHash: treeHash,
          };
          console.log(stringifyYaml(noStateOutput));

          if (options.verbose) {
            console.log(chalk.gray('ℹ️  No validation state found for current worktree'));
            console.log(chalk.gray('   Run: vibe-validate validate'));
          }
          process.exit(0);
        }

        // Read history note
        const historyNote = await readHistoryNote(treeHash);

        if (!historyNote || historyNote.runs.length === 0) {
          // Always show tree hash, even when no runs exist
          const noStateOutput = {
            exists: false,
            treeHash: treeHash,
          };
          console.log(stringifyYaml(noStateOutput));

          if (options.verbose) {
            console.log(chalk.gray('ℹ️  No validation runs found for current worktree'));
          }
          process.exit(0);
        }

        // Get most recent run
        const mostRecentRun = historyNote.runs[historyNote.runs.length - 1];
        const result = mostRecentRun.result;

        // Convert to state format (compatible with old format)
        const state: ValidationResult = {
          passed: result.passed,
          timestamp: result.timestamp,
          treeHash: result.treeHash,
          failedStep: result.failedStep,
          failedStepOutput: result.failedStepOutput,
          phases: result.phases,
          rerunCommand: result.rerunCommand,
        };

        // Output YAML format (always)
        const yamlContent = stringifyYaml(state);

        if (options.verbose) {
          // Verbose mode: show full output with colors and explanations
          displayVerboseState(state, yamlContent, mostRecentRun.branch);
        } else {
          // Minimal mode: just the YAML content
          console.log(yamlContent);
        }

        process.exit(0);
      } catch (error) {
        if (error instanceof Error && error.message.includes('not a git repository')) {
          // Not in git repo - show structured output
          const noGitOutput = {
            exists: false,
            error: 'Not in git repository',
          };
          console.log(stringifyYaml(noGitOutput));

          if (options.verbose) {
            console.log(chalk.gray('ℹ️  Not in a git repository'));
            console.log(chalk.gray('   Validation history requires git'));
          }
          process.exit(0);
        }

        console.error(chalk.red('❌ Failed to read validation state:'), error);
        process.exit(1);
      }
    });
}

/**
 * Display validation state in verbose format with colors and explanations
 */
function displayVerboseState(state: ValidationResult, yamlContent: string, branch: string): void {
  // First show the raw YAML
  console.log(yamlContent);

  // Then add colored summary and explanations
  console.log(chalk.gray('─'.repeat(50)));
  console.log(chalk.blue('📊 Validation State Summary'));
  console.log(chalk.gray('─'.repeat(50)));

  // Status
  if (state.passed) {
    console.log(chalk.green('✅ Status: PASSED'));
  } else {
    console.log(chalk.red('❌ Status: FAILED'));
  }

  // Timestamp
  const timestamp = new Date(state.timestamp);
  console.log(chalk.gray(`⏰ Last Run: ${timestamp.toLocaleString()}`));

  // Tree hash
  console.log(chalk.gray(`🌳 Git Tree Hash: ${state.treeHash.substring(0, 12)}...`));

  // Branch
  console.log(chalk.gray(`🌿 Branch: ${branch}`));

  // Failed step details (if any)
  if (!state.passed && state.failedStep) {
    console.log(chalk.red(`\n❌ Failed Step: ${state.failedStep}`));

    if (state.failedStepOutput) {
      console.log(chalk.red('\nError Output (included in YAML above):'));
      console.log(chalk.gray('  See failedStepOutput field for complete error details'));
    }
  }

  console.log(chalk.gray('─'.repeat(50)));

  // Next steps
  if (!state.passed) {
    console.log(chalk.yellow('\nNext Steps:'));
    console.log(chalk.gray('  1. Fix the failed step'));
    console.log(chalk.gray('  2. Re-run: vibe-validate validate'));
    console.log(chalk.gray('  3. Or force re-validation: vibe-validate validate --force'));

    // Suggest reporting extractor issues
    console.log(chalk.gray('\n💡 Error output unclear or missing details?'));
    console.log(
      chalk.gray(
        '   Help improve extraction: https://github.com/jdutton/vibe-validate/issues/new?template=extractor-improvement.yml',
      ),
    );
  } else {
    console.log(chalk.green('\n✅ Validation passed! Safe to commit.'));
  }

  console.log(chalk.gray('\n💡 Tip: View full history with: vibe-validate history list'));
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

- \`-v, --verbose\` - Show full error output and details
- \`-y, --yaml\` - Output as YAML (machine-readable)

## Exit Codes

- \`0\` - State file found and read successfully
- \`1\` - State file not found or invalid

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

/**
 * Pre-Commit Command
 *
 * Runs branch sync check + validation before allowing commit.
 * This is the recommended workflow before committing code.
 */

import type { Command } from 'commander';
import { checkBranchSync } from '@vibe-validate/git';
import { getRemoteBranch } from '@vibe-validate/config';
import { loadConfig } from '../utils/config-loader.js';
import { detectContext } from '../utils/context-detector.js';
import { runValidateWorkflow } from '../utils/validate-workflow.js';
import {
  selectToolsToRun,
  runSecretScan,
  showPerformanceWarning,
  showSecretsDetectedError,
  formatToolName,
  hasGitleaksConfig,
  isGitleaksAvailable,
} from '../utils/secret-scanning.js';
import chalk from 'chalk';

export function preCommitCommand(program: Command): void {
  program
    .command('pre-commit')
    .description('Run branch sync check + validation (recommended before commit)')
    .option('--skip-sync', 'Skip branch sync check')
    .option('-v, --verbose', 'Show detailed progress and output')
    // eslint-disable-next-line sonarjs/cognitive-complexity -- Complexity 47 acceptable for pre-commit workflow orchestration (coordinates git sync, config loading, validation, and error handling)
    .action(async (options) => {
      try {
        // Step 1: Load configuration (needed for git settings)
        const config = await loadConfig();
        if (!config) {
          console.error(chalk.red('❌ No configuration found'));
          console.error(chalk.gray('   Run: vibe-validate init'));
          process.exit(1);
        }

        // Step 2: Check branch sync (unless skipped)
        if (!options.skipSync) {
          // Construct remote branch reference using helper
          const remoteBranch = getRemoteBranch(config.git);

          console.log(chalk.blue(`🔄 Checking branch sync with ${remoteBranch}...`));

          const syncResult = await checkBranchSync({
            remoteBranch,
          });

          if (!syncResult.isUpToDate && syncResult.hasRemote) {
            console.error(chalk.red(`❌ Branch is behind ${remoteBranch}`));
            console.error(chalk.yellow(`   Behind by ${syncResult.behindBy} commit(s)`));
            console.error(chalk.yellow(`   Please merge ${remoteBranch} before committing:`));
            console.error(chalk.gray(`   git merge ${remoteBranch}`));
            process.exit(1);
          }

          if (syncResult.hasRemote) {
            console.log(chalk.green(`✅ Branch is up to date with ${remoteBranch}`));
          } else {
            console.log(chalk.gray('ℹ️  No remote tracking branch (new branch or no remote)'));
          }
        }

        // Step 3: Detect context
        const context = detectContext();

        // Step 4: Verbose mode is ONLY enabled via explicit --verbose flag
        const verbose = options.verbose ?? false;

        // Step 5: Run secret scanning if enabled
        const secretScanning = config.hooks?.preCommit?.secretScanning;
        if (secretScanning?.enabled) {
          console.log(chalk.blue('\n🔒 Running secret scanning...'));

          // Determine which tools to run (autodetect or explicit command)
          const toolsToRun = selectToolsToRun(secretScanning.scanCommand);

          if (toolsToRun.length === 0) {
            console.warn(chalk.yellow('⚠️  No secret scanning tools configured or available'));
            console.warn(chalk.gray('   Install gitleaks or add .secretlintrc.json'));
          } else {
            const results = [];

            // Run each tool
            for (const { tool, command } of toolsToRun) {
              const result = runSecretScan(tool, command, verbose);
              results.push(result);

              // Handle skipped scans (e.g., gitleaks not available but config exists)
              if (result.skipped) {
                if (hasGitleaksConfig() && !isGitleaksAvailable()) {
                  console.warn(chalk.yellow(`⚠️  Found .gitleaks.toml but gitleaks command not available, skipping`));
                  console.warn(chalk.gray('   Install gitleaks: brew install gitleaks'));
                }
                continue;
              }

              // Show verbose output if requested
              if (verbose && result.output) {
                console.log(chalk.gray(result.output));
              }

              // Show performance warning if scan was slow (hardcoded 5s threshold)
              if (result.passed) {
                showPerformanceWarning(tool, result.duration, 5000);
              }
            }

            // Check if any scans failed
            const failedScans = results.filter(r => !r.passed && !r.skipped);
            if (failedScans.length > 0) {
              showSecretsDetectedError(failedScans);
              process.exit(1);
            }

            // Success message
            const ranTools = results.filter(r => !r.skipped);
            if (ranTools.length > 0) {
              const toolNames = ranTools.map(r => formatToolName(r.tool)).join(', ');
              const totalDuration = ranTools.reduce((sum, r) => sum + r.duration, 0);
              console.log(chalk.green(`✅ No secrets detected (${toolNames}, ${totalDuration}ms)`));
            }
          }
        }

        // Step 6: Run validation with caching
        console.log(chalk.blue('\n🔄 Running validation...'));

        const result = await runValidateWorkflow(config, {
          force: false, // Respect cache by default
          verbose,
          yaml: false, // Pre-commit uses human-readable output
          check: false,
          context,
        });

        // Step 7: Report results
        if (result.passed) {
          console.log(chalk.green('\n✅ Pre-commit checks passed!'));
          console.log(chalk.gray('   Safe to commit.'));
          process.exit(0);
        } else {
          console.error(chalk.red('\n❌ Pre-commit checks failed'));
          console.error(chalk.yellow('   Fix errors before committing.'));

          // Note: Error details and YAML output are already shown by runValidateWorkflow
          // No need to duplicate the error display here

          process.exit(1);
        }
      } catch (error) {
        console.error(chalk.red('❌ Pre-commit checks failed with error:'), error);
        process.exit(1);
      }
    });
}

/**
 * Show verbose help with detailed documentation
 */
export function showPreCommitVerboseHelp(): void {
  console.log(`# pre-commit Command Reference

> Run branch sync check + validation (recommended before commit)

## Overview

The \`pre-commit\` command runs a comprehensive pre-commit workflow to ensure your code is synced with the remote main branch and passes all validation checks before allowing a commit. This prevents pushing broken code or creating merge conflicts.

## How It Works

1. Runs sync-check (fails if branch behind origin/main)
2. Runs validate (with caching)
3. Reports git status (warns about unstaged files)

## Options

- \`--skip-sync\` - Skip branch sync check (not recommended)
- \`-v, --verbose\` - Show detailed progress and output

## Exit Codes

- \`0\` - Sync OK and validation passed
- \`1\` - Sync failed OR validation failed

## Examples

\`\`\`bash
# Standard pre-commit workflow
vibe-validate pre-commit

# Skip sync check (not recommended)
vibe-validate pre-commit --skip-sync
\`\`\`

## Common Workflows

### Typical usage before committing

\`\`\`bash
# Make changes
git add .

# Run pre-commit checks
vibe-validate pre-commit

# If passed, commit
git commit -m "Your message"
\`\`\`

### Integrate with Husky

\`\`\`bash
# Setup pre-commit hook
npx husky init
echo "npx vibe-validate pre-commit" > .husky/pre-commit

# Now runs automatically before every commit
git commit -m "Your message"
\`\`\`

## Error Recovery

### If sync check fails

**Branch is behind origin/main:**
\`\`\`bash
# Fetch latest changes
git fetch origin

# Merge origin/main
git merge origin/main

# Resolve conflicts if any

# Retry pre-commit
vibe-validate pre-commit
\`\`\`

### If validation fails

**Fix errors shown in output:**
\`\`\`bash
# View detailed error info
vibe-validate state

# Fix the errors

# Retry pre-commit
vibe-validate pre-commit
\`\`\`
`);
}

/**
 * Pre-Commit Command
 *
 * Runs branch sync check + validation before allowing commit.
 * This is the recommended workflow before committing code.
 */

import { getRemoteBranch } from '@vibe-validate/config';
import {
  checkBranchSync,
  getPartiallyStagedFiles,
  isCurrentBranchBehindTracking,
  getGitTreeHash,
  isMergeInProgress
} from '@vibe-validate/git';
import { isToolAvailable } from '@vibe-validate/utils';
import chalk from 'chalk';
import type { Command } from 'commander';

import { getCommandName } from '../utils/command-name.js';
import { loadConfig } from '../utils/config-loader.js';
import { detectContext } from '../utils/context-detector.js';
import {
  selectToolsToRun,
  runSecretScan,
  showPerformanceWarning,
  showSecretsDetectedError,
  formatToolName,
  hasGitleaksConfig,
} from '../utils/secret-scanning.js';
import { runValidateWorkflow } from '../utils/validate-workflow.js';


/**
 * Show work protection recovery instructions with snapshot hash
 */
function showWorkProtectionMessage(treeHash: string | null, recoveryCommand: string, programName: string): void {
  if (treeHash) {
    console.error(chalk.green(`\n   ✓ Work protected by snapshot: ${treeHash.slice(0, 12)}...`));
    console.error(chalk.yellow(`   Safe to run:`));
    console.error(chalk.gray(`     ${recoveryCommand}`));
    console.error(chalk.yellow('\n   If files get lost or corrupted, view recovery guidance:'));
    console.error(chalk.gray(`     ${programName} snapshot --help --verbose`));
  } else {
    console.error(chalk.yellow('\n   ⚠️  No snapshot created - proceed with caution'));
    console.error(chalk.yellow('   To fix, run:'));
    console.error(chalk.gray(`     ${recoveryCommand}`));
  }
}

export function preCommitCommand(program: Command): void {
  const cmd = program
    .command('pre-commit')
    .description('Run branch sync check + validation (recommended before commit)')
    .option('--skip-sync', 'Skip branch sync check')
    .option('-v, --verbose', 'Show detailed progress and output');

  // eslint-disable-next-line sonarjs/cognitive-complexity -- Complexity 47 acceptable for pre-commit workflow orchestration (coordinates git sync, config loading, validation, and error handling)
  cmd.action(async (options) => {
    const programName = program.name();
      try {
        // Step 1: Load configuration (needed for git settings)
        const config = await loadConfig();
        if (!config) {
          const cmd = getCommandName();
          console.error(chalk.red('❌ No configuration found'));
          console.error(chalk.gray(`   Run: ${cmd} init`));
          process.exit(1);
        }

        // Step 2: Create worktree snapshot BEFORE any git operations (CRITICAL for work protection)
        console.log(chalk.blue('📸 Creating worktree snapshot...'));
        let treeHash: string | null = null;

        try {
          treeHash = await getGitTreeHash();
          console.log(chalk.gray(`   Snapshot: ${treeHash.slice(0, 12)}...`));
        } catch (error) {
          console.warn(chalk.yellow('⚠️  Could not create snapshot'));
          if (options.verbose) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.warn(chalk.gray(`   ${errorMessage}`));
          }
        }
        console.log(''); // Blank line for readability

        // Step 3: Check for partially staged files
        console.log(chalk.blue('🔍 Checking for partially staged files...'));
        const partiallyStagedFiles = getPartiallyStagedFiles();

        if (partiallyStagedFiles.length > 0) {
          console.error(chalk.red('❌ Partially staged files detected'));
          console.error(chalk.yellow('   These files have BOTH staged and unstaged changes:'));
          for (const file of partiallyStagedFiles) {
            console.error(chalk.gray(`   - ${file}`));
          }
          console.error(chalk.yellow('\n   This is incompatible with validation:'));
          console.error(chalk.gray('   • Validation runs against the FULL file (staged + unstaged)'));
          console.error(chalk.gray('   • Git commits only the STAGED portion'));
          console.error(chalk.gray('   • Result: Validated code ≠ committed code'));
          console.error(chalk.yellow('\n   To fix, choose one:'));
          console.error(chalk.gray(`   • Stage all changes:   git add ${partiallyStagedFiles.join(' ')}`));
          console.error(chalk.gray(`   • Unstage all changes: git restore --staged ${partiallyStagedFiles.join(' ')}`));
          console.error(chalk.gray('   • Skip validation:     git commit --no-verify (not recommended)'));
          process.exit(1);
        }
        console.log(chalk.green('✅ No partially staged files'));

        // Step 3: Check if current branch is behind its remote tracking branch
        console.log(chalk.blue('🔍 Checking if current branch is behind remote...'));
        const behindTracking = isCurrentBranchBehindTracking();

        if (behindTracking !== null && behindTracking > 0) {
          console.error(chalk.red(`❌ Current branch is behind its remote tracking branch`));
          console.error(chalk.yellow(`   Behind by ${behindTracking} commit(s)`));
          console.error(chalk.yellow('   Someone else has pushed changes to this branch.'));

          showWorkProtectionMessage(treeHash, 'git pull', programName);

          console.error(chalk.gray('\n   Alternative: git pull --rebase'));
          console.error(chalk.gray('\n   Skip this check with: --skip-sync (not recommended)'));
          process.exit(1);
        }

        if (behindTracking === null) {
          console.log(chalk.gray('ℹ️  No remote tracking branch (new branch or not pushed yet)'));
        } else {
          console.log(chalk.green('✅ Current branch is up to date with remote'));
        }

        // Step 4: Check branch sync (unless skipped or in merge)
        if (!options.skipSync) {
          // Construct remote branch reference using helper
          const remoteBranch = getRemoteBranch(config.git);

          // Check if we're in the middle of a merge (MERGE_HEAD exists)
          // During a merge, being behind origin/main is expected - the merge commit will resolve it
          if (isMergeInProgress()) {
            console.log(chalk.blue(`🔄 Merge in progress - skipping branch sync check`));
            console.log(chalk.gray(`   (This merge commit will sync with ${remoteBranch})`));
          } else {
            console.log(chalk.blue(`🔄 Checking branch sync with ${remoteBranch}...`));

            const syncResult = await checkBranchSync({
              remoteBranch,
            });

            if (!syncResult.isUpToDate && syncResult.hasRemote) {
              console.error(chalk.red(`❌ Branch is behind ${remoteBranch}`));
              console.error(chalk.yellow(`   Behind by ${syncResult.behindBy} commit(s)`));

              showWorkProtectionMessage(treeHash, `git merge ${remoteBranch}`, programName);

              process.exit(1);
            }

            if (syncResult.hasRemote) {
              console.log(chalk.green(`✅ Branch is up to date with ${remoteBranch}`));
            } else {
              console.log(chalk.gray('ℹ️  No remote tracking branch (new branch or no remote)'));
            }
          }
        }

        // Step 5: Detect context
        const context = detectContext();

        // Step 6: Verbose mode is ONLY enabled via explicit --verbose flag
        const verbose = options.verbose ?? false;

        // Step 7: Run secret scanning if enabled
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
                if (hasGitleaksConfig() && !isToolAvailable('gitleaks')) {
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
                const hasExplicitCommand = secretScanning.scanCommand !== undefined && secretScanning.scanCommand !== 'autodetect';
                showPerformanceWarning(tool, result.duration, 5000, hasExplicitCommand);
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

        // Step 8: Run validation with caching
        console.log(chalk.blue('\n🔄 Running validation...'));

        const result = await runValidateWorkflow(config, {
          force: false, // Respect cache by default
          verbose,
          yaml: false, // Pre-commit uses human-readable output
          check: false,
          context,
        });

        // Step 9: Report results
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

1. Checks for partially staged files (fails if detected)
2. Checks if current branch is behind its remote tracking branch (fails if detected)
3. Runs sync-check (fails if branch behind origin/main, skipped during merge)
4. Runs secret scanning (if enabled in config)
5. Runs validate (with caching)
6. Reports git status (warns about unstaged files)

**Note:** When completing a merge commit (MERGE_HEAD exists), the branch sync check is automatically skipped since the merge commit itself resolves the out-of-sync state.

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

## Secret Scanning

Secret scanning prevents accidental commits of credentials (API keys, tokens, passwords).

### Autodetect Mode (Recommended)

Enable in config without specifying \`scanCommand\`:

\`\`\`yaml
hooks:
  preCommit:
    secretScanning:
      enabled: true
\`\`\`

Automatically runs tools based on config files:
- \`.gitleaks.toml\` or \`.gitleaksignore\` → runs gitleaks
- \`.secretlintrc.json\` → runs secretlint (via npx)
- Both files → runs both tools (defense-in-depth)

### Tool Setup

**Option 1: gitleaks (recommended - fast, 160+ secret types)**
\`\`\`bash
# Install
macOS:   brew install gitleaks
Linux:   https://github.com/gitleaks/gitleaks#installation
Windows: winget install gitleaks

# Create config (empty file enables autodetect)
touch .gitleaksignore

# Handle false positives (add fingerprints from gitleaks output)
echo "path/to/file.txt:generic-api-key:123" >> .gitleaksignore
\`\`\`

**Option 2: secretlint (npm-based, always available)**
\`\`\`bash
# Install
npm install --save-dev @secretlint/secretlint-rule-preset-recommend secretlint

# Create config
cat > .secretlintrc.json << 'EOF'
{
  "rules": [
    {"id": "@secretlint/secretlint-rule-preset-recommend"}
  ]
}
EOF

# Handle false positives
cat > .secretlintignore << 'EOF'
.jscpd/
**/dist/**
**/node_modules/**
EOF
\`\`\`

**Option 3: Both (defense-in-depth)**
\`\`\`bash
# Set up both tools - autodetect runs both automatically
# gitleaks: fast native binary
# secretlint: npm-based with different detection patterns
\`\`\`

### Explicit Command Mode

For custom tools or specific flags:

\`\`\`yaml
hooks:
  preCommit:
    secretScanning:
      enabled: true
      scanCommand: "gitleaks protect --staged --verbose --config .gitleaks.toml"
\`\`\`

### Troubleshooting

- **"No secrets detected"** - Working correctly, no secrets found
- **"Secret scanning enabled but no tools available"** - Install gitleaks or create .secretlintrc.json
- **False positives** - Add to .gitleaksignore or .secretlintignore
- **Slow scans** - Warning shown if scan takes >5 seconds

## Error Recovery

### If sync check fails

**Branch is behind origin/main:**
\`\`\`bash
# Fetch latest changes
git fetch origin

# Merge origin/main
git merge origin/main

# Resolve conflicts if any

# Retry pre-commit (sync check auto-skipped during merge)
vibe-validate pre-commit

# Complete the merge
git commit -m "Merge origin/main into feature-branch"
\`\`\`

**Note:** Once you start the merge (\`git merge origin/main\`), pre-commit will automatically skip the branch sync check when you commit, since the merge itself brings you up to date.

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

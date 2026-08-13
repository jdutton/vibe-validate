/**
 * Pre-Commit Command
 *
 * Runs branch sync check + validation before allowing commit.
 * This is the recommended workflow before committing code.
 */

import {
  getRemoteBranch,
  getRemoteOrigin,
  getMainBranch,
  DEFAULT_SYNC_GUARD_MODE,
  type SyncGuardMode
} from '@vibe-validate/config';
import {
  checkBranchSync,
  fetchRemoteRefs,
  getPartiallyStagedFiles,
  getTrackingDivergence,
  getUpstreamRef,
  getGitTreeHash,
  isMergeInProgress,
  isRebaseInProgress,
  refKey,
  type RemoteRef
} from '@vibe-validate/git';
import { isToolAvailable } from '@vibe-validate/utils';
import chalk from 'chalk';
import type { Command } from 'commander';

import { getCommandName } from '../utils/command-name.js';
import { loadConfig } from '../utils/config-loader.js';
import {
  selectToolsToRun,
  runSecretScan,
  showPerformanceWarning,
  showSecretsDetectedError,
  formatToolName,
  hasGitleaksConfig,
  type SecretScanningTool,
} from '../utils/secret-scanning.js';
import { runValidateWorkflow } from '../utils/validate-workflow.js';
import { withValidationLock } from '../utils/validation-lock-wrapper.js';


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

/**
 * Refresh exactly the refs the active sync guards depend on.
 *
 * Both guards compare local refs against remote-tracking refs, so an answer is
 * only as truthful as the last fetch. `off` must cost nothing, so the rule is a
 * disjunction: fetch when *either* guard is active, and fetch only that guard's
 * ref. Grouping into one call means both-active still costs a single
 * round-trip.
 *
 * @returns Whether each guard's local ref can be trusted. "Fresh" means the ref
 *          is safe to judge on: either it was just fetched, or there was
 *          nothing to fetch (no upstream, guard disabled) and the local ref is
 *          all the truth there is. Only an *attempted and failed* fetch marks a
 *          ref stale, so the caller degrades that guard to no opinion.
 */
function fetchSyncRefs(
  baseRef: RemoteRef | null,
  upstreamRef: RemoteRef | null,
  verbose: boolean
): { baseFresh: boolean; upstreamFresh: boolean } {
  const refs = [baseRef, upstreamRef].filter((ref): ref is RemoteRef => ref !== null);
  if (refs.length === 0) {
    return { baseFresh: true, upstreamFresh: true };
  }

  console.log(chalk.blue('🔄 Fetching latest refs from remote...'));
  const outcomes = fetchRemoteRefs(refs);

  if (verbose) {
    for (const [remote, outcome] of Object.entries(outcomes)) {
      if (!outcome.ok) {
        console.warn(chalk.gray(`   Fetch from ${remote} failed: ${outcome.error ?? 'unknown error'}`));
      }
    }
  }

  // Per ref, not per remote: a deleted upstream branch aborts the combined
  // fetch, and must not be read as "origin is unreachable" and take the
  // base-branch guard down with it.
  const isFresh = (ref: RemoteRef | null): boolean =>
    ref === null || (outcomes[refKey(ref)]?.ok ?? false);

  return { baseFresh: isFresh(baseRef), upstreamFresh: isFresh(upstreamRef) };
}

/**
 * Guard: is the branch behind its own remote tracking branch?
 *
 * This means someone else — or another machine, or another agent — pushed to
 * your branch. `git push` would tell you eventually; this just tells you sooner.
 *
 * @param isFresh - Whether the upstream ref was successfully fetched. When
 *                  false the local ref is stale, so this guard has no opinion:
 *                  reporting "up to date" from a stale ref is worse than
 *                  silence, and blocking on one is worse still.
 * @returns true when the commit must be blocked.
 */
function reportTrackingDivergence(
  mode: SyncGuardMode,
  isFresh: boolean,
  treeHash: string | null,
  programName: string
): boolean {
  console.log(chalk.blue('🔍 Checking divergence from remote tracking branch...'));
  const divergence = getTrackingDivergence();

  if (divergence === null) {
    console.log(chalk.gray('ℹ️  No remote tracking branch (new branch or not pushed yet)'));
    return false;
  }

  // Before any verdict: a stale ref cannot support one. "Up to date" from a ref
  // we failed to refresh is the same reassuring lie as a missed "behind".
  if (!isFresh) {
    console.log(chalk.gray('ℹ️  Could not refresh the remote tracking branch - skipping this check'));
    console.log(chalk.gray('   (deleted upstream branch, or offline)'));
    return false;
  }

  if (divergence.behind === 0) {
    if (divergence.ahead === 0) {
      console.log(chalk.green('✅ Current branch is up to date with remote'));
    } else {
      // Purely ahead: local unpushed commits. Normal mid-PR state.
      console.log(chalk.green(`✅ Local branch is ahead of remote by ${divergence.ahead} commit(s) (unpushed)`));
    }
    return false;
  }

  if (divergence.ahead > 0) {
    // Diverged: history rewritten (typically a rebase). Pass with notice.
    console.log(chalk.blue('ℹ️  Local branch has rewritten history vs remote tracking branch.'));
    console.log(chalk.gray(`   Ahead by ${divergence.ahead} commit(s), behind by ${divergence.behind} commit(s) (rebased history).`));
    console.log(chalk.gray('   When ready to push: git push --force-with-lease'));
    return false;
  }

  // Purely behind: someone else pushed.
  if (mode === 'block') {
    console.error(chalk.red(`❌ Current branch is behind its remote tracking branch`));
    console.error(chalk.yellow(`   Behind by ${divergence.behind} commit(s)`));
    console.error(chalk.yellow('   Someone else has pushed changes to this branch.'));

    showWorkProtectionMessage(treeHash, 'git pull', programName);

    console.error(chalk.gray('\n   Alternative: git pull --rebase'));
    console.error(chalk.gray('\n   Skip this check with: hooks.preCommit.trackingSync: off'));
    return true;
  }

  console.warn(chalk.yellow(`⚠️  Current branch is behind its remote tracking branch by ${divergence.behind} commit(s)`));
  console.warn(chalk.gray('   Someone else has pushed changes to this branch. To sync: git pull --rebase'));
  console.warn(chalk.gray('   (warning only - set hooks.preCommit.trackingSync: block to make this a hard stop)'));
  return false;
}

/**
 * Guard: is the branch behind the base branch (e.g. origin/main)?
 *
 * @param isFresh - Whether the base ref was successfully fetched; see
 *                  {@link reportTrackingDivergence}.
 * @returns true when the commit must be blocked.
 */
async function reportBaseBranchSync(
  mode: SyncGuardMode,
  remoteBranch: string,
  isFresh: boolean,
  treeHash: string | null,
  programName: string
): Promise<boolean> {
  console.log(chalk.blue(`🔄 Checking branch sync with ${remoteBranch}...`));

  // The fetch already happened in fetchSyncRefs (one round-trip for both
  // guards), so don't pay for a second one here.
  const syncResult = await checkBranchSync({ remoteBranch, skipFetch: true });

  // Checked before freshness: a repo with no remote is a benign, permanent
  // state, not a failed fetch, and shouldn't be reported as one.
  if (!syncResult.hasRemote) {
    console.log(chalk.gray('ℹ️  No remote tracking branch (new branch or no remote)'));
    return false;
  }

  if (!isFresh) {
    console.log(chalk.gray(`ℹ️  Could not refresh ${remoteBranch} - skipping this check (offline?)`));
    return false;
  }

  if (syncResult.isUpToDate) {
    console.log(chalk.green(`✅ Branch is up to date with ${remoteBranch}`));
    return false;
  }

  if (mode === 'block') {
    console.error(chalk.red(`❌ Branch is behind ${remoteBranch}`));
    console.error(chalk.yellow(`   Behind by ${syncResult.behindBy} commit(s)`));

    showWorkProtectionMessage(treeHash, `git merge ${remoteBranch}`, programName);

    return true;
  }

  console.warn(chalk.yellow(`⚠️  Branch is behind ${remoteBranch} by ${syncResult.behindBy} commit(s)`));
  console.warn(chalk.gray(`   To sync: git merge ${remoteBranch}`));
  console.warn(chalk.gray('   (warning only - set hooks.preCommit.branchSync: block to make this a hard stop)'));
  return false;
}

/**
 * Handle the result of a secret scanning tool
 *
 * @param result - The scan result
 * @param tool - The tool name (SecretScanningTool type)
 * @param verbose - Whether to show verbose output
 * @param scanCommand - The configured scan command (undefined or 'autodetect' = auto mode)
 */
function handleScanResult(
  result: { passed: boolean; skipped?: boolean; output?: string; duration: number; tool: string },
  tool: SecretScanningTool,
  verbose: boolean,
  scanCommand: string | undefined
): void {
  // Handle skipped scans (e.g., gitleaks not available but config exists)
  if (result.skipped) {
    if (hasGitleaksConfig() && !isToolAvailable('gitleaks')) {
      console.warn(chalk.yellow(`⚠️  Found .gitleaks.toml but gitleaks command not available, skipping`));
      console.warn(chalk.gray('   Install gitleaks: brew install gitleaks'));
    }
    return;
  }

  // Show verbose output if requested
  if (verbose && result.output) {
    console.log(chalk.gray(result.output));
  }

  // Show performance warning if scan was slow (hardcoded 5s threshold)
  if (result.passed) {
    const hasExplicitCommand = scanCommand !== undefined && scanCommand !== 'autodetect';
    showPerformanceWarning(tool, result.duration, 5000, hasExplicitCommand);
  }
}

export function preCommitCommand(program: Command): void {
  const cmd = program
    .command('pre-commit')
    .description('Run branch sync check + validation (recommended before commit). Spawned steps run with GIT_* env vars stripped to prevent parent-repo corruption when invoked as a git hook (see docs/skills/vibe-validate/git-hook-safety.md).')
    .option('--skip-sync', 'Skip the base-branch sync check and its network fetch (same as hooks.preCommit.branchSync: off)')
    .option('-v, --verbose', 'Show detailed progress and output');

  // eslint-disable-next-line sonarjs/cognitive-complexity -- Complexity 47 acceptable for pre-commit workflow orchestration (coordinates git sync, config loading, validation, and error handling)
  cmd.action(async (options) => {
    const programName = program.name();
      try {
        // Step 1: Load configuration (needed for git settings)
        // Note: Config loading is now handled by withValidationLock wrapper
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
          const treeHashResult = await getGitTreeHash();
          treeHash = treeHashResult.hash;
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

        // Step 4: Verbose mode is ONLY enabled via explicit --verbose flag
        const verbose = options.verbose ?? false;

        // Step 5: Sync guards.
        //
        // Neither guard is a correctness condition, so both default to 'warn':
        // check, say something useful, let the commit through. Blocking here for
        // a non-correctness reason routes people to `git commit --no-verify`,
        // which skips every other guard too. Set 'block' to opt back into a hard
        // stop; hard enforcement otherwise belongs in CI (`vv sync-check`).
        const preCommitConfig = config.hooks?.preCommit;
        const trackingMode: SyncGuardMode = preCommitConfig?.trackingSync ?? DEFAULT_SYNC_GUARD_MODE;
        // --skip-sync predates the config and has always meant the base-branch
        // guard specifically, so it stays scoped to that one.
        const branchMode: SyncGuardMode = options.skipSync
          ? 'off'
          : (preCommitConfig?.branchSync ?? DEFAULT_SYNC_GUARD_MODE);

        const remoteBranch = getRemoteBranch(config.git);

        // The base-branch guard is meaningless while a merge or rebase is
        // mid-flight. During a merge, being behind origin/main is expected - the
        // merge commit resolves it. During a rebase, HEAD is transiently
        // rewinding. Decided here so we don't fetch a ref nothing will read.
        const mergeInProgress = isMergeInProgress();
        const rebaseInProgress = isRebaseInProgress();
        const baseGuardActive = branchMode !== 'off' && !mergeInProgress && !rebaseInProgress;
        // Mid-rebase HEAD is detached, so there is no upstream to compare
        // against - the tracking guard would report "no remote tracking branch",
        // which is false and alarming during every conflict resolution.
        const trackingGuardActive = trackingMode !== 'off' && !rebaseInProgress;

        const upstreamRef = trackingGuardActive ? getUpstreamRef() : null;
        const baseRef: RemoteRef | null = baseGuardActive
          ? { remote: getRemoteOrigin(config.git), branch: getMainBranch(config.git) }
          : null;

        const { baseFresh, upstreamFresh } = fetchSyncRefs(baseRef, upstreamRef, verbose);

        if (trackingGuardActive
          && reportTrackingDivergence(trackingMode, upstreamFresh, treeHash, programName)) {
          process.exit(1);
        }

        if (branchMode !== 'off') {
          if (mergeInProgress) {
            console.log(chalk.blue(`🔄 Merge in progress - skipping branch sync check`));
            console.log(chalk.gray(`   (This merge commit will sync with ${remoteBranch})`));
          } else if (rebaseInProgress) {
            console.log(chalk.blue(`🔄 Rebase in progress - skipping branch sync check`));
            console.log(chalk.gray(`   (Sync state will settle once the rebase completes)`));
          } else if (await reportBaseBranchSync(branchMode, remoteBranch, baseFresh, treeHash, programName)) {
            process.exit(1);
          }
        }

        // Step 6: Run secret scanning if enabled
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

              handleScanResult(result, tool, verbose, secretScanning.scanCommand);
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

        // Step 7: Run validation with caching AND locking
        console.log(chalk.blue('\n🔄 Running validation...'));

        const result = await withValidationLock(
          {
            lockEnabled: true,  // Always enable locking for pre-commit
            waitEnabled: true,  // Always wait for running validation
            waitTimeout: 30,    // Shorter timeout than validate command (30s vs 300s)
            yaml: false         // Pre-commit uses human-readable output
          },
          async ({ config, configDir, context, treeHashResult: lockTreeHashResult }) => {
            // CRITICAL (Issue #129): Change to project root directory
            // This ensures validation steps run in the project root (where config lives),
            // not in process.cwd() where the user happens to be
            const originalCwd = process.cwd();
            try {
              // Only chdir if configDir is different from current directory
              if (configDir !== originalCwd) {
                process.chdir(configDir);
              }

              return await runValidateWorkflow(config, {
                force: false, // Respect cache by default
                verbose,
                yaml: false, // Pre-commit uses human-readable output
                check: false,
                context: {
                  ...context,
                  isPreCommit: true, // Signal this is pre-commit workflow
                },
                treeHashResult: lockTreeHashResult,
              });
            } finally {
              // Always restore original directory, even on error
              if (configDir !== originalCwd) {
                process.chdir(originalCwd);
              }
            }
          }
        );

        // Step 8: Report results
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

1. Checks for partially staged files (**fails** if detected)
2. Fetches only the refs the enabled sync guards need (one round-trip; skipped entirely when both are \`off\`)
3. Checks if the current branch is behind its remote tracking branch (**warns** by default)
4. Checks if the current branch is behind the base branch, e.g. origin/main (**warns** by default; skipped during a merge or rebase)
5. Runs secret scanning (if enabled in config)
6. Runs validate (with caching)

**Note:** When completing a merge commit (MERGE_HEAD exists), or partway through a rebase, the base-branch sync check is automatically skipped — the merge commit itself resolves the out-of-sync state, and a mid-rebase HEAD gives a misleading answer.

## Sync Guards

The two sync checks are **warnings, not gates**. Being behind a branch does not make the code you are committing wrong, and blocking a commit for a non-correctness reason pushes people to \`git commit --no-verify\` — which skips secret scanning, validation and partial-stage detection too.

The partially-staged-files check is different, and stays a hard block: validation runs against the full file while git commits only the staged hunk, so a pass could certify code that isn't what lands.

Each guard takes \`warn\` (default), \`block\`, or \`off\`:

\`\`\`yaml
hooks:
  preCommit:
    branchSync: warn      # behind the base branch (origin/main)
    trackingSync: warn    # behind your own remote branch (someone else pushed)
\`\`\`

- \`warn\` — check, print a notice, allow the commit
- \`block\` — check and fail the commit (the pre-0.19.7 behaviour)
- \`off\` — skip the check entirely, **including its network fetch**

\`off\` is the only setting that makes \`pre-commit\` skip the fetch. \`warn\` still fetches, because a sync notice computed from a stale ref is worth nothing. If a ref cannot be refreshed — offline, or an upstream branch deleted after its PR merged — the guard that depends on that ref degrades to no opinion and the commit proceeds. Degradation is per guard, not per remote.

For hard enforcement, use \`vibe-validate sync-check\` in CI — it still exits 1 when the branch is behind.

## Options

- \`--skip-sync\` - Skip the base-branch sync check and its network fetch (equivalent to \`branchSync: off\`; does not affect \`trackingSync\`)
- \`-v, --verbose\` - Show detailed progress and output

## Exit Codes

- \`0\` - Validation passed (and no sync guard set to \`block\` was violated)
- \`1\` - Validation failed, secrets detected, files partially staged, or a \`block\` sync guard was violated

## Examples

\`\`\`bash
# Standard pre-commit workflow
vibe-validate pre-commit

# Skip the base-branch sync check and its fetch
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
# Install (choose your package manager)
npm install --save-dev @secretlint/secretlint-rule-preset-recommend secretlint
# or: pnpm add -D @secretlint/secretlint-rule-preset-recommend secretlint
# or: yarn add --dev @secretlint/secretlint-rule-preset-recommend secretlint
# or: bun add --dev @secretlint/secretlint-rule-preset-recommend secretlint

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

### If a sync guard blocks the commit

Only reachable when a guard is set to \`block\` — with the default \`warn\` you get a notice and the commit proceeds.

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

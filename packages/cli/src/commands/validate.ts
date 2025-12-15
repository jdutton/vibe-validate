/**
 * Validate Command
 *
 * Runs validation phases with git tree hash caching and history recording.
 */

import { getGitTreeHash } from '@vibe-validate/git';
import chalk from 'chalk';
import type { Command } from 'commander';

import { displayConfigErrors } from '../utils/config-error-reporter.js';
import { loadConfigWithErrors, loadConfigWithDir } from '../utils/config-loader.js';
import { detectContext } from '../utils/context-detector.js';
import { acquireLock, releaseLock, checkLock, waitForLock, type LockOptions } from '../utils/pid-lock.js';
import { detectProjectId } from '../utils/project-id.js';
import { runValidateWorkflow } from '../utils/validate-workflow.js';


export function validateCommand(program: Command): void {
  program
    .command('validate')
    .description('Run validation with git tree hash caching')
    .option('-f, --force', 'Force validation even if already passed')
    .option('-v, --verbose', 'Show detailed progress and output')
    .option('-y, --yaml', 'Output validation result as YAML to stdout')
    .option('-c, --check', 'Check if validation has already passed (do not run)')
    .option('-d, --debug', 'Create output files for all steps (for debugging)')
    .option('--no-lock', 'Allow concurrent validation runs (disables single-instance mode)')
    .option('--no-wait', 'Exit immediately if validation is already running (for background hooks)')
    .option('--wait-timeout <seconds>', 'Maximum time to wait for running validation (default: 300)', '300')
    // eslint-disable-next-line sonarjs/cognitive-complexity -- Complexity 50 acceptable for main validation command handler (orchestrates options, locking, caching, and validation)
    .action(async (options) => {

      let lockFile: string | null = null;
      try {
        // Normalize conflicting options
        // When using --check (just checking state, not running validation):
        // - lock is meaningless (no validation process to lock)
        // - force is meaningless (no validation to force)
        if (options.check) {
          options.lock = false;
          options.force = false;
        }

        // Default behavior: lock is enabled (single-instance mode)
        // Users can opt out with --no-lock for concurrent runs
        if (options.lock === undefined) {
          options.lock = true;
        }

        // Load configuration first (needed for lock config)
        // Use loadConfigWithDir to get config directory for locking
        const configResult = await loadConfigWithDir();
        if (!configResult) {
          // Get detailed error information to distinguish between missing file and validation errors
          const configWithErrors = await loadConfigWithErrors();

          if (configWithErrors.errors && configWithErrors.filePath) {
            // Config file exists but has validation errors
            const fileName = configWithErrors.filePath.split('/').pop() ?? 'vibe-validate.config.yaml';
            displayConfigErrors({
              fileName,
              errors: configWithErrors.errors
            });
          } else {
            // Config file doesn't exist
            console.error(chalk.red('❌ No configuration found'));
          }

          process.exit(1);
        }

        const { config, configDir } = configResult;

        // Detect context (Claude Code, CI, etc.)
        const context = detectContext();

        // Determine lock options from config
        const lockConfig = config.locking ?? { enabled: true, concurrencyScope: 'directory' };

        // If config disables locking, override CLI flag
        if (!lockConfig.enabled) {
          options.lock = false;
        }

        let lockOptions: LockOptions = {};
        if (lockConfig.concurrencyScope === 'project') {
          // Project-scoped locking - need projectId
          const projectId = lockConfig.projectId ?? detectProjectId();
          if (!projectId) {
            console.error(chalk.red('❌ ERROR: concurrencyScope=project but projectId cannot be detected'));
            console.error(chalk.yellow('Solutions:'));
            console.error('  1. Add locking.projectId to vibe-validate.config.yaml');
            console.error('  2. Ensure git remote is configured');
            console.error('  3. Ensure package.json has name field');
            process.exit(1);
          }
          lockOptions = { scope: 'project', projectId };
        } else {
          // Directory-scoped locking (default)
          lockOptions = { scope: 'directory' };
        }

        // Default behavior: wait is enabled (wait for running validation)
        // Users can opt out with --no-wait for background hooks
        const shouldWait = options.wait !== false;

        // Handle wait mode (default: wait for running validation to complete)
        if (shouldWait) {
          // Use config directory for lock (not process.cwd()) - ensures same lock regardless of invocation directory
          const existingLock = await checkLock(configDir, lockOptions);

          if (existingLock) {
            const waitTimeout = Number.parseInt(options.waitTimeout, 10) || 300;

            if (!options.yaml) {
              console.log(chalk.yellow('⏳ Waiting for running validation to complete...'));
              console.log(`  PID: ${existingLock.pid}`);
              console.log(`  Started: ${new Date(existingLock.startTime).toLocaleTimeString()}`);
              console.log(`  Timeout: ${waitTimeout}s`);
            }

            const waitResult = await waitForLock(configDir, waitTimeout, 1000, lockOptions);

            if (waitResult.timedOut) {
              if (!options.yaml) {
                console.log(chalk.yellow('⏱️  Wait timed out, proceeding with validation'));
              }
              // Continue with normal validation flow
            } else if (!options.yaml) {
              console.log(chalk.green('✓ Background validation completed'));
              // Continue to check cache/run validation
            }
          }
          // If no lock exists, proceed normally
        }

        // Handle lock mode (single-instance execution)
        if (options.lock) {
          // Use config directory for lock (not process.cwd()) - ensures same lock regardless of invocation directory
          const treeHash = await getGitTreeHash();

          const lockResult = await acquireLock(configDir, treeHash, lockOptions);

          if (!lockResult.acquired && lockResult.existingLock) {
            // Another validation is already running

            // If --no-wait specified, exit immediately (for background hooks)
            if (!shouldWait) {
              const existing = lockResult.existingLock;
              const isCurrentHash = existing.treeHash === treeHash;
              const hashStatus = isCurrentHash
                ? 'same as current'
                : `stale - current is ${treeHash.substring(0, 7)}`;

              const elapsed = Math.floor(
                (Date.now() - new Date(existing.startTime).getTime()) / 1000,
              );
              const elapsedStr =
                elapsed < 60
                  ? `${elapsed} seconds ago`
                  : `${Math.floor(elapsed / 60)} minutes ago`;

              if (!options.yaml) {
                console.log(
                  chalk.yellow('⚠️  Validation already running'),
                );
                console.log(`  Directory: ${existing.directory}`);
                console.log(
                  `  Tree Hash: ${existing.treeHash.substring(0, 7)} (${hashStatus})`,
                );
                console.log(`  PID: ${existing.pid}`);
                console.log(`  Started: ${elapsedStr}`);
              }

              process.exit(0); // Exit 0 to not trigger errors in hooks
            }

            // If wait is enabled (default), the wait logic above already handled it
            // Just don't try to acquire lock again
          } else {
            // Lock acquired successfully
            lockFile = lockResult.lockFile;
          }
        }

        // Run shared validation workflow
        const result = await runValidateWorkflow(config, {
          force: options.force,
          verbose: options.verbose,
          yaml: options.yaml,
          check: options.check,
          debug: options.debug,
          context,
        });

        // Only call process.exit for non-cached results
        // Cache hits return early without calling process.exit (to support testing)
        if (!result.isCachedResult) {
          process.exit(result.passed ? 0 : 1);
        }
        // For cache hits, return normally and let Commander exit with code 0
      } catch (error) {
        // Re-throw process.exit errors (for testing)
        if (error instanceof Error && error.message.startsWith('process.exit')) {
          throw error;
        }
        // Error already logged by runValidateWorkflow
        process.exit(1);
      } finally {
        // Always release lock when done
        if (lockFile) {
          await releaseLock(lockFile);
        }
      }
    });
}

/**
 * Show verbose help with detailed documentation
 */
export function showValidateVerboseHelp(): void {
  console.log(`# validate Command Reference

> Run validation with git tree hash caching

## Overview

The \`validate\` command is the core of vibe-validate. It executes your validation pipeline (linting, testing, type-checking, etc.) and uses git tree hashes for intelligent caching.

## How It Works

1. **Calculates git tree hash** of working directory (includes all tracked and untracked files)
2. **Checks if hash matches cached state** (from previous run)
3. **If match:** Exits immediately with cached result (sub-second)
4. **If no match:** Runs validation pipeline (~60-90s depending on your project)
5. **Caches result** in git notes for next run
6. **Records history** for analysis via \`vibe-validate history\`

## Options

- \`-f, --force\` - Force validation even if already passed (bypasses cache)
- \`-v, --verbose\` - Show detailed progress and output
- \`-y, --yaml\` - Output validation result as YAML to stdout (LLM-friendly)
- \`-c, --check\` - Check if validation has already passed without running

## Exit Codes

- \`0\` - Validation passed (or cached pass)
- \`1\` - Validation failed
- \`2\` - Configuration error

## Examples

\`\`\`bash
# Standard usage (uses cache if available)
vibe-validate validate

# Force re-validation (bypass cache)
vibe-validate validate --force

# Check status without running
vibe-validate validate --check

# YAML output for AI agents
vibe-validate validate --yaml

# Verbose output with YAML result
vibe-validate validate --verbose --yaml
\`\`\`

## Caching Behavior

### Cache Key
- Based on **git tree hash** (not commit SHA)
- Includes **all files** (tracked + untracked)
- Deterministic: same content = same hash

### Cache Hit
- Validation result found for current tree hash
- Exits in sub-second time
- Shows: "✓ Validation already passed for tree <hash>"

### Cache Miss
- No result found for current tree hash
- Runs full validation pipeline
- Typical duration: 60-90s

### Cache Invalidation
- ANY file change (content or path)
- Adding/removing files
- Modifying .gitignore

## YAML Output Mode

When using \`--yaml\`, output is split:

**stderr** (human-readable progress):
\`\`\`
phase_start: Pre-Qualification
🔍 Running Pre-Qualification...
✅ TypeScript - PASSED
phase_complete: Pre-Qualification (passed)
\`\`\`

**stdout** (machine-parseable YAML):
\`\`\`yaml
---
passed: true
timestamp: 2025-10-23T14:30:00Z
treeHash: 2b62c71a3f...
duration: 62.4
\`\`\`

This design:
- ✅ Humans see progress in real-time (stderr)
- ✅ LLMs parse structured result (stdout)
- ✅ 90% smaller than verbose logs

## Integration with Other Commands

- \`vibe-validate state\` - View cached result
- \`vibe-validate state --verbose\` - See full error details
- \`vibe-validate history list\` - View validation timeline
- \`vibe-validate pre-commit\` - Runs sync-check + validate

## Common Workflows

### Development workflow
\`\`\`bash
# Make changes
# ...

# Run validation (uses cache if no changes)
vibe-validate validate

# If fails, fix errors and retry
vibe-validate validate
\`\`\`

### Debugging workflow
\`\`\`bash
# Why did validation fail?
vibe-validate state --verbose

# View history
vibe-validate history list

# Force fresh validation
vibe-validate validate --force
\`\`\`

### AI agent workflow
\`\`\`bash
# Run validation
vibe-validate validate --yaml 2>&1 | sed -n '/^---$/,$p' | tail -n +2

# Or use state command
vibe-validate validate
vibe-validate state --yaml
\`\`\`

## Performance

| Scenario | Duration | Notes |
|----------|----------|-------|
| Cache hit | Sub-second | Cached result found |
| Cache miss | ~60-90s | Full validation run |
| Force flag | ~60-90s | Cache bypassed |

## Files Created/Modified

- \`refs/notes/vibe-validate/validate\` - Validation history (git notes, auto-created)

## Error Recovery

If validation fails:
1. Check error details: \`vibe-validate state --verbose\`
2. Fix errors shown in output
3. Re-run: \`vibe-validate validate\`
4. Verify: \`vibe-validate state\`
`);
}

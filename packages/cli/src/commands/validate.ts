/**
 * Validate Command
 *
 * Runs validation phases with git tree hash caching and history recording.
 */

import { getDefaultValidateLevel } from '@vibe-validate/config';
import type { Command } from 'commander';

import { resolveCheckLevelOrExit, resolveLevelOrExit } from '../utils/level-option.js';
import { runValidateWorkflow } from '../utils/validate-workflow.js';
import { loadConfigOrExit, withValidationLock } from '../utils/validation-lock-wrapper.js';

export function validateCommand(program: Command): void {
  program
    .command('validate')
    .description('Run validation with git tree hash caching. Spawned steps run with GIT_* env vars stripped to prevent parent-repo corruption when invoked as a git hook (see docs/skills/vibe-validate/git-hook-safety.md).')
    .option('-l, --level <name>', 'Validation level to run (one of validation.levels; default: the last)')
    .option('-f, --force', 'Re-run even when a pass is already recorded (a failure is never replayed)')
    .option('-v, --verbose', 'Show detailed progress and output')
    .option('-y, --yaml', 'Output validation result as YAML to stdout')
    .option('-c, --check', 'Check if validation has already passed (do not run; exit 0 passed, 1 last run failed, 2 nothing recorded or cannot answer)')
    .option('-d, --debug', 'Create output files for all steps (for debugging)')
    .option('--retry-failed', 'Retry only failed steps from previous validation')
    .option('--no-lock', 'Allow concurrent validation runs (disables single-instance mode)')
    .option('--no-wait', 'Exit immediately if validation is already running (for background hooks)')
    .option('--wait-timeout <seconds>', 'Maximum time to wait for running validation (default: 300)', '300')
    .action(async (options) => {
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

        // Load the config once; the lock wrapper and the workflow share it
        const loaded = await loadConfigOrExit();
        const defaultLevel = getDefaultValidateLevel(loaded.config);
        // --check answers 0/1/2, and 1 means "the run failed": an unknown level is 2
        const level = options.check
          ? await resolveCheckLevelOrExit(loaded.config, options.level, defaultLevel, options.yaml === true)
          : resolveLevelOrExit(loaded.config, options.level, defaultLevel);

        const result = await withValidationLock(
          loaded,
          {
            lockEnabled: options.lock,
            waitEnabled: options.wait !== false,
            waitTimeout: Number.parseInt(options.waitTimeout, 10) || 300,
            yaml: options.yaml
          },
          async ({ config, configDir, context, treeHashResult }) => {
            // CRITICAL (Issue #129): Change to project root directory
            // This ensures validation steps run in the project root (where config lives),
            // not in process.cwd() where the user happens to be
            const originalCwd = process.cwd();
            try {
              // Only chdir if configDir is different from current directory
              if (configDir !== originalCwd) {
                process.chdir(configDir);
              }

              // Run shared validation workflow
              return await runValidateWorkflow(config, {
                force: options.force,
                verbose: options.verbose,
                yaml: options.yaml,
                check: options.check,
                debug: options.debug,
                retryFailed: options.retryFailed,
                level,
                context,
                treeHashResult,
              });
            } finally {
              // Always restore original directory, even on error
              if (configDir !== originalCwd) {
                process.chdir(originalCwd);
              }
            }
          }
        );

        // A failure exits 1, whatever isCachedResult says: the exit code never
        // rests on the invariant that only passes are served from cache.
        if (!result.passed) {
          process.exit(1);
        }
        // A cached pass returns normally so Commander exits 0 on its own; that
        // also keeps the happy path free of a process.exit for tests to trap.
        if (!result.isCachedResult) {
          process.exit(0);
        }
      } catch (error) {
        // Re-throw process.exit errors (for testing)
        if (error instanceof Error && error.message.startsWith('process.exit')) {
          throw error;
        }
        // Error already logged by runValidateWorkflow
        process.exit(1);
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

1. **Calculates git tree hash** of working directory (tracked and untracked files; ignored paths excluded)
2. **Looks for a recorded PASS** for that tree at the requested level or a later one
3. **If found:** Exits 0 immediately (sub-second)
4. **If not:** Runs the steps at that level (~60-90s depending on your project). A recorded failure is never replayed; the steps run again
5. **Records the run** (pass or fail, with its level) in git notes
6. **Records history** for analysis via \`vibe-validate history\`

## Levels

\`validation.levels\` names ordered, nested levels (e.g. \`[commit, full]\`); each step names the level that adds it. A run at a level runs every step at that level and the earlier ones. \`validate\` defaults to the last level, \`pre-commit\` to \`hooks.preCommit.level\` or the first. A pass at a later level answers a request at an earlier one.

## Options

- \`-l, --level <name>\` - Validation level to run (one of \`validation.levels\`; default: the last, which runs every step)
- \`-f, --force\` - Re-run even when a pass is already recorded. A failure is never replayed, so this is only ever needed to re-run a green
- \`--retry-failed\` - Retry only failed steps from previous validation (preserves passed step cache)
- \`-v, --verbose\` - Show detailed progress and output
- \`-y, --yaml\` - Output validation result as YAML to stdout (LLM-friendly)
- \`-c, --check\` - Check if validation has already passed without running

## Exit Codes

- \`0\` - Validation passed (or cached pass)
- \`1\` - Validation failed, or the configuration is invalid (an unknown \`--level\` included)

With \`--check\` (nothing runs; the answer comes from the recorded runs):

- \`0\` - A recorded pass covers the level (\`validate\` would be a cache hit)
- \`1\` - The last run bearing on the level failed (see it with \`state --level <that run's level>\`)
- \`2\` - Nothing recorded that bears on the level, or it cannot answer (not in a git repository, unknown \`--level\`). With \`--yaml\`, an unknown level is a YAML document on stdout: \`exists: false\`, \`error\`, \`levels\`

## Examples

\`\`\`bash
# Standard usage (uses cache if available)
vibe-validate validate

# Run only the commit level
vibe-validate validate --level commit

# Re-run a recorded pass (everything at the level)
vibe-validate validate --force

# Retry only failed steps (fast recovery from transient failures)
vibe-validate validate --retry-failed

# Check status without running
vibe-validate validate --check

# YAML output for AI agents
vibe-validate validate --yaml

# Verbose output with YAML result
vibe-validate validate --verbose --yaml
\`\`\`

## --force vs --retry-failed

They differ in what they start from:

| Flag | Re-runs | Preserves cache | Use when |
|------|---------|-----------------|----------|
| \`--force\` | All steps at the level | No | A recorded pass must be re-checked (it is the only thing a cache hit can be) |
| \`--retry-failed\` | Failed steps only | Yes (passed steps) | The last run at this level failed and you want to skip the steps that passed |

\`--retry-failed\` also detects flakiness: if a step that failed on the previous run now passes without code changes, it warns you about potential non-deterministic behavior.

## Caching Behavior

### Cache Key
- Based on **git tree hash** (not commit SHA)
- Covers **tracked and untracked files** in the working tree
- **Excludes ignored paths**, by design: secrets and per-developer build
  artifacts are never checksummed, and the cache stays shareable between
  developers whose ignored files differ. "Ignored" means by any source —
  \`.gitignore\`, \`.git/info/exclude\`, or your global excludes file
- Deterministic: same content = same hash

### Cache Hit
- A PASS recorded for the current tree hash, at the requested level or a later one
- Exits in sub-second time
- Shows: "✅ Validation passed for this code" and the level it covered
- A recorded failure is never a cache hit

### Cache Miss
- No result found for current tree hash
- Runs full validation pipeline
- Typical duration: 60-90s

### Cache Invalidation
- Any change to a tracked or untracked file (content or path)
- Adding/removing those files
- Modifying .gitignore

Changing an ignored path does **not** invalidate the cache, since those paths
are not part of the key. Failures are never replayed, so this can only ever
leave a stale PASS; re-run it with \`--force\` (or \`VV_FORCE_EXECUTION=1\`,
which exists for the same reason and nothing else).

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
- \`vibe-validate pre-commit\` - Runs the sync and secret checks, then validation at the pre-commit level

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
| Force flag | ~60-90s | Recorded pass ignored |

## Files Created/Modified

- \`refs/notes/vibe-validate/leveled-runs\` - Validation history (git notes, auto-created)

## Error Recovery

If validation fails:
1. Check error details: \`vibe-validate state --verbose\`
2. Fix errors shown in output
3. Re-run: \`vibe-validate validate\`
4. Verify: \`vibe-validate state\`
`);
}

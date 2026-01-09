/**
 * Validate Command
 *
 * Runs validation phases with git tree hash caching and history recording.
 */

import type { Command } from 'commander';

import { runValidateWorkflow } from '../utils/validate-workflow.js';
import { withValidationLock } from '../utils/validation-lock-wrapper.js';

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

        // Use validation lock wrapper to handle config, context, and locking
        const result = await withValidationLock(
          {
            lockEnabled: options.lock,
            waitEnabled: options.wait !== false,
            waitTimeout: Number.parseInt(options.waitTimeout, 10) || 300,
            yaml: options.yaml
          },
          async ({ config, context }) => {
            // Run shared validation workflow
            return await runValidateWorkflow(config, {
              force: options.force,
              verbose: options.verbose,
              yaml: options.yaml,
              check: options.check,
              debug: options.debug,
              context,
            });
          }
        );

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

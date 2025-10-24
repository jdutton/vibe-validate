/**
 * Validate Command
 *
 * Runs validation phases with git tree hash caching and history recording.
 */

import type { Command } from 'commander';
import { runValidation } from '@vibe-validate/core';
import { getGitTreeHash } from '@vibe-validate/git';
import {
  recordValidationHistory,
  checkWorktreeStability,
  checkHistoryHealth,
  readHistoryNote,
} from '@vibe-validate/history';
import { loadConfig } from '../utils/config-loader.js';
import { createRunnerConfig } from '../utils/runner-adapter.js';
import { detectContext } from '../utils/context-detector.js';
import chalk from 'chalk';
import { stringify as yamlStringify } from 'yaml';

export function validateCommand(program: Command): void {
  program
    .command('validate')
    .description('Run validation with git tree hash caching')
    .option('-f, --force', 'Force validation even if already passed')
    .option('-v, --verbose', 'Show detailed progress and output')
    .option('-y, --yaml', 'Output validation result as YAML to stdout')
    .option('-c, --check', 'Check if validation has already passed (do not run)')
    .action(async (options) => {
      try {
        // Load configuration
        const config = await loadConfig();
        if (!config) {
          console.error(chalk.red('❌ No configuration found'));
          process.exit(1);
        }

        // If --check flag is used, only check validation state without running
        if (options.check) {
          const yaml = options.yaml ?? false;
          const { checkValidationStatus } = await import('../utils/check-validation.js');
          await checkValidationStatus(config, yaml);
          return; // Exit handled by checkValidationStatus
        }

        // Detect context (Claude Code, CI, etc.)
        const context = detectContext();

        // Verbose mode is ONLY enabled via explicit --verbose flag
        const verbose = options.verbose ?? false;
        const yaml = options.yaml ?? false;

        // Create runner config
        const runnerConfig = createRunnerConfig(config, {
          force: options.force,
          verbose,
          yaml,
          context,
        });

        // Get tree hash BEFORE validation (for caching and stability check)
        let treeHashBefore: string | null = null;
        try {
          treeHashBefore = await getGitTreeHash();
        } catch (_error) {
          // Not in git repo or git command failed - continue without history
          if (verbose) {
            console.warn(chalk.yellow('⚠️  Could not get git tree hash - history recording disabled'));
          }
        }

        // Check cache: if validation already passed for this tree hash, skip re-running
        if (treeHashBefore && !options.force) {
          try {
            const historyNote = await readHistoryNote(treeHashBefore);

            if (historyNote && historyNote.runs.length > 0) {
              // Find most recent passing run
              const passingRun = [...historyNote.runs]
                .reverse()
                .find(run => run.passed);

              if (passingRun) {
                if (yaml) {
                  // YAML mode: Output cached result as YAML to stdout
                  await new Promise(resolve => setTimeout(resolve, 10));

                  // Output YAML document separator (RFC 4627)
                  process.stdout.write('---\n');

                  process.stdout.write(yamlStringify(passingRun.result));

                  // Wait for stdout to flush before exiting
                  await new Promise<void>(resolve => {
                    if (process.stdout.write('')) {
                      resolve();
                    } else {
                      process.stdout.once('drain', resolve);
                    }
                  });
                } else {
                  // Human-readable mode: Display cache hit message
                  const durationSecs = (passingRun.duration / 1000).toFixed(1);
                  console.log(chalk.green('✅ Validation already passed for current working tree'));
                  console.log(chalk.gray(`   Tree hash: ${treeHashBefore.substring(0, 12)}...`));
                  console.log(chalk.gray(`   Last validated: ${passingRun.timestamp}`));
                  console.log(chalk.gray(`   Duration: ${durationSecs}s`));
                  console.log(chalk.gray(`   Branch: ${passingRun.branch}`));

                  if (passingRun.result?.phases) {
                    const totalSteps = passingRun.result.phases.reduce((sum, phase) => sum + (phase.steps?.length || 0), 0);
                    console.log(chalk.gray(`   Phases: ${passingRun.result.phases.length}, Steps: ${totalSteps}`));
                  }
                }

                // Exit action handler - cached result already output
                return;
              }
            }
          } catch (_error) {
            // Cache check failed - proceed with validation
            // This is expected for first-time validation
          }
        }

        // Display tree hash before running validation (debugging/transparency aid)
        // This goes to stderr, so it's visible even in YAML mode
        if (treeHashBefore) {
          console.error(chalk.gray(`🌳 Working tree: ${treeHashBefore.slice(0, 12)}...`));
          if (!yaml) {
            console.log(''); // Blank line for readability (human mode only)
          }
        }

        // Run validation
        const result = await runValidation(runnerConfig);

        // Record validation history (if in git repo and stability check passes)
        if (treeHashBefore) {
          try {
            // Check if worktree changed during validation
            const stability = await checkWorktreeStability(treeHashBefore);

            if (!stability.stable) {
              console.warn(chalk.yellow('\n⚠️  Worktree changed during validation'));
              console.warn(chalk.yellow(`   Before: ${stability.treeHashBefore.slice(0, 12)}...`));
              console.warn(chalk.yellow(`   After:  ${stability.treeHashAfter.slice(0, 12)}...`));
              console.warn(chalk.yellow('   Results valid but history not recorded (unstable state)'));
            } else {
              // Record to git notes
              const recordResult = await recordValidationHistory(treeHashBefore, result);

              if (recordResult.recorded) {
                if (verbose) {
                  console.log(chalk.gray(`\n📝 History recorded (tree: ${treeHashBefore.slice(0, 12)})`));
                }
              } else if (verbose) {
                console.warn(chalk.yellow(`⚠️  History recording failed: ${recordResult.reason}`));
              }
            }
          } catch (error) {
            // Silent failure - don't block validation
            if (verbose) {
              const errorMessage = error instanceof Error ? error.message : String(error);
              console.warn(chalk.yellow(`⚠️  History recording error: ${errorMessage}`));
            }
          }
        }

        // Proactive health check (non-blocking)
        try {
          const health = await checkHistoryHealth();
          if (health.shouldWarn) {
            console.log('');
            console.log(chalk.blue(health.warningMessage));
          }
        } catch {
          // Silent failure - don't block validation
        }

        // If validation failed, show agent-friendly error details
        if (!result.passed) {
          console.error(chalk.blue('\n📋 View error details:'), chalk.white('vibe-validate state'));
          if (result.rerunCommand) {
            console.error(chalk.blue('🔄 To retry:'), chalk.white(result.rerunCommand));
          }
          if (result.fullLogFile) {
            console.error(chalk.blue('📄 Full log:'), chalk.gray(result.fullLogFile));
          }

          // Context-aware extraction quality feedback (only when developerFeedback is enabled)
          if (config.developerFeedback) {
            // Check if any steps had poor extraction quality
            const poorExtractionSteps = result.phases
              ?.flatMap(phase => phase.steps || [])
              .filter(step => !step.passed && step.extractionQuality && step.extractionQuality.score < 50);

            if (poorExtractionSteps && poorExtractionSteps.length > 0) {
              // Detect if we're dogfooding (in the vibe-validate project itself)
              const isDogfooding = process.cwd().includes('vibe-validate');

              console.error('');
              console.error(chalk.yellow('⚠️  Poor extraction quality detected'));

              if (isDogfooding) {
                // Developing vibe-validate itself: direct contributor call-to-action
                console.error(chalk.yellow('   💡 vibe-validate improvement opportunity: Improve extractors in packages/extractors/'));
                console.error(chalk.gray('   See packages/extractors/test/samples/ for how to add test cases'));
              } else {
                // External project: user feedback to improve vibe-validate
                console.error(chalk.yellow('   💡 Help improve vibe-validate by reporting this extraction issue'));
                console.error(chalk.gray('   https://github.com/anthropics/vibe-validate/issues/new?template=extractor-improvement.yml'));
              }
            }
          }
        }

        // Output YAML validation result if --yaml flag is set
        if (yaml) {
          // Small delay to ensure stderr is flushed before writing to stdout
          await new Promise(resolve => setTimeout(resolve, 10));

          // Output YAML document separator (RFC 4627) to mark transition from stderr to stdout
          process.stdout.write('---\n');

          // Output pure YAML without headers (workflow provides display framing)
          process.stdout.write(yamlStringify(result));

          // CRITICAL: Wait for stdout to flush before exiting
          // When stdout is redirected to a file (CI), process.exit() can kill the process
          // before the write buffer is flushed, causing truncated output
          await new Promise<void>(resolve => {
            if (process.stdout.write('')) {
              // Write buffer is empty, can exit immediately
              resolve();
            } else {
              // Wait for drain event
              process.stdout.once('drain', resolve);
            }
          });
        }

        // Exit with appropriate code
        process.exit(result.passed ? 0 : 1);
      } catch (error) {
        console.error(chalk.red('❌ Validation failed with error:'), error);

        // If YAML mode, output error as YAML to stdout for CI extraction
        if (options.yaml) {
          const errorResult = {
            passed: false,
            timestamp: new Date().toISOString(),
            error: error instanceof Error ? error.message : String(error),
            errorStack: error instanceof Error ? error.stack : undefined,
          };

          // Small delay to ensure stderr is flushed before writing to stdout
          await new Promise(resolve => setTimeout(resolve, 10));

          // Output YAML document separator
          process.stdout.write('---\n');
          process.stdout.write(yamlStringify(errorResult));

          // Wait for stdout to flush before exiting
          await new Promise<void>(resolve => {
            if (process.stdout.write('')) {
              resolve();
            } else {
              process.stdout.once('drain', resolve);
            }
          });
        }

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
3. **If match:** Exits immediately with cached result (~288ms)
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
- Exits in ~288ms
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
| Cache hit | ~288ms | Cached result found |
| Cache miss | ~60-90s | Full validation run |
| Force flag | ~60-90s | Cache bypassed |

## Files Created/Modified

- \`refs/notes/vibe-validate/runs\` - Validation history (git notes, auto-created)

## Error Recovery

If validation fails:
1. Check error details: \`vibe-validate state --verbose\`
2. Fix errors shown in output
3. Re-run: \`vibe-validate validate\`
4. Verify: \`vibe-validate state\`
`);
}

/**
 * Run Command
 *
 * Executes a command and extracts LLM-friendly error output using vibe-validate extractors.
 * Provides concise, structured error information to save AI agent context windows.
 */

import type { Command } from 'commander';
import { execSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { autoDetectAndExtract } from '@vibe-validate/extractors';
import { getGitTreeHash, encodeRunCacheKey, extractYamlWithPreamble } from '@vibe-validate/git';
import type { RunCacheNote } from '@vibe-validate/history';
import { spawnCommand } from '@vibe-validate/core';
import { type RunResult } from '../schemas/run-result-schema.js';
import yaml from 'yaml';

export function runCommand(program: Command): void {
  program
    .command('run')
    .description('Run a command and extract LLM-friendly errors (with smart caching)')
    .argument('<command>', 'Command to execute (quoted if it contains spaces)')
    .option('--check', 'Check if cached result exists without executing')
    .option('--force', 'Force execution and update cache (bypass cache read)')
    .action(async (commandString: string, options: { check?: boolean; force?: boolean }) => {
      try {
        // Handle --check flag (cache status check only)
        if (options.check) {
          const cachedResult = await tryGetCachedResult(commandString);
          if (cachedResult) {
            // Cache hit - output cached result and exit with code 0
            process.stdout.write('---\n');
            process.stdout.write(yaml.stringify(cachedResult));
            process.stdout.write('\n');
            process.exit(0);
          } else {
            // Cache miss - output message and exit with code 1
            process.stderr.write('No cached result found for command.\n');
            process.exit(1);
          }
          return;
        }

        // Try to get cached result (unless --force)
        let result: RunResult;
        let context = { preamble: '', stderr: '' };

        if (!options.force) {
          const cachedResult = await tryGetCachedResult(commandString);
          if (cachedResult) {
            result = cachedResult;
          } else {
            // Cache miss - execute command
            const executeResult = await executeAndExtract(commandString);
            result = executeResult.result;
            context = executeResult.context;

            // Store result in cache
            await storeCacheResult(commandString, result);
          }
        } else {
          // Force flag - bypass cache and execute
          const executeResult = await executeAndExtract(commandString);
          result = executeResult.result;
          context = executeResult.context;

          // Update cache with fresh result
          await storeCacheResult(commandString, result);
        }

        // CRITICAL: Write complete YAML to stdout and flush BEFORE any stderr
        // This ensures even if callers use 2>&1, YAML completes first
        process.stdout.write('---\n');
        process.stdout.write(yaml.stringify(result));

        // Add final newline to ensure YAML terminates cleanly
        process.stdout.write('\n');

        // Flush stdout to guarantee all YAML is written before any stderr
        // This prevents interleaving when streams are combined with 2>&1
        await new Promise<void>((resolve) => {
          if (process.stdout.writableNeedDrain) {
            process.stdout.once('drain', resolve);
          } else {
            resolve();
          }
        });

        // Now write preamble and stderr to stderr stream (after YAML is flushed)
        if (context.preamble) {
          process.stderr.write(context.preamble + '\n');
        }
        if (context.stderr) {
          process.stderr.write(context.stderr);
        }

        // Exit with same code as the command
        process.exit(result.exitCode);
      } catch (error) {
        // Flush stdout before writing error to stderr
        await new Promise<void>((resolve) => {
          if (process.stdout.writableNeedDrain) {
            process.stdout.once('drain', resolve);
          } else {
            resolve();
          }
        });

        console.error('Failed to execute command:', error);
        process.exit(1);
      }
    });
}

/**
 * Get working directory relative to git root
 * Returns empty string for root, "packages/cli" for subdirectory
 */
function getWorkingDirectory(): string {
  try {
    const gitRoot = execSync('git rev-parse --show-toplevel', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();

    const cwd = process.cwd();

    // If cwd is git root, return empty string
    if (cwd === gitRoot) {
      return '';
    }

    // Return relative path from git root
    return cwd.substring(gitRoot.length + 1); // +1 to remove leading slash
  } catch {
    // Not in a git repository - return empty string
    return '';
  }
}

/**
 * Try to get cached result for a command
 * Returns null if no cache hit or if not in a git repository
 */
async function tryGetCachedResult(commandString: string): Promise<RunResult | null> {
  try {
    // Get tree hash
    const treeHash = await getGitTreeHash();

    // Get working directory
    const workdir = getWorkingDirectory();

    // Encode cache key
    const cacheKey = encodeRunCacheKey(commandString, workdir);

    // Construct git notes ref path: refs/notes/vibe-validate/run/{treeHash}/{cacheKey}
    const refPath = `vibe-validate/run/${treeHash}/${cacheKey}`;

    // Try to read git note
    const noteContent = execSync(`git notes --ref=${refPath} show HEAD 2>/dev/null || true`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();

    if (!noteContent) {
      // Cache miss
      return null;
    }

    // Parse cached note
    const cachedNote = yaml.parse(noteContent) as RunCacheNote;

    // Convert to RunResult format (mark as cached)
    const result: RunResult = {
      command: commandString,
      exitCode: cachedNote.exitCode,
      timestamp: cachedNote.timestamp,
      extraction: cachedNote.extraction,
      fullOutputFile: cachedNote.fullOutputFile,
      isCachedResult: true, // Mark as cache hit
    };

    return result;
  // eslint-disable-next-line sonarjs/no-ignored-exceptions -- Cache lookup failure is non-critical, proceed with execution
  } catch (_error) {
    // Cache lookup failed - proceed with execution
    return null;
  }
}

/**
 * Store result in cache (only successful runs - exitCode === 0)
 */
async function storeCacheResult(commandString: string, result: RunResult): Promise<void> {
  try {
    // Only cache successful runs (v0.15.0+)
    // Failed runs may be transient or environment-specific
    if (result.exitCode !== 0) {
      return;
    }

    // Get tree hash
    const treeHash = await getGitTreeHash();

    // Get working directory
    const workdir = getWorkingDirectory();

    // Encode cache key
    const cacheKey = encodeRunCacheKey(commandString, workdir);

    // Construct git notes ref path
    const refPath = `vibe-validate/run/${treeHash}/${cacheKey}`;

    // Build cache note with full extraction
    const cacheNote: RunCacheNote = {
      treeHash,
      command: commandString,
      workdir,
      timestamp: result.timestamp,
      exitCode: result.exitCode,
      duration: 0, // Duration not tracked for cached results
      extraction: result.extraction,
      fullOutputFile: result.fullOutputFile,
    };

    // Store in git notes using heredoc to avoid quote escaping issues
    const noteYaml = yaml.stringify(cacheNote);

    // Use heredoc format for multi-line YAML
    try {
      execSync(
        `cat <<'EOF' | git notes --ref=${refPath} add -f -F - HEAD\n${noteYaml}\nEOF`,
        {
          stdio: 'ignore',
          shell: '/bin/bash', // Ensure bash for heredoc support
        }
      );
    // eslint-disable-next-line sonarjs/no-ignored-exceptions -- Note creation failure is non-critical, cache is optional
    } catch (_error) {
      // Ignore errors (note might already exist or not in git repo)
    }
  // eslint-disable-next-line sonarjs/no-ignored-exceptions -- Cache storage failure is non-critical, continue execution
  } catch (_error) {
    // Cache storage failed - not critical, continue
  }
}

/**
 * Execute a command and extract errors from its output
 */
async function executeAndExtract(commandString: string): Promise<{
  result: RunResult;
  context: { preamble: string; stderr: string };
}> {
  return new Promise((resolve, reject) => {
    const child = spawnCommand(commandString);

    let stdout = '';
    let stderr = '';

    // Capture stdout (spawnCommand always sets stdio: ['ignore', 'pipe', 'pipe'], so stdout/stderr are guaranteed non-null)
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- spawnCommand always pipes stdout/stderr
    child.stdout!.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    // Capture stderr
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- spawnCommand always pipes stdout/stderr
    child.stderr!.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    // Handle process exit
    child.on('close', (exitCode: number = 1) => {
      // CRITICAL: Check ONLY stdout for YAML (not stderr)
      // This prevents stderr warnings from corrupting nested YAML output
      const yamlResult = extractYamlWithPreamble(stdout);
      if (yamlResult) {
        const mergedResult = mergeNestedYaml(commandString, yamlResult.yaml, exitCode);

        // Include preamble and stderr for context
        const contextOutput = {
          preamble: yamlResult.preamble,
          stderr: stderr.trim(),
        };

        resolve({ result: mergedResult, context: contextOutput });
        return;
      }

      // For extraction, combine both streams (stderr has useful error context)
      const combinedOutput = stdout + stderr;

      // Write full output to temp file for later access
      let fullOutputFile: string | undefined;
      try {
        const tempDir = mkdtempSync(join(tmpdir(), 'vibe-validate-run-'));
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const outputFileName = `run-${timestamp}.log`;
        fullOutputFile = join(tempDir, outputFileName);
        writeFileSync(fullOutputFile, combinedOutput, 'utf8');
      // eslint-disable-next-line sonarjs/no-ignored-exceptions -- Full output file is optional, not critical
      } catch (_error) {
        // Failed to write temp file - not critical, continue without it
        fullOutputFile = undefined;
      }

      // Extract errors using smart extractor (output-based detection)
      const extraction = autoDetectAndExtract(combinedOutput);

      const result: RunResult = {
        command: commandString,
        exitCode,
        timestamp: new Date().toISOString(),
        extraction,
        fullOutputFile,
      };

      resolve({ result, context: { preamble: '', stderr: '' } });
    });

    // Handle spawn errors (e.g., command not found)
    child.on('error', (error: Error) => {
      reject(error);
    });
  });
}

/**
 * Infer a step name from the command for smart extraction
 *
 * Examples:
 * - "npx vitest" → "test"
 * - "npx tsc --noEmit" → "typecheck"
 * - "pnpm lint" → "lint"
 * - "pnpm --filter @pkg test" → "test"
 */
/**
 * Merge nested YAML output with outer run metadata
 *
 * When vibe-validate run wraps another vibe-validate command (run or validate),
 * we merge the inner YAML with outer metadata instead of double-extracting.
 */
function mergeNestedYaml(
  outerCommand: string,
  yamlOutput: string,
  outerExitCode: number
): RunResult {
  try {
    // Parse the inner YAML
    const innerResult = yaml.parse(yamlOutput);

    // Extract the innermost command for suggestedDirectCommand
    const innermostCommand = extractInnermostCommand(innerResult);

    // Merge: preserve ALL inner fields, add outer metadata
    const mergedResult: RunResult = {
      ...innerResult, // Spread ALL inner fields (errors, phases, tree_hash, etc.)
      command: outerCommand, // Override with outer command
      exitCode: outerExitCode, // Use outer exit code (should match inner)
      suggestedDirectCommand: innermostCommand, // Add suggestion
    };

    return mergedResult;
  } catch (error) {
    // If YAML parsing fails, treat as regular output
    console.error('Warning: Failed to parse nested YAML output:', error);

    const extraction = autoDetectAndExtract(yamlOutput);

    return {
      command: outerCommand,
      exitCode: outerExitCode,
      timestamp: new Date().toISOString(),
      extraction,
    };
  }
}

/**
 * Extract the innermost command from nested run results
 *
 * Examples:
 * - { command: "npm test" } → "npm test"
 * - { command: "...", suggestedDirectCommand: "npm test" } → "npm test"
 * - { command: "vibe-validate validate" } → "vibe-validate validate"
 */
function extractInnermostCommand(result: Record<string, unknown>): string {
  // If already has suggestedDirectCommand, use it (handles 3+ levels)
  if (result.suggestedDirectCommand && typeof result.suggestedDirectCommand === 'string') {
    return result.suggestedDirectCommand;
  }

  // Otherwise, use the command from the inner result
  if (result.command && typeof result.command === 'string') {
    return result.command;
  }

  return 'unknown';
}

/**
 * Show verbose help with detailed documentation
 */
export function showRunVerboseHelp(): void {
  console.log(`# run Command Reference

> Run a command and extract LLM-friendly errors (with smart caching)

## Overview

The \`run\` command executes any shell command and extracts errors using vibe-validate's smart extractors. This provides concise, structured error information to save AI agent context windows.

**NEW in v0.15.0**: Automatic caching based on git tree hash - repeat commands are instant (<200ms) when code hasn't changed.

## How It Works

1. **Checks cache** - If git tree unchanged, returns cached result instantly
2. **Executes command** (on cache miss) in a shell subprocess
3. **Captures output** (stdout + stderr)
4. **Auto-detects format** (vitest, jest, tsc, eslint, etc.)
5. **Extracts errors** using appropriate extractor
6. **Stores in cache** - Future runs with same tree hash are instant
7. **Outputs YAML** with structured error information
8. **Passes through exit code** from original command

## Caching

The \`run\` command automatically caches results based on:
- **Git tree hash** - Content-based identifier (same code = same hash)
- **Command string** - Different commands have separate caches
- **Working directory** - Subdirectory runs are tracked separately

### Cache Behavior

**First run** (cache miss):
\`\`\`bash
$ vibe-validate run "pnpm test"
# Executes test suite, extracts errors, stores in cache
# Duration: ~30 seconds
\`\`\`

**Repeat run** (cache hit):
\`\`\`bash
$ vibe-validate run "pnpm test"
# Returns cached result instantly (no execution)
# Duration: <200ms
\`\`\`

**After code change**:
\`\`\`bash
# Edit a file, tree hash changes
$ vibe-validate run "pnpm test"
# Cache miss - executes and caches with new tree hash
\`\`\`

### Cache Flags

**Check cache status** (--check):
\`\`\`bash
$ vibe-validate run --check "pnpm test"
# Exit 0 if cached (outputs cached result)
# Exit 1 if not cached (no execution)
\`\`\`

**Force execution** (--force):
\`\`\`bash
$ vibe-validate run --force "pnpm test"
# Always executes, updates cache (ignores existing cache)
# Useful for flaky tests or time-sensitive commands
\`\`\`

### Cache Storage

Cache is stored in git notes at:
\`\`\`
refs/notes/vibe-validate/run/{treeHash}/{encodedCommand}
\`\`\`

- **Local only** - Not pushed with git (each dev has their own cache)
- **Automatic cleanup** - Run \`vibe-validate doctor\` to check cache health
- **No configuration required** - Works out of the box

## Use Cases

### During Development (AI Agents)
Instead of parsing verbose test output:
\`\`\`bash
# Verbose (wastes context window)
npx vitest packages/extractors/test/vitest-extractor.test.ts

# Concise (LLM-friendly)
vibe-validate run "npx vitest packages/extractors/test/vitest-extractor.test.ts"
\`\`\`

### Debugging Specific Tests
\`\`\`bash
# Run single test file with extraction
vibe-validate run "npx vitest -t 'should extract failed tests'"

# Run package tests with extraction
vibe-validate run "pnpm --filter @vibe-validate/extractors test"
\`\`\`

### Type Checking
\`\`\`bash
# Extract TypeScript errors
vibe-validate run "npx tsc --noEmit"
\`\`\`

### Linting
\`\`\`bash
# Extract ESLint errors
vibe-validate run "pnpm lint"
\`\`\`

## Output Format

YAML structure:
\`\`\`yaml
---
command: "npx vitest test.ts"
exitCode: 1
extraction:
  errors:
    - file: "test.ts"
      line: 42
      message: "expected 5 to equal 3"
  summary: "1 test failed"
  guidance: "Review test assertions and expected values"
  errorSummary: |
    test.ts:42 - expected 5 to equal 3
rawOutput: "... (truncated)"
\`\`\`

## Stream Output Behavior

**IMPORTANT**: The \`run\` command separates structured data from context noise:

- **stdout**: Pure YAML (clean, parseable, pipeable)
- **stderr**: Package manager preamble + warnings (human context)

### Examples

**Terminal usage (both streams visible):**
\`\`\`bash
$ vibe-validate run "pnpm test"
---                           # ← stdout (YAML)
command: pnpm test
exitCode: 0
extraction: {...}

> pkg@1.0.0 test             # ← stderr (preamble)
> vitest run
\`\`\`

**Piped usage (only YAML):**
\`\`\`bash
$ vibe-validate run "pnpm test" > results.yaml
# results.yaml contains ONLY pure YAML (no preamble)
\`\`\`

**Suppress context:**
\`\`\`bash
$ vibe-validate run "pnpm test" 2>/dev/null
# Shows only YAML (stderr suppressed)
\`\`\`

## Package Manager Support

The \`run\` command automatically detects and handles package manager preambles:

- **pnpm**: \`> package@1.0.0 script\` → routed to stderr
- **npm**: \`> package@1.0.0 script\` → routed to stderr
- **yarn**: \`$ command\` → routed to stderr

This means you can safely use:
\`\`\`bash
vibe-validate run "pnpm validate --yaml"  # Works!
vibe-validate run "npm test"              # Works!
vibe-validate run "yarn build"            # Works!
\`\`\`

The YAML output on stdout remains clean and parseable, while the preamble is preserved on stderr for debugging.

## Nested Run Detection

When \`run\` wraps another vibe-validate command that outputs YAML, it intelligently merges the results:

\`\`\`bash
# 2-level nesting
$ vibe-validate run "vibe-validate run 'npm test'"
---
command: vibe-validate run "npm test"
exitCode: 0
extraction: {...}
suggestedDirectCommand: npm test  # ← Unwrapped!
\`\`\`

The \`suggestedDirectCommand\` field shows the innermost command, helping you avoid unnecessary nesting.

## Exit Codes

The \`run\` command passes through the exit code from the executed command:
- \`0\` - Command succeeded
- \`1+\` - Command failed (same code as original command)

## Examples

### Run Single Test File
\`\`\`bash
vibe-validate run "npx vitest packages/cli/test/commands/run.test.ts"
\`\`\`

### Run Specific Test Case
\`\`\`bash
vibe-validate run "npx vitest -t 'should extract errors'"
\`\`\`

### Run Package Tests
\`\`\`bash
vibe-validate run "pnpm --filter @vibe-validate/core test"
\`\`\`

### Type Check
\`\`\`bash
vibe-validate run "npx tsc --noEmit"
\`\`\`

### Lint
\`\`\`bash
vibe-validate run "pnpm lint"
\`\`\`

## Supported Extractors

The command auto-detects and uses appropriate extractors:
- **TypeScript** (tsc) - Type errors with file/line/message
- **ESLint** - Lint errors with rules and suggestions
- **Vitest** - Test failures with assertion details
- **Jest** - Test failures with stack traces
- **Mocha** - Test failures with hooks
- **Jasmine** - Test failures with specs
- **JUnit XML** - CI test results
- **Generic** - Fallback for unknown formats

## Integration with AI Agents

This command is designed specifically for AI agents (Claude Code, Cursor, etc.):

1. **Context Window Savings**: Extracts only essential error info (90% reduction)
2. **Structured Output**: YAML format is easily parseable
3. **Actionable Guidance**: Provides fix suggestions
4. **Exit Code Handling**: Proper error propagation

## Comparison

### Without \`run\` command:
\`\`\`bash
$ npx vitest test.ts
[200+ lines of verbose output with stack traces, timing info, etc.]
\`\`\`

### With \`run\` command:
\`\`\`bash
$ vibe-validate run "npx vitest test.ts"
---
command: "npx vitest test.ts"
exitCode: 1
extraction:
  errors:
    - file: "test.ts"
      line: 42
      message: "expected 5 to equal 3"
  summary: "1 test failed"
\`\`\`

**Result**: Same information, 90% smaller!
`);
}

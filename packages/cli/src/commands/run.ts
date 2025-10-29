/**
 * Run Command
 *
 * Executes a command and extracts LLM-friendly error output using vibe-validate extractors.
 * Provides concise, structured error information to save AI agent context windows.
 */

import type { Command } from 'commander';
import { spawn } from 'node:child_process';
import { autoDetectAndExtract } from '@vibe-validate/extractors';
import type { ErrorExtractorResult } from '@vibe-validate/extractors';
import yaml from 'yaml';

/**
 * Result of running a command with extraction
 */
interface RunResult {
  /** Command that was executed */
  command: string;

  /** Exit code from the command */
  exitCode: number;

  /** Extracted error information */
  extraction: ErrorExtractorResult;

  /** Raw output (truncated to 1000 chars for reference) */
  rawOutput?: string;

  /** Suggested direct command (when nested vibe-validate detected) */
  suggestedDirectCommand?: string;

  /** Allow additional fields from nested YAML */
  [key: string]: unknown;
}

export function runCommand(program: Command): void {
  program
    .command('run')
    .description('Run a command and extract LLM-friendly errors from output')
    .argument('<command>', 'Command to execute (quoted if it contains spaces)')
    .action(async (commandString: string) => {
      try {
        const { result, context } = await executeAndExtract(commandString);

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
 * Execute a command and extract errors from its output
 */
async function executeAndExtract(commandString: string): Promise<{
  result: RunResult;
  context: { preamble: string; stderr: string };
}> {
  return new Promise((resolve, reject) => {
    // SECURITY: shell: true required for shell operators (&&, ||, |) and cross-platform compatibility.
    // Commands from user config files only (same trust as npm scripts). See SECURITY.md for full threat model.
    // NOSONAR - Intentional shell execution of user-defined commands
    const child = spawn(commandString, {
      shell: true,
      stdio: ['inherit', 'pipe', 'pipe'], // inherit stdin, pipe stdout/stderr
    });

    let stdout = '';
    let stderr = '';

    // Capture stdout (stdio: 'pipe' configuration guarantees these are Readable streams)
    child.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    // Capture stderr (stdio: 'pipe' configuration guarantees these are Readable streams)
    child.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    // Handle process exit
    child.on('close', (exitCode: number = 1) => {
      // CRITICAL: Check ONLY stdout for YAML (not stderr)
      // This prevents stderr warnings from corrupting nested YAML output
      if (isYamlOutput(stdout)) {
        const { yaml, preamble } = extractYamlAndPreamble(stdout);
        const mergedResult = mergeNestedYaml(commandString, yaml, exitCode);

        // Include preamble and stderr for context
        const contextOutput = {
          preamble: preamble.trim(),
          stderr: stderr.trim(),
        };

        resolve({ result: mergedResult, context: contextOutput });
        return;
      }

      // For extraction, combine both streams (stderr has useful error context)
      const combinedOutput = stdout + stderr;

      // Infer step name from command for smart extraction
      const stepName = inferStepName(commandString);

      // Extract errors using smart extractor
      const extraction = autoDetectAndExtract(stepName, combinedOutput);

      const result: RunResult = {
        command: commandString,
        exitCode,
        extraction,
        // Include truncated raw output for reference (if needed for debugging)
        rawOutput: combinedOutput.length > 1000
          ? combinedOutput.substring(0, 1000) + '... (truncated)'
          : combinedOutput,
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
function inferStepName(commandString: string): string {
  const lower = commandString.toLowerCase();

  // TypeScript/tsc
  if (lower.includes('tsc') || lower.includes('typecheck')) {
    return 'typecheck';
  }

  // Linting
  if (lower.includes('eslint') || lower.includes('lint')) {
    return 'lint';
  }

  // Testing (vitest, jest, mocha, etc.)
  if (lower.includes('vitest') || lower.includes('jest') ||
      lower.includes('mocha') || lower.includes('test') ||
      lower.includes('jasmine')) {
    return 'test';
  }

  // OpenAPI
  if (lower.includes('openapi')) {
    return 'openapi';
  }

  // Generic fallback
  return 'run';
}

/**
 * Check if output contains YAML format (may have preamble before ---)
 *
 * IMPORTANT: This function detects YAML anywhere in the output, not just at the start.
 * This allows us to handle package manager preambles (pnpm, npm, yarn) that appear
 * before the actual YAML content.
 *
 * Example with preamble:
 * ```
 * > vibe-validate@0.13.0 validate
 * > node packages/cli/dist/bin.js validate
 *
 * ---
 * command: "npm test"
 * exitCode: 0
 * ```
 *
 * The preamble will be extracted and routed to stderr, keeping stdout clean.
 */
function isYamlOutput(output: string): boolean {
  const trimmed = output.trim();
  // Check if starts with --- (no preamble)
  if (trimmed.startsWith('---\n') || trimmed.startsWith('---\r\n')) {
    return true;
  }
  // Check if contains --- with newlines (has preamble)
  return output.includes('\n---\n') || output.includes('\n---\r\n');
}

/**
 * Extract YAML content and separate preamble/postamble
 *
 * STREAM ROUTING STRATEGY:
 * - stdout (returned 'yaml'): Clean YAML for piping and LLM consumption
 * - stderr (returned 'preamble'): Package manager noise, preserved for human context
 *
 * This separation follows Unix philosophy: stdout = data, stderr = human messages.
 *
 * Example input:
 * ```
 * > package@1.0.0 test    ← preamble (goes to stderr)
 * > vitest run            ← preamble (goes to stderr)
 *
 * ---                     ← yaml (goes to stdout)
 * command: "vitest run"
 * exitCode: 0
 * extraction: {...}
 * ```
 *
 * Benefits:
 * 1. `run "pnpm test" > file.yaml` writes pure YAML
 * 2. `run "pnpm test" 2>/dev/null` suppresses noise
 * 3. Terminal shows both streams (full context)
 *
 * @param stdout - Raw stdout from the executed command
 * @returns Object with separated yaml, preamble, and postamble
 */
function extractYamlAndPreamble(stdout: string): {
  yaml: string;
  preamble: string;
  postamble: string;
} {
  // Check if it starts with --- (no preamble)
  const trimmed = stdout.trim();
  if (trimmed.startsWith('---\n') || trimmed.startsWith('---\r\n')) {
    return { yaml: trimmed, preamble: '', postamble: '' };
  }

  // Find first YAML separator with newline before it
  const patterns = [
    { pattern: '\n---\n', offset: 1 },
    { pattern: '\n---\r\n', offset: 1 },
  ];

  let earliestIndex = -1;
  let selectedOffset = 0;

  for (const { pattern, offset } of patterns) {
    const idx = stdout.indexOf(pattern);
    if (idx !== -1 && (earliestIndex === -1 || idx < earliestIndex)) {
      earliestIndex = idx;
      selectedOffset = offset;
    }
  }

  if (earliestIndex === -1) {
    // No YAML found
    return { yaml: '', preamble: stdout, postamble: '' };
  }

  // Extract preamble (everything before ---)
  const preamble = stdout.substring(0, earliestIndex).trim();

  // Extract YAML content (from --- onward)
  const yamlContent = stdout.substring(earliestIndex + selectedOffset).trim();

  return { yaml: yamlContent, preamble, postamble: '' };
}

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

    const stepName = inferStepName(outerCommand);
    const extraction = autoDetectAndExtract(stepName, yamlOutput);

    return {
      command: outerCommand,
      exitCode: outerExitCode,
      extraction,
      rawOutput: yamlOutput.substring(0, 1000),
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

> Run a command and extract LLM-friendly errors

## Overview

The \`run\` command executes any shell command and extracts errors using vibe-validate's smart extractors. This provides concise, structured error information to save AI agent context windows.

## How It Works

1. **Executes command** in a shell subprocess
2. **Captures output** (stdout + stderr)
3. **Auto-detects format** (vitest, jest, tsc, eslint, etc.)
4. **Extracts errors** using appropriate extractor
5. **Outputs YAML** with structured error information
6. **Passes through exit code** from original command

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
  cleanOutput: |
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

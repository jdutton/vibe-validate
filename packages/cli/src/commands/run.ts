/**
 * Run Command
 *
 * Executes a command and extracts LLM-friendly error output using vibe-validate extractors.
 * Provides concise, structured error information to save AI agent context windows.
 */

import type { Command } from 'commander';
import { spawn } from 'child_process';
import { extractByStepName } from '@vibe-validate/extractors';
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
        const result = await executeAndExtract(commandString);

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

        // Now safe to write any stderr messages (after YAML is complete)
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
async function executeAndExtract(commandString: string): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    // Spawn command in shell mode to support complex commands
    const child = spawn(commandString, {
      shell: true,
      stdio: ['inherit', 'pipe', 'pipe'], // inherit stdin, pipe stdout/stderr
    });

    let stdout = '';
    let stderr = '';

    // Capture stdout
    child.stdout?.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    // Capture stderr
    child.stderr?.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    // Handle process exit
    child.on('close', (exitCode: number | null) => {
      const actualExitCode = exitCode ?? 1;

      // CRITICAL: Check ONLY stdout for YAML (not stderr)
      // This prevents stderr warnings from corrupting nested YAML output
      if (isYamlOutput(stdout)) {
        const mergedResult = mergeNestedYaml(commandString, stdout, actualExitCode);
        resolve(mergedResult);
        return;
      }

      // For extraction, combine both streams (stderr has useful error context)
      const combinedOutput = stdout + stderr;

      // Infer step name from command for smart extraction
      const stepName = inferStepName(commandString);

      // Extract errors using smart extractor
      const extraction = extractByStepName(stepName, combinedOutput);

      const result: RunResult = {
        command: commandString,
        exitCode: actualExitCode,
        extraction,
        // Include truncated raw output for reference (if needed for debugging)
        rawOutput: combinedOutput.length > 1000
          ? combinedOutput.substring(0, 1000) + '... (truncated)'
          : combinedOutput,
      };

      resolve(result);
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
 * Check if output is YAML format (starts with ---)
 */
function isYamlOutput(output: string): boolean {
  const trimmed = output.trim();
  return trimmed.startsWith('---\n') || trimmed.startsWith('---\r\n');
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
    const extraction = extractByStepName(stepName, yamlOutput);

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

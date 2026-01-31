/**
 * Run Command
 *
 * Executes a command and extracts LLM-friendly error output using vibe-validate extractors.
 * Provides concise, structured error information to save AI agent context windows.
 */

import { writeFile, readFile } from 'node:fs/promises';
import { join, resolve, relative } from 'node:path';

import type { OutputLine } from '@vibe-validate/core';
import { spawnCommand, parseVibeValidateOutput, getGitRoot } from '@vibe-validate/core';
import { autoDetectAndExtract } from '@vibe-validate/extractors';
import { getGitTreeHash, encodeRunCacheKey, extractYamlWithPreamble, addNote, readNote, type NotesRef } from '@vibe-validate/git';
import type { RunCacheNote } from '@vibe-validate/history';
import { normalizePath, toForwardSlash } from '@vibe-validate/utils';
import chalk from 'chalk';
import type { Command } from 'commander';
import yaml from 'yaml';

import { type RunResult } from '../schemas/run-result-schema.js';
import { getCommandName } from '../utils/command-name.js';
import { logDebug, logWarning } from '../utils/logger.js';
import { getRunOutputDir, ensureDir } from '../utils/temp-files.js';

export function runCommand(program: Command): void {
  program
    .command('run')
    .description('Run a command and extract LLM-friendly errors (with smart caching)')
    .argument('<command...>', 'Command to execute (multiple words supported)')
    .option('--check', 'Check if cached result exists without executing')
    .option('--force', 'Force execution and update cache (bypass cache read)')
    .option('--cwd <directory>', 'Working directory relative to git root (default: git root)')
    .option('--head <lines>', 'Display first N lines of output after YAML (on stderr)', Number.parseInt)
    .option('--tail <lines>', 'Display last N lines of output after YAML (on stderr)', Number.parseInt)
    .option('--verbose', 'Display all output after YAML (on stderr)')
    .helpOption(false) // Disable automatic help to avoid conflicts with commands that use --help
    .allowUnknownOption() // Allow unknown options in the command
    // eslint-disable-next-line sonarjs/cognitive-complexity -- Complex command handling logic, refactoring would reduce readability
    .action(async (commandParts: string[], options: { check?: boolean; force?: boolean; cwd?: string; head?: number; tail?: number; verbose?: boolean }) => {
      // WORKAROUND: Commander.js with allowUnknownOption() strips ALL options from commandParts
      // Parse directly from process.argv to get the actual command with our options parsed correctly
      const argv = process.argv;
      const runIndex = argv.findIndex(arg => arg === 'run' || arg.endsWith('/vv') || arg.endsWith('/vibe-validate'));

      let actualOptions: typeof options;
      let commandString: string;

      if (runIndex === -1) {
        // Test environment or non-standard invocation - fallback to Commander's parsing
        actualOptions = options;
        commandString = commandParts.join(' ');
      } else {
        // Real CLI environment - manually parse argv to get correct options
        actualOptions = {};
        const actualCommand: string[] = [];

        let i = runIndex + 1;
        while (i < argv.length) {
          const arg = argv[i];

          if (arg === '--verbose') {
            actualOptions.verbose = true;
            i++;
          } else if (arg === '--check') {
            actualOptions.check = true;
            i++;
          } else if (arg === '--force') {
            actualOptions.force = true;
            i++;
          } else if (arg === '--cwd' && i + 1 < argv.length) {
            actualOptions.cwd = argv[i + 1];
            i += 2;
          } else if (arg === '--head' && i + 1 < argv.length) {
            actualOptions.head = Number.parseInt(argv[i + 1], 10);
            i += 2;
          } else if (arg === '--tail' && i + 1 < argv.length) {
            actualOptions.tail = Number.parseInt(argv[i + 1], 10);
            i += 2;
          } else {
            // Not a known option - rest is the command
            actualCommand.push(...argv.slice(i));
            break;
          }
        }

        commandString = actualCommand.join(' ');
      }

      // If command is empty or starts with a flag (like --help), show help for run command
      // This handles cases like: vv run --help, vv run --verbose --help, vv run --help bob
      const trimmedCommand = commandString.trim();
      if (!trimmedCommand || trimmedCommand.startsWith('-')) {
        // No command or command starts with a flag - show run command help
        showRunHelp();
        process.exit(0);
      }

      try {
        // Note: Plugin loading is handled by the runner (in @vibe-validate/core)
        // when running via validate command. For standalone run commands, plugins
        // are not needed since run is primarily for caching/extraction, not validation.

        // Set VV_FORCE_EXECUTION environment variable when --force flag is present
        // This propagates the force flag to nested vv run commands naturally
        if (actualOptions.force) {
          process.env.VV_FORCE_EXECUTION = '1';
        }

        // Handle --check flag (cache status check only)
        if (actualOptions.check) {
          const cachedResult = await tryGetCachedResult(commandString, actualOptions.cwd);
          if (cachedResult) {
            // Cache hit - output cached result and exit with code 0
            process.stdout.write('---\n');
            process.stdout.write(yaml.stringify(cachedResult));
            process.stdout.write('---\n');
            process.exit(0);
          } else {
            // Cache miss - output message and exit with code 1
            process.stderr.write('No cached result found for command.\n');
            process.exit(1);
          }
          return;
        }

        // Try to get cached result (unless --force or VV_FORCE_EXECUTION is set)
        let result: RunResult;
        let context = { preamble: '', stderr: '' };

        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- Using || is correct here: force flag can be explicitly false, and we need to check env var as fallback
        const shouldForce = actualOptions.force || process.env.VV_FORCE_EXECUTION === '1';
        if (shouldForce) {
          // Force execution - skip cache
          const executeResult = await executeAndExtract(commandString, actualOptions.cwd);
          result = executeResult.result;
          context = executeResult.context;

          // Update cache with fresh result
          await storeCacheResult(commandString, result, actualOptions.cwd);
        } else {
          // Try cache first
          const cachedResult = await tryGetCachedResult(commandString, actualOptions.cwd);
          if (cachedResult) {
            result = cachedResult;
          } else {
            // Cache miss - execute command
            const executeResult = await executeAndExtract(commandString, actualOptions.cwd);
            result = executeResult.result;
            context = executeResult.context;

            // Store result in cache
            await storeCacheResult(commandString, result, actualOptions.cwd);
          }
        }

        // CRITICAL: Write complete YAML to stdout and flush BEFORE any stderr
        // This ensures even if callers use 2>&1, YAML completes first
        // Format as YAML front matter with opening delimiter
        process.stdout.write('---\n');

        // Add YAML comment for non-git repositories to inform LLMs
        let yamlOutput = yaml.stringify(result);
        if (result.treeHash === 'unknown') {
          yamlOutput = yamlOutput.replace(
            /^treeHash: unknown$/m,
            'treeHash: unknown  # Not in git repository - caching disabled'
          );
        }
        process.stdout.write(yamlOutput);

        // Always write closing delimiter for consistent YAML format
        // This ensures LLMs and parsers can deterministically identify document boundaries
        process.stdout.write('---\n');

        // Check if additional output will be displayed (for displayCommandOutput)
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- Using || to check truthy values (0 is falsy, which is correct)
        const willDisplayOutput = !!(actualOptions.head || actualOptions.tail || actualOptions.verbose);

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

        // Display output based on --head, --tail, or --verbose flags
        if (willDisplayOutput) {
          await displayCommandOutput(result, actualOptions);
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
 * Get working directory relative to git root for cache key
 * Returns empty string for root, "packages/cli" for subdirectory
 *
 * IMPORTANT: For cache key generation, we use the ACTUAL directory where the command
 * is invoked from (process.cwd()), not where it runs. This ensures cache keys are
 * accurate - running "npm test" from packages/cli is different than from git root.
 *
 * @param explicitCwd - Optional explicit cwd from --cwd flag (relative to git root)
 * @returns Working directory path relative to git root (empty string for root)
 */
function getWorkingDirectory(explicitCwd?: string): string {
  try {
    const gitRoot = getGitRoot();

    if (!gitRoot) {
      throw new Error('Not in a git repository');
    }

    // Use explicit --cwd if provided
    if (explicitCwd) {
      // Resolve path relative to git root
      const resolved = resolve(gitRoot, explicitCwd);

      // Security: Prevent directory traversal outside git root
      // Normalize both paths for cross-platform comparison (Windows uses backslashes, git root may use forward slashes)
      const normalizedResolved = normalizePath(resolved);
      const normalizedGitRoot = normalizePath(gitRoot);
      if (!toForwardSlash(normalizedResolved).startsWith(toForwardSlash(normalizedGitRoot))) {
        throw new Error(`Invalid --cwd: "${explicitCwd}" - must be within git repository`);
      }

      // Return normalized relative path
      const relativePath = relative(gitRoot, resolved);
      return relativePath || ''; // Empty string if resolved to git root
    }

    // Use actual current directory for cache key (process.cwd() relative to git root)
    // This ensures cache keys reflect WHERE the command was invoked from, not where it runs
    const cwd = process.cwd();
    const relativePath = relative(gitRoot, cwd);

    // If outside git repo or at git root, return empty string
    if (toForwardSlash(relativePath).startsWith('..') || !relativePath) {
      return '';
    }

    return relativePath;
  } catch (error) {
    // Re-throw validation errors
    if (error instanceof Error && error.message.includes('Invalid --cwd')) {
      throw error;
    }
    // Not in a git repository - return empty string
    return '';
  }
}

/**
 * Try to get cached result for a command
 * Returns null if no cache hit or if not in a git repository
 */
async function tryGetCachedResult(commandString: string, explicitCwd?: string): Promise<RunResult | null> {
  try {
    // Skip cache lookup if VV_FORCE_EXECUTION is set (propagated from parent)
    if (process.env.VV_FORCE_EXECUTION === '1') {
      logDebug('cache', 'Cache lookup skipped: VV_FORCE_EXECUTION=1');
      return null;
    }

    // Get tree hash
    const treeHash = await getGitTreeHash();

    // Skip caching if not in git repository
    if (treeHash === 'unknown') {
      logDebug('cache', 'Cache lookup skipped: not in git repository');
      return null;
    }

    // Get working directory
    const workdir = getWorkingDirectory(explicitCwd);

    // Encode cache key
    const cacheKey = encodeRunCacheKey(commandString, workdir);

    // Construct git notes ref path: refs/notes/vibe-validate/run/{treeHash}/{cacheKey}
    const refPath = `vibe-validate/run/${treeHash}/${cacheKey}` as NotesRef;

    logDebug('cache', 'Cache lookup', { treeHash, cacheKey, refPath });

    // Try to read git note using secure readNote function
    const noteContent = readNote(refPath, treeHash);

    if (!noteContent) {
      // Cache miss
      logDebug('cache', 'Cache miss');
      return null;
    }

    logDebug('cache', 'Cache hit');

    // Parse cached note
    const cachedNote = yaml.parse(noteContent) as RunCacheNote;

    // Migration: v0.14.x cached notes used 'duration' (ms), v0.15.0+ uses 'durationSecs' (s)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const durationSecs = cachedNote.durationSecs ?? ((cachedNote as any).duration ? (cachedNote as any).duration / 1000 : 0);

    // Convert to RunResult format (mark as cached)
    const result: RunResult = {
      command: cachedNote.command, // Use command from cache (may be unwrapped)
      exitCode: cachedNote.exitCode,
      durationSecs,
      timestamp: cachedNote.timestamp,
      treeHash: cachedNote.treeHash,
      extraction: cachedNote.extraction,
      ...(cachedNote.outputFiles ? { outputFiles: cachedNote.outputFiles } : {}),
      isCachedResult: true, // Mark as cache hit
    };

    return result;
  } catch (error) {
    logWarning('cache', 'Cache lookup failed - proceeding with execution', error as Error);
    return null;
  }
}

/**
 * Store result in cache (only successful runs - exitCode === 0)
 */
async function storeCacheResult(commandString: string, result: RunResult, explicitCwd?: string): Promise<void> {
  try {
    // Only cache successful runs (v0.15.0+)
    // Failed runs may be transient or environment-specific
    if (result.exitCode !== 0) {
      logDebug('cache', 'Skipping cache storage: command failed', { exitCode: result.exitCode });
      return;
    }

    // CRITICAL FIX (Issue #73 expanded): Skip caching if nested vibe-validate command was detected
    // When result.command differs from commandString, it means we detected YAML output from a nested
    // vibe-validate invocation and unwrapped to the actual command. The inner command already cached
    // its result, so we don't need to (and shouldn't) cache again at the outer level.
    // This prevents duplicate cache entries and ensures only the innermost command caches.
    if (result.command !== commandString) {
      logDebug('cache', 'Skipping cache storage: nested vibe-validate command already cached by inner execution', {
        requestedCommand: commandString,
        actualCommand: result.command,
      });
      return;
    }

    // Get tree hash
    const treeHash = await getGitTreeHash();

    // Skip caching if not in git repository
    if (treeHash === 'unknown') {
      logDebug('cache', 'Cache storage skipped: not in git repository');
      return;
    }

    // Get working directory
    const workdir = getWorkingDirectory(explicitCwd);

    // Encode cache key (using commandString since we verified it equals result.command above)
    const cacheKey = encodeRunCacheKey(commandString, workdir);

    // Construct git notes ref path
    const refPath = `vibe-validate/run/${treeHash}/${cacheKey}` as NotesRef;

    logDebug('cache', 'Storing cache result', { treeHash, cacheKey, refPath });

    // Build cache note (extraction already cleaned in runner)
    // Token optimization: Only include extraction when exitCode !== 0 OR there are actual errors
    // Note: result.command may be unwrapped (actual command) if nested vibe-validate was detected
    const cacheNote: RunCacheNote = {
      treeHash,
      command: result.command, // Store unwrapped command (e.g., "eslint ..." not "pnpm lint")
      workdir,
      timestamp: result.timestamp,
      exitCode: result.exitCode,
      durationSecs: result.durationSecs,
      ...(result.extraction ? { extraction: result.extraction } : {}), // Conditionally include extraction
      ...(result.outputFiles ? { outputFiles: result.outputFiles } : {}),
    };

    // Store in git notes using secure addNote function
    // SECURITY FIX: Eliminates heredoc injection vulnerability
    const noteYaml = yaml.stringify(cacheNote);

    try {
      // Use secure addNote with stdin piping (no shell, no heredoc)
      addNote(refPath, treeHash, noteYaml, true);
      logDebug('cache', 'Cache stored successfully');
    } catch (error) {
      logWarning('cache', 'Failed to store cache result', error as Error);
    }
  } catch (error) {
    logWarning('cache', 'Cache storage failed', error as Error);
  }
}

/**
 * Strip ANSI escape codes from text
 */
function stripAnsiCodes(text: string): string {
  // Control character \x1b is intentionally used to match ANSI escape codes
  // eslint-disable-next-line no-control-regex, sonarjs/no-control-regex
  return text.replaceAll(/\x1b\[[0-9;]*m/g, '');
}

/**
 * Execute a command and extract errors from its output
 */
async function executeAndExtract(commandString: string, explicitCwd?: string): Promise<{
  result: RunResult;
  context: { preamble: string; stderr: string };
}> {
  return new Promise((resolvePromise, rejectPromise) => {
    const startTime = Date.now();

    // Resolve cwd if provided (relative to git root)
    let resolvedCwd: string | undefined;
    if (explicitCwd) {
      try {
        const gitRoot = getGitRoot();
        if (!gitRoot) {
          rejectPromise(new Error('Not in a git repository'));
          return;
        }
        resolvedCwd = resolve(gitRoot, explicitCwd);

        // Security: Validate path is within git root
        // Normalize both paths for cross-platform comparison (Windows uses backslashes, git root may use forward slashes)
        const normalizedResolvedCwd = normalizePath(resolvedCwd);
        const normalizedGitRoot = normalizePath(gitRoot);
        if (!normalizedResolvedCwd.startsWith(normalizedGitRoot)) {
          rejectPromise(new Error(`Invalid --cwd: "${explicitCwd}" - must be within git repository`));
          return;
        }
      } catch (error) {
        rejectPromise(new Error(`Failed to resolve --cwd: ${error instanceof Error ? error.message : 'unknown error'}`));
        return;
      }
    }

    const child = spawnCommand(commandString, { cwd: resolvedCwd });

    let stdout = '';
    let stderr = '';
    const combinedLines: OutputLine[] = [];

    // Capture stdout (spawnCommand always sets stdio: ['ignore', 'pipe', 'pipe'], so stdout/stderr are guaranteed non-null)
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- spawnCommand always pipes stdout/stderr
    child.stdout!.on('data', (data: Buffer) => {
      const chunk = data.toString();
      stdout += chunk;

      // Add to combined output (ANSI-stripped)
      const lines = chunk.split('\n');
      for (const line of lines) {
        if (line) {
          combinedLines.push({
            ts: new Date().toISOString(),
            stream: 'stdout',
            line: stripAnsiCodes(line),
          });
        }
      }
    });

    // Capture stderr
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- spawnCommand always pipes stdout/stderr
    child.stderr!.on('data', (data: Buffer) => {
      const chunk = data.toString();
      stderr += chunk;

      // Add to combined output (ANSI-stripped)
      const lines = chunk.split('\n');
      for (const line of lines) {
        if (line) {
          combinedLines.push({
            ts: new Date().toISOString(),
            stream: 'stderr',
            line: stripAnsiCodes(line),
          });
        }
      }
    });

    // Handle process exit
    child.on('close', (exitCode: number = 1) => {
      const durationSecs = (Date.now() - startTime) / 1000;

      // CRITICAL: Check ONLY stdout for YAML (not stderr)
      // This prevents stderr warnings from corrupting nested YAML output
      const yamlResult = extractYamlWithPreamble(stdout);
      if (yamlResult) {
        const mergedResult = mergeNestedYaml(commandString, yamlResult.yaml, exitCode, durationSecs);

        // Include preamble and stderr for context
        const contextOutput = {
          preamble: yamlResult.preamble,
          stderr: stderr.trim(),
        };

        resolvePromise({ result: mergedResult, context: contextOutput });
        return;
      }

      // For extraction, combine both streams (stderr has useful error context)
      const combinedOutput = stdout + stderr;

      // Extract errors using smart extractor (output-based detection)
      // Token optimization: Only extract when exitCode !== 0 OR there are actual errors
      const rawExtraction = autoDetectAndExtract({
        stdout,
        stderr,
        combined: combinedOutput,
      }, exitCode);
      const extraction = (exitCode !== 0 || rawExtraction.totalErrors > 0) ? rawExtraction : undefined;

      // Get tree hash for result (async operation needs to be awaited)
      getGitTreeHash()
        .then(async treeHash => {
          // Write output files to organized temp directory
          const outputDir = getRunOutputDir(treeHash);
          await ensureDir(outputDir);

          const writePromises: Promise<void>[] = [];

          // Write stdout.log (only if non-empty)
          let stdoutFile: string | undefined;
          if (stdout.trim()) {
            stdoutFile = join(outputDir, 'stdout.log');
            writePromises.push(writeFile(stdoutFile, stdout, 'utf-8'));
          }

          // Write stderr.log (only if non-empty)
          let stderrFile: string | undefined;
          if (stderr.trim()) {
            stderrFile = join(outputDir, 'stderr.log');
            writePromises.push(writeFile(stderrFile, stderr, 'utf-8'));
          }

          // Write combined.jsonl (always)
          const combinedFile = join(outputDir, 'combined.jsonl');
          const combinedContent = combinedLines
            // eslint-disable-next-line sonarjs/no-nested-functions -- Array.map callback is standard functional programming pattern
            .map(line => JSON.stringify(line))
            .join('\n');
          writePromises.push(writeFile(combinedFile, combinedContent, 'utf-8'));

          // Wait for all writes to complete
          await Promise.all(writePromises);

          const result: RunResult = {
            command: commandString,
            exitCode,
            durationSecs,
            timestamp: new Date().toISOString(),
            treeHash,
            ...(extraction ? { extraction } : {}), // Only include extraction if needed
            outputFiles: {
              ...(stdoutFile ? { stdout: stdoutFile } : {}),
              ...(stderrFile ? { stderr: stderrFile } : {}),
              combined: combinedFile,
            },
          };

          resolvePromise({ result, context: { preamble: '', stderr: '' } });
        })
        .catch(async () => {
          // If tree hash fails, use timestamp-based fallback
          const timestamp = new Date().toISOString();
          const fallbackHash = `nogit-${Date.now()}`;

          // Write output files even without git
          const outputDir = getRunOutputDir(fallbackHash);
          await ensureDir(outputDir);

          const writePromises: Promise<void>[] = [];

          // Write stdout.log (only if non-empty)
          let stdoutFile: string | undefined;
          if (stdout.trim()) {
            stdoutFile = join(outputDir, 'stdout.log');
            writePromises.push(writeFile(stdoutFile, stdout, 'utf-8'));
          }

          // Write stderr.log (only if non-empty)
          let stderrFile: string | undefined;
          if (stderr.trim()) {
            stderrFile = join(outputDir, 'stderr.log');
            writePromises.push(writeFile(stderrFile, stderr, 'utf-8'));
          }

          // Write combined.jsonl (always)
          const combinedFile = join(outputDir, 'combined.jsonl');
          const combinedContent = combinedLines
            // eslint-disable-next-line sonarjs/no-nested-functions -- Array.map callback is standard functional programming pattern
            .map(line => JSON.stringify(line))
            .join('\n');
          writePromises.push(writeFile(combinedFile, combinedContent, 'utf-8'));

          // Wait for all writes to complete
          await Promise.all(writePromises);

          const result: RunResult = {
            command: commandString,
            exitCode,
            durationSecs,
            timestamp,
            treeHash: fallbackHash,
            ...(extraction ? { extraction } : {}), // Only include extraction if needed
            outputFiles: {
              ...(stdoutFile ? { stdout: stdoutFile } : {}),
              ...(stderrFile ? { stderr: stderrFile } : {}),
              combined: combinedFile,
            },
          };

          resolvePromise({ result, context: { preamble: '', stderr: '' } });
        });
    });

    // Handle spawn errors (e.g., command not found)
    child.on('error', (error: Error) => {
      rejectPromise(error);
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
  outerExitCode: number,
  outerDurationSecs: number
): RunResult {
  try {
    // Always parse the raw YAML first to preserve all fields
    const innerResult = yaml.parse(yamlOutput);

    // Try parsing as vibe-validate output using shared parser
    const parsed = parseVibeValidateOutput(yamlOutput);

    if (parsed) {
      // Successfully parsed nested vibe-validate output
      // Spread all inner fields to preserve custom fields (rawOutput, customField, etc.)
      // Then override with outer metadata and parsed information
      // Use command from inner result (already unwrapped by nested vibe-validate call)
      const unwrappedCommand = innerResult.command ?? outerCommand;

      return {
        ...innerResult, // Preserve ALL inner fields
        command: unwrappedCommand, // Use unwrapped command (e.g., "eslint ..." instead of "pnpm lint")
        ...(unwrappedCommand === outerCommand ? {} : { requestedCommand: outerCommand }), // Show what user requested if different
        exitCode: outerExitCode, // Override with outer exit code
        durationSecs: outerDurationSecs, // Override with outer duration
        timestamp: parsed.timestamp ?? innerResult.timestamp ?? new Date().toISOString(),
        treeHash: parsed.treeHash ?? innerResult.treeHash ?? 'unknown',
        extraction: parsed.extraction, // Use parsed extraction
        ...(parsed.isCachedResult === undefined ? {} : { isCachedResult: parsed.isCachedResult }),
        ...(parsed.fullOutputFile ? { fullOutputFile: parsed.fullOutputFile } : {}),
      };
    }

    // Not a recognized vibe-validate format - use inner command if available
    // This handles cases where the wrapper executes a command that produces non-YAML output
    const unwrappedCommand = (innerResult.command && typeof innerResult.command === 'string')
      ? innerResult.command
      : outerCommand;

    return {
      ...innerResult,
      command: unwrappedCommand, // Use inner command (unwrapped)
      ...(unwrappedCommand === outerCommand ? {} : { requestedCommand: outerCommand }), // Show what user requested if different
      exitCode: outerExitCode,
      durationSecs: outerDurationSecs,
      treeHash: innerResult.treeHash ?? 'unknown', // Use inner treeHash or fallback to unknown
    };

  // eslint-disable-next-line sonarjs/no-ignored-exceptions -- Intentional: nested vv run YAML parsing is expected to fail, fallback to extraction is correct behavior
  } catch (_error) {
    // YAML parsing failed - treat as regular output (normal for nested vv run)
    // This is expected when running nested vv run commands, so silent fallback

    // Token optimization: Only extract when exitCode !== 0 OR there are actual errors
    const rawExtraction = autoDetectAndExtract(yamlOutput);
    const extraction = (outerExitCode !== 0 || rawExtraction.totalErrors > 0) ? rawExtraction : undefined;

    return {
      command: outerCommand,
      exitCode: outerExitCode,
      durationSecs: outerDurationSecs,
      timestamp: new Date().toISOString(),
      treeHash: 'unknown',
      ...(extraction ? { extraction } : {}), // Only include extraction if needed
    };
  }
}

// Note: loadPluginsIfConfigured() has been removed.
// Plugin loading is now handled exclusively by the runner (in @vibe-validate/core)
// when executing validation. This prevents redundant plugin loading on every
// `vv run` invocation, which was causing 2.4x+ performance regression during tests.

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
# Propagates to nested vv run commands via VV_FORCE_EXECUTION env var
\`\`\`

**Working directory** (--cwd):
\`\`\`bash
$ vibe-validate run --cwd packages/cli "npm test"
# Runs command in packages/cli directory (relative to git root)
# Cache keys include working directory for correct cache hits
\`\`\`

**NEW in v0.17.0**: The \`--cwd\` flag allows running commands in subdirectories while maintaining consistent cache behavior. Paths are relative to git root, ensuring cache hits regardless of where you invoke the command.

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

# Concise (LLM-friendly) - NEW: No quotes needed!
vibe-validate run npx vitest packages/extractors/test/vitest-extractor.test.ts
\`\`\`

### Debugging Specific Tests
\`\`\`bash
# Run single test file with extraction (NEW: natural syntax)
vibe-validate run npx vitest -t 'should extract failed tests'

# Run package tests with extraction
vibe-validate run pnpm --filter @vibe-validate/extractors test

# Quoted syntax still works for compatibility
vibe-validate run "npx vitest test.ts"
\`\`\`

### Type Checking
\`\`\`bash
# Extract TypeScript errors
vibe-validate run npx tsc --noEmit
\`\`\`

### Linting
\`\`\`bash
# Extract ESLint errors (options pass through correctly)
vibe-validate run pnpm lint
vibe-validate run eslint --max-warnings 0 src/
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
vibe-validate run pnpm validate --yaml  # Works!
vibe-validate run npm test              # Works!
vibe-validate run yarn build            # Works!
\`\`\`

The YAML output on stdout remains clean and parseable, while the preamble is preserved on stderr for debugging.

## Nested Run Detection

When \`run\` wraps another vibe-validate command that outputs YAML, it automatically unwraps to show the actual command:

\`\`\`bash
# 2-level nesting
$ vibe-validate run "vibe-validate run 'npm test'"
---
command: npm test  # ← Automatically unwrapped!
exitCode: 0
extraction: {...}
\`\`\`

The \`command\` field shows the innermost command that actually executed, helping you avoid unnecessary nesting.

## Exit Codes

The \`run\` command passes through the exit code from the executed command:
- \`0\` - Command succeeded
- \`1+\` - Command failed (same code as original command)

## Examples

### Python Testing
\`\`\`bash
vv run pytest tests/ --cov=src
vv run pytest -k test_auth --verbose
vv run python -m unittest discover
\`\`\`

### Rust Testing
\`\`\`bash
vv run cargo test
vv run cargo test --all-features
vv run cargo clippy -- -D warnings
\`\`\`

### Go Testing
\`\`\`bash
vv run go test ./...
vv run go test -v -race ./pkg/...
vv run go vet ./...
\`\`\`

### Ruby Testing
\`\`\`bash
vv run bundle exec rspec
vv run bundle exec rspec spec/models/
vv run bundle exec rubocop
\`\`\`

### Node.js/TypeScript
\`\`\`bash
vv run npm test
vv run npx vitest packages/cli/test/commands/run.test.ts
vv run npx tsc --noEmit
vv run pnpm lint
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

/**
 * Show help for the run command
 */
function showRunHelp(): void {
  const cmd = getCommandName();
  console.log(`
Usage: ${cmd} run [options] <command...>

Run a command and extract LLM-friendly errors (with smart caching)

Arguments:
  command...  Command to execute (multiple words supported)

Options:
  --check             Check if cached result exists without executing
  --force             Force execution and update cache (bypass cache read)
  --cwd <directory>   Working directory relative to git root (default: git root)
  --head <lines>      Display first N lines of output after YAML (on stderr)
  --tail <lines>      Display last N lines of output after YAML (on stderr)
  --verbose           Display all output after YAML (on stderr)
  -h, --help          Display this help message

Examples:
  ${cmd} run pytest tests/ --cov=src          # Python
  ${cmd} run cargo test --all-features         # Rust
  ${cmd} run go test ./...                     # Go
  ${cmd} run npm test                          # Node.js
  ${cmd} run --cwd packages/cli npm test      # Run in subdirectory
  ${cmd} run --verbose npm test                # With output display

For detailed documentation, use: ${cmd} run --help --verbose
  `.trim());
}

/**
 * Display command output based on --head, --tail, or --verbose flags
 */
async function displayCommandOutput(
  result: RunResult,
  options: { head?: number; tail?: number; verbose?: boolean }
): Promise<void> {
  if (!result.outputFiles?.combined) {
    return;
  }

  try {
    const combinedContent = await readFile(result.outputFiles.combined, 'utf-8');
    const lines = combinedContent.trim().split('\n');
    const outputLines: OutputLine[] = lines
      .filter(line => line.trim())
      .map(line => JSON.parse(line));

    let linesToDisplay: OutputLine[];

    if (options.verbose) {
      linesToDisplay = outputLines;
    } else if (options.head) {
      linesToDisplay = outputLines.slice(0, options.head);
    } else if (options.tail) {
      linesToDisplay = outputLines.slice(-options.tail);
    } else {
      return;
    }

    // Display lines with formatting (no timestamp - available in JSONL if needed)
    // No header - YAML front matter delimiter serves as separator
    for (const line of linesToDisplay) {
      const streamColor = line.stream === 'stdout' ? chalk.gray : chalk.yellow;
      const stream = streamColor(`[${line.stream}]`);
      process.stderr.write(`${stream} ${line.line}\n`);
    }
  } catch {
    // Silently ignore errors in display - YAML output is already written
  }
}

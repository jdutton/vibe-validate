/**
 * Sandboxed Extractor Wrapper
 *
 * Wraps extractor plugins to execute in a secure sandbox when configured with 'sandbox' trust level.
 * For 'full' trust, extractors run directly without sandboxing for maximum performance.
 *
 * @package @vibe-validate/extractors
 */

import type { ExtractorTrustLevel } from './extractor-registry.js';
import { runInSandbox } from './sandbox.js';
import type { ExtractorPlugin, ErrorExtractorResult } from './types.js';

/**
 * Options for sandboxed extractor creation
 */
export interface SandboxedExtractorOptions {
  /** Trust level (default: 'sandbox') */
  trust?: ExtractorTrustLevel;

  /** Memory limit in MB for sandboxed execution (default: 128) */
  memoryLimitMB?: number;

  /** Timeout in milliseconds for sandboxed execution (default: 5000) */
  timeoutMs?: number;
}

/**
 * Wrap an extractor plugin to run in a sandbox based on trust level
 *
 * This function returns a wrapped extract function that:
 * - If trust='full': Runs the original extract function directly (no sandbox)
 * - If trust='sandbox': Runs the extract function in an isolated V8 context
 *
 * @param plugin - The extractor plugin to wrap
 * @param options - Sandbox configuration options
 * @returns Wrapped extract function that respects trust level
 *
 * @example Trusted execution (no sandbox)
 * ```typescript
 * const wrappedExtract = createSandboxedExtractor(plugin, { trust: 'full' });
 * const result = wrappedExtract('error output');
 * ```
 *
 * @example Sandboxed execution (secure)
 * ```typescript
 * const wrappedExtract = createSandboxedExtractor(plugin, { trust: 'sandbox' });
 * const result = await wrappedExtract('error output');
 * ```
 */
export function createSandboxedExtractor(
  plugin: ExtractorPlugin,
  options: SandboxedExtractorOptions = {}
  // eslint-disable-next-line no-unused-vars
): (output: string, command?: string) => Promise<ErrorExtractorResult> {
  const trust = options.trust ?? 'sandbox';
  const memoryLimitMB = options.memoryLimitMB ?? 128;
  const timeoutMs = options.timeoutMs ?? 5000;

  // If trusted, return the original extract function (wrapped in Promise for consistency)
  if (trust === 'full') {
    return async (_output: string, _command?: string) => {
      return plugin.extract(_output, _command);
    };
  }

  // Otherwise, wrap with sandbox execution
  return async (output: string, command?: string) => {
    try {
      // Serialize the extract function to string for sandbox execution
      const extractFnCode = plugin.extract.toString();

      // Create wrapped code that returns the full ErrorExtractorResult
      // The sandbox's wrapper expects 'extract' to return 'errors', so we need to return the whole result
      const sandboxCode = `
        // Extract function from plugin
        const extractFn = ${extractFnCode};

        // Wrapper that calls the extract function and returns the full result
        function extract(input) {
          const command = ${command ? JSON.stringify(command) : 'undefined'};
          const result = extractFn(input, command);

          // If result is a Promise, throw error (sandbox doesn't support async)
          if (result && typeof result.then === 'function') {
            throw new Error('Async extractors cannot be sandboxed (use trust: "full")');
          }

          // Return the full ErrorExtractorResult object
          // The sandbox wrapper will JSON.stringify this as { success: true, errors: <result> }
          return result;
        }
      `;

      // Execute in sandbox
      const sandboxResult = await runInSandbox({
        code: sandboxCode,
        input: output,
        extractorName: plugin.metadata.name,
        memoryLimitMB,
        timeoutMs,
      });

      // Check if sandbox execution succeeded
      if (!sandboxResult.success) {
        console.error(
          `[vibe-validate] Sandbox execution failed for extractor "${plugin.metadata.name}": ${sandboxResult.error}`
        );

        // Return empty result with error metadata
        return {
          errors: [],
          totalErrors: 0,
          summary: `Sandbox execution failed: ${sandboxResult.error}`,
          guidance: 'Check extractor code for syntax errors or unsafe operations',
          metadata: {
            detection: {
              extractor: plugin.metadata.name,
              confidence: 0,
              patterns: [],
              reason: `Sandbox execution error: ${sandboxResult.error}`,
            },
            confidence: 0,
            completeness: 0,
            issues: [`Sandbox execution failed: ${sandboxResult.error}`],
          },
        };
      }

      // Sandbox returns the full ErrorExtractorResult in the 'errors' field
      // (The sandbox's wrapper puts the return value of extract() into the 'errors' field)
      if (!sandboxResult.errors) {
        return {
          errors: [],
          totalErrors: 0,
          summary: 'Invalid sandbox result structure',
          guidance: 'Extractor must return ErrorExtractorResult object',
          metadata: {
            detection: {
              extractor: plugin.metadata.name,
              confidence: 0,
              patterns: [],
              reason: 'Invalid result structure from sandbox',
            },
            confidence: 0,
            completeness: 0,
            issues: ['Sandbox returned invalid result structure'],
          },
        };
      }

      // Validate that sandboxResult.errors is a valid ErrorExtractorResult
      const extractorResult = sandboxResult.errors as unknown as ErrorExtractorResult;

      // Check for required fields
      if (!extractorResult.errors || !Array.isArray(extractorResult.errors)) {
        return {
          errors: [],
          totalErrors: 0,
          summary: 'Invalid extractor result: missing or invalid errors array',
          guidance: 'Extractor must return ErrorExtractorResult with errors array',
          metadata: {
            detection: {
              extractor: plugin.metadata.name,
              confidence: 0,
              patterns: [],
              reason: 'Invalid ErrorExtractorResult structure',
            },
            confidence: 0,
            completeness: 0,
            issues: ['Extractor returned invalid ErrorExtractorResult (missing errors array)'],
          },
        };
      }

      // sandboxResult.errors is the full ErrorExtractorResult from the plugin
      return extractorResult;
    } catch (error) {
      // Handle unexpected errors
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(
        `[vibe-validate] Unexpected error wrapping extractor "${plugin.metadata.name}": ${errorMessage}`
      );

      // Return empty result with error metadata
      return {
        errors: [],
        totalErrors: 0,
        summary: `Extractor wrapper error: ${errorMessage}`,
        guidance: 'Check extractor code and sandbox configuration',
        metadata: {
          detection: {
            extractor: plugin.metadata.name,
            confidence: 0,
            patterns: [],
            reason: `Wrapper error: ${errorMessage}`,
          },
          confidence: 0,
          completeness: 0,
          issues: [`Wrapper error: ${errorMessage}`],
        },
      };
    }
  };
}

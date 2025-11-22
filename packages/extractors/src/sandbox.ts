/**
 * Sandbox Module for Secure Extractor Execution
 *
 * Uses isolated-vm to run extractor plugins in a secure V8 Isolate.
 * This provides true security isolation by preventing access to Node.js APIs
 * and limiting memory/CPU usage.
 *
 * @see docs/sandbox-research.md for detailed architecture and security model
 */

import type { FormattedError } from './types.js';

// Lazy-load isolated-vm (CommonJS module)
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- isolated-vm has no types
let ivm: any;
async function getIVM() {
  if (!ivm) {
    try {
      // isolated-vm is CommonJS, use dynamic import and createRequire
      const { createRequire } = await import('node:module');
      const require = createRequire(import.meta.url);
      ivm = require('isolated-vm');
    } catch {
      // If isolated-vm is not installed, throw helpful error
      throw new Error(
        'isolated-vm is required for sandbox execution. Install with: pnpm add isolated-vm'
      );
    }
  }
  return ivm;
}

export interface SandboxOptions {
  /**
   * Memory limit in MB (default: 128)
   * Prevents memory exhaustion attacks
   */
  memoryLimitMB?: number;

  /**
   * Execution timeout in milliseconds (default: 5000)
   * Prevents infinite loop attacks
   */
  timeoutMs?: number;

  /**
   * Extractor function code to execute
   * Must define a function named 'extract' that takes string input
   */
  code: string;

  /**
   * Input data to pass to the extractor
   * This is the command output to parse for errors
   */
  input: string;

  /**
   * Extractor name for debugging/logging
   */
  extractorName: string;
}

export interface SandboxResult {
  /**
   * Whether execution succeeded without errors
   */
  success: boolean;

  /**
   * Extracted errors if successful
   */
  errors?: FormattedError[];

  /**
   * Error message if execution failed
   */
  error?: string;

  /**
   * Execution statistics
   */
  stats: {
    /**
     * Execution duration in milliseconds
     */
    durationMs: number;

    /**
     * Peak memory usage in MB
     */
    memoryUsedMB: number;
  };
}

/**
 * Error thrown when sandbox execution fails
 */
export class SandboxExecutionError extends Error {
  constructor(
    message: string,
    public readonly extractorName: string,
    public readonly _cause?: unknown
  ) {
    super(`Sandbox execution failed for ${extractorName}: ${message}`);
    this.name = 'SandboxExecutionError';
  }
}

/**
 * Run extractor code in a secure V8 Isolate
 *
 * Security features:
 * - Isolated V8 heap (no access to Node.js globals)
 * - Memory limit enforcement
 * - Execution timeout protection
 * - No filesystem, network, or process access
 *
 * @param options - Sandbox configuration
 * @returns Result containing extracted errors or error details
 *
 * @example
 * ```typescript
 * const result = await runInSandbox({
 *   code: 'function extract(input) { return []; }',
 *   input: 'error output',
 *   extractorName: 'test-extractor'
 * });
 *
 * if (result.success) {
 *   console.log('Extracted errors:', result.errors);
 * } else {
 *   console.error('Execution failed:', result.error);
 * }
 * ```
 */
export async function runInSandbox(
  options: SandboxOptions
): Promise<SandboxResult> {
  const startTime = performance.now();
  const ivm = await getIVM();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- isolated-vm has no types
  let isolate: any;

  try {
    // Create V8 Isolate with memory limit
    isolate = new ivm.Isolate({
      memoryLimit: options.memoryLimitMB ?? 128
    });

    const context = await isolate.createContext();

    // Wrap extractor code to return JSON-serializable result
    const wrappedCode = `
      ${options.code}

      function __executeExtractor(input) {
        try {
          const errors = extract(input);
          return JSON.stringify({ success: true, errors });
        } catch (error) {
          return JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }
    `;

    // Compile code (cached by V8)
    const script = await isolate.compileScript(wrappedCode);
    await script.run(context);

    // Transfer input to isolate (copy, don't share reference)
    const inputCopy = new ivm.ExternalCopy(options.input);
    await context.global.set('input', inputCopy.copyInto());

    // Execute with timeout
    const resultJson = await context.eval(
      '__executeExtractor(input)',
      {
        timeout: options.timeoutMs ?? 5000,
        promise: true
      }
    );

    const result = JSON.parse(resultJson);

    // Get memory stats before disposal
    const heapStats = isolate.getHeapStatisticsSync();
    const memoryUsedMB = heapStats.used_heap_size / 1024 / 1024;

    isolate.dispose();

    const durationMs = performance.now() - startTime;

    if (!result.success) {
      return {
        success: false,
        error: result.error,
        stats: {
          durationMs,
          memoryUsedMB
        }
      };
    }

    return {
      success: true,
      errors: result.errors ?? [],
      stats: {
        durationMs,
        memoryUsedMB
      }
    };
  } catch (error) {
    // Clean up isolate on error
    if (isolate) {
      try {
        isolate.dispose();
      } catch {
        // Ignore disposal errors
      }
    }

    const durationMs = performance.now() - startTime;

    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      stats: {
        durationMs,
        memoryUsedMB: 0
      }
    };
  }
}

/**
 * Create sandboxed code from an extractor function
 *
 * Converts a regular function to a string that can be executed in the sandbox.
 * The function must:
 * - Be named 'extract'
 * - Take a single string parameter
 * - Return ExtractedError[]
 *
 * @param extractFn - The extractor function to sandbox
 * @returns Sandboxed code string
 *
 * @example
 * ```typescript
 * function extract(content: string): ExtractedError[] {
 *   const errors = [];
 *   const pattern = /ERROR: (.+)/g;
 *   let match;
 *   while ((match = pattern.exec(content)) !== null) {
 *     errors.push({ message: match[1], severity: 'error' });
 *   }
 *   return errors;
 * }
 *
 * const code = createSandboxedCode(extract);
 * // code is now a string that can be passed to runInSandbox
 * ```
 */
export function createSandboxedCode(
  extractFn: (_content: string) => FormattedError[]
): string {
  // Convert function to string and rename to 'extract' if needed
  const fnString = extractFn.toString();

  // Check if function is already named 'extract'
  if (fnString.startsWith('function extract(')) {
    return fnString;
  }

  // Anonymous or arrow function - wrap it
  if (fnString.startsWith('(') || fnString.includes('=>')) {
    return `function extract(content) { return (${fnString})(content); }`;
  }

  // Named function - extract body and create 'extract' wrapper
  const functionPattern = /function\s+\w+\s*\([^)]*\)\s*{([\s\S]*)}$/;
  const bodyMatch = functionPattern.exec(fnString);
  if (bodyMatch) {
    return `function extract(content) { ${bodyMatch[1]} }`;
  }

  // Fallback - assume it's valid code
  return fnString;
}

/**
 * Performance statistics for sandbox operations
 * Used for monitoring and optimization
 */
export interface SandboxStats {
  totalExecutions: number;
  successfulExecutions: number;
  failedExecutions: number;
  averageDurationMs: number;
  averageMemoryUsedMB: number;
}

/**
 * Sandbox performance tracker
 * Collects statistics across multiple executions
 */
export class SandboxStatsCollector {
  private stats: SandboxStats = {
    totalExecutions: 0,
    successfulExecutions: 0,
    failedExecutions: 0,
    averageDurationMs: 0,
    averageMemoryUsedMB: 0
  };

  private totalDurationMs = 0;
  private totalMemoryUsedMB = 0;

  /**
   * Record a sandbox execution result
   */
  record(result: SandboxResult): void {
    this.stats.totalExecutions++;

    if (result.success) {
      this.stats.successfulExecutions++;
    } else {
      this.stats.failedExecutions++;
    }

    this.totalDurationMs += result.stats.durationMs;
    this.totalMemoryUsedMB += result.stats.memoryUsedMB;

    // Update averages
    this.stats.averageDurationMs =
      this.totalDurationMs / this.stats.totalExecutions;
    this.stats.averageMemoryUsedMB =
      this.totalMemoryUsedMB / this.stats.totalExecutions;
  }

  /**
   * Get current statistics
   */
  getStats(): Readonly<SandboxStats> {
    return { ...this.stats };
  }

  /**
   * Reset statistics
   */
  reset(): void {
    this.stats = {
      totalExecutions: 0,
      successfulExecutions: 0,
      failedExecutions: 0,
      averageDurationMs: 0,
      averageMemoryUsedMB: 0
    };
    this.totalDurationMs = 0;
    this.totalMemoryUsedMB = 0;
  }
}

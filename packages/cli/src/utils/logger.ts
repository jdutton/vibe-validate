/**
 * Structured logging for vibe-validate
 *
 * Logs are only output when VV_DEBUG=1 environment variable is set.
 * This provides visibility into silent failures without cluttering production output.
 */

export type LogCategory =
  | 'cache'
  | 'validation'
  | 'git'
  | 'config'
  | 'extraction'
  | 'perf';

export interface LogContext {
  category: LogCategory;
  message: string;
  error?: Error;
  metadata?: Record<string, unknown>;
}

/**
 * Log a debug message
 * Only outputs when VV_DEBUG=1
 *
 * @example
 * ```typescript
 * logDebug('cache', 'Cache lookup', { treeHash, cacheKey });
 * ```
 */
export function logDebug(category: LogCategory, message: string, metadata?: Record<string, unknown>): void {
  if (process.env.VV_DEBUG === '1') {
    const timestamp = new Date().toISOString();
    console.error(`[${timestamp}] [DEBUG] [${category}] ${message}`);
    if (metadata) {
      console.error(JSON.stringify(metadata, null, 2));
    }
  }
}

/**
 * Log a warning (non-critical error)
 * Only outputs when VV_DEBUG=1
 *
 * @example
 * ```typescript
 * logWarning('cache', 'Cache lookup failed - proceeding with execution', error);
 * ```
 */
export function logWarning(category: LogCategory, message: string, error?: Error): void {
  if (process.env.VV_DEBUG === '1') {
    const timestamp = new Date().toISOString();
    console.error(`[${timestamp}] [WARN] [${category}] ${message}`);
    if (error) {
      console.error(`Error: ${error.message}`);
      if (error.stack) {
        console.error(error.stack);
      }
    }
  }
}

/**
 * Log an error (critical failure)
 * Always outputs, even without VV_DEBUG
 *
 * @example
 * ```typescript
 * logError('validation', 'Failed to load config', error);
 * ```
 */
export function logError(category: LogCategory, message: string, error?: Error): void {
  const timestamp = new Date().toISOString();
  console.error(`[${timestamp}] [ERROR] [${category}] ${message}`);
  if (error) {
    console.error(`Error: ${error.message}`);
    if (error.stack) {
      console.error(error.stack);
    }
  }
}

/**
 * Performance timing helper for VV_DEBUG instrumentation
 *
 * Creates a timer that logs elapsed time for operations.
 * Zero overhead when VV_DEBUG is not set (returns no-op functions).
 *
 * If an operation exceeds its threshold, logs a LOUD warning to stderr
 * regardless of VV_DEBUG setting — these indicate performance regressions.
 *
 * @example
 * ```typescript
 * const timer = createPerfTimer('validate');
 * // ... do work ...
 * timer.mark('config loaded');
 * // ... do more work ...
 * timer.mark('tree hash computed');
 * timer.done(); // logs full breakdown
 * ```
 */
export interface PerfTimer {
  /** Record a timing mark with label */
  mark(label: string): void;
  /** Record a timing mark and warn if elapsed since last mark exceeds threshold (ms) */
  markWithThreshold(label: string, thresholdMs: number): void;
  /** Log the full timing breakdown (VV_DEBUG only) */
  done(): void;
}

const PERF_DEBUG = process.env.VV_DEBUG === '1';

export function createPerfTimer(context: string): PerfTimer {
  if (!PERF_DEBUG) {
    // Return no-op timer — zero overhead when debug is off.
    // Still check thresholds so regressions are caught regardless of debug mode.
    const startTime = Date.now();
    let lastTime = startTime;
    return {
      mark() { lastTime = Date.now(); },
      markWithThreshold(label: string, thresholdMs: number) {
        const now = Date.now();
        const delta = now - lastTime;
        if (delta > thresholdMs) {
          console.error(`[PERF WARNING] [${context}] ${label} took ${delta}ms (threshold: ${thresholdMs}ms)`);
        }
        lastTime = now;
      },
      done() { /* no-op */ },
    };
  }

  const startTime = Date.now();
  let lastTime = startTime;
  const marks: Array<{ label: string; elapsed: number; delta: number }> = [];

  return {
    mark(label: string) {
      const now = Date.now();
      marks.push({ label, elapsed: now - startTime, delta: now - lastTime });
      lastTime = now;
    },
    markWithThreshold(label: string, thresholdMs: number) {
      const now = Date.now();
      const delta = now - lastTime;
      marks.push({ label, elapsed: now - startTime, delta });
      if (delta > thresholdMs) {
        console.error(`[PERF WARNING] [${context}] ${label} took ${delta}ms (threshold: ${thresholdMs}ms)`);
      }
      lastTime = now;
    },
    done() {
      const total = Date.now() - startTime;
      console.error(`[DEBUG] [perf] [${context}] total=${total}ms`);
      for (const m of marks) {
        console.error(`  ${m.label.padEnd(35)} +${m.delta}ms (${m.elapsed}ms)`);
      }
    },
  };
}

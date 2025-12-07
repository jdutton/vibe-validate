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
  | 'extraction';

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

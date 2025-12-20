/**
 * Filesystem utilities for vibe-validate
 *
 * Provides shared filesystem operations used across the codebase:
 * - Directory creation with error handling
 * - Temp directory path generation
 * - File creation utilities
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import { normalizedTmpdir } from '@vibe-validate/utils';


/**
 * Ensure a directory exists (create if needed)
 *
 * Creates the directory and any necessary parent directories.
 * Ignores EEXIST errors if the directory already exists.
 *
 * @param dirPath - Path to directory to ensure exists
 * @throws Error if directory creation fails for reasons other than already existing
 *
 * @example
 * ```typescript
 * await ensureDir('/tmp/my-app/logs');
 * // Directory now exists, ready to write files
 * ```
 */
export async function ensureDir(dirPath: string): Promise<void> {
  try {
    await mkdir(dirPath, { recursive: true });
  } catch (err: unknown) {
    // Ignore if directory already exists
    if (err && typeof err === 'object' && 'code' in err && err.code !== 'EEXIST') {
      throw err;
    }
  }
}

/**
 * Generate organized temp directory path with timestamp and hash
 *
 * Creates a path structure like:
 * /tmp/vibe-validate/{baseDir}/{YYYY-MM-DD}/{shortHash-HH-mm-ss-suffix}/
 *
 * @param baseDir - Base directory name (e.g., 'runs', 'steps')
 * @param treeHash - Git tree hash or identifier
 * @param suffix - Optional suffix to append (e.g., step name)
 * @returns Full path to temp directory
 *
 * @example
 * ```typescript
 * // For run output
 * const runDir = getTempDir('runs', 'abc123def456');
 * // Returns: /tmp/vibe-validate/runs/2025-11-10/abc123-17-30-45/
 *
 * // For step output
 * const stepDir = getTempDir('steps', 'abc123def456', 'typecheck');
 * // Returns: /tmp/vibe-validate/steps/2025-11-10/abc123-17-30-45-typecheck/
 * ```
 */
export function getTempDir(
  baseDir: string,
  treeHash: string,
  suffix?: string
): string {
  const now = new Date();

  // Date folder: YYYY-MM-DD
  const dateFolder = now.toISOString().split('T')[0];

  // Short hash: first 6 chars
  const shortHash = treeHash.substring(0, 6);

  // Time suffix: HH-mm-ss
  const timeSuffix = now.toISOString().split('T')[1].substring(0, 8).replaceAll(':', '-');

  // Combined folder name
  let folderName = `${shortHash}-${timeSuffix}`;
  if (suffix) {
    // Sanitize suffix for filesystem
    const safeSuffix = suffix.replaceAll(/[^a-zA-Z0-9]/g, '-').toLowerCase();
    folderName += `-${safeSuffix}`;
  }

  return join(normalizedTmpdir(), 'vibe-validate', baseDir, dateFolder, folderName);
}

/**
 * Write a log file only if content is non-empty
 *
 * Helper to conditionally write log files, avoiding empty file creation.
 *
 * @param content - Content to write
 * @param outputDir - Directory to write file in
 * @param filename - Name of the log file
 * @returns Object with file path (if written) and write promise (if needed)
 *
 * @example
 * ```typescript
 * const writePromises: Promise<void>[] = [];
 *
 * const { file: stdoutFile, promise: stdoutPromise } =
 *   createLogFileWrite(stdout, outputDir, 'stdout.log');
 * if (stdoutPromise) writePromises.push(stdoutPromise);
 *
 * await Promise.all(writePromises);
 * ```
 */
export function createLogFileWrite(
  content: string,
  outputDir: string,
  filename: string
): { file: string | undefined; promise: Promise<void> | null } {
  if (!content.trim()) {
    return { file: undefined, promise: null };
  }

  const file = join(outputDir, filename);
  return {
    file,
    promise: writeFile(file, content, 'utf-8'),
  };
}

/**
 * Create timestamped combined.jsonl content
 *
 * Converts an array of timestamped output lines into JSONL format
 * for storage as combined.jsonl file.
 *
 * @param lines - Array of timestamped output lines
 * @returns JSONL string (one JSON object per line)
 *
 * @example
 * ```typescript
 * const lines = [
 *   { ts: '2025-11-10T17:30:45.123Z', stream: 'stdout', line: 'Starting...' },
 *   { ts: '2025-11-10T17:30:46.456Z', stream: 'stderr', line: 'Warning!' }
 * ];
 * const jsonl = createCombinedJsonl(lines);
 * // Returns:
 * // {"ts":"2025-11-10T17:30:45.123Z","stream":"stdout","line":"Starting..."}
 * // {"ts":"2025-11-10T17:30:46.456Z","stream":"stderr","line":"Warning!"}
 * ```
 */
export function createCombinedJsonl(
  lines: Array<{ ts: string; stream: 'stdout' | 'stderr'; line: string }>
): string {
  return lines.map(line => JSON.stringify(line)).join('\n');
}

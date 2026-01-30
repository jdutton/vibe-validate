/**
 * Common utilities for tools/ scripts
 *
 * Shared code to eliminate duplication across tool scripts.
 */

import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { safeExecResult } from '../../utils/dist/safe-exec.js';

/**
 * Get __filename equivalent in ESM
 */
export function getFilename(importMetaUrl: string): string {
  return fileURLToPath(importMetaUrl);
}

/**
 * Get __dirname equivalent in ESM
 */
export function getDirname(importMetaUrl: string): string {
  return dirname(fileURLToPath(importMetaUrl));
}

/**
 * Project root directory (3 levels up from packages/dev-tools/src/)
 */
export const PROJECT_ROOT = join(getDirname(import.meta.url), '../../..');

/**
 * ANSI color codes for terminal output
 */
export const colors = {
  red: '\x1b[0;31m',
  green: '\x1b[0;32m',
  yellow: '\x1b[1;33m',
  blue: '\x1b[0;34m',
  cyan: '\x1b[0;36m',
  reset: '\x1b[0m',
} as const;

export type Color = keyof typeof colors;

/**
 * Log a message with optional color
 */
export function log(message: string, color: Color = 'reset'): void {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

/**
 * Get the version of a package for a specific npm dist-tag
 * @param packageName - Package name (e.g., 'vibe-validate', '@vibe-validate/cli')
 * @param tag - npm dist-tag (e.g., 'latest', 'next')
 * @returns Version string or null if not found
 */
export function getNpmTagVersion(packageName: string, tag: string): string | null {
  const result = safeExecResult('npm', ['view', `${packageName}@${tag}`, 'version'], {
    encoding: 'utf8',
    stdio: 'pipe',
  });

  if (result.status === 0 && result.stdout) {
    // stdout is string when encoding: 'utf8' is specified
    return result.stdout.toString().trim();
  }

  return null;
}

/**
 * Result from processing a workspace package
 */
export interface PackageProcessResult {
  name: string;
  skipped: boolean;
  reason?: string;
  version?: string;
  [key: string]: unknown; // Allow processor-specific fields
}

/**
 * Format skip reason text consistently
 */
function formatSkipReason(reason: string, version?: string): string {
  if (reason === 'no-version') {
    return 'no version field';
  }
  return version ? `${reason}, v${version}` : reason;
}

/**
 * Process all workspace packages with a custom processor function
 * @param processor - Function to process each package
 * @param onSuccess - Callback for successful processing
 * @param onSkip - Callback for skipped packages
 * @param onError - Callback for errors (optional, defaults to exit)
 * @returns Counts object { processed: number, skipped: number }
 */
export function processWorkspacePackages<T extends PackageProcessResult>(
  processor: (_pkgPath: string, _pkgName: string) => T,
  onSuccess: (_result: T) => void,
  onSkip: (_result: T) => void,
  onError?: (_pkgName: string, _error: Error) => void
): { processed: number; skipped: number } {
  const packagesDir = join(PROJECT_ROOT, 'packages');
  let processedCount = 0;
  let skippedCount = 0;

  try {
    const packages = readdirSync(packagesDir, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory())
      .map(dirent => dirent.name)
      .sort((a, b) => a.localeCompare(b));

    for (const pkg of packages) {
      const pkgPath = join(packagesDir, pkg, 'package.json');
      try {
        const result = processor(pkgPath, pkg);

        if (result.skipped) {
          const reasonText = formatSkipReason(result.reason ?? 'unknown', result.version);
          log(`  - ${result.name}: skipped (${reasonText})`, 'yellow');
          onSkip(result);
          skippedCount++;
        } else {
          onSuccess(result);
          processedCount++;
        }
      } catch (error) {
        if (onError) {
          onError(pkg, error as Error);
        } else {
          log(`  ✗ ${pkg}: ${(error as Error).message}`, 'red');
          process.exit(1);
        }
      }
    }
  } catch (error) {
    log(`✗ Failed to read packages directory: ${(error as Error).message}`, 'red');
    process.exit(1);
  }

  return { processed: processedCount, skipped: skippedCount };
}

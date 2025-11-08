#!/usr/bin/env node
/**
 * Smart vibe-validate wrapper with context-aware execution
 *
 * Automatically detects execution context and delegates to appropriate binary:
 * - Developer mode: Inside vibe-validate repo → packages/cli/dist/bin.js (unpackaged dev build)
 * - Local install: Project has vibe-validate → node_modules version (packaged)
 * - Global install: Fallback → globally installed version (packaged)
 *
 * Works in both git and non-git directories. Non-git directories don't get
 * caching but still get error extraction.
 */

import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Find project root by walking up to .git directory
 * Falls back to startDir if no git repo found
 *
 * @param startDir - Directory to start searching from
 * @returns Project root directory path
 */
function findProjectRoot(startDir: string): string {
  let current = startDir;

  while (true) {
    const gitDir = join(current, '.git');
    if (existsSync(gitDir)) {
      return current; // Found git repo
    }

    const parent = dirname(current);
    if (parent === current) {
      // Reached filesystem root, no git found
      return startDir;
    }
    current = parent;
  }
}

/**
 * Check if we're in vibe-validate repo (developer mode)
 * Simple detection: both dist/vibe-validate and dist/bin.js must exist
 *
 * @param projectRoot - Root directory of the project
 * @returns Path to bin.js if detected, null otherwise
 */
function getDevModeBinary(projectRoot: string): string | null {
  const wrapperPath = join(projectRoot, 'packages/cli/dist/vibe-validate');
  const binPath = join(projectRoot, 'packages/cli/dist/bin.js');

  // Both files must exist to confirm we're in vibe-validate repo
  if (existsSync(wrapperPath) && existsSync(binPath)) {
    return binPath;
  }

  return null;
}

/**
 * Find local vibe-validate installation in node_modules
 * Walks up directory tree from project root
 *
 * @param projectRoot - Root directory to start searching from
 * @returns Path to local bin.js if found, null otherwise
 */
function findLocalInstall(projectRoot: string): string | null {
  let current = projectRoot;

  while (true) {
    const localBin = join(current, 'node_modules/@vibe-validate/cli/dist/bin.js');
    if (existsSync(localBin)) {
      return localBin;
    }

    const parent = dirname(current);
    if (parent === current) {
      // Reached filesystem root
      break;
    }
    current = parent;
  }

  return null;
}

/**
 * Main entry point - detects context and executes appropriate binary
 */
function main(): void {
  const cwd = process.cwd();
  const args = process.argv.slice(2);

  // Find project root (where .git is, or cwd if no git)
  const projectRoot = findProjectRoot(cwd);

  let binPath: string;
  let context: 'dev' | 'local' | 'global';

  // Priority 1: Check for developer mode (inside vibe-validate repo)
  const devBin = getDevModeBinary(projectRoot);
  if (devBin) {
    binPath = devBin;
    context = 'dev';
  }
  // Priority 2: Check for local install (node_modules)
  else {
    const localBin = findLocalInstall(projectRoot);
    if (localBin) {
      binPath = localBin;
      context = 'local';
    }
    // Priority 3: Use global install (this script's location)
    else {
      binPath = join(__dirname, '../bin.js');
      context = 'global';
    }
  }

  // Execute the binary with all arguments
  const result: SpawnSyncReturns<Buffer> = spawnSync(
    process.execPath,
    [binPath, ...args],
    {
      stdio: 'inherit',
      env: {
        ...process.env,
        VV_CONTEXT: context, // Pass context for debugging (optional)
      },
    }
  );

  // Exit with same code as child process
  const exitCode: number = result.status ?? 1;
  process.exit(exitCode);
}

// Run main function
main();

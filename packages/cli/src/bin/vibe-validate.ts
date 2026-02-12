#!/usr/bin/env node
/**
 * Smart vibe-validate wrapper with context-aware execution
 *
 * Automatically detects execution context and delegates to appropriate binary:
 * - Developer mode: Inside vibe-validate repo → packages/cli/dist/bin.js (unpackaged dev build)
 * - Local install: Project has vibe-validate → node_modules version (packaged)
 * - Global install: Fallback → globally installed version (packaged)
 *
 * Features:
 * - Version detection and comparison
 * - Gentle warnings when global is outdated
 * - Debug mode (VV_DEBUG=1) shows resolution details
 *
 * Works in both git and non-git directories. Non-git directories don't get
 * caching but still get error extraction.
 */

import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
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
  const wrapperPath = join(projectRoot, 'packages/cli/dist/bin/vibe-validate');
  const binPath = join(projectRoot, 'packages/cli/dist/bin.js');

  if (process.env.VV_DEBUG === '1') {
    console.error(`[vv debug] Dev check - wrapper: ${wrapperPath} (${existsSync(wrapperPath)})`);
    console.error(`[vv debug] Dev check - bin: ${binPath} (${existsSync(binPath)})`);
  }

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
 * Read version from package.json
 * @param packageJsonPath - Path to package.json file
 * @returns Version string or null if not found
 */
function readVersion(packageJsonPath: string): string | null {
  try {
    if (!existsSync(packageJsonPath)) {
      return null;
    }
    const content = readFileSync(packageJsonPath, 'utf-8');
    const pkg = JSON.parse(content);
    return pkg.version ?? null;
  } catch {
    return null;
  }
}


/**
 * Resolve binary path using priority chain
 *
 * Priority order:
 * 0. VV_ROOT_DIR env override (developer testing dev build against other projects)
 * 1. Developer mode (inside vibe-validate repo itself)
 * 2. Local install (node_modules)
 * 3. Global install (this script's own location)
 */
function resolveBinary(projectRoot: string, debug: boolean): { binPath: string; context: string; binDir: string } {
  // Priority 0: VV_ROOT_DIR override (developer testing against other projects)
  // Usage: VV_ROOT_DIR=~/Workspaces/vibe-validate vv validate
  const vvRootDir = process.env.VV_ROOT_DIR;
  if (vvRootDir) {
    const overrideBin = join(vvRootDir, 'packages/cli/dist/bin.js');
    if (existsSync(overrideBin)) {
      if (debug) {
        console.error(`[vv debug] VV_ROOT_DIR override: ${vvRootDir}`);
      }
      return { binPath: overrideBin, context: 'dev-override', binDir: dirname(dirname(overrideBin)) };
    }
    console.error(`[vv warn] VV_ROOT_DIR=${vvRootDir} but ${overrideBin} not found — falling back`);
  }

  // Priority 1: Developer mode (inside vibe-validate repo)
  const devBin = getDevModeBinary(projectRoot);
  if (devBin) {
    return { binPath: devBin, context: 'dev', binDir: dirname(dirname(devBin)) };
  }

  // Priority 2: Local install (node_modules)
  const localBin = findLocalInstall(projectRoot);
  if (localBin) {
    return { binPath: localBin, context: 'local', binDir: dirname(dirname(localBin)) };
  }

  // Priority 3: Global install (this script's location)
  return { binPath: join(__dirname, '../bin.js'), context: 'global', binDir: dirname(__dirname) };
}

/**
 * Main entry point - detects context and executes appropriate binary
 */
function main(): void {
  const cwd = process.cwd();
  const args = process.argv.slice(2);
  const debug = process.env.VV_DEBUG === '1';

  // Find project root (where .git is, or cwd if no git)
  const projectRoot = findProjectRoot(cwd);

  const { binPath, context, binDir } = resolveBinary(projectRoot, debug);

  // Read versions for comparison
  // __dirname = dist/bin, so go up twice to reach package.json at cli root
  const globalPkgPath = join(dirname(dirname(__dirname)), 'package.json');
  const globalVersion = readVersion(globalPkgPath);

  let localVersion: string | null = null;
  if (context === 'local') {
    const localPkgPath = join(binDir, 'package.json');
    localVersion = readVersion(localPkgPath);
  }

  // Debug output
  if (debug) {
    console.error(`[vv debug] CWD: ${cwd}`);
    console.error(`[vv debug] Project root: ${projectRoot}`);
    console.error(`[vv debug] Context: ${context}`);
    console.error(`[vv debug] Binary: ${binPath}`);
    console.error(`[vv debug] Global version: ${globalVersion ?? 'unknown'}`);
    console.error(`[vv debug] Local version: ${localVersion ?? 'N/A'}`);
    console.error(`[vv debug] Args: ${args.join(' ')}`);
  }

  // Determine command name from how this wrapper was invoked
  // Extract basename (e.g., "vv" from "/usr/local/bin/vv")
  const commandName = __filename.includes('vv') ? 'vv' : 'vibe-validate';

  // Execute the binary with all arguments
  const result: SpawnSyncReturns<Buffer> = spawnSync(
    process.execPath,
    [binPath, ...args],
    {
      stdio: 'inherit',
      env: {
        ...process.env,
        VV_CONTEXT: context, // Pass context for debugging
        VV_COMMAND_NAME: commandName, // Pass original command name
      },
    }
  );

  // Exit with same code as child process
  const exitCode: number = result.status ?? 1;
  process.exit(exitCode);
}

// Run main function
main();

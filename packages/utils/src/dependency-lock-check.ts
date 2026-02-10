/**
 * Dependency Lock File Check
 *
 * Verifies that lock files are in sync with package.json to prevent cache poisoning.
 * Supports npm, pnpm, yarn, and bun package managers with auto-detection.
 */

import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { safeExecResult } from './safe-exec.js';

/**
 * Supported package managers
 */
export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';

/**
 * Skip reasons for dependency check
 */
export type SkipReason = 'npm-link' | 'env-var' | 'no-lock-file';

/**
 * Result of dependency lock file check
 */
export interface DependencyCheckResult {
  /** Whether the check passed (lock file in sync) */
  passed: boolean;
  /** Whether the check was skipped */
  skipped: boolean;
  /** Reason for skipping the check */
  skipReason?: SkipReason;
  /** List of linked packages (if npm link detected) */
  linkedPackages?: string[];
  /** Error message if check failed */
  error?: string;
  /** Package manager used for check */
  packageManager?: PackageManager;
  /** Command executed for verification */
  command?: string;
  /** Duration of check in milliseconds */
  duration: number;
}

/**
 * Lock file names for each package manager
 */
const LOCK_FILES: Record<PackageManager, string> = {
  bun: 'bun.lockb',
  yarn: 'yarn.lock',
  pnpm: 'pnpm-lock.yaml',
  npm: 'package-lock.json',
};

/**
 * Priority order for lock file detection (most specific first)
 */
const DETECTION_PRIORITY: PackageManager[] = ['bun', 'yarn', 'pnpm', 'npm'];

/**
 * Detect package manager from git root directory
 *
 * Detection strategy:
 * 1. Check config override first (if provided)
 * 2. Read package.json for packageManager field
 * 3. Check for lock files in priority order (bun → yarn → pnpm → npm)
 *
 * @param gitRoot - Git repository root path
 * @param configPackageManager - Optional package manager from config
 * @returns Detected package manager or null if none found
 *
 * @example
 * const pm = detectPackageManager('/path/to/repo');
 * console.log(pm); // 'pnpm' or 'npm' or null
 *
 * @example
 * // With config override
 * const pm = detectPackageManager('/path/to/repo', 'yarn');
 * console.log(pm); // 'yarn'
 */
export function detectPackageManager(
  gitRoot: string,
  configPackageManager?: PackageManager
): PackageManager | null {
  // 1. Config override takes precedence
  if (configPackageManager) {
    return configPackageManager;
  }

  // 2. Check package.json packageManager field
  const packageJsonPath = join(gitRoot, 'package.json');
  if (existsSync(packageJsonPath)) {
    try {
      const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
      if (packageJson.packageManager) {
        // Format: "pnpm@8.6.0" or "npm@9.0.0"
        const match = packageJson.packageManager.match(/^(npm|pnpm|yarn|bun)@/);
        if (match) {
          return match[1] as PackageManager;
        }
      }
    } catch {
      // Ignore parse errors, fall through to lock file detection
    }
  }

  // 3. Check for lock files in priority order
  for (const pm of DETECTION_PRIORITY) {
    const lockFile = join(gitRoot, LOCK_FILES[pm]);
    if (existsSync(lockFile)) {
      return pm;
    }
  }

  return null;
}

/**
 * Check if path is a symlink (safe, ignores errors)
 */
function isSymlink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

/**
 * Find linked packages in scoped directory (@org/*)
 */
function findScopedLinkedPackages(scopePath: string, scopeName: string): string[] {
  const linked: string[] = [];

  try {
    const scopedEntries = readdirSync(scopePath, { withFileTypes: true });
    for (const scopedEntry of scopedEntries) {
      const scopedPath = join(scopePath, scopedEntry.name);
      if (isSymlink(scopedPath)) {
        linked.push(`${scopeName}/${scopedEntry.name}`);
      }
    }
  } catch {
    // Ignore readdir errors for scoped directory
  }

  return linked;
}

/**
 * Detect linked packages (npm link) in node_modules
 *
 * Uses lstatSync to check for symlinks (cross-platform, works on Windows).
 * Checks both top-level entries and scoped packages (@org/package).
 *
 * @param gitRoot - Git repository root path
 * @returns Array of linked package names
 *
 * @example
 * const linked = detectLinkedPackages('/path/to/repo');
 * console.log(linked); // ['my-package', '@org/other-package']
 */
export function detectLinkedPackages(gitRoot: string): string[] {
  const nodeModulesPath = join(gitRoot, 'node_modules');
  if (!existsSync(nodeModulesPath)) {
    return [];
  }

  const linkedPackages: string[] = [];

  try {
    const entries = readdirSync(nodeModulesPath, { withFileTypes: true });

    for (const entry of entries) {
      const entryPath = join(nodeModulesPath, entry.name);

      // Check if top-level entry is a symlink
      if (isSymlink(entryPath)) {
        linkedPackages.push(entry.name);
        continue;
      }

      // Check scoped packages (@org/package)
      if (entry.name.startsWith('@') && entry.isDirectory()) {
        const scopedLinked = findScopedLinkedPackages(entryPath, entry.name);
        linkedPackages.push(...scopedLinked);
      }
    }
  } catch {
    // Ignore readdir errors for node_modules
  }

  return linkedPackages;
}

/**
 * Build install command for package manager
 *
 * If custom command provided, parses into array format.
 * Otherwise, returns appropriate frozen lockfile command:
 * - npm: npm ci
 * - pnpm: pnpm install --frozen-lockfile
 * - yarn: yarn install --immutable
 * - bun: bun install --frozen-lockfile
 *
 * @param packageManager - Package manager to build command for
 * @param customCommand - Optional custom command string
 * @returns Command array [command, ...args]
 *
 * @example
 * const cmd = buildInstallCommand('npm');
 * console.log(cmd); // ['npm', 'ci']
 *
 * @example
 * const cmd = buildInstallCommand('npm', 'npm ci --legacy-peer-deps');
 * console.log(cmd); // ['npm', 'ci', '--legacy-peer-deps']
 */
export function buildInstallCommand(
  packageManager: PackageManager,
  customCommand?: string
): string[] {
  // Parse custom command if provided
  if (customCommand) {
    return customCommand.trim().split(/\s+/);
  }

  // Return frozen lockfile command for package manager
  switch (packageManager) {
    case 'npm':
      return ['npm', 'ci'];
    case 'pnpm':
      return ['pnpm', 'install', '--frozen-lockfile'];
    case 'yarn':
      return ['yarn', 'install', '--immutable'];
    case 'bun':
      return ['bun', 'install', '--frozen-lockfile'];
  }
}

/**
 * Run dependency lock file verification
 *
 * Checks that lock file is in sync with package.json by running
 * the package manager's install command with frozen lockfile flag.
 *
 * Skip conditions:
 * - VV_SKIP_DEPENDENCY_CHECK env var is set
 * - npm link detected (linked packages present)
 *
 * @param gitRoot - Git repository root path
 * @param config - Configuration object
 * @param config.packageManager - Optional package manager override
 * @param config.command - Optional custom verification command
 * @param verbose - Enable verbose output
 * @returns Dependency check result
 *
 * @example
 * const result = await runDependencyCheck('/path/to/repo', {}, false);
 * if (!result.passed) {
 *   console.error(result.error);
 * }
 *
 * @example
 * // With custom command
 * const result = await runDependencyCheck('/path/to/repo', {
 *   packageManager: 'npm',
 *   command: 'npm ci --legacy-peer-deps'
 * }, true);
 */
export async function runDependencyCheck(
  gitRoot: string,
  config: {
    packageManager?: PackageManager;
    command?: string;
  },
  verbose: boolean
): Promise<DependencyCheckResult> {
  const startTime = Date.now();

  // Check for skip env var
  if (process.env.VV_SKIP_DEPENDENCY_CHECK) {
    return {
      passed: true,
      skipped: true,
      skipReason: 'env-var',
      duration: Date.now() - startTime,
    };
  }

  // Detect linked packages
  const linkedPackages = detectLinkedPackages(gitRoot);
  if (linkedPackages.length > 0) {
    if (verbose) {
      console.warn(`⚠️  npm link detected (${linkedPackages.length} packages), skipping lock file check`);
      console.warn(`   Linked: ${linkedPackages.join(', ')}`);
    }
    return {
      passed: true,
      skipped: true,
      skipReason: 'npm-link',
      linkedPackages,
      duration: Date.now() - startTime,
    };
  }

  // Detect package manager
  const packageManager = detectPackageManager(gitRoot, config.packageManager);
  if (!packageManager) {
    return {
      passed: false,
      skipped: false,
      error: 'No package manager detected (no lock file found)',
      duration: Date.now() - startTime,
    };
  }

  // Verify lock file exists
  const lockFile = join(gitRoot, LOCK_FILES[packageManager]);
  if (!existsSync(lockFile)) {
    return {
      passed: false,
      skipped: false,
      error: `No lock file found for detected package manager (${packageManager})`,
      packageManager,
      duration: Date.now() - startTime,
    };
  }

  // Build and execute install command
  const commandArray = buildInstallCommand(packageManager, config.command);
  const commandString = commandArray.join(' ');

  if (verbose) {
    console.log(`🔍 Verifying lock file with: ${commandString}`);
  }

  const result = safeExecResult(commandArray[0], commandArray.slice(1), {
    cwd: gitRoot,
    encoding: 'utf8',
  });

  const duration = Date.now() - startTime;

  if (result.status === 0) {
    if (verbose) {
      console.log('✅ Lock file verification passed');
    }
    return {
      passed: true,
      skipped: false,
      packageManager,
      command: commandString,
      duration,
    };
  }

  // Command failed - lock file out of sync
  const stderr = typeof result.stderr === 'string' ? result.stderr : result.stderr.toString();
  return {
    passed: false,
    skipped: false,
    error: `Lock file verification failed: ${stderr.trim()}`,
    packageManager,
    command: commandString,
    duration,
  };
}

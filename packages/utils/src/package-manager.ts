/**
 * Package Manager Operations
 *
 * Single source of truth for npm/pnpm command execution.
 * Centralizes all package registry and publishing operations.
 *
 * DO NOT call npm/pnpm via safeExecSync/safeExecResult directly.
 * Use these functions instead for:
 * - Consistent error handling
 * - Better testability (easy mocking)
 * - Architectural consistency
 */

import { safeExecResult, safeExecSync } from './safe-exec.js';

export interface PackageManagerOptions {
  cwd?: string;
  timeout?: number;
  stdio?: 'pipe' | 'ignore' | Array<'pipe' | 'ignore' | 'inherit'>;
  env?: NodeJS.ProcessEnv;
}

/**
 * Get package version from npm registry
 *
 * @param packageName - Package name (e.g., 'vibe-validate')
 * @param versionOrTag - Version or tag (e.g., '0.19.0', 'latest')
 * @returns Version string or null if not found
 *
 * @example
 * const version = getPackageVersion('vibe-validate', 'latest');
 * console.log(version); // '0.19.0'
 */
export function getPackageVersion(packageName: string, versionOrTag: string): string | null {
  const result = safeExecResult('npm', ['view', `${packageName}@${versionOrTag}`, 'version'], {
    encoding: 'utf8',
    stdio: 'pipe',
  });

  if (result.status !== 0) {
    return null;
  }

  return (result.stdout as string).trim();
}

/**
 * Get latest version of a package from npm registry
 *
 * @param packageName - Package name (e.g., 'vibe-validate')
 * @returns Latest version string
 * @throws Error if package not found or registry unreachable
 *
 * @example
 * const version = getLatestVersion('vibe-validate');
 * console.log(version); // '0.19.0'
 */
export function getLatestVersion(packageName: string): string {
  const version = safeExecSync('npm', ['view', packageName, 'version'], {
    encoding: 'utf8',
    stdio: 'pipe',
  });
  return (version as string).trim();
}

/**
 * Check if a package version exists in npm registry
 *
 * @param packageName - Package name
 * @param version - Version to check
 * @returns True if package version exists
 *
 * @example
 * if (packageExists('vibe-validate', '0.19.0')) {
 *   console.log('Package already published');
 * }
 */
export function packageExists(packageName: string, version: string): boolean {
  return getPackageVersion(packageName, version) !== null;
}

/**
 * Publish package to npm registry using pnpm
 *
 * @param options - Publishing options
 * @param options.cwd - Package directory to publish from
 * @param options.tag - Dist tag (e.g., 'latest', 'rc', 'dev')
 * @param options.stdio - How to handle stdio streams
 *
 * @example
 * publishPackage({
 *   cwd: '/path/to/package',
 *   tag: 'latest',
 *   stdio: 'inherit'
 * });
 */
export function publishPackage(options: {
  cwd: string;
  tag: string;
  stdio?: 'pipe' | 'ignore' | Array<'pipe' | 'ignore' | 'inherit'>;
}): void {
  safeExecSync('pnpm', ['publish', '--no-git-checks', '--tag', options.tag], {
    stdio: options.stdio ?? 'pipe',
    cwd: options.cwd,
  });
}

/**
 * Add dist tag to published package
 *
 * @param packageName - Full package name (e.g., '@vibe-validate/core')
 * @param version - Version to tag
 * @param tag - Tag name (e.g., 'latest', 'rc')
 *
 * @example
 * addDistTag('@vibe-validate/core', '0.19.0', 'latest');
 */
export function addDistTag(packageName: string, version: string, tag: string): void {
  safeExecSync('npm', ['dist-tag', 'add', `${packageName}@${version}`, tag], {
    stdio: 'pipe',
  });
}

/**
 * Unpublish package version from npm registry
 *
 * @param packageName - Full package name
 * @param version - Version to unpublish
 * @returns True if successful, false if failed
 *
 * @example
 * if (unpublishPackage('@vibe-validate/core', '0.19.0-rc.1')) {
 *   console.log('Successfully unpublished');
 * }
 */
export function unpublishPackage(packageName: string, version: string): boolean {
  const result = safeExecResult('npm', ['unpublish', `${packageName}@${version}`, '--force'], {
    stdio: 'pipe',
  });
  return result.status === 0;
}

/**
 * Deprecate package version on npm registry
 *
 * @param packageName - Full package name
 * @param version - Version to deprecate
 * @param message - Deprecation message
 * @returns True if successful, false if failed
 *
 * @example
 * deprecatePackage(
 *   '@vibe-validate/core',
 *   '0.19.0-rc.1',
 *   'Use 0.19.0 instead'
 * );
 */
export function deprecatePackage(packageName: string, version: string, message: string): boolean {
  const result = safeExecResult('npm', ['deprecate', `${packageName}@${version}`, message], {
    stdio: 'pipe',
  });
  return result.status === 0;
}

/**
 * Install npm package from tarball
 *
 * @param tarballPath - Path to tarball file
 * @param targetDir - Directory to install into
 *
 * @example
 * installPackage(
 *   '/tmp/vibe-validate-0.19.0.tgz',
 *   '/tmp/test-install'
 * );
 */
export function installPackage(tarballPath: string, targetDir: string): void {
  safeExecSync('npm', ['install', tarballPath], {
    cwd: targetDir,
    stdio: 'pipe',
  });
}

/**
 * Execute pnpm command with arguments
 *
 * Use this for pnpm commands not covered by specific functions above.
 *
 * @param args - Command arguments
 * @param options - Execution options
 * @returns Command output
 *
 * @example
 * // Run pnpm validate
 * executePnpmCommand(['validate'], {
 *   cwd: projectRoot,
 *   stdio: 'inherit'
 * });
 */
export function executePnpmCommand(args: string[], options?: PackageManagerOptions): string {
  const execOptions = {
    encoding: 'utf8' as const,
    stdio: options?.stdio ?? ('pipe' as const),
    cwd: options?.cwd,
    timeout: options?.timeout,
    env: options?.env,
  };

  return safeExecSync('pnpm', args, execOptions) as string;
}

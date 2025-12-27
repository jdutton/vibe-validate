/**
 * Package Manager Command Utilities
 *
 * Provides package-manager-agnostic command generation for all supported package managers:
 * npm, pnpm, yarn, bun
 *
 * @packageDocumentation
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Supported package managers
 */
export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';

/**
 * Get install command for package manager (for CI/production)
 * Uses frozen lockfile modes to ensure reproducible installs
 */
export function getInstallCommand(packageManager: PackageManager): string {
  switch (packageManager) {
    case 'bun': return 'bun install';
    case 'pnpm': return 'pnpm install --frozen-lockfile';
    case 'yarn': return 'yarn install --frozen-lockfile';
    case 'npm': return 'npm ci';
    default: return 'npm ci';
  }
}

/**
 * Get basic install command without frozen lockfile (for local development)
 */
export function getInstallCommandUnfrozen(packageManager: PackageManager): string {
  switch (packageManager) {
    case 'bun': return 'bun install';
    case 'pnpm': return 'pnpm install';
    case 'yarn': return 'yarn install';
    case 'npm': return 'npm install';
    default: return 'npm install';
  }
}

/**
 * Get command to install dev dependencies
 * @param packages - Space-separated list of packages to install
 */
export function getDevInstallCommand(packageManager: PackageManager, packages: string): string {
  switch (packageManager) {
    case 'bun': return `bun add --dev ${packages}`;
    case 'pnpm': return `pnpm add -D ${packages}`;
    case 'yarn': return `yarn add --dev ${packages}`;
    case 'npm': return `npm install --save-dev ${packages}`;
    default: return `npm install --save-dev ${packages}`;
  }
}

/**
 * Get command to install global packages
 * @param packages - Space-separated list of packages to install
 */
export function getGlobalInstallCommand(packageManager: PackageManager, packages: string): string {
  switch (packageManager) {
    case 'bun': return `bun add --global ${packages}`;
    case 'pnpm': return `pnpm add -g ${packages}`;
    case 'yarn': return `yarn global add ${packages}`;
    case 'npm': return `npm install -g ${packages}`;
    default: return `npm install -g ${packages}`;
  }
}

/**
 * Get command to install regular dependencies
 * @param packages - Space-separated list of packages to install
 */
export function getAddCommand(packageManager: PackageManager, packages: string): string {
  switch (packageManager) {
    case 'bun': return `bun add ${packages}`;
    case 'pnpm': return `pnpm add ${packages}`;
    case 'yarn': return `yarn add ${packages}`;
    case 'npm': return `npm install ${packages}`;
    default: return `npm install ${packages}`;
  }
}

/**
 * Get upgrade command for a package
 * @param packageName - Name of package to upgrade
 * @param scope - 'local' for dev dependency, 'global' for global install
 */
export function getUpgradeCommand(
  packageManager: PackageManager,
  packageName: string,
  scope: 'local' | 'global' = 'local'
): string {
  if (scope === 'global') {
    return getGlobalInstallCommand(packageManager, `${packageName}@latest`);
  }

  // Local upgrade
  switch (packageManager) {
    case 'bun': return `bun update ${packageName}`;
    case 'pnpm': return `pnpm update ${packageName}`;
    case 'yarn': return `yarn upgrade ${packageName}`;
    case 'npm': return `npm install -D ${packageName}@latest`;
    default: return `npm install -D ${packageName}@latest`;
  }
}

/**
 * Get build command for package manager
 */
export function getBuildCommand(packageManager: PackageManager): string {
  switch (packageManager) {
    case 'bun': return 'bun run build';
    case 'pnpm': return 'pnpm -r build';
    case 'yarn': return 'yarn run build';
    case 'npm': return 'npm run build';
    default: return 'npm run build';
  }
}

/**
 * Get validate command for package manager
 */
export function getValidateCommand(packageManager: PackageManager): string {
  switch (packageManager) {
    case 'bun': return 'bun run validate';
    case 'pnpm': return 'pnpm validate';
    case 'yarn': return 'yarn run validate';
    case 'npm': return 'npm run validate';
    default: return 'npm run validate';
  }
}

/**
 * Get coverage command for package manager
 */
export function getCoverageCommand(packageManager: PackageManager): string {
  switch (packageManager) {
    case 'bun': return 'bun run test:coverage';
    case 'pnpm': return 'pnpm test:coverage';
    case 'yarn': return 'yarn run test:coverage';
    case 'npm': return 'npm run test:coverage';
    default: return 'npm run test:coverage';
  }
}

/**
 * Get run command prefix for package manager
 */
export function getRunCommand(packageManager: PackageManager, script: string): string {
  switch (packageManager) {
    case 'bun': return `bun run ${script}`;
    case 'pnpm': return `pnpm ${script}`;
    case 'yarn': return `yarn run ${script}`;
    case 'npm': return `npm run ${script}`;
    default: return `npm run ${script}`;
  }
}

/**
 * Detect package manager from package.json packageManager field
 */
function detectFromPackageJson(cwd: string): PackageManager | null {
  try {
    const packageJsonPath = join(cwd, 'package.json');
    if (!existsSync(packageJsonPath)) return null;

    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
    const pm = packageJson.packageManager;
    if (!pm) return null;

    if (pm.startsWith('bun@')) return 'bun';
    if (pm.startsWith('pnpm@')) return 'pnpm';
    if (pm.startsWith('yarn@')) return 'yarn';
    if (pm.startsWith('npm@')) return 'npm';
    return null;
  } catch {
    return null;
  }
}

/**
 * Detect package manager from lockfiles
 * Priority: bun > yarn > npm > pnpm
 * Note: npm preferred over pnpm when both exist (more conservative default)
 */
function detectFromLockfiles(cwd: string): PackageManager {
  // Check both bun.lockb (binary, older) and bun.lock (text, newer)
  const hasBunLock = existsSync(join(cwd, 'bun.lockb')) || existsSync(join(cwd, 'bun.lock'));
  const hasPnpmLock = existsSync(join(cwd, 'pnpm-lock.yaml'));
  const hasYarnLock = existsSync(join(cwd, 'yarn.lock'));
  const hasNpmLock = existsSync(join(cwd, 'package-lock.json'));

  // Priority: bun > yarn > npm > pnpm
  // npm preferred over pnpm when both exist (more conservative default)
  if (hasBunLock) return 'bun';
  if (hasYarnLock) return 'yarn';
  if (hasNpmLock) return 'npm';
  if (hasPnpmLock) return 'pnpm';

  return 'npm'; // Default
}

/**
 * Detect package manager from package.json and lockfiles
 * Priority:
 * 1. package.json packageManager field (official spec)
 * 2. Lockfile detection (priority: bun > yarn > npm > pnpm)
 *    Note: npm preferred over pnpm when both exist (more conservative default)
 */
export function detectPackageManager(cwd: string = process.cwd()): PackageManager {
  return detectFromPackageJson(cwd) ?? detectFromLockfiles(cwd);
}

/**
 * Get formatted list of upgrade commands for all package managers
 * Useful for help text where we want to show all options
 */
export function getAllUpgradeCommands(packageName: string, scope: 'local' | 'global' = 'local'): string {
  const managers: PackageManager[] = ['npm', 'pnpm', 'yarn', 'bun'];
  return managers
    .map(pm => getUpgradeCommand(pm, packageName, scope))
    .join(' or\n   ');
}

/**
 * Tests for dependency lock file check
 *
 * Verifies package manager detection, npm link detection, and lock file verification.
 * Uses real file system operations in temp directories for accurate cross-platform testing.
 */

import { mkdtempSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';

import { normalizedTmpdir, mkdirSyncReal } from '@vibe-validate/utils';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
  type PackageManager,
  detectPackageManager,
  detectLinkedPackages,
  buildInstallCommand,
  runDependencyCheck,
} from '../src/dependency-lock-check.js';

/**
 * Create temporary test directory
 */
function createTempDir(): string {
  return mkdtempSync(join(normalizedTmpdir(), 'dep-check-test-'));
}

/**
 * Create package.json in directory
 */
function createPackageJson(dir: string, content: Record<string, unknown> = {}): void {
  const defaultContent = {
    name: 'test-package',
    version: '1.0.0',
    ...content,
  };
  writeFileSync(join(dir, 'package.json'), JSON.stringify(defaultContent, null, 2));
}

/**
 * Create lock file in directory
 */
function createLockFile(dir: string, packageManager: PackageManager): void {
  const lockFiles: Record<PackageManager, string> = {
    npm: 'package-lock.json',
    pnpm: 'pnpm-lock.yaml',
    yarn: 'yarn.lock',
    bun: 'bun.lockb',
  };

  const lockFile = join(dir, lockFiles[packageManager]);
  writeFileSync(lockFile, packageManager === 'bun' ? Buffer.from([0x00]) : '# Lock file content');
}

/**
 * Create node_modules directory with entries
 */
function createNodeModules(dir: string): string {
  const nodeModulesPath = join(dir, 'node_modules');
  mkdirSyncReal(nodeModulesPath, { recursive: true });
  return nodeModulesPath;
}

/**
 * Create symlink (cross-platform)
 */
function createSymlink(target: string, link: string): void {
  try {
    symlinkSync(target, link, 'junction'); // Use junction on Windows for better compatibility
  } catch {
    // If junction fails, try regular symlink (Unix)
    symlinkSync(target, link);
  }
}

/**
 * Setup test suite with two temporary directories
 *
 * Configures beforeEach/afterEach hooks to create and cleanup two temp directories.
 * Returns getter functions to access the directories within tests.
 *
 * @returns Object with getTempDir and getTargetDir getter functions
 *
 * @example
 * describe('my tests', () => {
 *   const { getTempDir, getTargetDir } = setupTwoTempDirsSuite();
 *
 *   it('should work', () => {
 *     const dir = getTempDir();
 *     // Use dir in test
 *   });
 * });
 */
function setupTwoTempDirsSuite(): {
  getTempDir: () => string;
  getTargetDir: () => string;
} {
  let tempDir: string;
  let targetDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
    targetDir = createTempDir();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    rmSync(targetDir, { recursive: true, force: true });
  });

  return {
    getTempDir: () => tempDir,
    getTargetDir: () => targetDir,
  };
}

describe('detectPackageManager', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('should return config override when provided', () => {
    createPackageJson(tempDir);
    createLockFile(tempDir, 'npm');
    createLockFile(tempDir, 'pnpm');

    const result = detectPackageManager(tempDir, 'yarn');
    expect(result).toBe('yarn');
  });

  it('should detect from package.json packageManager field', () => {
    createPackageJson(tempDir, {
      packageManager: 'pnpm@8.6.0',
    });

    const result = detectPackageManager(tempDir);
    expect(result).toBe('pnpm');
  });

  it('should detect from package.json packageManager field for all managers', () => {
    const managers: PackageManager[] = ['npm', 'pnpm', 'yarn', 'bun'];

    for (const pm of managers) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = createTempDir();

      createPackageJson(tempDir, {
        packageManager: `${pm}@9.0.0`,
      });

      expect(detectPackageManager(tempDir)).toBe(pm);
    }
  });

  it('should detect from lock file when package.json missing', () => {
    createLockFile(tempDir, 'pnpm');

    const result = detectPackageManager(tempDir);
    expect(result).toBe('pnpm');
  });

  it('should detect bun with highest priority', () => {
    createPackageJson(tempDir);
    createLockFile(tempDir, 'npm');
    createLockFile(tempDir, 'pnpm');
    createLockFile(tempDir, 'yarn');
    createLockFile(tempDir, 'bun');

    const result = detectPackageManager(tempDir);
    expect(result).toBe('bun');
  });

  it('should detect yarn with second priority', () => {
    createPackageJson(tempDir);
    createLockFile(tempDir, 'npm');
    createLockFile(tempDir, 'pnpm');
    createLockFile(tempDir, 'yarn');

    const result = detectPackageManager(tempDir);
    expect(result).toBe('yarn');
  });

  it('should detect pnpm with third priority', () => {
    createPackageJson(tempDir);
    createLockFile(tempDir, 'npm');
    createLockFile(tempDir, 'pnpm');

    const result = detectPackageManager(tempDir);
    expect(result).toBe('pnpm');
  });

  it('should detect npm with lowest priority', () => {
    createPackageJson(tempDir);
    createLockFile(tempDir, 'npm');

    const result = detectPackageManager(tempDir);
    expect(result).toBe('npm');
  });

  it('should return null when no package manager found', () => {
    createPackageJson(tempDir);

    const result = detectPackageManager(tempDir);
    expect(result).toBeNull();
  });

  it('should return null for empty directory', () => {
    const result = detectPackageManager(tempDir);
    expect(result).toBeNull();
  });

  it('should handle invalid package.json gracefully', () => {
    writeFileSync(join(tempDir, 'package.json'), 'invalid json {{{');
    createLockFile(tempDir, 'npm');

    const result = detectPackageManager(tempDir);
    expect(result).toBe('npm');
  });
});

describe('detectLinkedPackages', () => {
  const { getTempDir, getTargetDir } = setupTwoTempDirsSuite();

  it('should return empty array when no node_modules', () => {
    const result = detectLinkedPackages(getTempDir());
    expect(result).toEqual([]);
  });

  it('should return empty array when node_modules is empty', () => {
    createNodeModules(getTempDir());

    const result = detectLinkedPackages(getTempDir());
    expect(result).toEqual([]);
  });

  it('should detect top-level linked package (cross-platform)', () => {
    const nodeModules = createNodeModules(getTempDir());

    // Create real target directory
    const packageTarget = join(getTargetDir(), 'my-package');
    mkdirSyncReal(packageTarget, { recursive: true });
    writeFileSync(join(packageTarget, 'index.js'), 'module.exports = {}');

    // Create symlink
    const linkPath = join(nodeModules, 'my-package');
    createSymlink(packageTarget, linkPath);

    const result = detectLinkedPackages(getTempDir());
    expect(result).toContain('my-package');
  });

  it('should detect multiple top-level linked packages', () => {
    const nodeModules = createNodeModules(getTempDir());

    // Create targets
    const pkg1Target = join(getTargetDir(), 'package-1');
    const pkg2Target = join(getTargetDir(), 'package-2');
    mkdirSyncReal(pkg1Target, { recursive: true });
    mkdirSyncReal(pkg2Target, { recursive: true });

    // Create symlinks
    createSymlink(pkg1Target, join(nodeModules, 'package-1'));
    createSymlink(pkg2Target, join(nodeModules, 'package-2'));

    // Add regular package (not a link)
    const regularPkg = join(nodeModules, 'regular-package');
    mkdirSyncReal(regularPkg, { recursive: true });

    const result = detectLinkedPackages(getTempDir());
    expect(result).toHaveLength(2);
    expect(result).toContain('package-1');
    expect(result).toContain('package-2');
    expect(result).not.toContain('regular-package');
  });

  it('should detect scoped linked packages (@org/package)', () => {
    const nodeModules = createNodeModules(getTempDir());

    // Create scoped directory
    const scopeDir = join(nodeModules, '@myorg');
    mkdirSyncReal(scopeDir, { recursive: true });

    // Create target
    const packageTarget = join(getTargetDir(), 'scoped-package');
    mkdirSyncReal(packageTarget, { recursive: true });

    // Create symlink
    const linkPath = join(scopeDir, 'scoped-package');
    createSymlink(packageTarget, linkPath);

    const result = detectLinkedPackages(getTempDir());
    expect(result).toContain('@myorg/scoped-package');
  });

  it('should detect mix of top-level and scoped linked packages', () => {
    const nodeModules = createNodeModules(getTempDir());

    // Top-level link
    const topTarget = join(getTargetDir(), 'top-package');
    mkdirSyncReal(topTarget, { recursive: true });
    createSymlink(topTarget, join(nodeModules, 'top-package'));

    // Scoped link
    const scopeDir = join(nodeModules, '@org');
    mkdirSyncReal(scopeDir, { recursive: true });
    const scopedTarget = join(getTargetDir(), 'scoped');
    mkdirSyncReal(scopedTarget, { recursive: true });
    createSymlink(scopedTarget, join(scopeDir, 'scoped'));

    const result = detectLinkedPackages(getTempDir());
    expect(result).toHaveLength(2);
    expect(result).toContain('top-package');
    expect(result).toContain('@org/scoped');
  });

  it('should not detect regular scoped packages as linked', () => {
    const nodeModules = createNodeModules(getTempDir());

    // Create scoped directory with regular package (not a link)
    const scopeDir = join(nodeModules, '@myorg');
    mkdirSyncReal(scopeDir, { recursive: true });
    const regularPkg = join(scopeDir, 'regular-package');
    mkdirSyncReal(regularPkg, { recursive: true });
    writeFileSync(join(regularPkg, 'package.json'), '{}');

    const result = detectLinkedPackages(getTempDir());
    expect(result).toEqual([]);
  });

  it('should handle scoped directory that is itself a symlink', () => {
    const nodeModules = createNodeModules(getTempDir());

    // Create target scoped directory
    const scopeTarget = join(getTargetDir(), 'org-dir');
    mkdirSyncReal(scopeTarget, { recursive: true });

    // Create symlink for entire scope
    const scopeLink = join(nodeModules, '@myorg');
    createSymlink(scopeTarget, scopeLink);

    const result = detectLinkedPackages(getTempDir());
    expect(result).toContain('@myorg');
  });
});

describe('buildInstallCommand', () => {
  it('should build npm ci command', () => {
    const cmd = buildInstallCommand('npm');
    expect(cmd).toEqual(['npm', 'ci']);
  });

  it('should build pnpm install --frozen-lockfile command', () => {
    const cmd = buildInstallCommand('pnpm');
    expect(cmd).toEqual(['pnpm', 'install', '--frozen-lockfile']);
  });

  it('should build yarn install --immutable command', () => {
    const cmd = buildInstallCommand('yarn');
    expect(cmd).toEqual(['yarn', 'install', '--immutable']);
  });

  it('should build bun install --frozen-lockfile command', () => {
    const cmd = buildInstallCommand('bun');
    expect(cmd).toEqual(['bun', 'install', '--frozen-lockfile']);
  });

  it('should parse custom command string', () => {
    const cmd = buildInstallCommand('npm', 'npm ci --legacy-peer-deps');
    expect(cmd).toEqual(['npm', 'ci', '--legacy-peer-deps']);
  });

  it('should handle custom command with multiple flags', () => {
    const cmd = buildInstallCommand('pnpm', 'pnpm install --frozen-lockfile --prefer-offline');
    expect(cmd).toEqual(['pnpm', 'install', '--frozen-lockfile', '--prefer-offline']);
  });

  it('should trim whitespace from custom command', () => {
    const cmd = buildInstallCommand('npm', '  npm ci  ');
    expect(cmd).toEqual(['npm', 'ci']);
  });

  it('should handle custom command overriding package manager', () => {
    const cmd = buildInstallCommand('npm', 'yarn install --immutable');
    expect(cmd).toEqual(['yarn', 'install', '--immutable']);
  });
});

describe('runDependencyCheck', () => {
  let tempDir: string;
  let originalEnv: string | undefined;

  beforeEach(() => {
    tempDir = createTempDir();
    originalEnv = process.env.VV_SKIP_DEPENDENCY_CHECK;
    delete process.env.VV_SKIP_DEPENDENCY_CHECK;
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    if (originalEnv === undefined) {
      delete process.env.VV_SKIP_DEPENDENCY_CHECK;
    } else {
      process.env.VV_SKIP_DEPENDENCY_CHECK = originalEnv;
    }
  });

  it('should skip check when VV_SKIP_DEPENDENCY_CHECK env var is set', async () => {
    process.env.VV_SKIP_DEPENDENCY_CHECK = '1';

    const result = await runDependencyCheck(tempDir, {}, false);

    expect(result).toMatchObject({
      passed: true,
      skipped: true,
      skipReason: 'env-var',
    });
    expect(result.duration).toBeGreaterThanOrEqual(0);
  });

  it('should skip check when npm link detected', async () => {
    const nodeModules = createNodeModules(tempDir);
    const targetDir = createTempDir();

    try {
      // Create linked package
      const packageTarget = join(targetDir, 'linked-package');
      mkdirSyncReal(packageTarget, { recursive: true });
      createSymlink(packageTarget, join(nodeModules, 'linked-package'));

      const result = await runDependencyCheck(tempDir, {}, false);

      expect(result).toMatchObject({
        passed: true,
        skipped: true,
        skipReason: 'npm-link',
      });
      expect(result.linkedPackages).toContain('linked-package');
    } finally {
      rmSync(targetDir, { recursive: true, force: true });
    }
  });

  it('should fail when no package manager detected', async () => {
    createPackageJson(tempDir);

    const result = await runDependencyCheck(tempDir, {}, false);

    expect(result).toMatchObject({
      passed: false,
      skipped: false,
      error: 'No package manager detected (no lock file found)',
    });
  });

  it('should fail when lock file missing for detected package manager', async () => {
    createPackageJson(tempDir, {
      packageManager: 'pnpm@8.6.0',
    });

    const result = await runDependencyCheck(tempDir, {}, false);

    expect(result).toMatchObject({
      passed: false,
      skipped: false,
      error: 'No lock file found for detected package manager (pnpm)',
      packageManager: 'pnpm',
    });
  });

  it('should pass when lock file is in sync (npm)', async () => {
    createPackageJson(tempDir, {
      dependencies: {
        vitest: '^2.0.0',
      },
    });
    createLockFile(tempDir, 'npm');

    // Run actual npm ci to create valid lock file
    const { safeExecSync } = await import('../src/safe-exec.js');
    safeExecSync('npm', ['install'], { cwd: tempDir, stdio: 'ignore' });

    const result = await runDependencyCheck(tempDir, {}, false);

    expect(result).toMatchObject({
      passed: true,
      skipped: false,
      packageManager: 'npm',
      command: 'npm ci',
    });
    expect(result.duration).toBeGreaterThan(0);
  });

  it('should fail when lock file is out of sync', async () => {
    createPackageJson(tempDir, {
      dependencies: {
        // Package that doesn't match lock file
        'nonexistent-package-xyz': '^1.0.0',
      },
    });
    createLockFile(tempDir, 'npm');

    const result = await runDependencyCheck(tempDir, {}, false);

    expect(result).toMatchObject({
      passed: false,
      skipped: false,
      packageManager: 'npm',
      command: 'npm ci',
    });
    expect(result.error).toMatch(/Lock file verification failed/);
  });

  it('should use config package manager override', async () => {
    createPackageJson(tempDir);
    createLockFile(tempDir, 'yarn');

    const result = await runDependencyCheck(tempDir, { packageManager: 'yarn' }, false);

    expect(result.packageManager).toBe('yarn');
    expect(result.command).toBe('yarn install --immutable');
  });

  it('should use custom command when provided', async () => {
    createPackageJson(tempDir);
    createLockFile(tempDir, 'npm');

    const result = await runDependencyCheck(
      tempDir,
      {
        packageManager: 'npm',
        command: 'npm ci --legacy-peer-deps',
      },
      false
    );

    expect(result.command).toBe('npm ci --legacy-peer-deps');
  });

  it('should track duration of check', async () => {
    createPackageJson(tempDir);
    createLockFile(tempDir, 'npm');

    const result = await runDependencyCheck(tempDir, {}, false);

    expect(result.duration).toBeGreaterThanOrEqual(0);
    expect(typeof result.duration).toBe('number');
  });
});

describe('runDependencyCheck - cross-platform symlink detection', () => {
  const { getTempDir, getTargetDir } = setupTwoTempDirsSuite();

  it('should detect Windows junction symlinks', async () => {
    const nodeModules = createNodeModules(getTempDir());

    // Create target
    const packageTarget = join(getTargetDir(), 'win-linked');
    mkdirSyncReal(packageTarget, { recursive: true });

    // Create symlink (junction on Windows, symlink on Unix)
    createSymlink(packageTarget, join(nodeModules, 'win-linked'));

    const result = await runDependencyCheck(getTempDir(), {}, false);

    expect(result).toMatchObject({
      passed: true,
      skipped: true,
      skipReason: 'npm-link',
    });
    expect(result.linkedPackages).toContain('win-linked');
  });

  it('should detect Unix symlinks', async () => {
    const nodeModules = createNodeModules(getTempDir());

    // Create target
    const packageTarget = join(getTargetDir(), 'unix-linked');
    mkdirSyncReal(packageTarget, { recursive: true });

    // Create symlink
    try {
      symlinkSync(packageTarget, join(nodeModules, 'unix-linked'), 'dir');
    } catch {
      // Fallback to junction if symlink fails
      createSymlink(packageTarget, join(nodeModules, 'unix-linked'));
    }

    const result = await runDependencyCheck(getTempDir(), {}, false);

    expect(result).toMatchObject({
      passed: true,
      skipped: true,
      skipReason: 'npm-link',
    });
    expect(result.linkedPackages).toContain('unix-linked');
  });
});

describe('runDependencyCheck - all package managers', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = createTempDir();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  const packageManagers: PackageManager[] = ['npm', 'pnpm', 'yarn', 'bun'];

  for (const pm of packageManagers) {
    it(`should detect and verify ${pm} lock file`, async () => {
      createPackageJson(tempDir, {
        packageManager: `${pm}@9.0.0`,
      });
      createLockFile(tempDir, pm);

      const result = await runDependencyCheck(tempDir, {}, false);

      // Note: This will likely fail since we're not running actual install
      // but we're testing that it detects the package manager correctly
      expect(result.packageManager).toBe(pm);
      expect(result.skipped).toBe(false);
    });
  }
});

/**
 * Tests for dependency lock file check
 *
 * Verifies package manager detection and lock file verification.
 * Uses real file system operations in temp directories for accurate cross-platform testing.
 */

import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { normalizedTmpdir } from '@vibe-validate/utils';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
  type PackageManager,
  detectPackageManager,
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
 * Create bun.lock (text format, Bun v1.2+) in directory
 */
function createBunTextLockFile(dir: string): void {
  writeFileSync(join(dir, 'bun.lock'), '# bun.lock text format');
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

  it('should detect bun from bun.lock text format (v1.2+)', () => {
    createPackageJson(tempDir);
    createBunTextLockFile(tempDir);

    const result = detectPackageManager(tempDir);
    expect(result).toBe('bun');
  });

  it('should detect bun from bun.lock when both formats exist', () => {
    createPackageJson(tempDir);
    createBunTextLockFile(tempDir);
    createLockFile(tempDir, 'bun'); // also creates bun.lockb

    const result = detectPackageManager(tempDir);
    expect(result).toBe('bun');
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

  it('should fail when no package manager detected', async () => {
    createPackageJson(tempDir);

    const result = await runDependencyCheck(tempDir, {}, false);

    expect(result).toMatchObject({
      passed: false,
      skipped: false,
      error: 'No package manager detected (no lock file found)',
    });
  });

  it('should find bun.lock (text format) for detected bun package manager', async () => {
    createPackageJson(tempDir, {
      packageManager: 'bun@1.3.9',
    });
    createBunTextLockFile(tempDir);

    const result = await runDependencyCheck(tempDir, {}, false);

    // Should NOT fail with "No lock file found" - bun.lock exists
    expect(result.error).not.toContain('No lock file found');
    expect(result.packageManager).toBe('bun');
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
        // Use tiny package for fast test execution (especially on Windows CI)
        'ms': '^2.1.3',
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

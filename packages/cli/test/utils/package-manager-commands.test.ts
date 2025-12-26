/**
 * Tests for package-manager-commands utility module
 */

import { existsSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { mkdirSyncReal } from '@vibe-validate/utils';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
  type PackageManager,
  detectPackageManager,
  getInstallCommand,
  getInstallCommandUnfrozen,
  getDevInstallCommand,
  getGlobalInstallCommand,
  getAddCommand,
  getUpgradeCommand,
  getBuildCommand,
  getValidateCommand,
  getCoverageCommand,
  getRunCommand,
  getAllUpgradeCommands,
} from '../../src/utils/package-manager-commands.js';

/**
 * Package managers to test against
 */
const ALL_PACKAGE_MANAGERS: PackageManager[] = ['npm', 'pnpm', 'yarn', 'bun'];

/**
 * Test a command function across all package managers
 */
function testAllPackageManagers(
  commandFn: (_packageManager: PackageManager) => string,
  expected: Record<PackageManager, string>
) {
  for (const pm of ALL_PACKAGE_MANAGERS) {
    expect(commandFn(pm)).toBe(expected[pm]);
  }
}

describe('package-manager-commands', () => {
  describe('getInstallCommand', () => {
    it('should return frozen lockfile commands for CI', () => {
      testAllPackageManagers(getInstallCommand, {
        npm: 'npm ci',
        pnpm: 'pnpm install --frozen-lockfile',
        yarn: 'yarn install --frozen-lockfile',
        bun: 'bun install',
      });
    });

    it('should default to npm ci for unknown package manager', () => {
      expect(getInstallCommand('unknown' as PackageManager)).toBe('npm ci');
    });
  });

  describe('getInstallCommandUnfrozen', () => {
    it('should return regular install commands for local development', () => {
      testAllPackageManagers(getInstallCommandUnfrozen, {
        npm: 'npm install',
        pnpm: 'pnpm install',
        yarn: 'yarn install',
        bun: 'bun install',
      });
    });
  });

  describe('getDevInstallCommand', () => {
    it('should return dev dependency install commands', () => {
      testAllPackageManagers(
        (pm) => getDevInstallCommand(pm, 'typescript'),
        {
          npm: 'npm install --save-dev typescript',
          pnpm: 'pnpm add -D typescript',
          yarn: 'yarn add --dev typescript',
          bun: 'bun add --dev typescript',
        }
      );
    });

    it('should handle multiple packages', () => {
      expect(getDevInstallCommand('npm', 'vitest eslint')).toBe('npm install --save-dev vitest eslint');
      expect(getDevInstallCommand('pnpm', 'vitest eslint')).toBe('pnpm add -D vitest eslint');
    });
  });

  describe('getGlobalInstallCommand', () => {
    it('should return global install commands', () => {
      testAllPackageManagers(
        (pm) => getGlobalInstallCommand(pm, 'vibe-validate'),
        {
          npm: 'npm install -g vibe-validate',
          pnpm: 'pnpm add -g vibe-validate',
          yarn: 'yarn global add vibe-validate',
          bun: 'bun add --global vibe-validate',
        }
      );
    });
  });

  describe('getAddCommand', () => {
    it('should return regular dependency install commands', () => {
      testAllPackageManagers(
        (pm) => getAddCommand(pm, 'react'),
        {
          npm: 'npm install react',
          pnpm: 'pnpm add react',
          yarn: 'yarn add react',
          bun: 'bun add react',
        }
      );
    });
  });

  describe('getUpgradeCommand', () => {
    it('should return local upgrade commands', () => {
      testAllPackageManagers(
        (pm) => getUpgradeCommand(pm, 'vibe-validate', 'local'),
        {
          npm: 'npm install -D vibe-validate@latest',
          pnpm: 'pnpm update vibe-validate',
          yarn: 'yarn upgrade vibe-validate',
          bun: 'bun update vibe-validate',
        }
      );
    });

    it('should return global upgrade commands', () => {
      testAllPackageManagers(
        (pm) => getUpgradeCommand(pm, 'vibe-validate', 'global'),
        {
          npm: 'npm install -g vibe-validate@latest',
          pnpm: 'pnpm add -g vibe-validate@latest',
          yarn: 'yarn global add vibe-validate@latest',
          bun: 'bun add --global vibe-validate@latest',
        }
      );
    });

    it('should default to local scope', () => {
      expect(getUpgradeCommand('npm', 'vibe-validate')).toBe('npm install -D vibe-validate@latest');
    });
  });

  describe('getBuildCommand', () => {
    it('should return build commands', () => {
      testAllPackageManagers(getBuildCommand, {
        npm: 'npm run build',
        pnpm: 'pnpm -r build',
        yarn: 'yarn run build',
        bun: 'bun run build',
      });
    });
  });

  describe('getValidateCommand', () => {
    it('should return validate commands', () => {
      testAllPackageManagers(getValidateCommand, {
        npm: 'npm run validate',
        pnpm: 'pnpm validate',
        yarn: 'yarn run validate',
        bun: 'bun run validate',
      });
    });
  });

  describe('getCoverageCommand', () => {
    it('should return coverage commands', () => {
      testAllPackageManagers(getCoverageCommand, {
        npm: 'npm run test:coverage',
        pnpm: 'pnpm test:coverage',
        yarn: 'yarn run test:coverage',
        bun: 'bun run test:coverage',
      });
    });
  });

  describe('getRunCommand', () => {
    it('should return run commands with script name', () => {
      testAllPackageManagers(
        (pm) => getRunCommand(pm, 'test'),
        {
          npm: 'npm run test',
          pnpm: 'pnpm test',
          yarn: 'yarn run test',
          bun: 'bun run test',
        }
      );
    });
  });

  describe('getAllUpgradeCommands', () => {
    it('should return all upgrade commands separated by newlines', () => {
      const local = getAllUpgradeCommands('vibe-validate', 'local');
      expect(local).toContain('npm install -D vibe-validate@latest');
      expect(local).toContain('pnpm update vibe-validate');
      expect(local).toContain('yarn upgrade vibe-validate');
      expect(local).toContain('bun update vibe-validate');
      expect(local).toContain('\n   '); // Check formatting
    });

    it('should return all global upgrade commands', () => {
      const global = getAllUpgradeCommands('vibe-validate', 'global');
      expect(global).toContain('npm install -g vibe-validate@latest');
      expect(global).toContain('pnpm add -g vibe-validate@latest');
      expect(global).toContain('yarn global add vibe-validate@latest');
      expect(global).toContain('bun add --global vibe-validate@latest');
    });
  });

  describe('detectPackageManager', () => {
    let testDir: string;

    beforeEach(() => {
      // Create a temporary test directory
      testDir = join(process.cwd(), '.test-pm-detection');
      if (existsSync(testDir)) {
        rmSync(testDir, { recursive: true, force: true });
      }
      testDir = mkdirSyncReal(testDir, { recursive: true });
    });

    afterEach(() => {
      // Cleanup
      if (existsSync(testDir)) {
        rmSync(testDir, { recursive: true, force: true });
      }
    });

    it('should detect from package.json packageManager field (highest priority)', () => {
      writeFileSync(
        join(testDir, 'package.json'),
        JSON.stringify({ packageManager: 'pnpm@9.0.0' })
      );
      expect(detectPackageManager(testDir)).toBe('pnpm');
    });

    it('should detect bun from packageManager field', () => {
      writeFileSync(
        join(testDir, 'package.json'),
        JSON.stringify({ packageManager: 'bun@1.0.0' })
      );
      expect(detectPackageManager(testDir)).toBe('bun');
    });

    it('should detect yarn from packageManager field', () => {
      writeFileSync(
        join(testDir, 'package.json'),
        JSON.stringify({ packageManager: 'yarn@4.0.0' })
      );
      expect(detectPackageManager(testDir)).toBe('yarn');
    });

    it('should detect npm from packageManager field', () => {
      writeFileSync(
        join(testDir, 'package.json'),
        JSON.stringify({ packageManager: 'npm@10.0.0' })
      );
      expect(detectPackageManager(testDir)).toBe('npm');
    });

    it('should detect from bun.lockb when no packageManager field', () => {
      writeFileSync(join(testDir, 'package.json'), JSON.stringify({}));
      writeFileSync(join(testDir, 'bun.lockb'), '');
      expect(detectPackageManager(testDir)).toBe('bun');
    });

    it('should detect from yarn.lock when no packageManager field', () => {
      writeFileSync(join(testDir, 'package.json'), JSON.stringify({}));
      writeFileSync(join(testDir, 'yarn.lock'), '');
      expect(detectPackageManager(testDir)).toBe('yarn');
    });

    it('should detect from package-lock.json when no packageManager field', () => {
      writeFileSync(join(testDir, 'package.json'), JSON.stringify({}));
      writeFileSync(join(testDir, 'package-lock.json'), '{}');
      expect(detectPackageManager(testDir)).toBe('npm');
    });

    it('should detect from pnpm-lock.yaml when no packageManager field', () => {
      writeFileSync(join(testDir, 'package.json'), JSON.stringify({}));
      writeFileSync(join(testDir, 'pnpm-lock.yaml'), '');
      expect(detectPackageManager(testDir)).toBe('pnpm');
    });

    it('should prefer npm over pnpm when both lockfiles exist (conservative)', () => {
      writeFileSync(join(testDir, 'package.json'), JSON.stringify({}));
      writeFileSync(join(testDir, 'package-lock.json'), '{}');
      writeFileSync(join(testDir, 'pnpm-lock.yaml'), '');
      expect(detectPackageManager(testDir)).toBe('npm');
    });

    it('should prefer bun over all other lockfiles', () => {
      writeFileSync(join(testDir, 'package.json'), JSON.stringify({}));
      writeFileSync(join(testDir, 'bun.lockb'), '');
      writeFileSync(join(testDir, 'yarn.lock'), '');
      writeFileSync(join(testDir, 'package-lock.json'), '{}');
      writeFileSync(join(testDir, 'pnpm-lock.yaml'), '');
      expect(detectPackageManager(testDir)).toBe('bun');
    });

    it('should prefer yarn over npm', () => {
      writeFileSync(join(testDir, 'package.json'), JSON.stringify({}));
      writeFileSync(join(testDir, 'yarn.lock'), '');
      writeFileSync(join(testDir, 'package-lock.json'), '{}');
      expect(detectPackageManager(testDir)).toBe('yarn');
    });

    it('should default to npm when no lockfiles exist', () => {
      writeFileSync(join(testDir, 'package.json'), JSON.stringify({}));
      expect(detectPackageManager(testDir)).toBe('npm');
    });

    it('should default to npm when package.json does not exist', () => {
      expect(detectPackageManager(testDir)).toBe('npm');
    });

    it('should handle invalid package.json gracefully', () => {
      writeFileSync(join(testDir, 'package.json'), 'invalid json{{{');
      expect(detectPackageManager(testDir)).toBe('npm');
    });

    it('should ignore unknown packageManager values', () => {
      writeFileSync(
        join(testDir, 'package.json'),
        JSON.stringify({ packageManager: 'unknown@1.0.0' })
      );
      writeFileSync(join(testDir, 'pnpm-lock.yaml'), '');
      expect(detectPackageManager(testDir)).toBe('pnpm'); // Falls back to lockfile detection
    });

    it('should handle missing packageManager field', () => {
      writeFileSync(
        join(testDir, 'package.json'),
        JSON.stringify({ name: 'test' })
      );
      writeFileSync(join(testDir, 'pnpm-lock.yaml'), '');
      expect(detectPackageManager(testDir)).toBe('pnpm');
    });
  });
});

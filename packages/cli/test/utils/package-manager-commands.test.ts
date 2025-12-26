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

describe('package-manager-commands', () => {
  describe('getInstallCommand', () => {
    it('should return frozen lockfile commands for CI', () => {
      expect(getInstallCommand('npm')).toBe('npm ci');
      expect(getInstallCommand('pnpm')).toBe('pnpm install --frozen-lockfile');
      expect(getInstallCommand('yarn')).toBe('yarn install --frozen-lockfile');
      expect(getInstallCommand('bun')).toBe('bun install');
    });

    it('should default to npm ci for unknown package manager', () => {
      expect(getInstallCommand('unknown' as PackageManager)).toBe('npm ci');
    });
  });

  describe('getInstallCommandUnfrozen', () => {
    it('should return regular install commands for local development', () => {
      expect(getInstallCommandUnfrozen('npm')).toBe('npm install');
      expect(getInstallCommandUnfrozen('pnpm')).toBe('pnpm install');
      expect(getInstallCommandUnfrozen('yarn')).toBe('yarn install');
      expect(getInstallCommandUnfrozen('bun')).toBe('bun install');
    });
  });

  describe('getDevInstallCommand', () => {
    it('should return dev dependency install commands', () => {
      expect(getDevInstallCommand('npm', 'typescript')).toBe('npm install --save-dev typescript');
      expect(getDevInstallCommand('pnpm', 'typescript')).toBe('pnpm add -D typescript');
      expect(getDevInstallCommand('yarn', 'typescript')).toBe('yarn add --dev typescript');
      expect(getDevInstallCommand('bun', 'typescript')).toBe('bun add --dev typescript');
    });

    it('should handle multiple packages', () => {
      expect(getDevInstallCommand('npm', 'vitest eslint')).toBe('npm install --save-dev vitest eslint');
      expect(getDevInstallCommand('pnpm', 'vitest eslint')).toBe('pnpm add -D vitest eslint');
    });
  });

  describe('getGlobalInstallCommand', () => {
    it('should return global install commands', () => {
      expect(getGlobalInstallCommand('npm', 'vibe-validate')).toBe('npm install -g vibe-validate');
      expect(getGlobalInstallCommand('pnpm', 'vibe-validate')).toBe('pnpm add -g vibe-validate');
      expect(getGlobalInstallCommand('yarn', 'vibe-validate')).toBe('yarn global add vibe-validate');
      expect(getGlobalInstallCommand('bun', 'vibe-validate')).toBe('bun add --global vibe-validate');
    });
  });

  describe('getAddCommand', () => {
    it('should return regular dependency install commands', () => {
      expect(getAddCommand('npm', 'react')).toBe('npm install react');
      expect(getAddCommand('pnpm', 'react')).toBe('pnpm add react');
      expect(getAddCommand('yarn', 'react')).toBe('yarn add react');
      expect(getAddCommand('bun', 'react')).toBe('bun add react');
    });
  });

  describe('getUpgradeCommand', () => {
    it('should return local upgrade commands', () => {
      expect(getUpgradeCommand('npm', 'vibe-validate', 'local')).toBe('npm install -D vibe-validate@latest');
      expect(getUpgradeCommand('pnpm', 'vibe-validate', 'local')).toBe('pnpm update vibe-validate');
      expect(getUpgradeCommand('yarn', 'vibe-validate', 'local')).toBe('yarn upgrade vibe-validate');
      expect(getUpgradeCommand('bun', 'vibe-validate', 'local')).toBe('bun update vibe-validate');
    });

    it('should return global upgrade commands', () => {
      expect(getUpgradeCommand('npm', 'vibe-validate', 'global')).toBe('npm install -g vibe-validate@latest');
      expect(getUpgradeCommand('pnpm', 'vibe-validate', 'global')).toBe('pnpm add -g vibe-validate@latest');
      expect(getUpgradeCommand('yarn', 'vibe-validate', 'global')).toBe('yarn global add vibe-validate@latest');
      expect(getUpgradeCommand('bun', 'vibe-validate', 'global')).toBe('bun add --global vibe-validate@latest');
    });

    it('should default to local scope', () => {
      expect(getUpgradeCommand('npm', 'vibe-validate')).toBe('npm install -D vibe-validate@latest');
    });
  });

  describe('getBuildCommand', () => {
    it('should return build commands', () => {
      expect(getBuildCommand('npm')).toBe('npm run build');
      expect(getBuildCommand('pnpm')).toBe('pnpm -r build');
      expect(getBuildCommand('yarn')).toBe('yarn run build');
      expect(getBuildCommand('bun')).toBe('bun run build');
    });
  });

  describe('getValidateCommand', () => {
    it('should return validate commands', () => {
      expect(getValidateCommand('npm')).toBe('npm run validate');
      expect(getValidateCommand('pnpm')).toBe('pnpm validate');
      expect(getValidateCommand('yarn')).toBe('yarn run validate');
      expect(getValidateCommand('bun')).toBe('bun run validate');
    });
  });

  describe('getCoverageCommand', () => {
    it('should return coverage commands', () => {
      expect(getCoverageCommand('npm')).toBe('npm run test:coverage');
      expect(getCoverageCommand('pnpm')).toBe('pnpm test:coverage');
      expect(getCoverageCommand('yarn')).toBe('yarn run test:coverage');
      expect(getCoverageCommand('bun')).toBe('bun run test:coverage');
    });
  });

  describe('getRunCommand', () => {
    it('should return run commands with script name', () => {
      expect(getRunCommand('npm', 'test')).toBe('npm run test');
      expect(getRunCommand('pnpm', 'test')).toBe('pnpm test');
      expect(getRunCommand('yarn', 'test')).toBe('yarn run test');
      expect(getRunCommand('bun', 'test')).toBe('bun run test');
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

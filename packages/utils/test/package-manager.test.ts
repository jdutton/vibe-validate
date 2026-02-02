/**
 * Tests for package-manager.ts
 *
 * Centralized npm/pnpm command execution
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import * as packageManager from '../src/package-manager.js';
import * as safeExec from '../src/safe-exec.js';

// Mock the safe-exec module
vi.mock('../src/safe-exec.js', () => ({
  safeExecSync: vi.fn(),
  safeExecResult: vi.fn(),
}));

describe('package-manager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getPackageVersion', () => {
    it('should return version when package exists', () => {
      vi.mocked(safeExec.safeExecResult).mockReturnValue({
        status: 0,
        stdout: '1.2.3\n',
        stderr: '',
      });

      const result = packageManager.getPackageVersion('test-package', '1.2.3');

      expect(result).toBe('1.2.3');
      expect(safeExec.safeExecResult).toHaveBeenCalledWith(
        'npm',
        ['view', 'test-package@1.2.3', 'version'],
        expect.objectContaining({
          encoding: 'utf8',
          stdio: 'pipe',
        })
      );
    });

    it('should return null when package does not exist', () => {
      vi.mocked(safeExec.safeExecResult).mockReturnValue({
        status: 1,
        stdout: '',
        stderr: 'npm ERR! 404 not found',
      });

      const result = packageManager.getPackageVersion('nonexistent-package', '1.0.0');

      expect(result).toBeNull();
    });

    it('should handle scoped packages', () => {
      vi.mocked(safeExec.safeExecResult).mockReturnValue({
        status: 0,
        stdout: '2.0.0\n',
        stderr: '',
      });

      const result = packageManager.getPackageVersion('@scope/package', 'latest');

      expect(result).toBe('2.0.0');
      expect(safeExec.safeExecResult).toHaveBeenCalledWith(
        'npm',
        ['view', '@scope/package@latest', 'version'],
        expect.anything()
      );
    });
  });

  describe('getLatestVersion', () => {
    it('should return latest version', () => {
      vi.mocked(safeExec.safeExecSync).mockReturnValue('3.0.0\n');

      const result = packageManager.getLatestVersion('test-package');

      expect(result).toBe('3.0.0');
      expect(safeExec.safeExecSync).toHaveBeenCalledWith(
        'npm',
        ['view', 'test-package', 'version'],
        expect.objectContaining({
          encoding: 'utf8',
          stdio: 'pipe',
        })
      );
    });

    it('should trim whitespace from version', () => {
      vi.mocked(safeExec.safeExecSync).mockReturnValue('  1.0.0  \n');

      const result = packageManager.getLatestVersion('test-package');

      expect(result).toBe('1.0.0');
    });
  });

  describe('packageExists', () => {
    it('should return true when package version exists', () => {
      vi.mocked(safeExec.safeExecResult).mockReturnValue({
        status: 0,
        stdout: '1.0.0\n',
        stderr: '',
      });

      const result = packageManager.packageExists('test-package', '1.0.0');

      expect(result).toBe(true);
    });

    it('should return false when package version does not exist', () => {
      vi.mocked(safeExec.safeExecResult).mockReturnValue({
        status: 1,
        stdout: '',
        stderr: 'npm ERR! 404',
      });

      const result = packageManager.packageExists('test-package', '99.0.0');

      expect(result).toBe(false);
    });
  });

  describe('publishPackage', () => {
    it('should publish package with default options', () => {
      vi.mocked(safeExec.safeExecSync).mockReturnValue('');

      packageManager.publishPackage({
        cwd: '/test/package',
        tag: 'latest',
      });

      expect(safeExec.safeExecSync).toHaveBeenCalledWith(
        'pnpm',
        ['publish', '--no-git-checks', '--tag', 'latest'],
        expect.objectContaining({
          cwd: '/test/package',
          stdio: 'pipe',
        })
      );
    });

    it('should publish package with custom stdio', () => {
      vi.mocked(safeExec.safeExecSync).mockReturnValue('');

      packageManager.publishPackage({
        cwd: '/test/package',
        tag: 'rc',
        stdio: 'inherit',
      });

      expect(safeExec.safeExecSync).toHaveBeenCalledWith(
        'pnpm',
        ['publish', '--no-git-checks', '--tag', 'rc'],
        expect.objectContaining({
          stdio: 'inherit',
        })
      );
    });
  });

  describe('addDistTag', () => {
    it('should add dist tag to package', () => {
      vi.mocked(safeExec.safeExecSync).mockReturnValue('');

      packageManager.addDistTag('@scope/package', '1.0.0', 'latest');

      expect(safeExec.safeExecSync).toHaveBeenCalledWith(
        'npm',
        ['dist-tag', 'add', '@scope/package@1.0.0', 'latest'],
        expect.objectContaining({
          stdio: 'pipe',
        })
      );
    });
  });

  describe('unpublishPackage', () => {
    it('should return true when unpublish succeeds', () => {
      vi.mocked(safeExec.safeExecResult).mockReturnValue({
        status: 0,
        stdout: '',
        stderr: '',
      });

      const result = packageManager.unpublishPackage('@scope/package', '1.0.0');

      expect(result).toBe(true);
      expect(safeExec.safeExecResult).toHaveBeenCalledWith(
        'npm',
        ['unpublish', '@scope/package@1.0.0', '--force'],
        expect.objectContaining({
          stdio: 'pipe',
        })
      );
    });

    it('should return false when unpublish fails', () => {
      vi.mocked(safeExec.safeExecResult).mockReturnValue({
        status: 1,
        stdout: '',
        stderr: 'npm ERR! unpublish failed',
      });

      const result = packageManager.unpublishPackage('@scope/package', '1.0.0');

      expect(result).toBe(false);
    });
  });

  describe('deprecatePackage', () => {
    it('should return true when deprecate succeeds', () => {
      vi.mocked(safeExec.safeExecResult).mockReturnValue({
        status: 0,
        stdout: '',
        stderr: '',
      });

      const result = packageManager.deprecatePackage(
        '@scope/package',
        '1.0.0',
        'Use version 2.0.0 instead'
      );

      expect(result).toBe(true);
      expect(safeExec.safeExecResult).toHaveBeenCalledWith(
        'npm',
        ['deprecate', '@scope/package@1.0.0', 'Use version 2.0.0 instead'],
        expect.objectContaining({
          stdio: 'pipe',
        })
      );
    });

    it('should return false when deprecate fails', () => {
      vi.mocked(safeExec.safeExecResult).mockReturnValue({
        status: 1,
        stdout: '',
        stderr: 'npm ERR! deprecate failed',
      });

      const result = packageManager.deprecatePackage('@scope/package', '1.0.0', 'Deprecated');

      expect(result).toBe(false);
    });
  });

  describe('installPackage', () => {
    it('should install package from tarball', () => {
      vi.mocked(safeExec.safeExecSync).mockReturnValue('');

      // NOSONAR - test paths, never actually used
      packageManager.installPackage('/test/package.tgz', '/test/install-dir');

      expect(safeExec.safeExecSync).toHaveBeenCalledWith(
        'npm',
        ['install', '/test/package.tgz'],
        expect.objectContaining({
          cwd: '/test/install-dir',
          stdio: 'pipe',
        })
      );
    });
  });

  describe('executePnpmCommand', () => {
    it('should execute pnpm command with default options', () => {
      vi.mocked(safeExec.safeExecSync).mockReturnValue('output\n');

      const result = packageManager.executePnpmCommand(['validate']);

      expect(result).toBe('output\n');
      expect(safeExec.safeExecSync).toHaveBeenCalledWith(
        'pnpm',
        ['validate'],
        expect.objectContaining({
          encoding: 'utf8',
          stdio: 'pipe',
        })
      );
    });

    it('should execute pnpm command with custom options', () => {
      vi.mocked(safeExec.safeExecSync).mockReturnValue('');

      packageManager.executePnpmCommand(['build'], {
        cwd: '/test/dir',
        stdio: 'inherit',
        timeout: 60000,
        env: { NODE_ENV: 'production' },
      });

      expect(safeExec.safeExecSync).toHaveBeenCalledWith(
        'pnpm',
        ['build'],
        expect.objectContaining({
          cwd: '/test/dir',
          stdio: 'inherit',
          timeout: 60000,
          env: { NODE_ENV: 'production' },
        })
      );
    });

    it('should handle array stdio option', () => {
      vi.mocked(safeExec.safeExecSync).mockReturnValue('');

      packageManager.executePnpmCommand(['test'], {
        stdio: ['inherit', 'inherit', 'inherit'],
      });

      expect(safeExec.safeExecSync).toHaveBeenCalledWith(
        'pnpm',
        ['test'],
        expect.objectContaining({
          stdio: ['inherit', 'inherit', 'inherit'],
        })
      );
    });
  });
});

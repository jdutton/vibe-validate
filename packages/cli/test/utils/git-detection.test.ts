import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  detectGitConfig,
  findGitRoot,
  resolveProjectPath,
  projectFileExists,
  readProjectFile,
} from '../../src/utils/git-detection.js';

// Mock @vibe-validate/git instead of child_process
vi.mock('@vibe-validate/git', async () => {
  const actual = await vi.importActual<typeof import('@vibe-validate/git')>('@vibe-validate/git');
  return {
    ...actual,
    isGitRepository: vi.fn(() => true),
    executeGitCommand: vi.fn((_args: string[]) => {
      // Default mock - tests will override
      return { success: true, stdout: '', stderr: '', exitCode: 0 };
    }),
  };
});

describe('git-detection', () => {
  beforeEach(async () => {
    // Reset mocks to default implementation
    const { isGitRepository, executeGitCommand } = await import('@vibe-validate/git');
    vi.mocked(isGitRepository).mockReturnValue(true);
    vi.mocked(executeGitCommand).mockImplementation(() => {
      return { success: true, stdout: '', stderr: '', exitCode: 0 };
    });
  });

  describe('detectGitConfig', () => {
    it('should return defaults when not in a git repository', async () => {
      // Arrange: isGitRepository returns false
      const { isGitRepository } = await import('@vibe-validate/git');
      vi.mocked(isGitRepository).mockReturnValue(false);

      // Act
      const result = detectGitConfig();

      // Assert
      expect(result).toEqual({
        mainBranch: 'main',
        remoteOrigin: 'origin',
        detected: false,
      });
    });

    it('should detect main branch from remote HEAD', async () => {
      // Arrange
      const { executeGitCommand } = await import('@vibe-validate/git');
      vi.mocked(executeGitCommand).mockImplementation((args: string[]) => {
        const cmd = args.join(' ');
        if (cmd === 'remote') {
          return { success: true, stdout: 'origin', stderr: '', exitCode: 0 };
        }
        if (cmd === 'symbolic-ref refs/remotes/origin/HEAD') {
          return { success: true, stdout: 'refs/remotes/origin/main', stderr: '', exitCode: 0 };
        }
        return { success: false, stdout: '', stderr: `Unexpected command: ${cmd}`, exitCode: 1 };
      });

      // Act
      const result = detectGitConfig();

      // Assert
      expect(result).toEqual({
        mainBranch: 'main',
        remoteOrigin: 'origin',
        detected: true,
      });
    });

    it('should detect master branch from remote HEAD', async () => {
      // Arrange
      const { executeGitCommand } = await import('@vibe-validate/git');
      vi.mocked(executeGitCommand).mockImplementation((args: string[]) => {
        const cmd = args.join(' ');
        if (cmd === 'remote') {
          return { success: true, stdout: 'origin', stderr: '', exitCode: 0 };
        }
        if (cmd === 'symbolic-ref refs/remotes/origin/HEAD') {
          return { success: true, stdout: 'refs/remotes/origin/master', stderr: '', exitCode: 0 };
        }
        return { success: false, stdout: '', stderr: `Unexpected command: ${cmd}`, exitCode: 1 };
      });

      // Act
      const result = detectGitConfig();

      // Assert
      expect(result).toEqual({
        mainBranch: 'master',
        remoteOrigin: 'origin',
        detected: true,
      });
    });

    it('should prefer upstream over origin remote', async () => {
      // Arrange
      const { executeGitCommand } = await import('@vibe-validate/git');
      vi.mocked(executeGitCommand).mockImplementation((args: string[]) => {
        const cmd = args.join(' ');
        if (cmd === 'remote') {
          return { success: true, stdout: 'origin\nupstream', stderr: '', exitCode: 0 };
        }
        if (cmd === 'symbolic-ref refs/remotes/upstream/HEAD') {
          return { success: true, stdout: 'refs/remotes/upstream/main', stderr: '', exitCode: 0 };
        }
        return { success: false, stdout: '', stderr: `Unexpected command: ${cmd}`, exitCode: 1 };
      });

      // Act
      const result = detectGitConfig();

      // Assert
      expect(result).toEqual({
        mainBranch: 'main',
        remoteOrigin: 'upstream',
        detected: true,
      });
    });

    it('should use first remote if neither origin nor upstream exists', async () => {
      // Arrange
      const { executeGitCommand } = await import('@vibe-validate/git');
      vi.mocked(executeGitCommand).mockImplementation((args: string[]) => {
        const cmd = args.join(' ');
        if (cmd === 'remote') {
          return { success: true, stdout: 'custom-remote', stderr: '', exitCode: 0 };
        }
        if (cmd === 'symbolic-ref refs/remotes/custom-remote/HEAD') {
          return { success: true, stdout: 'refs/remotes/custom-remote/develop', stderr: '', exitCode: 0 };
        }
        return { success: false, stdout: '', stderr: `Unexpected command: ${cmd}`, exitCode: 1 };
      });

      // Act
      const result = detectGitConfig();

      // Assert
      expect(result).toEqual({
        mainBranch: 'develop',
        remoteOrigin: 'custom-remote',
        detected: true,
      });
    });

    it('should detect main from ls-remote when symbolic-ref fails', async () => {
      // Arrange
      const { executeGitCommand } = await import('@vibe-validate/git');
      vi.mocked(executeGitCommand).mockImplementation((args: string[]) => {
        const cmd = args.join(' ');
        if (cmd === 'remote') {
          return { success: true, stdout: 'origin', stderr: '', exitCode: 0 };
        }
        if (cmd === 'symbolic-ref refs/remotes/origin/HEAD') {
          return { success: false, stdout: '', stderr: 'Remote HEAD not set', exitCode: 1 };
        }
        if (cmd === 'ls-remote --heads origin') {
          return { success: true, stdout: 'abc123\trefs/heads/main\ndef456\trefs/heads/feature', stderr: '', exitCode: 0 };
        }
        return { success: false, stdout: '', stderr: `Unexpected command: ${cmd}`, exitCode: 1 };
      });

      // Act
      const result = detectGitConfig();

      // Assert
      expect(result).toEqual({
        mainBranch: 'main',
        remoteOrigin: 'origin',
        detected: true,
      });
    });

    it('should detect master from ls-remote when main does not exist', async () => {
      // Arrange
      const { executeGitCommand } = await import('@vibe-validate/git');
      vi.mocked(executeGitCommand).mockImplementation((args: string[]) => {
        const cmd = args.join(' ');
        if (cmd === 'remote') {
          return { success: true, stdout: 'origin', stderr: '', exitCode: 0 };
        }
        if (cmd === 'symbolic-ref refs/remotes/origin/HEAD') {
          return { success: false, stdout: '', stderr: 'Remote HEAD not set', exitCode: 1 };
        }
        if (cmd === 'ls-remote --heads origin') {
          return { success: true, stdout: 'abc123\trefs/heads/master\ndef456\trefs/heads/feature', stderr: '', exitCode: 0 };
        }
        return { success: false, stdout: '', stderr: `Unexpected command: ${cmd}`, exitCode: 1 };
      });

      // Act
      const result = detectGitConfig();

      // Assert
      expect(result).toEqual({
        mainBranch: 'master',
        remoteOrigin: 'origin',
        detected: true,
      });
    });

    it('should detect develop from ls-remote when main and master do not exist', async () => {
      // Arrange
      const { executeGitCommand } = await import('@vibe-validate/git');
      vi.mocked(executeGitCommand).mockImplementation((args: string[]) => {
        const cmd = args.join(' ');
        if (cmd === 'remote') {
          return { success: true, stdout: 'origin', stderr: '', exitCode: 0 };
        }
        if (cmd === 'symbolic-ref refs/remotes/origin/HEAD') {
          return { success: false, stdout: '', stderr: 'Remote HEAD not set', exitCode: 1 };
        }
        if (cmd === 'ls-remote --heads origin') {
          return { success: true, stdout: 'abc123\trefs/heads/develop\ndef456\trefs/heads/feature', stderr: '', exitCode: 0 };
        }
        return { success: false, stdout: '', stderr: `Unexpected command: ${cmd}`, exitCode: 1 };
      });

      // Act
      const result = detectGitConfig();

      // Assert
      expect(result).toEqual({
        mainBranch: 'develop',
        remoteOrigin: 'origin',
        detected: true,
      });
    });

    it('should return defaults when no remotes exist', async () => {
      // Arrange
      const { executeGitCommand } = await import('@vibe-validate/git');
      vi.mocked(executeGitCommand).mockImplementation((args: string[]) => {
        const cmd = args.join(' ');
        if (cmd === 'remote') {
          return { success: true, stdout: '', stderr: '', exitCode: 0 };
        }
        return { success: false, stdout: '', stderr: `Unexpected command: ${cmd}`, exitCode: 1 };
      });

      // Act
      const result = detectGitConfig();

      // Assert
      expect(result).toEqual({
        mainBranch: 'main',
        remoteOrigin: 'origin',
        detected: false,
      });
    });

    it('should return defaults when ls-remote fails', async () => {
      // Arrange
      const { executeGitCommand } = await import('@vibe-validate/git');
      vi.mocked(executeGitCommand).mockImplementation((args: string[]) => {
        const cmd = args.join(' ');
        if (cmd === 'remote') {
          return { success: true, stdout: 'origin', stderr: '', exitCode: 0 };
        }
        if (cmd === 'symbolic-ref refs/remotes/origin/HEAD') {
          return { success: false, stdout: '', stderr: 'Remote HEAD not set', exitCode: 1 };
        }
        if (cmd === 'ls-remote --heads origin') {
          return { success: false, stdout: '', stderr: 'Network error', exitCode: 1 };
        }
        return { success: false, stdout: '', stderr: `Unexpected command: ${cmd}`, exitCode: 1 };
      });

      // Act
      const result = detectGitConfig();

      // Assert
      expect(result).toEqual({
        mainBranch: 'main',
        remoteOrigin: 'origin',
        detected: false,
      });
    });

    it('should return defaults when git remote command fails', async () => {
      // Arrange
      const { executeGitCommand } = await import('@vibe-validate/git');
      vi.mocked(executeGitCommand).mockImplementation((args: string[]) => {
        const cmd = args.join(' ');
        if (cmd === 'remote') {
          return { success: false, stdout: '', stderr: 'Git error', exitCode: 1 };
        }
        return { success: false, stdout: '', stderr: `Unexpected command: ${cmd}`, exitCode: 1 };
      });

      // Act
      const result = detectGitConfig();

      // Assert
      expect(result).toEqual({
        mainBranch: 'main',
        remoteOrigin: 'origin',
        detected: false,
      });
    });
  });

  describe('findGitRoot', () => {
    const testRoot = join(process.cwd(), 'test-temp-git-root');
    const testSubdir = join(testRoot, 'packages', 'cli');

    beforeEach(() => {
      // Create test directory structure with .git
      mkdirSync(join(testRoot, '.git'), { recursive: true });
      mkdirSync(testSubdir, { recursive: true });
    });

    afterEach(() => {
      // Clean up test directories
      if (existsSync(testRoot)) {
        rmSync(testRoot, { recursive: true, force: true });
      }
    });

    it('should find git root from repository root', () => {
      // Act
      const result = findGitRoot(testRoot);

      // Assert
      expect(result).toBe(testRoot);
    });

    it('should find git root from subdirectory', () => {
      // Act
      const result = findGitRoot(testSubdir);

      // Assert
      expect(result).toBe(testRoot);
    });

    it('should find git root from deeply nested subdirectory', () => {
      // Arrange
      const deepSubdir = join(testSubdir, 'src', 'commands', 'subdir');
      mkdirSync(deepSubdir, { recursive: true });

      // Act
      const result = findGitRoot(deepSubdir);

      // Assert
      expect(result).toBe(testRoot);
    });

    it('should return null when not in git repository', () => {
      // Arrange: Use /tmp which is outside any git repo
      const nonGitDir = join('/tmp', 'test-temp-non-git-' + Date.now());
      mkdirSync(nonGitDir, { recursive: true });

      try {
        // Act
        const result = findGitRoot(nonGitDir);

        // Assert
        expect(result).toBeNull();
      } finally {
        // Cleanup
        rmSync(nonGitDir, { recursive: true, force: true });
      }
    });

    it('should use process.cwd() when startDir not provided', () => {
      // Arrange: current working directory should be in vibe-validate repo
      // Act
      const result = findGitRoot();

      // Assert: should find vibe-validate git root
      expect(result).not.toBeNull();
      expect(result).toContain('vibe-validate');
    });

    it('should handle directory at filesystem root', () => {
      // Act
      const result = findGitRoot('/');

      // Assert: filesystem root unlikely to be git repo
      expect(result).toBeNull();
    });
  });

  describe('resolveProjectPath', () => {
    const testRoot = join(process.cwd(), 'test-temp-resolve-path');
    const testSubdir = join(testRoot, 'packages', 'cli');

    beforeEach(() => {
      // Create test directory structure with .git
      mkdirSync(join(testRoot, '.git'), { recursive: true });
      mkdirSync(testSubdir, { recursive: true });
    });

    afterEach(() => {
      // Clean up test directories
      if (existsSync(testRoot)) {
        rmSync(testRoot, { recursive: true, force: true });
      }
    });

    it('should resolve path relative to git root from root directory', () => {
      // Act
      const result = resolveProjectPath('.github/workflows/validate.yml', testRoot);

      // Assert
      expect(result).toBe(join(testRoot, '.github/workflows/validate.yml'));
    });

    it('should resolve path relative to git root from subdirectory', () => {
      // Act
      const result = resolveProjectPath('.github/workflows/validate.yml', testSubdir);

      // Assert
      expect(result).toBe(join(testRoot, '.github/workflows/validate.yml'));
    });

    it('should return null when not in git repository', () => {
      // Arrange: Use /tmp which is outside any git repo
      const nonGitDir = join('/tmp', 'test-temp-non-git-resolve-' + Date.now());
      mkdirSync(nonGitDir, { recursive: true });

      try {
        // Act
        const result = resolveProjectPath('.github/workflows/validate.yml', nonGitDir);

        // Assert
        expect(result).toBeNull();
      } finally {
        // Cleanup
        rmSync(nonGitDir, { recursive: true, force: true });
      }
    });

    it('should handle nested relative paths', () => {
      // Act
      const result = resolveProjectPath('packages/cli/src/commands/doctor.ts', testRoot);

      // Assert
      expect(result).toBe(join(testRoot, 'packages/cli/src/commands/doctor.ts'));
    });

    it('should use process.cwd() when startDir not provided', () => {
      // Act
      const result = resolveProjectPath('.github/workflows/validate.yml');

      // Assert: should find vibe-validate git root
      expect(result).not.toBeNull();
      expect(result).toContain('vibe-validate');
      expect(result).toContain('.github/workflows/validate.yml');
    });
  });

  describe('projectFileExists', () => {
    const testRoot = join(process.cwd(), 'test-temp-file-exists');
    const testSubdir = join(testRoot, 'packages', 'cli');

    beforeEach(() => {
      // Create test directory structure with .git
      mkdirSync(join(testRoot, '.git'), { recursive: true });
      mkdirSync(testSubdir, { recursive: true });

      // Create a test file at git root
      mkdirSync(join(testRoot, '.github', 'workflows'), { recursive: true });
      writeFileSync(join(testRoot, '.github/workflows/validate.yml'), 'test content');
    });

    afterEach(() => {
      // Clean up test directories
      if (existsSync(testRoot)) {
        rmSync(testRoot, { recursive: true, force: true });
      }
    });

    it('should return true when file exists at git root (from root)', () => {
      // Act
      const result = projectFileExists('.github/workflows/validate.yml', testRoot);

      // Assert
      expect(result).toBe(true);
    });

    it('should return true when file exists at git root (from subdirectory)', () => {
      // Act
      const result = projectFileExists('.github/workflows/validate.yml', testSubdir);

      // Assert
      expect(result).toBe(true);
    });

    it('should return false when file does not exist', () => {
      // Act
      const result = projectFileExists('.github/workflows/nonexistent.yml', testRoot);

      // Assert
      expect(result).toBe(false);
    });

    it('should return false when not in git repository', () => {
      // Arrange: Use /tmp which is outside any git repo
      const nonGitDir = join('/tmp', 'test-temp-non-git-exists-' + Date.now());
      mkdirSync(nonGitDir, { recursive: true });

      try {
        // Act
        const result = projectFileExists('.github/workflows/validate.yml', nonGitDir);

        // Assert
        expect(result).toBe(false);
      } finally {
        // Cleanup
        rmSync(nonGitDir, { recursive: true, force: true });
      }
    });

    it('should use process.cwd() when startDir not provided', () => {
      // Act - testing with actual vibe-validate repo
      const result = projectFileExists('.github/workflows/validate.yml');

      // Assert: vibe-validate has workflow file
      expect(result).toBe(true);
    });
  });

  describe('readProjectFile', () => {
    const testRoot = join(process.cwd(), 'test-temp-read-file');
    const testSubdir = join(testRoot, 'packages', 'cli');
    const testContent = 'test workflow content\nline 2';

    beforeEach(() => {
      // Create test directory structure with .git
      mkdirSync(join(testRoot, '.git'), { recursive: true });
      mkdirSync(testSubdir, { recursive: true });

      // Create a test file at git root
      mkdirSync(join(testRoot, '.github', 'workflows'), { recursive: true });
      writeFileSync(join(testRoot, '.github/workflows/validate.yml'), testContent);
    });

    afterEach(() => {
      // Clean up test directories
      if (existsSync(testRoot)) {
        rmSync(testRoot, { recursive: true, force: true });
      }
    });

    it('should read file content from git root (from root)', () => {
      // Act
      const result = readProjectFile('.github/workflows/validate.yml', 'utf8', testRoot);

      // Assert
      expect(result).toBe(testContent);
    });

    it('should read file content from git root (from subdirectory)', () => {
      // Act
      const result = readProjectFile('.github/workflows/validate.yml', 'utf8', testSubdir);

      // Assert
      expect(result).toBe(testContent);
    });

    it('should return null when file does not exist', () => {
      // Act
      const result = readProjectFile('.github/workflows/nonexistent.yml', 'utf8', testRoot);

      // Assert
      expect(result).toBeNull();
    });

    it('should return null when not in git repository', () => {
      // Arrange: Use /tmp which is outside any git repo
      const nonGitDir = join('/tmp', 'test-temp-non-git-read-' + Date.now());
      mkdirSync(nonGitDir, { recursive: true });

      try {
        // Act
        const result = readProjectFile('.github/workflows/validate.yml', 'utf8', nonGitDir);

        // Assert
        expect(result).toBeNull();
      } finally {
        // Cleanup
        rmSync(nonGitDir, { recursive: true, force: true });
      }
    });

    it('should use default encoding (utf8) when not specified', () => {
      // Act
      const result = readProjectFile('.github/workflows/validate.yml', undefined, testRoot);

      // Assert
      expect(result).toBe(testContent);
    });

    it('should handle different encodings', () => {
      // Arrange
      const binaryContent = Buffer.from([0x48, 0x65, 0x6c, 0x6c, 0x6f]); // "Hello"
      writeFileSync(join(testRoot, '.github/workflows/binary.yml'), binaryContent);

      // Act
      const result = readProjectFile('.github/workflows/binary.yml', 'utf8', testRoot);

      // Assert
      expect(result).toBe('Hello');
    });

    it('should use process.cwd() when startDir not provided', () => {
      // Act - testing with actual vibe-validate repo
      const result = readProjectFile('.github/workflows/validate.yml');

      // Assert: vibe-validate has workflow file with content
      expect(result).not.toBeNull();
      expect(result).toContain('name:'); // YAML workflow has name field
    });

    // Note: Testing permission errors is difficult and platform-specific
    // The try-catch in readProjectFile() will handle EACCES and other read errors
    // returning null, but we can't reliably test this across all platforms
  });
});

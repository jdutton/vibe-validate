import { existsSync,  writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import { mkdirSyncReal } from '@vibe-validate/utils';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  detectGitConfig,
  findGitRoot,
  resolveProjectPath,
  projectFileExists,
  readProjectFile,
} from '../../src/utils/git-detection.js';

// Mock @vibe-validate/utils instead of child_process
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

  /**
   * Helper: Create test directory structure with .git and optional test file
   * @param rootName Directory name for test root
   * @param options Optional configuration for test file creation
   */
  function createTestGitStructure(
    rootName: string,
    options: { createTestFile?: boolean; fileContent?: string } = {}
  ): {
    testRoot: string;
    testSubdir: string;
    cleanup: () => void;
  } {
    const { createTestFile = false, fileContent = 'test content' } = options;
    const testRoot = join(process.cwd(), rootName);
    const testSubdir = join(testRoot, 'packages', 'cli');

    // Create test directory structure with .git
    mkdirSyncReal(join(testRoot, '.git'), { recursive: true });
    mkdirSyncReal(testSubdir, { recursive: true });

    // Optionally create a test file at git root
    if (createTestFile) {
      mkdirSyncReal(join(testRoot, '.github', 'workflows'), { recursive: true });
      writeFileSync(join(testRoot, '.github/workflows/validate.yml'), fileContent);
    }

    return {
      testRoot,
      testSubdir,
      cleanup: () => {
        if (existsSync(testRoot)) {
          rmSync(testRoot, { recursive: true, force: true });
        }
      },
    };
  }

  /**
   * Helper: Create mock for executeGitCommand with command → response mapping
   * @param responses Map of command string to git command result
   * @returns Mock implementation function
   */
  function mockGitCommand(responses: Record<string, { success: boolean; stdout: string; stderr: string; exitCode: number }>) {
    return (args: string[]) => {
      const cmd = args.join(' ');
      if (cmd in responses) {
        return responses[cmd];
      }
      return { success: false, stdout: '', stderr: `Unexpected command: ${cmd}`, exitCode: 1 };
    };
  }

  /**
   * Helper: Setup executeGitCommand mock with responses
   * @param responses Map of command string to git command result
   */
  async function setupGitCommandMock(responses: Record<string, { success: boolean; stdout: string; stderr: string; exitCode: number }>) {
    const { executeGitCommand } = await import('@vibe-validate/git');
    vi.mocked(executeGitCommand).mockImplementation(mockGitCommand(responses));
  }

  /**
   * Helper: Create successful git command response
   */
  function successResponse(stdout: string) {
    return { success: true, stdout, stderr: '', exitCode: 0 };
  }

  /**
   * Helper: Create failed git command response
   */
  function failureResponse(stderr: string) {
    return { success: false, stdout: '', stderr, exitCode: 1 };
  }

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
      await setupGitCommandMock({
        'remote': successResponse('origin'),
        'symbolic-ref refs/remotes/origin/HEAD': successResponse('refs/remotes/origin/main'),
      });

      const result = detectGitConfig();

      expect(result).toEqual({
        mainBranch: 'main',
        remoteOrigin: 'origin',
        detected: true,
      });
    });

    it('should detect master branch from remote HEAD', async () => {
      await setupGitCommandMock({
        'remote': successResponse('origin'),
        'symbolic-ref refs/remotes/origin/HEAD': successResponse('refs/remotes/origin/master'),
      });

      const result = detectGitConfig();

      expect(result).toEqual({
        mainBranch: 'master',
        remoteOrigin: 'origin',
        detected: true,
      });
    });

    it('should prefer upstream over origin remote', async () => {
      await setupGitCommandMock({
        'remote': successResponse('origin\nupstream'),
        'symbolic-ref refs/remotes/upstream/HEAD': successResponse('refs/remotes/upstream/main'),
      });

      const result = detectGitConfig();

      expect(result).toEqual({
        mainBranch: 'main',
        remoteOrigin: 'upstream',
        detected: true,
      });
    });

    it('should use first remote if neither origin nor upstream exists', async () => {
      await setupGitCommandMock({
        'remote': successResponse('custom-remote'),
        'symbolic-ref refs/remotes/custom-remote/HEAD': successResponse('refs/remotes/custom-remote/develop'),
      });

      const result = detectGitConfig();

      expect(result).toEqual({
        mainBranch: 'develop',
        remoteOrigin: 'custom-remote',
        detected: true,
      });
    });

    it('should detect main from ls-remote when symbolic-ref fails', async () => {
      await setupGitCommandMock({
        'remote': successResponse('origin'),
        'symbolic-ref refs/remotes/origin/HEAD': failureResponse('Remote HEAD not set'),
        'ls-remote --heads origin': successResponse('abc123\trefs/heads/main\ndef456\trefs/heads/feature'),
      });

      const result = detectGitConfig();

      expect(result).toEqual({
        mainBranch: 'main',
        remoteOrigin: 'origin',
        detected: true,
      });
    });

    it('should detect master from ls-remote when main does not exist', async () => {
      await setupGitCommandMock({
        'remote': successResponse('origin'),
        'symbolic-ref refs/remotes/origin/HEAD': failureResponse('Remote HEAD not set'),
        'ls-remote --heads origin': successResponse('abc123\trefs/heads/master\ndef456\trefs/heads/feature'),
      });

      const result = detectGitConfig();

      expect(result).toEqual({
        mainBranch: 'master',
        remoteOrigin: 'origin',
        detected: true,
      });
    });

    it('should detect develop from ls-remote when main and master do not exist', async () => {
      await setupGitCommandMock({
        'remote': successResponse('origin'),
        'symbolic-ref refs/remotes/origin/HEAD': failureResponse('Remote HEAD not set'),
        'ls-remote --heads origin': successResponse('abc123\trefs/heads/develop\ndef456\trefs/heads/feature'),
      });

      const result = detectGitConfig();

      expect(result).toEqual({
        mainBranch: 'develop',
        remoteOrigin: 'origin',
        detected: true,
      });
    });

    it('should return defaults when no remotes exist', async () => {
      await setupGitCommandMock({
        'remote': successResponse(''),
      });

      const result = detectGitConfig();

      expect(result).toEqual({
        mainBranch: 'main',
        remoteOrigin: 'origin',
        detected: false,
      });
    });

    it('should return defaults when ls-remote fails', async () => {
      await setupGitCommandMock({
        'remote': successResponse('origin'),
        'symbolic-ref refs/remotes/origin/HEAD': failureResponse('Remote HEAD not set'),
        'ls-remote --heads origin': failureResponse('Network error'),
      });

      const result = detectGitConfig();

      expect(result).toEqual({
        mainBranch: 'main',
        remoteOrigin: 'origin',
        detected: false,
      });
    });

    it('should return defaults when git remote command fails', async () => {
      await setupGitCommandMock({
        'remote': failureResponse('Git error'),
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
    let testEnv: ReturnType<typeof createTestGitStructure>;

    beforeEach(() => {
      testEnv = createTestGitStructure('test-temp-git-root');
    });

    afterEach(() => {
      testEnv.cleanup();
    });

    it('should find git root from repository root', () => {
      const result = findGitRoot(testEnv.testRoot);
      expect(result).toBe(testEnv.testRoot);
    });

    it('should find git root from subdirectory', () => {
      const result = findGitRoot(testEnv.testSubdir);
      expect(result).toBe(testEnv.testRoot);
    });

    it('should find git root from deeply nested subdirectory', () => {
      const deepSubdir = join(testEnv.testSubdir, 'src', 'commands', 'subdir');
      mkdirSyncReal(deepSubdir, { recursive: true });

      const result = findGitRoot(deepSubdir);
      expect(result).toBe(testEnv.testRoot);
    });

    it('should return null when not in git repository', () => {
      // Arrange: Use /tmp which is outside any git repo
      const nonGitDir = join('/tmp', 'test-temp-non-git-' + Date.now());
      mkdirSyncReal(nonGitDir, { recursive: true });

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
    let testEnv: ReturnType<typeof createTestGitStructure>;

    beforeEach(() => {
      testEnv = createTestGitStructure('test-temp-resolve-path');
    });

    afterEach(() => {
      testEnv.cleanup();
    });

    it('should resolve path relative to git root from root directory', () => {
      const result = resolveProjectPath('.github/workflows/validate.yml', testEnv.testRoot);
      expect(result).toBe(join(testEnv.testRoot, '.github/workflows/validate.yml'));
    });

    it('should resolve path relative to git root from subdirectory', () => {
      const result = resolveProjectPath('.github/workflows/validate.yml', testEnv.testSubdir);
      expect(result).toBe(join(testEnv.testRoot, '.github/workflows/validate.yml'));
    });

    it('should return null when not in git repository', () => {
      const nonGitDir = join('/tmp', 'test-temp-non-git-resolve-' + Date.now());
      mkdirSyncReal(nonGitDir, { recursive: true });

      try {
        const result = resolveProjectPath('.github/workflows/validate.yml', nonGitDir);
        expect(result).toBeNull();
      } finally {
        rmSync(nonGitDir, { recursive: true, force: true });
      }
    });

    it('should handle nested relative paths', () => {
      const result = resolveProjectPath('packages/cli/src/commands/doctor.ts', testEnv.testRoot);
      expect(result).toBe(join(testEnv.testRoot, 'packages/cli/src/commands/doctor.ts'));
    });

    it('should use process.cwd() when startDir not provided', () => {
      // Act
      const result = resolveProjectPath('.github/workflows/validate.yml');

      // Assert: should find vibe-validate git root
      expect(result).not.toBeNull();
      expect(result).toContain('vibe-validate');
      // Normalize paths for cross-platform comparison (Windows uses backslashes)
      expect(result?.replaceAll('\\', '/')).toContain('.github/workflows/validate.yml');
    });
  });

  describe('projectFileExists', () => {
    let testEnv: ReturnType<typeof createTestGitStructure>;

    beforeEach(() => {
      testEnv = createTestGitStructure('test-temp-file-exists', { createTestFile: true });
    });

    afterEach(() => {
      testEnv.cleanup();
    });

    it('should return true when file exists at git root (from root)', () => {
      // Act
      const result = projectFileExists('.github/workflows/validate.yml', testEnv.testRoot);

      // Assert
      expect(result).toBe(true);
    });

    it('should return true when file exists at git root (from subdirectory)', () => {
      // Act
      const result = projectFileExists('.github/workflows/validate.yml', testEnv.testSubdir);

      // Assert
      expect(result).toBe(true);
    });

    it('should return false when file does not exist', () => {
      // Act
      const result = projectFileExists('.github/workflows/nonexistent.yml', testEnv.testRoot);

      // Assert
      expect(result).toBe(false);
    });

    it('should return false when not in git repository', () => {
      // Arrange: Use /tmp which is outside any git repo
      const nonGitDir = join('/tmp', 'test-temp-non-git-exists-' + Date.now());
      mkdirSyncReal(nonGitDir, { recursive: true });

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
    const testContent = 'test workflow content\nline 2';
    let testEnv: ReturnType<typeof createTestGitStructure>;

    beforeEach(() => {
      testEnv = createTestGitStructure('test-temp-read-file', { createTestFile: true, fileContent: testContent });
    });

    afterEach(() => {
      testEnv.cleanup();
    });

    it('should read file content from git root (from root)', () => {
      // Act
      const result = readProjectFile('.github/workflows/validate.yml', 'utf8', testEnv.testRoot);

      // Assert
      expect(result).toBe(testContent);
    });

    it('should read file content from git root (from subdirectory)', () => {
      // Act
      const result = readProjectFile('.github/workflows/validate.yml', 'utf8', testEnv.testSubdir);

      // Assert
      expect(result).toBe(testContent);
    });

    it('should return null when file does not exist', () => {
      // Act
      const result = readProjectFile('.github/workflows/nonexistent.yml', 'utf8', testEnv.testRoot);

      // Assert
      expect(result).toBeNull();
    });

    it('should return null when not in git repository', () => {
      // Arrange: Use /tmp which is outside any git repo
      const nonGitDir = join('/tmp', 'test-temp-non-git-read-' + Date.now());
      mkdirSyncReal(nonGitDir, { recursive: true });

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
      const result = readProjectFile('.github/workflows/validate.yml', undefined, testEnv.testRoot);

      // Assert
      expect(result).toBe(testContent);
    });

    it('should handle different encodings', () => {
      // Arrange
      const binaryContent = Buffer.from([0x48, 0x65, 0x6c, 0x6c, 0x6f]); // "Hello"
      writeFileSync(join(testEnv.testRoot, '.github/workflows/binary.yml'), binaryContent);

      // Act
      const result = readProjectFile('.github/workflows/binary.yml', 'utf8', testEnv.testRoot);

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

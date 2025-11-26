import { describe, it, expect, vi, beforeEach } from 'vitest';
import { detectGitConfig } from '../../src/utils/git-detection.js';

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
});

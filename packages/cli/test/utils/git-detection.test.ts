import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execSync } from 'child_process';
import { detectGitConfig, type DetectedGitConfig } from '../../src/utils/git-detection.js';

// Mock child_process
vi.mock('child_process');

describe('git-detection', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('detectGitConfig', () => {
    it('should return defaults when not in a git repository', () => {
      // Arrange: git rev-parse throws (not a git repo)
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error('Not a git repository');
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

    it('should detect main branch from remote HEAD', () => {
      // Arrange
      vi.mocked(execSync).mockImplementation((command: string | Buffer, _options?: any) => {
        const cmd = command.toString();
        if (cmd === 'git rev-parse --git-dir') {
          return Buffer.from('.git');
        }
        if (cmd === 'git remote') {
          return 'origin';
        }
        if (cmd === 'git symbolic-ref refs/remotes/origin/HEAD') {
          return 'refs/remotes/origin/main';
        }
        throw new Error(`Unexpected command: ${cmd}`);
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

    it('should detect master branch from remote HEAD', () => {
      // Arrange
      vi.mocked(execSync).mockImplementation((command: string | Buffer, _options?: any) => {
        const cmd = command.toString();
        if (cmd === 'git rev-parse --git-dir') {
          return Buffer.from('.git');
        }
        if (cmd === 'git remote') {
          return 'origin';
        }
        if (cmd === 'git symbolic-ref refs/remotes/origin/HEAD') {
          return 'refs/remotes/origin/master';
        }
        throw new Error(`Unexpected command: ${cmd}`);
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

    it('should prefer upstream over origin remote', () => {
      // Arrange
      vi.mocked(execSync).mockImplementation((command: string | Buffer, _options?: any) => {
        const cmd = command.toString();
        if (cmd === 'git rev-parse --git-dir') {
          return Buffer.from('.git');
        }
        if (cmd === 'git remote') {
          return 'origin\nupstream';
        }
        if (cmd === 'git symbolic-ref refs/remotes/upstream/HEAD') {
          return 'refs/remotes/upstream/main';
        }
        throw new Error(`Unexpected command: ${cmd}`);
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

    it('should use first remote if neither origin nor upstream exists', () => {
      // Arrange
      vi.mocked(execSync).mockImplementation((command: string | Buffer, _options?: any) => {
        const cmd = command.toString();
        if (cmd === 'git rev-parse --git-dir') {
          return Buffer.from('.git');
        }
        if (cmd === 'git remote') {
          return 'custom-remote';
        }
        if (cmd === 'git symbolic-ref refs/remotes/custom-remote/HEAD') {
          return 'refs/remotes/custom-remote/develop';
        }
        throw new Error(`Unexpected command: ${cmd}`);
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

    it('should detect main from ls-remote when symbolic-ref fails', () => {
      // Arrange
      vi.mocked(execSync).mockImplementation((command: string | Buffer, _options?: any) => {
        const cmd = command.toString();
        if (cmd === 'git rev-parse --git-dir') {
          return Buffer.from('.git');
        }
        if (cmd === 'git remote') {
          return 'origin';
        }
        if (cmd === 'git symbolic-ref refs/remotes/origin/HEAD') {
          throw new Error('Remote HEAD not set');
        }
        if (cmd === 'git ls-remote --heads origin') {
          return 'abc123\trefs/heads/main\ndef456\trefs/heads/feature';
        }
        throw new Error(`Unexpected command: ${cmd}`);
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

    it('should detect master from ls-remote when main does not exist', () => {
      // Arrange
      vi.mocked(execSync).mockImplementation((command: string | Buffer, _options?: any) => {
        const cmd = command.toString();
        if (cmd === 'git rev-parse --git-dir') {
          return Buffer.from('.git');
        }
        if (cmd === 'git remote') {
          return 'origin';
        }
        if (cmd === 'git symbolic-ref refs/remotes/origin/HEAD') {
          throw new Error('Remote HEAD not set');
        }
        if (cmd === 'git ls-remote --heads origin') {
          return 'abc123\trefs/heads/master\ndef456\trefs/heads/feature';
        }
        throw new Error(`Unexpected command: ${cmd}`);
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

    it('should detect develop from ls-remote when main and master do not exist', () => {
      // Arrange
      vi.mocked(execSync).mockImplementation((command: string | Buffer, _options?: any) => {
        const cmd = command.toString();
        if (cmd === 'git rev-parse --git-dir') {
          return Buffer.from('.git');
        }
        if (cmd === 'git remote') {
          return 'origin';
        }
        if (cmd === 'git symbolic-ref refs/remotes/origin/HEAD') {
          throw new Error('Remote HEAD not set');
        }
        if (cmd === 'git ls-remote --heads origin') {
          return 'abc123\trefs/heads/develop\ndef456\trefs/heads/feature';
        }
        throw new Error(`Unexpected command: ${cmd}`);
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

    it('should return defaults when no remotes exist', () => {
      // Arrange
      vi.mocked(execSync).mockImplementation((command: string | Buffer, _options?: any) => {
        const cmd = command.toString();
        if (cmd === 'git rev-parse --git-dir') {
          return Buffer.from('.git');
        }
        if (cmd === 'git remote') {
          return '';
        }
        throw new Error(`Unexpected command: ${cmd}`);
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

    it('should return defaults when ls-remote fails', () => {
      // Arrange
      vi.mocked(execSync).mockImplementation((command: string | Buffer, _options?: any) => {
        const cmd = command.toString();
        if (cmd === 'git rev-parse --git-dir') {
          return Buffer.from('.git');
        }
        if (cmd === 'git remote') {
          return 'origin';
        }
        if (cmd === 'git symbolic-ref refs/remotes/origin/HEAD') {
          throw new Error('Remote HEAD not set');
        }
        if (cmd === 'git ls-remote --heads origin') {
          throw new Error('Network error');
        }
        throw new Error(`Unexpected command: ${cmd}`);
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

    it('should return defaults when git remote command fails', () => {
      // Arrange
      vi.mocked(execSync).mockImplementation((command: string | Buffer, _options?: any) => {
        const cmd = command.toString();
        if (cmd === 'git rev-parse --git-dir') {
          return Buffer.from('.git');
        }
        if (cmd === 'git remote') {
          throw new Error('Git error');
        }
        throw new Error(`Unexpected command: ${cmd}`);
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

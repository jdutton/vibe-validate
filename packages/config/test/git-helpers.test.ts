/**
 * Tests for Git Configuration Helper Functions
 *
 * @package @vibe-validate/config
 */

import { describe, it, expect } from 'vitest';
import { getRemoteBranch, getMainBranch, getRemoteOrigin } from '../src/git-helpers.js';
import { GIT_DEFAULTS } from '../src/constants.js';

describe('git-helpers', () => {
  describe('getRemoteBranch', () => {
    it('should return default remote branch when no config provided', () => {
      const result = getRemoteBranch();
      expect(result).toBe('origin/main');
    });

    it('should return default remote branch when empty config provided', () => {
      const result = getRemoteBranch({});
      expect(result).toBe('origin/main');
    });

    it('should use custom mainBranch with default remoteOrigin', () => {
      const result = getRemoteBranch({ mainBranch: 'develop' });
      expect(result).toBe('origin/develop');
    });

    it('should use custom remoteOrigin with default mainBranch', () => {
      const result = getRemoteBranch({ remoteOrigin: 'upstream' });
      expect(result).toBe('upstream/main');
    });

    it('should use both custom mainBranch and remoteOrigin', () => {
      const result = getRemoteBranch({ mainBranch: 'develop', remoteOrigin: 'upstream' });
      expect(result).toBe('upstream/develop');
    });

    it('should handle master branch', () => {
      const result = getRemoteBranch({ mainBranch: 'master' });
      expect(result).toBe('origin/master');
    });

    it('should construct valid git reference format', () => {
      const result = getRemoteBranch({ mainBranch: 'feature/test', remoteOrigin: 'fork' });
      expect(result).toBe('fork/feature/test');
      expect(result).toMatch(/^[^/]+\/.+$/); // Matches "remote/branch" format
    });
  });

  describe('getMainBranch', () => {
    it('should return default main branch when no config provided', () => {
      const result = getMainBranch();
      expect(result).toBe(GIT_DEFAULTS.MAIN_BRANCH);
      expect(result).toBe('main');
    });

    it('should return default main branch when empty config provided', () => {
      const result = getMainBranch({});
      expect(result).toBe('main');
    });

    it('should return custom main branch when provided', () => {
      const result = getMainBranch({ mainBranch: 'develop' });
      expect(result).toBe('develop');
    });

    it('should return master branch when configured', () => {
      const result = getMainBranch({ mainBranch: 'master' });
      expect(result).toBe('master');
    });

    it('should handle branch names with slashes', () => {
      const result = getMainBranch({ mainBranch: 'release/v1.0' });
      expect(result).toBe('release/v1.0');
    });

    it('should ignore remoteOrigin when provided', () => {
      const result = getMainBranch({ mainBranch: 'develop', remoteOrigin: 'upstream' });
      expect(result).toBe('develop');
    });
  });

  describe('getRemoteOrigin', () => {
    it('should return default remote origin when no config provided', () => {
      const result = getRemoteOrigin();
      expect(result).toBe(GIT_DEFAULTS.REMOTE_ORIGIN);
      expect(result).toBe('origin');
    });

    it('should return default remote origin when empty config provided', () => {
      const result = getRemoteOrigin({});
      expect(result).toBe('origin');
    });

    it('should return custom remote origin when provided', () => {
      const result = getRemoteOrigin({ remoteOrigin: 'upstream' });
      expect(result).toBe('upstream');
    });

    it('should handle fork as remote origin', () => {
      const result = getRemoteOrigin({ remoteOrigin: 'fork' });
      expect(result).toBe('fork');
    });

    it('should ignore mainBranch when provided', () => {
      const result = getRemoteOrigin({ mainBranch: 'develop', remoteOrigin: 'upstream' });
      expect(result).toBe('upstream');
    });
  });

  describe('Integration: All helpers together', () => {
    it('should construct consistent references across helpers', () => {
      const config = { mainBranch: 'develop', remoteOrigin: 'upstream' };

      const remoteBranch = getRemoteBranch(config);
      const mainBranch = getMainBranch(config);
      const remoteOrigin = getRemoteOrigin(config);

      expect(remoteBranch).toBe(`${remoteOrigin}/${mainBranch}`);
      expect(remoteBranch).toBe('upstream/develop');
    });

    it('should use defaults consistently when no config', () => {
      const remoteBranch = getRemoteBranch();
      const mainBranch = getMainBranch();
      const remoteOrigin = getRemoteOrigin();

      expect(remoteBranch).toBe(`${remoteOrigin}/${mainBranch}`);
      expect(remoteBranch).toBe('origin/main');
    });
  });
});

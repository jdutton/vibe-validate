/**
 * Tests for test-helpers.ts
 *
 * Unit tests for git test helper functions
 */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import * as utils from '@vibe-validate/utils';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import * as testHelpers from '../src/test-helpers.js';

// Mock the utils module
vi.mock('@vibe-validate/utils', async () => {
  const actual = await vi.importActual<typeof utils>('@vibe-validate/utils');
  return {
    ...actual,
    safeExecSync: vi.fn(),
    safeExecResult: vi.fn(),
  };
});

// Mock node:fs
vi.mock('node:fs', async () => {
  const actual = await vi.importActual('node:fs');
  return {
    ...actual,
    writeFileSync: vi.fn(),
  };
});

describe('test-helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('initTestRepo', () => {
    it('should initialize git repository', () => {
      vi.mocked(utils.safeExecSync).mockReturnValue('');

      testHelpers.initTestRepo('/test/repo');

      expect(utils.safeExecSync).toHaveBeenCalledWith(
        'git',
        ['init'],
        { cwd: '/test/repo', stdio: 'pipe' }
      );
    });

    it('should initialize repository at specified path', () => {
      vi.mocked(utils.safeExecSync).mockReturnValue('');

      testHelpers.initTestRepo('/custom/path');

      expect(utils.safeExecSync).toHaveBeenCalledWith(
        'git',
        ['init'],
        { cwd: '/custom/path', stdio: 'pipe' }
      );
    });
  });

  describe('configTestUser', () => {
    it('should configure git user with default values', () => {
      vi.mocked(utils.safeExecSync).mockReturnValue('');

      testHelpers.configTestUser('/test/repo');

      expect(utils.safeExecSync).toHaveBeenCalledTimes(2);
      expect(utils.safeExecSync).toHaveBeenNthCalledWith(
        1,
        'git',
        ['config', 'user.email', 'test@example.com'],
        { cwd: '/test/repo', stdio: 'pipe' }
      );
      expect(utils.safeExecSync).toHaveBeenNthCalledWith(
        2,
        'git',
        ['config', 'user.name', 'Test User'],
        { cwd: '/test/repo', stdio: 'pipe' }
      );
    });

    it('should configure git user with custom email', () => {
      vi.mocked(utils.safeExecSync).mockReturnValue('');

      testHelpers.configTestUser('/test/repo', 'custom@example.com');

      expect(utils.safeExecSync).toHaveBeenNthCalledWith(
        1,
        'git',
        ['config', 'user.email', 'custom@example.com'],
        { cwd: '/test/repo', stdio: 'pipe' }
      );
    });

    it('should configure git user with custom name', () => {
      vi.mocked(utils.safeExecSync).mockReturnValue('');

      testHelpers.configTestUser('/test/repo', 'test@example.com', 'Custom Name');

      expect(utils.safeExecSync).toHaveBeenNthCalledWith(
        2,
        'git',
        ['config', 'user.name', 'Custom Name'],
        { cwd: '/test/repo', stdio: 'pipe' }
      );
    });

    it('should configure git user with both custom values', () => {
      vi.mocked(utils.safeExecSync).mockReturnValue('');

      testHelpers.configTestUser('/test/repo', 'admin@company.com', 'Admin User');

      expect(utils.safeExecSync).toHaveBeenCalledTimes(2);
      expect(utils.safeExecSync).toHaveBeenNthCalledWith(
        1,
        'git',
        ['config', 'user.email', 'admin@company.com'],
        { cwd: '/test/repo', stdio: 'pipe' }
      );
      expect(utils.safeExecSync).toHaveBeenNthCalledWith(
        2,
        'git',
        ['config', 'user.name', 'Admin User'],
        { cwd: '/test/repo', stdio: 'pipe' }
      );
    });
  });

  describe('stageTestFiles', () => {
    it('should stage all files by default', () => {
      vi.mocked(utils.safeExecSync).mockReturnValue('');

      testHelpers.stageTestFiles('/test/repo');

      expect(utils.safeExecSync).toHaveBeenCalledWith(
        'git',
        ['add', '.'],
        { cwd: '/test/repo', stdio: 'pipe' }
      );
    });

    it('should stage specific files', () => {
      vi.mocked(utils.safeExecSync).mockReturnValue('');

      testHelpers.stageTestFiles('/test/repo', ['file1.txt', 'file2.txt']);

      expect(utils.safeExecSync).toHaveBeenCalledWith(
        'git',
        ['add', 'file1.txt', 'file2.txt'],
        { cwd: '/test/repo', stdio: 'pipe' }
      );
    });

    it('should stage single file', () => {
      vi.mocked(utils.safeExecSync).mockReturnValue('');

      testHelpers.stageTestFiles('/test/repo', ['README.md']);

      expect(utils.safeExecSync).toHaveBeenCalledWith(
        'git',
        ['add', 'README.md'],
        { cwd: '/test/repo', stdio: 'pipe' }
      );
    });

    it('should handle empty array', () => {
      vi.mocked(utils.safeExecSync).mockReturnValue('');

      testHelpers.stageTestFiles('/test/repo', []);

      expect(utils.safeExecSync).toHaveBeenCalledWith(
        'git',
        ['add'],
        { cwd: '/test/repo', stdio: 'pipe' }
      );
    });
  });

  describe('commitTestChanges', () => {
    it('should create commit with message', () => {
      vi.mocked(utils.safeExecSync).mockReturnValue('');

      testHelpers.commitTestChanges('/test/repo', 'Initial commit');

      expect(utils.safeExecSync).toHaveBeenCalledWith(
        'git',
        ['commit', '-m', 'Initial commit'],
        { cwd: '/test/repo', stdio: 'pipe' }
      );
    });

    it('should create commit with multiline message', () => {
      vi.mocked(utils.safeExecSync).mockReturnValue('');

      const message = 'feat: Add feature\n\nDetailed description';
      testHelpers.commitTestChanges('/test/repo', message);

      expect(utils.safeExecSync).toHaveBeenCalledWith(
        'git',
        ['commit', '-m', message],
        { cwd: '/test/repo', stdio: 'pipe' }
      );
    });

    it('should create commit with special characters', () => {
      vi.mocked(utils.safeExecSync).mockReturnValue('');

      testHelpers.commitTestChanges('/test/repo', 'fix: Handle "quotes" and $vars');

      expect(utils.safeExecSync).toHaveBeenCalledWith(
        'git',
        ['commit', '-m', 'fix: Handle "quotes" and $vars'],
        { cwd: '/test/repo', stdio: 'pipe' }
      );
    });
  });

  describe('getTestTreeHash', () => {
    it('should return tree hash', () => {
      vi.mocked(utils.safeExecSync).mockReturnValue('abc123def456\n');

      const result = testHelpers.getTestTreeHash('/test/repo');

      expect(result).toBe('abc123def456');
      expect(utils.safeExecSync).toHaveBeenCalledWith(
        'git',
        ['rev-parse', 'HEAD:'],
        {
          cwd: '/test/repo',
          encoding: 'utf-8',
          stdio: 'pipe',
        }
      );
    });

    it('should trim whitespace from tree hash', () => {
      vi.mocked(utils.safeExecSync).mockReturnValue('  abc123def456  \n');

      const result = testHelpers.getTestTreeHash('/test/repo');

      expect(result).toBe('abc123def456');
    });

    it('should handle hash without newline', () => {
      vi.mocked(utils.safeExecSync).mockReturnValue('abc123def456');

      const result = testHelpers.getTestTreeHash('/test/repo');

      expect(result).toBe('abc123def456');
    });
  });

  describe('readTestNote', () => {
    it('should return note content when note exists', () => {
      vi.mocked(utils.safeExecResult).mockReturnValue({
        status: 0,
        stdout: 'note content\n',
        stderr: '',
      });

      const result = testHelpers.readTestNote(
        '/test/repo',
        'refs/notes/test',
        'abc123'
      );

      expect(result).toBe('note content');
      expect(utils.safeExecResult).toHaveBeenCalledWith(
        'git',
        ['notes', '--ref', 'refs/notes/test', 'show', 'abc123'],
        {
          cwd: '/test/repo',
          encoding: 'utf-8',
          stdio: 'pipe',
        }
      );
    });

    it('should return null when note does not exist', () => {
      vi.mocked(utils.safeExecResult).mockReturnValue({
        status: 1,
        stdout: '',
        stderr: 'error: no note found',
      });

      const result = testHelpers.readTestNote(
        '/test/repo',
        'refs/notes/test',
        'abc123'
      );

      expect(result).toBeNull();
    });

    it('should trim whitespace from note content', () => {
      vi.mocked(utils.safeExecResult).mockReturnValue({
        status: 0,
        stdout: '  note content  \n',
        stderr: '',
      });

      const result = testHelpers.readTestNote(
        '/test/repo',
        'refs/notes/test',
        'abc123'
      );

      expect(result).toBe('note content');
    });

    it('should handle multiline note content', () => {
      vi.mocked(utils.safeExecResult).mockReturnValue({
        status: 0,
        stdout: 'line 1\nline 2\nline 3\n',
        stderr: '',
      });

      const result = testHelpers.readTestNote(
        '/test/repo',
        'refs/notes/test',
        'abc123'
      );

      expect(result).toBe('line 1\nline 2\nline 3');
    });

    it('should return null for non-zero exit status', () => {
      vi.mocked(utils.safeExecResult).mockReturnValue({
        status: 128,
        stdout: '',
        stderr: 'fatal: not a git repository',
      });

      const result = testHelpers.readTestNote(
        '/test/repo',
        'refs/notes/test',
        'abc123'
      );

      expect(result).toBeNull();
    });
  });

  describe('setupTestRepoWithCommit', () => {
    it('should setup repository with default values', () => {
      vi.mocked(utils.safeExecSync).mockReturnValue('');
      vi.mocked(writeFileSync).mockReturnValue();

      testHelpers.setupTestRepoWithCommit('/test/repo');

      // Verify git init
      expect(utils.safeExecSync).toHaveBeenCalledWith(
        'git',
        ['init'],
        { cwd: '/test/repo', stdio: 'pipe' }
      );

      // Verify git config (2 calls)
      expect(utils.safeExecSync).toHaveBeenCalledWith(
        'git',
        ['config', 'user.email', 'test@example.com'],
        { cwd: '/test/repo', stdio: 'pipe' }
      );
      expect(utils.safeExecSync).toHaveBeenCalledWith(
        'git',
        ['config', 'user.name', 'Test User'],
        { cwd: '/test/repo', stdio: 'pipe' }
      );

      // Verify file creation
      expect(writeFileSync).toHaveBeenCalledWith(
        join('/test/repo', 'README.md'),
        '# Test\n'
      );

      // Verify git add
      expect(utils.safeExecSync).toHaveBeenCalledWith(
        'git',
        ['add', '.'],
        { cwd: '/test/repo', stdio: 'pipe' }
      );

      // Verify git commit
      expect(utils.safeExecSync).toHaveBeenCalledWith(
        'git',
        ['commit', '-m', 'Initial commit'],
        { cwd: '/test/repo', stdio: 'pipe' }
      );
    });

    it('should setup repository with custom file', () => {
      vi.mocked(utils.safeExecSync).mockReturnValue('');
      vi.mocked(writeFileSync).mockReturnValue();

      testHelpers.setupTestRepoWithCommit('/test/repo', 'custom.txt');

      expect(writeFileSync).toHaveBeenCalledWith(
        join('/test/repo', 'custom.txt'),
        '# Test\n'
      );
    });

    it('should setup repository with custom content', () => {
      vi.mocked(utils.safeExecSync).mockReturnValue('');
      vi.mocked(writeFileSync).mockReturnValue();

      testHelpers.setupTestRepoWithCommit(
        '/test/repo',
        'README.md',
        'Custom content\n'
      );

      expect(writeFileSync).toHaveBeenCalledWith(
        join('/test/repo', 'README.md'),
        'Custom content\n'
      );
    });

    it('should setup repository with custom file and content', () => {
      vi.mocked(utils.safeExecSync).mockReturnValue('');
      vi.mocked(writeFileSync).mockReturnValue();

      testHelpers.setupTestRepoWithCommit(
        '/test/repo',
        'package.json',
        '{"name": "test"}\n'
      );

      expect(writeFileSync).toHaveBeenCalledWith(
        join('/test/repo', 'package.json'),
        '{"name": "test"}\n'
      );
    });

    it('should complete all setup steps in correct order', () => {
      vi.mocked(utils.safeExecSync).mockReturnValue('');
      vi.mocked(writeFileSync).mockReturnValue();

      testHelpers.setupTestRepoWithCommit('/test/repo');

      const calls = vi.mocked(utils.safeExecSync).mock.calls;

      // Order should be: init, config email, config name, add, commit
      expect(calls[0]).toEqual(['git', ['init'], { cwd: '/test/repo', stdio: 'pipe' }]);
      expect(calls[1]).toEqual([
        'git',
        ['config', 'user.email', 'test@example.com'],
        { cwd: '/test/repo', stdio: 'pipe' },
      ]);
      expect(calls[2]).toEqual([
        'git',
        ['config', 'user.name', 'Test User'],
        { cwd: '/test/repo', stdio: 'pipe' },
      ]);
      expect(calls[3]).toEqual(['git', ['add', '.'], { cwd: '/test/repo', stdio: 'pipe' }]);
      expect(calls[4]).toEqual([
        'git',
        ['commit', '-m', 'Initial commit'],
        { cwd: '/test/repo', stdio: 'pipe' },
      ]);
    });
  });
});

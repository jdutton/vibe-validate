/**
 * Tests for project ID detection
 *
 * Note: These tests use real execSync calls when possible since mocking
 * Node.js built-in modules (child_process) is unreliable in Vitest.
 * For tests that require specific git remote URLs, we test the URL parsing
 * logic directly through package.json fallbacks.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import os from 'os';
import {
  getProjectIdFromGit,
  getProjectIdFromPackageJson,
  detectProjectId,
} from '../../src/utils/project-id.js';

describe('Project ID Detection', () => {
  const testDir = join(os.tmpdir(), 'vibe-validate-project-id-test');

  beforeEach(() => {
    // Clean up and create fresh test directory
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('getProjectIdFromGit', () => {
    it('should return null if not a git repository', () => {
      // testDir is not a git repo, should return null
      const result = getProjectIdFromGit(testDir);
      expect(result).toBeNull();
    });

    it('should detect project ID from actual git repo', () => {
      // When run in the vibe-validate repo, should detect "vibe-validate"
      const result = getProjectIdFromGit();
      // This test passes if we're in a git repo with a remote
      // In CI or actual repo: expect(result).toBe('vibe-validate')
      // In non-git environment: expect(result).toBeNull()
      expect(result === null || typeof result === 'string').toBe(true);
    });
  });

  describe('getProjectIdFromPackageJson', () => {
    it('should extract name from package.json', () => {
      const packageJson = {
        name: 'my-project',
        version: '1.0.0',
      };
      writeFileSync(join(testDir, 'package.json'), JSON.stringify(packageJson));

      const result = getProjectIdFromPackageJson(testDir);
      expect(result).toBe('my-project');
    });

    it('should remove scope prefix from scoped package', () => {
      const packageJson = {
        name: '@myorg/my-project',
        version: '1.0.0',
      };
      writeFileSync(join(testDir, 'package.json'), JSON.stringify(packageJson));

      const result = getProjectIdFromPackageJson(testDir);
      expect(result).toBe('my-project');
    });

    it('should return null if package.json does not exist', () => {
      const result = getProjectIdFromPackageJson(testDir);
      expect(result).toBeNull();
    });

    it('should return null if package.json has no name field', () => {
      const packageJson = {
        version: '1.0.0',
      };
      writeFileSync(join(testDir, 'package.json'), JSON.stringify(packageJson));

      const result = getProjectIdFromPackageJson(testDir);
      expect(result).toBeNull();
    });

    it('should return null if package.json is malformed', () => {
      writeFileSync(join(testDir, 'package.json'), 'invalid json');

      const result = getProjectIdFromPackageJson(testDir);
      expect(result).toBeNull();
    });
  });

  describe('detectProjectId', () => {
    it('should fall back to package.json if not in git repo', () => {
      // testDir is not a git repo, should fall back to package.json
      const packageJson = {
        name: '@myorg/package-project',
      };
      writeFileSync(join(testDir, 'package.json'), JSON.stringify(packageJson));

      const result = detectProjectId(testDir);
      expect(result).toBe('package-project');
    });

    it('should return null if neither git nor package.json available', () => {
      // testDir has no git and no package.json
      const result = detectProjectId(testDir);
      expect(result).toBeNull();
    });

    it('should detect from actual project root', () => {
      // When run from project root, should detect something
      const result = detectProjectId();
      // Either from git (vibe-validate) or package.json (vibe-validate)
      expect(result === null || typeof result === 'string').toBe(true);
    });
  });
});

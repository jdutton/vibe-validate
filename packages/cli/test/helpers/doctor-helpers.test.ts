/**
 * Doctor Helpers Tests
 *
 * Basic tests to validate helper exports and functionality.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the modules before importing helpers
vi.mock('node:child_process');
vi.mock('node:fs');
vi.mock('@vibe-validate/git');

import {
  mockDoctorEnvironment,
  mockDoctorFileSystem,
  mockDoctorGit,
  findCheck,
  assertCheck,
  type DoctorEnvironmentConfig,
  type DoctorFileSystemConfig,
  type DoctorGitMockConfig
} from './doctor-helpers.js';

describe('doctor-helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('mockDoctorEnvironment', () => {
    it('should export and be callable', () => {
      expect(mockDoctorEnvironment).toBeDefined();
      expect(typeof mockDoctorEnvironment).toBe('function');

      const cleanup = mockDoctorEnvironment();
      expect(typeof cleanup).toBe('function');
      cleanup();
    });

    it('should accept config options', () => {
      const config: DoctorEnvironmentConfig = {
        nodeVersion: 'v18.0.0',
        gitVersion: 'git version 2.40.0'
      };

      const cleanup = mockDoctorEnvironment({}, config);
      expect(typeof cleanup).toBe('function');
      cleanup();
    });
  });

  describe('mockDoctorFileSystem', () => {
    it('should export and be callable', async () => {
      expect(mockDoctorFileSystem).toBeDefined();
      expect(typeof mockDoctorFileSystem).toBe('function');

      const cleanup = await mockDoctorFileSystem();
      expect(typeof cleanup).toBe('function');
      cleanup();
    });

    it('should accept config options', async () => {
      const config: DoctorFileSystemConfig = {
        packageVersion: '0.9.10',
        configExists: false
      };

      const cleanup = await mockDoctorFileSystem(config);
      expect(typeof cleanup).toBe('function');
      cleanup();
    });
  });

  describe('mockDoctorGit', () => {
    it('should export and be callable', async () => {
      expect(mockDoctorGit).toBeDefined();
      expect(typeof mockDoctorGit).toBe('function');

      const cleanup = await mockDoctorGit();
      expect(typeof cleanup).toBe('function');
      cleanup();
    });

    it('should accept config options', async () => {
      const config: DoctorGitMockConfig = {
        isRepository: false,
        hasRemote: false
      };

      const cleanup = await mockDoctorGit(config);
      expect(typeof cleanup).toBe('function');
      cleanup();
    });
  });

  describe('findCheck', () => {
    it('should export and be callable', () => {
      expect(findCheck).toBeDefined();
      expect(typeof findCheck).toBe('function');
    });

    it('should find a check by name', () => {
      const result = {
        checks: [
          { name: 'Test Check', passed: true, message: 'All good' }
        ]
      };

      const check = findCheck(result, 'Test Check');
      expect(check).toBeDefined();
      expect(check.name).toBe('Test Check');
    });

    it('should throw when check not found', () => {
      const result = {
        checks: [
          { name: 'Test Check', passed: true, message: 'All good' }
        ]
      };

      expect(() => findCheck(result, 'Missing Check')).toThrow('Check "Missing Check" not found');
    });
  });

  describe('assertCheck', () => {
    it('should export and be callable', () => {
      expect(assertCheck).toBeDefined();
      expect(typeof assertCheck).toBe('function');
    });

    it('should assert check passed/failed', () => {
      const result = {
        checks: [
          { name: 'Test Check', passed: true, message: 'All good' }
        ]
      };

      // Should not throw
      expect(() => assertCheck(result, 'Test Check', { passed: true })).not.toThrow();
    });

    it('should assert message contains pattern', () => {
      const result = {
        checks: [
          { name: 'Test Check', passed: false, message: 'Node.js 20+ required' }
        ]
      };

      // Should not throw
      expect(() => assertCheck(result, 'Test Check', {
        passed: false,
        messageContains: 'Node.js 20+'
      })).not.toThrow();
    });
  });
});

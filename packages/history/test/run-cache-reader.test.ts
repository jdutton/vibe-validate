/**
 * Tests for run cache reader functions
 *
 * v0.15.0 adds run cache stored at refs/notes/vibe-validate/run/{treeHash}/{cacheKey}
 * These functions read and enumerate run cache entries for the history command.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { execSync } from 'node:child_process';
import {
  listRunCacheEntries,
  getRunCacheEntry,
  getAllRunCacheForTree,
} from '../src/run-cache-reader.js';

// Mock child_process
vi.mock('child_process');

describe('run cache reader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('listRunCacheEntries', () => {
    it('should list all run cache entries for a tree hash', async () => {
      const mockOutput = `
refs/notes/vibe-validate/run/abc123/npm%20test abc123
refs/notes/vibe-validate/run/abc123/pnpm%20lint def456
refs/notes/vibe-validate/run/abc123/packages%2Fcli%3Anpm%20test ghi789
`;

      vi.mocked(execSync).mockReturnValue(mockOutput as any);

      const result = await listRunCacheEntries('abc123');

      expect(result).toHaveLength(3);
      expect(result[0]).toMatchObject({
        treeHash: 'abc123',
        cacheKey: 'npm%20test',
      });
      expect(result[1]).toMatchObject({
        treeHash: 'abc123',
        cacheKey: 'pnpm%20lint',
      });
      expect(result[2]).toMatchObject({
        treeHash: 'abc123',
        cacheKey: 'packages%2Fcli%3Anpm%20test',
      });
    });

    it('should return empty array when no run cache exists', async () => {
      vi.mocked(execSync).mockReturnValue('' as any);

      const result = await listRunCacheEntries('abc123');

      expect(result).toEqual([]);
    });

    it('should handle git command errors gracefully', async () => {
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error('Git command failed');
      });

      const result = await listRunCacheEntries('abc123');

      expect(result).toEqual([]);
    });
  });

  describe('getRunCacheEntry', () => {
    it('should read a run cache entry', async () => {
      const mockYaml = `
treeHash: abc123
command: npm test
workdir: ''
timestamp: '2025-11-02T10:00:00.000Z'
exitCode: 0
duration: 1500
errors: []
summary: All tests passed
`;

      vi.mocked(execSync).mockReturnValue(mockYaml as any);

      const result = await getRunCacheEntry('abc123', 'npm%20test');

      expect(result).toBeDefined();
      expect(result?.treeHash).toBe('abc123');
      expect(result?.command).toBe('npm test');
      expect(result?.exitCode).toBe(0);
    });

    it('should return null when entry does not exist', async () => {
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error('No note found');
      });

      const result = await getRunCacheEntry('abc123', 'nonexistent');

      expect(result).toBeNull();
    });

    it('should handle YAML parsing errors', async () => {
      vi.mocked(execSync).mockReturnValue('invalid yaml: [[[' as any);

      const result = await getRunCacheEntry('abc123', 'npm%20test');

      expect(result).toBeNull();
    });
  });

  describe('getAllRunCacheForTree', () => {
    it('should get all run cache entries for a tree hash', async () => {
      // Mock listRunCacheEntries
      const mockListOutput = `
refs/notes/vibe-validate/run/abc123/npm%20test note1
refs/notes/vibe-validate/run/abc123/pnpm%20lint note2
`;

      const mockNote1 = `
treeHash: abc123
command: npm test
workdir: ''
timestamp: '2025-11-02T10:00:00.000Z'
exitCode: 0
duration: 1500
errors: []
summary: All tests passed
`;

      const mockNote2 = `
treeHash: abc123
command: pnpm lint
workdir: ''
timestamp: '2025-11-02T10:05:00.000Z'
exitCode: 0
duration: 500
errors: []
summary: No linting errors
`;

      vi.mocked(execSync)
        .mockReturnValueOnce(mockListOutput as any) // list call
        .mockReturnValueOnce(mockNote1 as any) // first entry
        .mockReturnValueOnce(mockNote2 as any); // second entry

      const result = await getAllRunCacheForTree('abc123');

      expect(result).toHaveLength(2);
      expect(result[0].command).toBe('npm test');
      expect(result[1].command).toBe('pnpm lint');
    });

    it('should return empty array when no run cache exists', async () => {
      vi.mocked(execSync).mockReturnValue('' as any);

      const result = await getAllRunCacheForTree('abc123');

      expect(result).toEqual([]);
    });

    it('should skip entries that fail to read', async () => {
      const mockListOutput = `
refs/notes/vibe-validate/run/abc123/npm%20test note1
refs/notes/vibe-validate/run/abc123/pnpm%20lint note2
refs/notes/vibe-validate/run/abc123/bad%20entry note3
`;

      const mockNote1 = `
treeHash: abc123
command: npm test
workdir: ''
timestamp: '2025-11-02T10:00:00.000Z'
exitCode: 0
duration: 1500
errors: []
summary: All tests passed
`;

      vi.mocked(execSync)
        .mockReturnValueOnce(mockListOutput as any)
        .mockReturnValueOnce(mockNote1 as any)
        .mockImplementationOnce(() => {
          throw new Error('Failed to read note');
        })
        .mockReturnValueOnce(mockNote1 as any);

      const result = await getAllRunCacheForTree('abc123');

      // Should get 2 entries (skip the bad one)
      expect(result).toHaveLength(2);
    });
  });
});

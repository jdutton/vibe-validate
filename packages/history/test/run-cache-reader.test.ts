/**
 * Tests for run cache reader functions
 *
 * v0.15.0 adds run cache stored at refs/notes/vibe-validate/run/{treeHash}/{cacheKey}
 * These functions read and enumerate run cache entries for the history command.
 */

import { readNote, listNotesRefs } from '@vibe-validate/git';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import {
  listRunCacheEntries,
  getRunCacheEntry,
  getAllRunCacheForTree,
} from '../src/run-cache-reader.js';

// Mock @vibe-validate/git
vi.mock('@vibe-validate/git', () => ({
  readNote: vi.fn(),
  listNotesRefs: vi.fn(),
}));

describe('run cache reader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('listRunCacheEntries', () => {
    it('should list all run cache entries for a tree hash', async () => {
      const mockRefs = [
        'refs/notes/vibe-validate/run/abc123/npm%20test',
        'refs/notes/vibe-validate/run/abc123/pnpm%20lint',
        'refs/notes/vibe-validate/run/abc123/packages%2Fcli%3Anpm%20test',
      ];

      vi.mocked(listNotesRefs).mockReturnValue(mockRefs);

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
      vi.mocked(listNotesRefs).mockReturnValue([]);

      const result = await listRunCacheEntries('abc123');

      expect(result).toEqual([]);
    });

    it('should handle git command errors gracefully', async () => {
      vi.mocked(listNotesRefs).mockImplementation(() => {
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

      vi.mocked(readNote).mockReturnValue(mockYaml);

      const result = await getRunCacheEntry('abc123', 'npm%20test');

      expect(result).toBeDefined();
      expect(result?.treeHash).toBe('abc123');
      expect(result?.command).toBe('npm test');
      expect(result?.exitCode).toBe(0);
    });

    it('should return null when entry does not exist', async () => {
      vi.mocked(readNote).mockReturnValue(null);

      const result = await getRunCacheEntry('abc123', 'nonexistent');

      expect(result).toBeNull();
    });

    it('should handle YAML parsing errors', async () => {
      vi.mocked(readNote).mockReturnValue('invalid yaml: [[[');

      const result = await getRunCacheEntry('abc123', 'npm%20test');

      expect(result).toBeNull();
    });
  });

  describe('getAllRunCacheForTree', () => {
    it('should get all run cache entries for a tree hash', async () => {
      // Mock listNotesRefs
      const mockRefs = [
        'refs/notes/vibe-validate/run/abc123/npm%20test',
        'refs/notes/vibe-validate/run/abc123/pnpm%20lint',
      ];

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

      vi.mocked(listNotesRefs).mockReturnValue(mockRefs);
      vi.mocked(readNote)
        .mockReturnValueOnce(mockNote1) // first entry
        .mockReturnValueOnce(mockNote2); // second entry

      const result = await getAllRunCacheForTree('abc123');

      expect(result).toHaveLength(2);
      // Results are sorted by timestamp (newest first)
      expect(result[0].command).toBe('pnpm lint'); // 10:05:00 (newer)
      expect(result[1].command).toBe('npm test'); // 10:00:00 (older)
    });

    it('should return empty array when no run cache exists', async () => {
      vi.mocked(listNotesRefs).mockReturnValue([]);

      const result = await getAllRunCacheForTree('abc123');

      expect(result).toEqual([]);
    });

    it('should skip entries that fail to read', async () => {
      const mockRefs = [
        'refs/notes/vibe-validate/run/abc123/npm%20test',
        'refs/notes/vibe-validate/run/abc123/pnpm%20lint',
        'refs/notes/vibe-validate/run/abc123/bad%20entry',
      ];

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

      vi.mocked(listNotesRefs).mockReturnValue(mockRefs);
      vi.mocked(readNote)
        .mockReturnValueOnce(mockNote1)
        .mockReturnValueOnce(null) // Failed to read pnpm lint
        .mockReturnValueOnce(mockNote1);

      const result = await getAllRunCacheForTree('abc123');

      // Should get 2 entries (skip the bad one)
      expect(result).toHaveLength(2);
    });
  });
});

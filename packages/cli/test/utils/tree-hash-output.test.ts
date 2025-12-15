/**
 * Tests for tree-hash-output utility functions
 */

import type { RunCacheNote } from '@vibe-validate/history';
import { describe, it, expect } from 'vitest';

import { cleanRunCacheEntries, formatTreeHashOutput } from '../../src/utils/tree-hash-output.js';

describe('tree-hash-output utility', () => {
  describe('cleanRunCacheEntries', () => {
    it('should remove treeHash from entries', () => {
      const entries: RunCacheNote[] = [
        {
          treeHash: 'abc123',
          command: 'echo test',
          workdir: '',
          timestamp: '2025-11-09T22:00:00.000Z',
          exitCode: 0,
          durationSecs: 0.1,
        },
      ];

      const cleaned = cleanRunCacheEntries(entries);

      expect(cleaned[0]).not.toHaveProperty('treeHash');
      expect(cleaned[0].command).toBe('echo test');
    });

    it('should remove empty workdir', () => {
      const entries: RunCacheNote[] = [
        {
          treeHash: 'abc123',
          command: 'echo test',
          workdir: '',
          timestamp: '2025-11-09T22:00:00.000Z',
          exitCode: 0,
          durationSecs: 0.1,
        },
      ];

      const cleaned = cleanRunCacheEntries(entries);

      expect(cleaned[0]).not.toHaveProperty('workdir');
    });

    it('should preserve non-empty workdir', () => {
      const entries: RunCacheNote[] = [
        {
          treeHash: 'abc123',
          command: 'echo test',
          workdir: 'packages/cli',
          timestamp: '2025-11-09T22:00:00.000Z',
          exitCode: 0,
          durationSecs: 0.1,
        },
      ];

      const cleaned = cleanRunCacheEntries(entries);

      expect(cleaned[0].workdir).toBe('packages/cli');
    });

    it('should preserve other fields', () => {
      const entries: RunCacheNote[] = [
        {
          treeHash: 'abc123',
          command: 'echo test',
          workdir: '',
          timestamp: '2025-11-09T22:00:00.000Z',
          exitCode: 0,
          durationSecs: 0.1,
          extraction: {
            summary: 'Test',
            totalErrors: 0,
            errors: [],
          },
        },
      ];

      const cleaned = cleanRunCacheEntries(entries);

      expect(cleaned[0].timestamp).toBe('2025-11-09T22:00:00.000Z');
      expect(cleaned[0].exitCode).toBe(0);
      expect(cleaned[0].durationSecs).toBe(0.1);
      expect(cleaned[0].extraction).toEqual({
        summary: 'Test',
        totalErrors: 0,
        errors: [],
      });
    });
  });

  describe('formatTreeHashOutput', () => {
    it('should include treeHash at root level', () => {
      const result = formatTreeHashOutput(
        'abc123def456',
        null,
        [],
        { includeValidation: false, includeRunCache: false }
      );

      expect(result.treeHash).toBe('abc123def456');
    });

    it('should include validation without treeHash when requested', () => {
      const validationData = {
        treeHash: 'abc123def456',
        passed: true,
        timestamp: '2025-11-09T22:00:00.000Z',
        summary: 'All tests passed',
      };

      const result = formatTreeHashOutput(
        'abc123def456',
        validationData,
        [],
        { includeValidation: true, includeRunCache: false }
      );

      expect(result.treeHash).toBe('abc123def456');
      expect(result.validation).toBeDefined();
      expect(result.validation).not.toHaveProperty('treeHash');
      expect((result.validation as Record<string, unknown>).passed).toBe(true);
    });

    it('should include cleaned runCache when requested', () => {
      const runCacheEntries: RunCacheNote[] = [
        {
          treeHash: 'abc123',
          command: 'echo test',
          workdir: '',
          timestamp: '2025-11-09T22:00:00.000Z',
          exitCode: 0,
          durationSecs: 0.1,
        },
      ];

      const result = formatTreeHashOutput(
        'abc123def456',
        null,
        runCacheEntries,
        { includeValidation: false, includeRunCache: true }
      );

      expect(result.treeHash).toBe('abc123def456');
      expect(result.runCache).toBeDefined();
      expect(Array.isArray(result.runCache)).toBe(true);
      expect((result.runCache as RunCacheNote[])[0]).not.toHaveProperty('treeHash');
      expect((result.runCache as RunCacheNote[])[0]).not.toHaveProperty('workdir');
    });

    it('should include both validation and runCache when requested', () => {
      const validationData = {
        treeHash: 'abc123def456',
        passed: true,
        timestamp: '2025-11-09T22:00:00.000Z',
        summary: 'All tests passed',
      };

      const runCacheEntries: RunCacheNote[] = [
        {
          treeHash: 'abc123',
          command: 'echo test',
          workdir: 'packages/cli',
          timestamp: '2025-11-09T22:00:00.000Z',
          exitCode: 0,
          durationSecs: 0.1,
        },
      ];

      const result = formatTreeHashOutput(
        'abc123def456',
        validationData,
        runCacheEntries,
        { includeValidation: true, includeRunCache: true }
      );

      expect(result.treeHash).toBe('abc123def456');
      expect(result.validation).toBeDefined();
      expect(result.runCache).toBeDefined();
      expect((result.validation as Record<string, unknown>)).not.toHaveProperty('treeHash');
      expect((result.runCache as RunCacheNote[])[0]).not.toHaveProperty('treeHash');
      expect((result.runCache as RunCacheNote[])[0].workdir).toBe('packages/cli');
    });

    it('should not include validation when includeValidation is false', () => {
      const validationData = {
        treeHash: 'abc123def456',
        passed: true,
        timestamp: '2025-11-09T22:00:00.000Z',
      };

      const result = formatTreeHashOutput(
        'abc123def456',
        validationData,
        [],
        { includeValidation: false, includeRunCache: false }
      );

      expect(result.treeHash).toBe('abc123def456');
      expect(result.validation).toBeUndefined();
    });

    it('should not include runCache when includeRunCache is false', () => {
      const runCacheEntries: RunCacheNote[] = [
        {
          treeHash: 'abc123',
          command: 'echo test',
          workdir: '',
          timestamp: '2025-11-09T22:00:00.000Z',
          exitCode: 0,
          durationSecs: 0.1,
        },
      ];

      const result = formatTreeHashOutput(
        'abc123def456',
        null,
        runCacheEntries,
        { includeValidation: false, includeRunCache: false }
      );

      expect(result.treeHash).toBe('abc123def456');
      expect(result.runCache).toBeUndefined();
    });

    it('should not include runCache when entries array is empty', () => {
      const result = formatTreeHashOutput(
        'abc123def456',
        null,
        [],
        { includeValidation: false, includeRunCache: true }
      );

      expect(result.treeHash).toBe('abc123def456');
      expect(result.runCache).toBeUndefined();
    });
  });
});

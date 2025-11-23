/**
 * Tests for Sandboxed Extractor Wrapper
 */

import { describe, it, expect } from 'vitest';
import { createSandboxedExtractor } from '../src/sandboxed-extractor.js';
import type { ExtractorPlugin } from '../src/types.js';

// Mock extractor plugin for testing
const createMockPlugin = (
  extractFn: (_output: string, _command?: string) => {
    errors: Array<{ file?: string; line?: number; message: string }>;
    totalErrors: number;
    summary: string;
    guidance: string;
    metadata: {
      detection: {
        extractor: string;
        confidence: number;
        patterns: string[];
        reason: string;
      };
      confidence: number;
      completeness: number;
      issues: string[];
    };
  }
): ExtractorPlugin => ({
  metadata: {
    name: 'test-extractor',
    version: '1.0.0',
    description: 'Test extractor for sandboxing',
  },
  priority: 50,
  detect: () => ({ confidence: 100, patterns: ['test'], reason: 'Test' }),
  extract: extractFn,
  samples: [],
});

describe('createSandboxedExtractor', () => {
  describe('trust: full (no sandbox)', () => {
    it('should execute extractor directly without sandboxing', async () => {
      const plugin = createMockPlugin((output) => ({
        errors: [{ file: 'test.ts', line: 1, message: output }],
        totalErrors: 1,
        summary: '1 error',
        guidance: 'Fix it',
        metadata: {
          detection: {
            extractor: 'test-extractor',
            confidence: 100,
            patterns: ['test'],
            reason: 'Test',
          },
          confidence: 100,
          completeness: 100,
          issues: [],
        },
      }));

      const wrappedExtract = createSandboxedExtractor(plugin, { trust: 'full' });
      const result = await wrappedExtract('error: test failed');

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].message).toBe('error: test failed');
      expect(result.summary).toBe('1 error');
    });

    it('should pass command parameter to extractor', async () => {
      const plugin = createMockPlugin((output, command) => ({
        errors: [{ file: 'test.ts', line: 1, message: `${command}: ${output}` }],
        totalErrors: 1,
        summary: '1 error',
        guidance: 'Fix it',
        metadata: {
          detection: {
            extractor: 'test-extractor',
            confidence: 100,
            patterns: ['test'],
            reason: 'Test',
          },
          confidence: 100,
          completeness: 100,
          issues: [],
        },
      }));

      const wrappedExtract = createSandboxedExtractor(plugin, { trust: 'full' });
      const result = await wrappedExtract('error', 'npm test');

      expect(result.errors[0].message).toBe('npm test: error');
    });

    it('should handle extractors that return no errors', async () => {
      const plugin = createMockPlugin(() => ({
        errors: [],
        totalErrors: 0,
        summary: 'No errors',
        guidance: 'All good',
        metadata: {
          detection: {
            extractor: 'test-extractor',
            confidence: 100,
            patterns: ['test'],
            reason: 'Test',
          },
          confidence: 100,
          completeness: 100,
          issues: [],
        },
      }));

      const wrappedExtract = createSandboxedExtractor(plugin, { trust: 'full' });
      const result = await wrappedExtract('clean output');

      expect(result.errors).toHaveLength(0);
      expect(result.summary).toBe('No errors');
    });
  });

  describe('trust: sandbox (with isolation)', () => {
    it('should execute extractor in sandbox', async () => {
      const plugin = createMockPlugin((output) => ({
        errors: [{ file: 'test.ts', line: 1, message: output }],
        totalErrors: 1,
        summary: '1 error',
        guidance: 'Fix it',
        metadata: {
          detection: {
            extractor: 'test-extractor',
            confidence: 100,
            patterns: ['test'],
            reason: 'Test',
          },
          confidence: 100,
          completeness: 100,
          issues: [],
        },
      }));

      const wrappedExtract = createSandboxedExtractor(plugin, { trust: 'sandbox' });
      const result = await wrappedExtract('error: test failed');

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].message).toBe('error: test failed');
    });

    it('should use default trust level (sandbox) when not specified', async () => {
      const plugin = createMockPlugin((output) => ({
        errors: [{ file: 'test.ts', line: 1, message: output }],
        totalErrors: 1,
        summary: '1 error',
        guidance: 'Fix it',
        metadata: {
          detection: {
            extractor: 'test-extractor',
            confidence: 100,
            patterns: ['test'],
            reason: 'Test',
          },
          confidence: 100,
          completeness: 100,
          issues: [],
        },
      }));

      // No trust specified - should default to sandbox
      const wrappedExtract = createSandboxedExtractor(plugin);
      const result = await wrappedExtract('error: test failed');

      expect(result.errors).toHaveLength(1);
    });

    it('should handle extractors with multiple errors', async () => {
      const plugin = createMockPlugin(() => ({
        errors: [
          { file: 'test1.ts', line: 1, message: 'Error 1' },
          { file: 'test2.ts', line: 2, message: 'Error 2' },
          { file: 'test3.ts', line: 3, message: 'Error 3' },
        ],
        totalErrors: 3,
        summary: '3 errors',
        guidance: 'Fix them',
        metadata: {
          detection: {
            extractor: 'test-extractor',
            confidence: 100,
            patterns: ['test'],
            reason: 'Test',
          },
          confidence: 100,
          completeness: 100,
          issues: [],
        },
      }));

      const wrappedExtract = createSandboxedExtractor(plugin, { trust: 'sandbox' });
      const result = await wrappedExtract('multiple errors');

      expect(result.errors).toHaveLength(3);
      expect(result.summary).toBe('3 errors');
    });

    it('should handle extractors that use string manipulation', async () => {
      const plugin = createMockPlugin((output) => {
        const lines = output.split('\n');
        const errors = lines
          .filter(line => line.includes('ERROR'))
          .map((line, idx) => ({
            file: 'test.ts',
            line: idx + 1,
            message: line.trim(),
          }));

        return {
          errors,
          totalErrors: errors.length,
          summary: `${errors.length} errors`,
          guidance: 'Fix errors',
          metadata: {
            detection: {
              extractor: 'test-extractor',
              confidence: 100,
              patterns: ['ERROR'],
              reason: 'Found ERROR keyword',
            },
            confidence: 100,
            completeness: 100,
            issues: [],
          },
        };
      });

      const wrappedExtract = createSandboxedExtractor(plugin, { trust: 'sandbox' });
      const result = await wrappedExtract('INFO: Starting\nERROR: Failed\nINFO: Done');

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].message).toBe('ERROR: Failed');
    });

    it('should handle extractors that use regex', async () => {
      const plugin = createMockPlugin((output) => {
        const errorRegex = /Error at line (\d+): (.+)/g;
        const errors = [];
        let match;

        while ((match = errorRegex.exec(output)) !== null) {
          errors.push({
            file: 'test.ts',
            line: Number.parseInt(match[1], 10),
            message: match[2],
          });
        }

        return {
          errors,
          totalErrors: errors.length,
          summary: `${errors.length} errors`,
          guidance: 'Fix errors',
          metadata: {
            detection: {
              extractor: 'test-extractor',
              confidence: 100,
              patterns: ['Error at line'],
              reason: 'Regex match',
            },
            confidence: 100,
            completeness: 100,
            issues: [],
          },
        };
      });

      const wrappedExtract = createSandboxedExtractor(plugin, { trust: 'sandbox' });
      const result = await wrappedExtract('Error at line 5: undefined variable\nError at line 10: syntax error');

      expect(result.errors).toHaveLength(2);
      expect(result.errors[0].line).toBe(5);
      expect(result.errors[1].line).toBe(10);
    });

    it('should handle extractors that return no errors', async () => {
      const plugin = createMockPlugin(() => ({
        errors: [],
        totalErrors: 0,
        summary: 'No errors',
        guidance: 'All good',
        metadata: {
          detection: {
            extractor: 'test-extractor',
            confidence: 100,
            patterns: ['test'],
            reason: 'Test',
          },
          confidence: 100,
          completeness: 100,
          issues: [],
        },
      }));

      const wrappedExtract = createSandboxedExtractor(plugin, { trust: 'sandbox' });
      const result = await wrappedExtract('clean output');

      expect(result.errors).toHaveLength(0);
      expect(result.summary).toBe('No errors');
    });
  });

  describe('error handling', () => {
    it('should handle syntax errors in extractor code', async () => {
      // Create plugin with syntax error
      const plugin = createMockPlugin(() => {
        throw new Error('Syntax error: unexpected token');
      });

      const wrappedExtract = createSandboxedExtractor(plugin, { trust: 'sandbox' });
      const result = await wrappedExtract('some output');

      // Should return empty errors with error in metadata
      expect(result.errors).toHaveLength(0);
      expect(result.summary).toContain('Sandbox execution failed');
      expect(result.metadata?.issues).toHaveLength(1);
      expect(result.metadata?.issues[0]).toContain('Syntax error');
    });

    it('should handle extractors that throw errors', async () => {
      const plugin = createMockPlugin(() => {
        throw new Error('Extractor failed');
      });

      const wrappedExtract = createSandboxedExtractor(plugin, { trust: 'sandbox' });
      const result = await wrappedExtract('some output');

      expect(result.errors).toHaveLength(0);
      expect(result.summary).toContain('Sandbox execution failed');
      expect(result.metadata?.confidence).toBe(0);
    });

    it('should handle extractors that return invalid results', async () => {
      const plugin = createMockPlugin(() => {
        // Return invalid result (missing required fields)
        return { invalid: 'result' } as never;
      });

      const wrappedExtract = createSandboxedExtractor(plugin, { trust: 'sandbox' });
      const result = await wrappedExtract('some output');

      // Sandbox should handle this and return error metadata
      expect(result).toBeDefined();
      expect(result.errors).toBeDefined();
    });
  });

  describe('performance options', () => {
    it('should respect custom memory limit', async () => {
      const plugin = createMockPlugin(() => ({
        errors: [],
        totalErrors: 0,
        summary: 'No errors',
        guidance: '',
        metadata: {
          detection: {
            extractor: 'test-extractor',
            confidence: 100,
            patterns: [],
            reason: 'Test',
          },
          confidence: 100,
          completeness: 100,
          issues: [],
        },
      }));

      const wrappedExtract = createSandboxedExtractor(plugin, {
        trust: 'sandbox',
        memoryLimitMB: 64,
      });

      const result = await wrappedExtract('test');
      expect(result).toBeDefined();
    });

    it('should respect custom timeout', async () => {
      const plugin = createMockPlugin(() => ({
        errors: [],
        totalErrors: 0,
        summary: 'No errors',
        guidance: '',
        metadata: {
          detection: {
            extractor: 'test-extractor',
            confidence: 100,
            patterns: [],
            reason: 'Test',
          },
          confidence: 100,
          completeness: 100,
          issues: [],
        },
      }));

      const wrappedExtract = createSandboxedExtractor(plugin, {
        trust: 'sandbox',
        timeoutMs: 10000,
      });

      const result = await wrappedExtract('test');
      expect(result).toBeDefined();
    });
  });
});

/**
 * Registry Integration Tests
 *
 * Tests for extractor registry with trust level support (Phase 2B Task 3)
 *
 * @package @vibe-validate/extractors
 */

import { describe, it, expect } from 'vitest';

import { EXTRACTOR_REGISTRY, getExtractorByName, type ExtractorDescriptor } from '../src/extractor-registry.js';
import { createSandboxedExtractor } from '../src/sandboxed-extractor.js';
import type { ExtractorPlugin } from '../src/types.js';

describe('Extractor Registry - Trust Level Integration', () => {
  describe('Trust field presence', () => {
    it('should have trust field on all extractors', () => {
      expect(EXTRACTOR_REGISTRY.length).toBeGreaterThan(0);

      for (const descriptor of EXTRACTOR_REGISTRY) {
        expect(descriptor.trust).toBeDefined();
        expect(['full', 'sandbox']).toContain(descriptor.trust);
      }
    });

    it('should have trust: "full" for all built-in extractors', () => {
      const builtInNames = [
        'typescript',
        'eslint',
        'vitest',
        'jest',
        'mocha',
        'jasmine',
        'playwright',
        'pytest',
        'junit',
        'maven-compiler',
        'maven-checkstyle',
        'maven-surefire',
        'ava',
        'tap',
        'generic',
      ];

      for (const name of builtInNames) {
        const extractors = EXTRACTOR_REGISTRY.filter(e => e.name === name);
        expect(extractors.length).toBeGreaterThan(0);

        for (const extractor of extractors) {
          expect(extractor.trust).toBe('full');
        }
      }
    });

    it('should preserve all existing fields in ExtractorDescriptor', () => {
      for (const descriptor of EXTRACTOR_REGISTRY) {
        expect(descriptor.name).toBeDefined();
        expect(descriptor.detect).toBeDefined();
        expect(descriptor.extract).toBeDefined();
        expect(descriptor.priority).toBeDefined();
        expect(descriptor.trust).toBeDefined();

        expect(typeof descriptor.name).toBe('string');
        expect(typeof descriptor.detect).toBe('function');
        expect(typeof descriptor.extract).toBe('function');
        expect(typeof descriptor.priority).toBe('number');
        expect(typeof descriptor.trust).toBe('string');
      }
    });
  });

  describe('getExtractorByName helper', () => {
    it('should find extractor by name', () => {
      const typescript = getExtractorByName('typescript');
      expect(typescript).toBeDefined();
      expect(typescript?.name).toBe('typescript');
      expect(typescript?.trust).toBe('full');
    });

    it('should return undefined for non-existent extractor', () => {
      const notFound = getExtractorByName('does-not-exist');
      expect(notFound).toBeUndefined();
    });

    it('should find all built-in extractors', () => {
      const names = ['typescript', 'eslint', 'vitest', 'jest', 'generic'];

      for (const name of names) {
        const extractor = getExtractorByName(name);
        expect(extractor).toBeDefined();
        expect(extractor?.name).toBe(name);
      }
    });

    it('should return first match for duplicate names', () => {
      // Vitest appears twice in registry (priority 100 and 90)
      const vitest = getExtractorByName('vitest');
      expect(vitest).toBeDefined();
      expect(vitest?.name).toBe('vitest');
      // Should return the first one (priority 100)
      expect(vitest?.priority).toBe(100);
    });
  });

  describe('Trust-based execution integration', () => {
    it('should execute trusted extractors directly (no sandbox)', async () => {
      // Get a built-in extractor
      const descriptor = getExtractorByName('generic');
      expect(descriptor).toBeDefined();
      expect(descriptor!.trust).toBe('full');

      // Execute directly (simulating trust: 'full' behavior)
      const output = 'Error: Something went wrong';
      const result = descriptor!.extract(output);

      expect(result).toBeDefined();
      expect(result.errors).toBeDefined();
      expect(Array.isArray(result.errors)).toBe(true);
    });

    it('should support sandboxed execution for untrusted plugins', async () => {
      // Create a mock plugin that would be sandboxed
      const mockPlugin: ExtractorPlugin = {
        metadata: {
          name: 'mock-plugin',
          description: 'Mock plugin for testing',
          version: '1.0.0',
          author: 'Test Author',
        },
        priority: 50,
        detect: (_output: string) => ({
          confidence: 80,
          patterns: ['mock pattern'],
          reason: 'Mock detection',
        }),
        extract: (_output: string) => ({
          errors: [
            {
              file: 'test.ts',
              line: 1,
              column: 1,
              message: 'Mock error',
              severity: 'error' as const,
              code: 'MOCK001',
            },
          ],
          totalErrors: 1,
          summary: 'Mock summary',
          guidance: 'Mock guidance',
        }),
        samples: [],
      };

      // Create sandboxed wrapper with trust: 'sandbox'
      const sandboxedExtract = createSandboxedExtractor(mockPlugin, {
        trust: 'sandbox',
        memoryLimitMB: 64,
        timeoutMs: 1000,
      });

      // Execute in sandbox
      const output = 'Error: Something went wrong';
      const result = await sandboxedExtract(output);

      expect(result).toBeDefined();
      expect(result.errors).toBeDefined();
      expect(Array.isArray(result.errors)).toBe(true);
      expect(result.totalErrors).toBeGreaterThanOrEqual(0);
    });

    it('should handle sandboxed extractor with full trust (no sandbox)', async () => {
      // Create a mock plugin
      const mockPlugin: ExtractorPlugin = {
        metadata: {
          name: 'trusted-plugin',
          description: 'Trusted plugin',
          version: '1.0.0',
          author: 'Test Author',
        },
        priority: 50,
        detect: (_output: string) => ({
          confidence: 90,
          patterns: ['trusted pattern'],
          reason: 'Trusted detection',
        }),
        extract: (_output: string) => ({
          errors: [
            {
              file: 'test.ts',
              line: 1,
              column: 1,
              message: 'Trusted error',
              severity: 'error' as const,
              code: 'TRUST001',
            },
          ],
          totalErrors: 1,
          summary: 'Trusted summary',
          guidance: 'Trusted guidance',
        }),
        samples: [],
      };

      // Create wrapper with trust: 'full' (no sandbox)
      const trustedExtract = createSandboxedExtractor(mockPlugin, {
        trust: 'full',
      });

      // Execute directly (no sandbox overhead)
      const output = 'Error: Something went wrong';
      const result = await trustedExtract(output);

      expect(result).toBeDefined();
      expect(result.errors).toBeDefined();
      expect(result.errors.length).toBe(1);
      expect(result.errors[0].message).toBe('Trusted error');
      expect(result.totalErrors).toBe(1);
    });
  });

  describe('Registry structure validation', () => {
    it('should have extractors sorted by priority (descending)', () => {
      // Note: Registry may have duplicates (e.g., vitest with priority 100 and 90)
      // We just check that high-priority extractors appear early
      const priorities = EXTRACTOR_REGISTRY.map(e => e.priority);

      // Check that first few extractors have high priority
      expect(priorities[0]).toBeGreaterThanOrEqual(90);
      expect(priorities[1]).toBeGreaterThanOrEqual(90);

      // Check that generic extractor (priority 10) is last
      const lastExtractor = EXTRACTOR_REGISTRY.at(-1);
      expect(lastExtractor.name).toBe('generic');
      expect(lastExtractor.priority).toBe(10);
    });

    it('should have unique combinations of (name, priority)', () => {
      const seen = new Set<string>();

      for (const descriptor of EXTRACTOR_REGISTRY) {
        const key = `${descriptor.name}:${descriptor.priority}`;
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
    });

    it('should export ExtractorDescriptor type with trust field', () => {
      // Type-level test - ensures TypeScript compilation
      const descriptor: ExtractorDescriptor = {
        name: 'test',
        priority: 50,
        trust: 'full',
        detect: (_output: string) => ({ confidence: 0, patterns: [], reason: '' }),
        extract: (_output: string) => ({
          errors: [],
          totalErrors: 0,
          summary: '',
          guidance: '',
        }),
      };

      expect(descriptor.trust).toBe('full');
    });
  });

  describe('Backwards compatibility', () => {
    it('should maintain existing extractor behavior', () => {
      // Verify that adding trust field didn't break existing functionality
      const descriptor = getExtractorByName('generic');
      expect(descriptor).toBeDefined();

      // Detection still works
      const detection = descriptor!.detect('Error: test');
      expect(detection).toBeDefined();
      expect(typeof detection.confidence).toBe('number');

      // Extraction still works
      const result = descriptor!.extract('Error: test');
      expect(result).toBeDefined();
      expect(Array.isArray(result.errors)).toBe(true);
    });

    it('should not break smart-extractor integration', () => {
      // All extractors should still be callable from registry
      for (const descriptor of EXTRACTOR_REGISTRY) {
        const output = 'Error: test output';

        // Detection should work
        const detection = descriptor.detect(output);
        expect(detection).toBeDefined();
        expect(typeof detection.confidence).toBe('number');

        // Extraction should work
        const result = descriptor.extract(output);
        expect(result).toBeDefined();
        expect(result.errors).toBeDefined();
        expect(Array.isArray(result.errors)).toBe(true);
      }
    });
  });

  describe('Real-world extraction with trust awareness', () => {
    it('should extract TypeScript errors with full trust', () => {
      const descriptor = getExtractorByName('typescript');
      expect(descriptor).toBeDefined();
      expect(descriptor!.trust).toBe('full');

      const output = `
src/example.ts(10,5): error TS2322: Type 'string' is not assignable to type 'number'.
src/example.ts(15,10): error TS2304: Cannot find name 'foo'.
      `.trim();

      const result = descriptor!.extract(output);
      expect(result.totalErrors).toBeGreaterThan(0);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should extract ESLint errors with full trust', () => {
      const descriptor = getExtractorByName('eslint');
      expect(descriptor).toBeDefined();
      expect(descriptor!.trust).toBe('full');

      const output = `
/path/to/file.ts:10:5: error Unexpected console statement no-console
/path/to/file.ts:15:10: warning Missing semicolon semi
      `.trim();

      const result = descriptor!.extract(output);
      expect(result.totalErrors).toBeGreaterThan(0);
    });

    it('should detect and extract with confidence checks', () => {
      const output = 'Error: Something went wrong';

      // Find descriptors that match this output
      const matches = EXTRACTOR_REGISTRY.filter(d => {
        const detection = d.detect(output);
        return detection.confidence > 0;
      });

      expect(matches.length).toBeGreaterThan(0);

      // All matches should have trust level defined
      for (const match of matches) {
        expect(match.trust).toBeDefined();
        expect(['full', 'sandbox']).toContain(match.trust);
      }
    });
  });

  describe('Priority ordering with trust levels', () => {
    it('should maintain priority order regardless of trust level', () => {
      // Verify that all built-ins have trust: 'full' but vary by priority
      const trustedExtractors = EXTRACTOR_REGISTRY.filter(e => e.trust === 'full');
      expect(trustedExtractors.length).toBe(EXTRACTOR_REGISTRY.length);

      // Check that priorities vary (not all the same)
      const priorities = new Set(trustedExtractors.map(e => e.priority));
      expect(priorities.size).toBeGreaterThan(3);
    });

    it('should select highest-priority extractor when multiple match', () => {
      // All built-ins have trust: 'full', so selection is purely by confidence/priority
      const output = 'RUN v3.0.0\n✓ test.spec.ts\n× failed test';

      // Vitest should match with high confidence
      const vitestMatches = EXTRACTOR_REGISTRY.filter(
        e => e.name === 'vitest' && e.detect(output).confidence >= 70
      );

      expect(vitestMatches.length).toBeGreaterThan(0);
      expect(vitestMatches[0].trust).toBe('full');
    });
  });

  describe('Complete coverage of trust field', () => {
    it('should have exactly 16 extractors with trust levels', () => {
      // Count unique extractor names
      const uniqueNames = new Set(EXTRACTOR_REGISTRY.map(e => e.name));

      // Should have 15 unique extractors (vitest appears twice with different priorities)
      expect(uniqueNames.size).toBe(15);

      // All 16+ registry entries should have trust field
      expect(EXTRACTOR_REGISTRY.length).toBeGreaterThanOrEqual(16);
      expect(EXTRACTOR_REGISTRY.every(e => e.trust === 'full')).toBe(true);
    });

    it('should support future sandboxed extractors', () => {
      // This test verifies the type system supports sandbox trust
      const mockDescriptor: ExtractorDescriptor = {
        name: 'mock-sandboxed',
        priority: 50,
        trust: 'sandbox', // Future external plugins will use this
        detect: () => ({ confidence: 0, patterns: [], reason: '' }),
        extract: () => ({
          errors: [],
          totalErrors: 0,
          summary: '',
          guidance: '',
        }),
      };

      expect(mockDescriptor.trust).toBe('sandbox');
      expect(['full', 'sandbox']).toContain(mockDescriptor.trust);
    });
  });
});

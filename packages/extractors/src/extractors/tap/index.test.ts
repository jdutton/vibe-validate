/**
 * TAP Error Extractor Tests
 *
 * @package @vibe-validate/extractors
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect } from 'vitest';

import { expectDetection } from '../../test/helpers/extractor-test-helpers.js';

import tapExtractor from './index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const { extract: extractTAPErrors } = tapExtractor;

describe('TAP Extractor Plugin', () => {
  describe('Detection', () => {
    it('should detect TAP output with high confidence', () => {
      expectDetection(
        tapExtractor,
        `TAP version 13
not ok 1 test failed
  ---
    at: test.js:10:5
  ...
`,
        {
          confidence: { min: 60 },
          patterns: ['TAP version header'],
        }
      );
      expect(tapExtractor.metadata.name).toBe('tap'); // Explicit assertion for SonarQube
    });

    it('should reject non-TAP output', () => {
      expectDetection(
        tapExtractor,
        `
PASS tests/test.js
  ✓ test passes
`,
        {
          confidence: { max: 29 },
        }
      );
      expect(tapExtractor.metadata.name).toBe('tap'); // Explicit assertion for SonarQube
    });
  });

  describe('Basic Extraction', () => {
    it('should extract single test failure from TAP output', () => {
      // NOSONAR -- /tmp path is part of test fixture sample data, not actual temporary file creation
      const input = `TAP version 13
# Test › should pass assertion
not ok 1 should have 5 errors
  ---
    operator: equal
    expected: 5
    actual:   1
    at: Test.<anonymous> (file:///tmp/test.js:28:5)
  ...
`;

      const result = extractTAPErrors(input);

      expect(result.summary).toBe('1 test(s) failed');
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toMatchObject({
        // eslint-disable-next-line sonarjs/publicly-writable-directories -- /tmp path is part of test fixture sample data, not actual temporary file creation
        file: '/tmp/test.js',
        line: 28,
        message: 'should have 5 errors',
      });
    });

    it('should extract multiple test failures', () => {
      const input = `TAP version 13
# Test 1
not ok 1 first error
  ---
    at: Test.<anonymous> (test.js:10:5)
  ...
# Test 2
not ok 2 second error
  ---
    at: Test.<anonymous> (test.js:20:5)
  ...
`;

      const result = extractTAPErrors(input);

      expect(result.summary).toBe('2 test(s) failed');
      expect(result.errors).toHaveLength(2);
      expect(result.errors[0].line).toBe(10);
      expect(result.errors[1].line).toBe(20);
    });
  });

  describe('Comprehensive Sample', () => {
    it('should extract all failures from comprehensive sample', () => {
      const samplePath = join(__dirname, 'samples', 'comprehensive-failures-001.txt');
      const input = readFileSync(samplePath, 'utf8');

      const result = extractTAPErrors(input);

      expect(result.errors.length).toBeGreaterThanOrEqual(10);
      expect(result.metadata?.confidence ?? 0).toBeGreaterThanOrEqual(80);
    });
  });

  describe('Plugin Samples', () => {
    it('should pass all registered samples', () => {
      for (const sample of tapExtractor.samples) {
        const inputFile = sample.inputFile;
        const input = sample.input ?? (inputFile ? readFileSync(join(__dirname, inputFile), 'utf-8') : '');
        const result = extractTAPErrors(input);

        const expected = sample.expected;
        if (expected?.totalErrors !== undefined) {
          expect(result.totalErrors).toBe(expected.totalErrors);
        }
      }
    });
  });
});

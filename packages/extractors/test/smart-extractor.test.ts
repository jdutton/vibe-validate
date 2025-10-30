/**
 * Smart Extractor Tests - Pattern-Based Detection
 *
 * Tests that the smart extractor correctly detects which extractor to use
 * based on OUTPUT PATTERNS, not step names.
 *
 * CRITICAL: Each test verifies the correct extractor was chosen via metadata.detection.extractor
 *
 * @package @vibe-validate/extractors
 */

import { describe, it, expect } from 'vitest';
import { autoDetectAndExtract } from '../src/smart-extractor.js';
import {
  expectExtractorDetection,
  expectCompleteDetectionMetadata,
} from './helpers/assertion-helpers.js';

describe('Smart Extractor - Pattern-Based Detection', () => {
  describe('TypeScript Detection', () => {
    it('should detect TypeScript from error TS#### pattern', () => {
      const output = 'src/index.ts(10,5): error TS2322: Type error.';
      const result = autoDetectAndExtract('ANY_STEP_NAME', output);

      expectExtractorDetection(result, 'typescript', ['error TS#### pattern']);
      expect(result.summary).toContain('type error');
    });

    it('should detect TypeScript regardless of step name', () => {
      const output = 'src/index.ts(10,5): error TS2322: Type error.';

      // Try with various step names - should always route to TypeScript
      const result1 = autoDetectAndExtract('Build', output);
      const result2 = autoDetectAndExtract('Compile', output);
      const result3 = autoDetectAndExtract('Check Types', output);

      expect(result1).toBeDefined();
      expectExtractorDetection(result1, 'typescript');
      expectExtractorDetection(result2, 'typescript');
      expectExtractorDetection(result3, 'typescript');
    });
  });

  describe('ESLint Detection', () => {
    it('should detect ESLint from ✖ X problems pattern', () => {
      const output = '✖ 5 problems (3 errors, 2 warnings)';
      const result = autoDetectAndExtract('ANY_STEP_NAME', output);

      expect(result).toBeDefined();
      expectExtractorDetection(result, 'eslint', ['✖ X problems summary']);
    });

    it('should detect ESLint from line:col error/warning format', () => {
      const output = 'src/index.ts:10:5: error Error message rule-name';
      const result = autoDetectAndExtract('ANY_STEP_NAME', output);

      expect(result).toBeDefined();
      expectExtractorDetection(result, 'eslint', ['line:col error/warning format']);
    });
  });

  describe('JUnit XML Detection', () => {
    it('should detect JUnit from <?xml and <testsuite> tags', () => {
      const output = '<?xml version="1.0"?>\n<testsuite tests="10" failures="2"></testsuite>';
      const result = autoDetectAndExtract('ANY_STEP_NAME', output);

      expect(result.metadata?.detection?.extractor).toBe('junit');
      expect(result.metadata?.detection?.patterns).toContain('<?xml header');
      expect(result.metadata?.detection?.patterns).toContain('<testsuite> tag');
      expect(result.metadata?.detection?.confidence).toBe(100);
    });
  });

  describe('Jasmine Detection', () => {
    it('should detect Jasmine from Failures: header and numbered list', () => {
      const output = `
Failures:
1) Test Suite › test name
   Expected true to be false
      `.trim();
      const result = autoDetectAndExtract('ANY_STEP_NAME', output);

      expect(result.metadata?.detection?.extractor).toBe('jasmine');
      expect(result.metadata?.detection?.patterns).toContain('Failures: header');
      expect(result.metadata?.detection?.patterns).toContain('numbered test list');
    });
  });

  describe('Mocha Detection', () => {
    it('should detect Mocha from passing/failing summary', () => {
      const output = `
  5 passing
  2 failing

  1) Test Suite
     test name
      `.trim();
      const result = autoDetectAndExtract('ANY_STEP_NAME', output);

      expect(result.metadata?.detection?.extractor).toBe('mocha');
      expect(result.metadata?.detection?.patterns).toContain('passing/failing summary');
      expect(result.metadata?.detection?.patterns).toContain('numbered failures');
    });
  });

  describe('Playwright Detection', () => {
    it('should detect Playwright from .spec.ts + › separator pattern', () => {
      const output = `
Running 11 tests using 1 worker

  ✘   1 tests/example.spec.ts:26:5 › Test Suite › test name (100ms)

  1) tests/example.spec.ts:26:5 › Test Suite › test name
     Error: expect(received).toBe(expected)
      `.trim();
      const result = autoDetectAndExtract('ANY_STEP_NAME', output);

      expect(result.metadata?.detection?.extractor).toBe('playwright');
      expect(result.metadata?.detection?.patterns).toContain('.spec.ts files');
      expect(result.metadata?.detection?.patterns).toContain('numbered failures with › separator');
      expect(result.metadata?.detection?.confidence).toBe(95);
    });

    it('should detect Playwright from ✘ + .spec.ts pattern', () => {
      const output = '  ✘   1 tests/example.spec.ts:26:5';
      const result = autoDetectAndExtract('ANY_STEP_NAME', output);

      expect(result.metadata?.detection?.extractor).toBe('playwright');
      expect(result.metadata?.detection?.patterns).toContain('.spec.ts files');
      expect(result.metadata?.detection?.patterns).toContain('✘ failure with .spec.ts file');
    });

    it('should route to Playwright, not Jest, for .spec.ts files', () => {
      // Critical test: .spec.ts should go to Playwright, not Jest
      const output = `
  ✘   1 tests/example.spec.ts:26:5 › should fail

  1) tests/example.spec.ts:26:5 › should fail
     Error: test failed
      `.trim();

      const result = autoDetectAndExtract('Tests', output);

      // Must be Playwright, NOT Jest!
      expect(result.metadata?.detection?.extractor).toBe('playwright');
      expect(result.metadata?.detection?.extractor).not.toBe('jest');
    });
  });

  describe('Jest Detection', () => {
    it('should detect Jest from FAIL marker', () => {
      const output = `
FAIL test/unit/config.test.ts
  ● Test Suite › test name
    Error message
      `.trim();
      const result = autoDetectAndExtract('ANY_STEP_NAME', output);

      expect(result.metadata?.detection?.extractor).toBe('jest');
      expect(result.metadata?.detection?.patterns).toContain('FAIL marker');
    });

    it('should detect Jest from ● bullet marker', () => {
      const output = ' ● Test Suite › test name';
      const result = autoDetectAndExtract('ANY_STEP_NAME', output);

      expect(result.metadata?.detection?.extractor).toBe('jest');
      expect(result.metadata?.detection?.patterns).toContain('● bullet marker');
    });

    it('should detect Jest from ● bullet marker WITHOUT spaces (regression test)', () => {
      // Regression test for bug where Jest detection required ' ● ' (with spaces)
      // but real Jest output often has '●' without consistent spacing.
      // This caused false detection as Vitest when .test.ts files were present.
      const output = `
FAIL e2e/__tests__/nonSerializableStructures.test.ts
● processChild › handles circular inequality properly

    expect(received).toMatchSnapshot()

    Snapshot name: processChild handles circular inequality properly 1

    - Snapshot  -  0
    + Received  + 14

● processChild › handles Map

    expect(received).toMatchSnapshot()
      `.trim();

      const result = autoDetectAndExtract('ANY_STEP_NAME', output);

      // Should detect as Jest, NOT Vitest (even though .test.ts is present)
      expect(result.metadata?.detection?.extractor).toBe('jest');
      expect(result.metadata?.detection?.patterns).toContain('● bullet marker');
    });

    it('should detect Jest from Test Suites: summary', () => {
      const output = 'Test Suites: 1 failed, 1 total';
      const result = autoDetectAndExtract('ANY_STEP_NAME', output);

      expect(result.metadata?.detection?.extractor).toBe('jest');
      expect(result.metadata?.detection?.patterns).toContain('Test Suites: summary');
    });

    it('should use .test.ts files (Jest convention), not .spec.ts (Playwright)', () => {
      // Jest uses .test.ts files
      const output = `
FAIL tests/example.test.ts
  ● Test Suite › test name
    Error message
      `.trim();

      const result = autoDetectAndExtract('Tests', output);

      expect(result.metadata?.detection?.extractor).toBe('jest');
    });
  });

  describe('Vitest Detection', () => {
    it('should detect Vitest from × symbol + Test Files summary', () => {
      // Vitest requires MULTIPLE patterns: (× OR ❯) AND (Test Files OR FAIL pattern)
      const output = ' × test/unit/config.test.ts (1 failed)\nTest Files  1 failed | 2 passed (3)';
      const result = autoDetectAndExtract('ANY_STEP_NAME', output);

      expect(result.metadata?.detection?.extractor).toBe('vitest');
      expect(result.metadata?.detection?.patterns).toContain('× symbol (U+00D7)');
      expect(result.metadata?.detection?.patterns).toContain('Test Files summary');
    });

    it('should detect Vitest from ❯ arrow marker + Test Files summary', () => {
      // Vitest requires MULTIPLE patterns: (× OR ❯) AND (Test Files OR FAIL pattern)
      const output = ' ❯ test/unit/config.test.ts (5 tests)\nTest Files  1 failed (1)';
      const result = autoDetectAndExtract('ANY_STEP_NAME', output);

      expect(result.metadata?.detection?.extractor).toBe('vitest');
      expect(result.metadata?.detection?.patterns).toContain('❯ arrow marker');
      expect(result.metadata?.detection?.patterns).toContain('Test Files summary');
    });

    it('should detect Vitest from × symbol + FAIL N test files pattern', () => {
      // Vitest requires MULTIPLE patterns: (× OR ❯) AND (Test Files OR FAIL pattern)
      const output = ' × test/unit/config.test.ts\nFAIL 5 test files';
      const result = autoDetectAndExtract('ANY_STEP_NAME', output);

      expect(result.metadata?.detection?.extractor).toBe('vitest');
      expect(result.metadata?.detection?.patterns).toContain('× symbol (U+00D7)');
      expect(result.metadata?.detection?.patterns).toContain('FAIL N test files/cases pattern');
    });

    it('should NOT detect Vitest from × symbol alone', () => {
      // Single pattern should NOT trigger Vitest detection
      // Note: Removed .test.ts from test data because × + .test.ts correctly triggers vitest
      const output = ' × some-file.js (1 failed)';
      const result = autoDetectAndExtract('ANY_STEP_NAME', output);

      // Should fall back to generic extractor
      expect(result.metadata?.detection?.extractor).toBe('generic');
    });
  });

  describe('Generic Fallback Detection', () => {
    it('should use generic extractor for unrecognized patterns', () => {
      const output = 'Some random error output\nAnother error line';
      const result = autoDetectAndExtract('Custom Build Step', output);

      expect(result.metadata?.detection?.extractor).toBe('generic');
      expect(result.metadata?.detection?.patterns).toContain('no specific patterns');
      expect(result.metadata?.detection?.confidence).toBe(50);
      expect(result.summary).toContain('Custom Build Step');
    });

    it('should handle empty output gracefully', () => {
      const result = autoDetectAndExtract('Empty Step', '');

      expect(result.metadata?.detection?.extractor).toBe('generic');
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('Priority and Ordering', () => {
    it('should check TypeScript before other extractors', () => {
      // Output with both TypeScript and generic error patterns
      const output = 'src/index.ts(10,5): error TS2322: Type error.\nSome other error';
      const result = autoDetectAndExtract('Build', output);

      // Should match TypeScript first
      expect(result.metadata?.detection?.extractor).toBe('typescript');
    });

    it('should check Playwright before Jest (.spec.ts priority)', () => {
      // Both Playwright and Jest patterns, but .spec.ts should route to Playwright
      const output = `
  ✘   1 tests/example.spec.ts:26:5 › should fail
FAIL tests/example.spec.ts
      `.trim();

      const result = autoDetectAndExtract('Tests', output);

      // Must be Playwright because .spec.ts + › comes first
      expect(result.metadata?.detection?.extractor).toBe('playwright');
    });
  });

  describe('Detection Metadata Quality', () => {
    it('should include confidence score', () => {
      const output = 'src/index.ts(10,5): error TS2322: Type error.';
      const result = autoDetectAndExtract('Build', output);

      expect(result.metadata?.detection?.confidence).toBeGreaterThan(0);
      expect(result.metadata?.detection?.confidence).toBeLessThanOrEqual(100);
    });

    it('should include detected patterns', () => {
      const output = '✖ 5 problems (3 errors, 2 warnings)';
      const result = autoDetectAndExtract('Lint', output);

      expect(result.metadata?.detection?.patterns).toBeDefined();
      expect(result.metadata?.detection?.patterns.length).toBeGreaterThan(0);
    });

    it('should include complete metadata', () => {
      const output = 'src/index.ts(10,5): error TS2322: Type error.';
      const result = autoDetectAndExtract('Build', output);

      expect(result).toBeDefined();
      expectCompleteDetectionMetadata(result);
    });
  });
});

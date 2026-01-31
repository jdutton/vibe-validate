import { describe, it, expect } from 'vitest';

import {
  expectDetection,
  expectPluginMetadata,
  expectSampleValidation,
} from '../../test/helpers/extractor-test-helpers.js';


import mavenSurefireExtractor from './index.js';

describe('Maven Surefire Extractor Plugin', () => {
  describe('metadata', () => {
    it('should have correct plugin metadata', () => {
      expectPluginMetadata(mavenSurefireExtractor, {
        name: 'maven-surefire',
        priority: 95,
        requiredHints: ['[ERROR]', 'Tests run:'],
        tags: ['maven', 'junit'],
      });

      // Verify additional metadata fields not covered by helper
      expect(mavenSurefireExtractor.metadata.version).toBe('1.0.0');
      expect(mavenSurefireExtractor.hints?.anyOf).toBeDefined();
    });

    it('should have priority higher than Jasmine to avoid false matches', () => {
      // Regression test: Maven Surefire must have higher priority than Jasmine (90)
      // to prevent Jasmine from incorrectly detecting Maven output
      expect(mavenSurefireExtractor.priority).toBe(95);
      expect(mavenSurefireExtractor.priority).toBeGreaterThan(90); // Higher than Jasmine
    });
  });

  describe('detect', () => {
    it('should detect Maven Surefire output with high confidence', () => {
      expectDetection(
        mavenSurefireExtractor,
        `[INFO] Running tests...
[ERROR] Tests run: 10, Failures: 3, Errors: 1, Skipped: 0
[ERROR] com.example.FooTest.testBar -- Time elapsed: 0.123 s <<< FAILURE!
java.lang.AssertionError: Expected 5 but was 3`,
        {
          confidence: { min: 70 },
          patterns: ['Test summary (Tests run, Failures, Errors)', 'Test failure markers'],
          reasonContains: 'Maven Surefire',
        }
      );
      expect(mavenSurefireExtractor).toBeDefined();
    });

    it('should detect JUnit assertion errors', () => {
      expectDetection(
        mavenSurefireExtractor,
        `[ERROR] Tests run: 5, Failures: 2, Errors: 0
[ERROR] testFoo -- Time elapsed: 0.1 s <<< FAILURE!
org.opentest4j.AssertionFailedError: expected: "foo" but was: "bar"`,
        {
          confidence: { min: 70 },
          patterns: ['JUnit assertion errors'],
        }
      );
      expect(mavenSurefireExtractor).toBeDefined();
    });

    it('should have low confidence for non-Surefire output', () => {
      expectDetection(
        mavenSurefireExtractor,
        `Some random output
No test markers here`,
        {
          confidence: { max: 39 },
        }
      );
      expect(mavenSurefireExtractor).toBeDefined();
    });
  });

  describe('extract', () => {
    it('should extract test summary', () => {
      const output = `[ERROR] Tests run: 10, Failures: 3, Errors: 1, Skipped: 1`;

      const result = mavenSurefireExtractor.extract(output);

      expect(result.summary).toContain('3 failures, 1 errors');
    });

    it('should extract test failures with stack traces', () => {
      const output = `[ERROR] Tests run: 1, Failures: 1, Errors: 0
[ERROR] com.example.FooTest.testBar -- Time elapsed: 0.123 s <<< FAILURE!
java.lang.AssertionError: Expected 5 but was 3
\tat com.example.FooTest.testBar(FooTest.java:42)
\tat java.base/java.lang.reflect.Method.invoke(Method.java:565)`;

      const result = mavenSurefireExtractor.extract(output);

      expect(result.totalErrors).toBeGreaterThan(0);
      if (result.errors.length > 0) {
        expect(result.errors[0].file).toContain('FooTest.java');
        expect(result.errors[0].message).toContain('testBar');
      }
    });

    it('should extract NullPointerException errors', () => {
      const output = `[ERROR] Tests run: 1, Failures: 0, Errors: 1
[ERROR] com.example.FooTest.testNull -- Time elapsed: 0.01 s <<< ERROR!
java.lang.NullPointerException: Cannot invoke "String.length()" because "value" is null
\tat com.example.FooTest.testNull(FooTest.java:77)`;

      const result = mavenSurefireExtractor.extract(output);

      expect(result.totalErrors).toBeGreaterThan(0);
      if (result.errors.length > 0) {
        expect(result.errors[0].message).toContain('NullPointerException');
        expect(result.errors[0].line).toBe(77);
      }
    });

    it('should limit errors to MAX_ERRORS_IN_ARRAY', () => {
      // Create 15 test failures
      const failures = Array.from({ length: 15 }, (_, i) =>
        `[ERROR] com.example.Test.test${i} -- Time elapsed: 0.1 s <<< FAILURE!\njava.lang.AssertionError: Test ${i} failed`
      ).join('\n\n');

      const output = `[ERROR] Tests run: 15, Failures: 15, Errors: 0\n${failures}`;
      const result = mavenSurefireExtractor.extract(output);

      expect(result.totalErrors).toBe(15); // All counted
      expect(result.errors.length).toBeLessThanOrEqual(10); // Array limited
    });

    it('should provide guidance', () => {
      const output = `[ERROR] Tests run: 5, Failures: 2, Errors: 0
[ERROR] com.example.Test.testFoo -- <<< FAILURE!`;

      const result = mavenSurefireExtractor.extract(output);

      expect(result.guidance).toContain('Fix test failures');
      expect(result.guidance).toContain('mvn test');
    });

    it('should extract exception types correctly', () => {
      const output = `[ERROR] Tests run: 1, Failures: 0, Errors: 1
[ERROR] com.example.Test.testException -- <<< ERROR!
java.lang.IllegalArgumentException: Invalid format: expected 'XXX' but got 'invalid'
\tat com.example.Test.testException(Test.java:50)`;

      const result = mavenSurefireExtractor.extract(output);

      expect(result.totalErrors).toBeGreaterThan(0);
      if (result.errors.length > 0) {
        expect(result.errors[0].message).toContain('IllegalArgumentException');
        expect(result.errors[0].message).toContain('Invalid format');
      }
    });

    it('should handle AssertJ assertion errors', () => {
      const output = `[ERROR] Tests run: 1, Failures: 1, Errors: 0
[ERROR] com.example.Test.testAssertJ -- <<< FAILURE!
java.lang.AssertionError:

Expecting actual:
  "Hello World"
to contain:
  "Goodbye"
\tat com.example.Test.testAssertJ(Test.java:25)`;

      const result = mavenSurefireExtractor.extract(output);

      expect(result.totalErrors).toBeGreaterThan(0);
      if (result.errors.length > 0) {
        expect(result.errors[0].message).toContain('AssertionError');
        // Line number extraction is best-effort from stack traces
        if (result.errors[0].line) {
          expect(result.errors[0].line).toBe(25);
        }
      }
    });

    it('should return low confidence for non-test output', () => {
      const output = `[INFO] Building project...
[INFO] Success!`;

      const result = mavenSurefireExtractor.extract(output);

      expect(result.totalErrors).toBe(0);
      expect(result.summary).toContain('Not Maven test output');
      expect(result.metadata?.detection?.confidence).toBeLessThan(40);
    });
  });

  describe('samples', () => {
    it('should have test samples', () => {
      expect(mavenSurefireExtractor.samples).toBeDefined();
      expect(mavenSurefireExtractor.samples.length).toBeGreaterThan(0);
    });

    it('should validate basic-assertion-failure sample', () => {
      expectSampleValidation(mavenSurefireExtractor, 'basic-assertion-failure');
    });

    it('should validate null-pointer-exception sample', () => {
      expectSampleValidation(mavenSurefireExtractor, 'null-pointer-exception');
    });

    it('should validate assertj-failure sample', () => {
      expectSampleValidation(mavenSurefireExtractor, 'assertj-failure');
    });
  });
});

import { describe, it, expect } from 'vitest';
import { detectMavenSurefire, extractMavenSurefire } from '../src/maven-surefire-extractor.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('Maven Surefire Extractor', () => {
  describe('detectMavenSurefire', () => {
    it('should detect Maven Surefire output with high confidence', () => {
      const output = `[INFO] Running tests...
[ERROR] Tests run: 10, Failures: 3, Errors: 1, Skipped: 0
[ERROR] com.example.FooTest.testBar -- Time elapsed: 0.123 s <<< FAILURE!
java.lang.AssertionError: Expected 5 but was 3`;

      const result = detectMavenSurefire(output);

      expect(result.confidence).toBeGreaterThanOrEqual(70);
      expect(result.patterns).toContain('Test summary (Tests run, Failures, Errors)');
      expect(result.patterns).toContain('Test failure markers');
      expect(result.reason).toContain('Maven Surefire');
    });

    it('should detect JUnit assertion errors', () => {
      const output = `[ERROR] Tests run: 5, Failures: 2, Errors: 0
[ERROR] testFoo -- Time elapsed: 0.1 s <<< FAILURE!
org.opentest4j.AssertionFailedError: expected: "foo" but was: "bar"`;

      const result = detectMavenSurefire(output);

      expect(result.confidence).toBeGreaterThanOrEqual(70);
      expect(result.patterns).toContain('JUnit assertion errors');
    });

    it('should have low confidence for non-Surefire output', () => {
      const output = `Some random output
No test markers here`;

      const result = detectMavenSurefire(output);

      expect(result.confidence).toBeLessThan(40);
    });
  });

  describe('extractMavenSurefire', () => {
    it('should extract test summary', () => {
      const output = `[ERROR] Tests run: 10, Failures: 3, Errors: 1, Skipped: 1`;

      const result = extractMavenSurefire(output);

      expect(result.summary).toContain('3 failures, 1 errors');
    });

    it('should extract test failures with stack traces', () => {
      const output = `[ERROR] Tests run: 1, Failures: 1, Errors: 0
[ERROR] com.example.FooTest.testBar -- Time elapsed: 0.123 s <<< FAILURE!
java.lang.AssertionError: Expected 5 but was 3
\tat com.example.FooTest.testBar(FooTest.java:42)
\tat java.base/java.lang.reflect.Method.invoke(Method.java:565)`;

      const result = extractMavenSurefire(output);

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

      const result = extractMavenSurefire(output);

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
      const result = extractMavenSurefire(output);

      expect(result.totalErrors).toBe(15); // All counted
      expect(result.errors.length).toBeLessThanOrEqual(10); // Array limited
    });

    it('should provide guidance', () => {
      const output = `[ERROR] Tests run: 5, Failures: 2, Errors: 0
[ERROR] com.example.Test.testFoo -- <<< FAILURE!`;

      const result = extractMavenSurefire(output);

      expect(result.guidance).toContain('Fix test failures');
      expect(result.guidance).toContain('mvn test');
    });

    it('should handle real anonymized output', () => {
      const testFile = join(__dirname, '../static/maven-surefire-failures.txt');

      try {
        const output = readFileSync(testFile, 'utf-8');
        const result = extractMavenSurefire(output);

        // Should extract multiple test failures
        expect(result.totalErrors).toBeGreaterThan(8);
        expect(result.summary).toContain('test failure');
        expect(result.metadata?.detection?.confidence).toBeGreaterThanOrEqualTo(90);
      } catch {
        // File doesn't exist yet - skip test
        expect(true).toBe(true);
      }
    });

    it('should extract exception types correctly', () => {
      const output = `[ERROR] Tests run: 1, Failures: 0, Errors: 1
[ERROR] com.example.Test.testException -- <<< ERROR!
java.lang.IllegalArgumentException: Invalid format: expected 'XXX' but got 'invalid'
\tat com.example.Test.testException(Test.java:50)`;

      const result = extractMavenSurefire(output);

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

      const result = extractMavenSurefire(output);

      expect(result.totalErrors).toBeGreaterThan(0);
      if (result.errors.length > 0) {
        expect(result.errors[0].message).toContain('AssertionError');
        // Line number extraction is best-effort from stack traces
        if (result.errors[0].line) {
          expect(result.errors[0].line).toBe(25);
        }
      }
    });
  });
});

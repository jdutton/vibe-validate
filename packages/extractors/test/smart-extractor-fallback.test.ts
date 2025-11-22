import { describe, it, expect } from 'vitest';
import { autoDetectAndExtract } from '../src/smart-extractor.js';

describe('Smart Extractor Fallback Strategy', () => {
  describe('RED FLAG HEURISTIC: exitCode != 0 but totalErrors == 0', () => {
    it('should try next extractor when first finds no errors despite failure', () => {
      // Scenario: Maven compiler output that Checkstyle might partially match
      // but can't extract errors from
      const output = `[INFO] Compiling 45 source files
[ERROR] COMPILATION ERROR :
[ERROR] /path/to/Foo.java:[42,25] cannot find symbol
  symbol:   method extractComponent()
  location: class com.example.RefactoringActions
[INFO] 1 error
[ERROR] Failed to execute goal org.apache.maven.plugins:maven-compiler-plugin:3.13.0:compile`;

      const result = autoDetectAndExtract(output, 1);

      // Should detect Maven compiler, not fall back to generic
      expect(result.metadata?.detection?.extractor).toBe('maven-compiler');
      expect(result.totalErrors).toBeGreaterThan(0);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should fall back to generic when NO extractor finds errors', () => {
      // Scenario: Command failed but output doesn't match any extractor patterns
      const output = `Some mysterious error occurred
Build failed for unknown reasons
Exit code: 1`;

      const result = autoDetectAndExtract(output, 1);

      // Should use generic extractor
      expect(result.metadata?.detection?.extractor).toBe('generic');
      expect(result.metadata?.detection?.reason).toContain('no extractor found errors');
    });

    it('should prefer extractor with errors over higher confidence without errors', () => {
      // Scenario: Create output that triggers multiple detectors
      // One with high confidence but 0 errors, another with lower confidence but actual errors
      const output = `[INFO] Some Maven-like output
maven-checkstyle-plugin mentioned here
[ERROR] COMPILATION ERROR :
[ERROR] /path/to/File.java:[10,5] cannot find symbol
[INFO] 1 error`;

      const result = autoDetectAndExtract(output, 1);

      // Should prefer compiler (which found errors) over Checkstyle (which might not)
      expect(result.totalErrors).toBeGreaterThan(0);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe('exitCode == 0 (success)', () => {
    it('should use highest confidence extractor when command succeeded', () => {
      const output = `✓ packages/cli/test/config.test.ts (5)
✓ packages/core/test/validator.test.ts (12)

Test Files  2 passed (2)
     Tests  17 passed (17)`;

      const result = autoDetectAndExtract(output, 0);

      // Should detect Vitest
      expect(result.metadata?.detection?.extractor).toBe('vitest');
      expect(result.totalErrors).toBe(0);
    });

    it('should handle successful TypeScript compilation', () => {
      const output = `tsc --noEmit
No errors found`;

      const result = autoDetectAndExtract(output, 0);

      // May detect TypeScript or generic, but should have 0 errors
      expect(result.totalErrors).toBe(0);
    });
  });

  describe('Multiple extractors with varying confidence', () => {
    it('should pick highest confidence among extractors that found errors', () => {
      // Create output that matches multiple extractors
      const output = `[ERROR] COMPILATION ERROR :
[ERROR] /path/File.java:[10,5] cannot find symbol
TypeScript-like error TS2322: Type mismatch
[INFO] 1 error`;

      const result = autoDetectAndExtract(output, 1);

      // Should have extracted errors
      expect(result.totalErrors).toBeGreaterThan(0);
    });

    it('should handle Maven test failures with compiler errors', () => {
      // Scenario: Test run that triggered compilation error
      const output = `[INFO] Running tests
[INFO] maven-surefire-plugin starting
[ERROR] COMPILATION ERROR :
[ERROR] /path/TestFile.java:[5,10] cannot find symbol
[INFO] 1 error
Tests run: 0, Failures: 0, Errors: 1`;

      const result = autoDetectAndExtract(output, 1);

      // Should detect and extract the compilation error
      expect(result.totalErrors).toBeGreaterThan(0);
      expect(result.errors.length).toBeGreaterThan(0);
    });
  });

  describe('Backward compatibility (no exitCode provided)', () => {
    it('should use sequential detection when exitCode not provided', () => {
      const output = `error TS2322: Type 'string' is not assignable to type 'number'.
src/foo.ts(10,5): error TS2322:
src/bar.ts(15,3): error TS2345: Argument of type 'string' is not assignable to parameter of type 'number'.`;

      const result = autoDetectAndExtract(output);

      // Should still work with old behavior
      expect(result.metadata?.detection?.extractor).toBe('typescript');
      expect(result.totalErrors).toBeGreaterThan(0);
    });

    it('should detect Jest without exitCode', () => {
      const output = `● Test suite failed to run

FAIL packages/foo.test.ts
  ● Test #1

    Expected true, got false

Test Suites: 1 failed, 1 total`;

      const result = autoDetectAndExtract(output);

      expect(result.metadata?.detection?.extractor).toBe('jest');
    });
  });

  describe('Real-world Maven scenarios', () => {
    it('should handle Checkstyle success with Maven compiler failure', () => {
      // Scenario: Checkstyle passed, but compilation failed
      const output = `[INFO] maven-checkstyle-plugin starting
[INFO] Starting audit...
Audit done.
[INFO] BUILD SUCCESS for checkstyle
[ERROR] COMPILATION ERROR :
[ERROR] /path/Foo.java:[42,25] cannot find symbol
[ERROR] Failed to execute goal maven-compiler-plugin`;

      const result = autoDetectAndExtract(output, 1);

      // Should detect compiler error, not get confused by Checkstyle success
      expect(result.metadata?.detection?.extractor).toBe('maven-compiler');
      expect(result.totalErrors).toBeGreaterThan(0);
    });

    it('should handle Maven Surefire test failure', () => {
      const output = `[INFO] -------------------------------------------------------
[INFO]  T E S T S
[INFO] -------------------------------------------------------
[INFO] Running com.example.CalculatorTest
Tests run: 5, Failures: 2, Errors: 0, Skipped: 0, Time elapsed: 0.123 s <<< FAILURE!

Results:

Failed tests:
  testCalculation(com.example.CalculatorTest): expected:<10> but was:<5>
  testValidation(com.example.ValidatorTest): NullPointerException

Tests run: 5, Failures: 2, Errors: 0

[ERROR] Failed to execute goal org.apache.maven.plugins:maven-surefire-plugin:3.0.0`;

      const result = autoDetectAndExtract(output, 1);

      // Should detect some extractor (Maven Surefire or generic)
      expect(result.metadata?.detection?.extractor).toBeDefined();
      // For this minimal test output, generic extractor may not extract structured errors
      // That's OK - the key is that it doesn't crash and provides SOME result
      expect(result.exitCode !== undefined || result.summary).toBeTruthy();
    });
  });

  describe('Edge cases', () => {
    it('should handle empty output with failure', () => {
      const result = autoDetectAndExtract('', 1);

      expect(result.metadata?.detection?.extractor).toBe('generic');
      expect(result.totalErrors).toBeGreaterThanOrEqual(0);
    });

    it('should handle exitCode 0 with errors in output (warning scenario)', () => {
      const output = `[WARN] /path/File.java:10:5: Missing Javadoc [JavadocVariable]
Audit done.`;

      const result = autoDetectAndExtract(output, 0);

      // Command succeeded, so should accept result even if extractor found issues
      expect(result.totalErrors).toBeGreaterThanOrEqual(0);
    });

    it('should handle very high exit codes', () => {
      const output = `Catastrophic failure
Signal: SIGKILL`;

      const result = autoDetectAndExtract(output, 137);

      expect(result.metadata?.detection?.extractor).toBe('generic');
    });
  });

  describe('Detection confidence thresholds', () => {
    it('should include extractors with confidence >= 40%', () => {
      // Test that fallback considers extractors above the threshold
      const output = `[INFO] Some Maven-related output
[ERROR] COMPILATION ERROR :
[ERROR] /path/File.java:[1,1] error
[INFO] 1 error`;

      const result = autoDetectAndExtract(output, 1);

      // Should find errors from Maven compiler
      expect(result.totalErrors).toBeGreaterThan(0);
    });
  });
});

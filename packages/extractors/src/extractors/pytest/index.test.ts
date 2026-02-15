/**
 * Pytest Error Extractor - TDD Tests
 *
 * Built test-first following Red-Green-Refactor cycles.
 *
 * @package @vibe-validate/extractors
 */

import { describe, it, expect } from 'vitest';

import { expectExtractionResult, expectSamplesParseSuccessfully } from '../../test/helpers/extractor-test-helpers.js';

import pytestPlugin from './index.js';

describe('pytest extractor plugin', () => {
  describe('detect', () => {
    it('should detect pytest via short summary + .py paths at 90% confidence', () => {
      // No platform line — just short summary with .py paths
      const output = `=========================== short test summary info ============================
FAILED tests/test_calc.py::TestCalc::test_divide - ZeroDivisionError: division by zero
========================= 1 failed, 4 passed in 0.45s =========================`;

      const result = pytestPlugin.detect(output);
      expect(result.confidence).toBe(90);
      expect(result.patterns).toContain('short test summary');
    });

    it('should detect pytest output with platform line at 95% confidence', () => {
      const output = `============================= test session starts ==============================
platform darwin -- Python 3.9.6, pytest-8.4.1, pluggy-1.6.0
rootdir: /Users/dev/project
collected 5 items

tests/test_calc.py F.                                                    [ 40%]

=========================== short test summary info ============================
FAILED tests/test_calc.py::TestCalc::test_divide - ZeroDivisionError: division by zero
========================= 1 failed, 4 passed in 0.45s =========================`;

      const result = pytestPlugin.detect(output);
      expect(result.confidence).toBe(95);
      expect(result.patterns).toContain('pytest platform line');
      expect(result.reason).toContain('pytest');
    });

    it('should detect pytest via summary format + .py paths at 85% confidence', () => {
      // No platform line, no short test summary — just pytest-style counts + .py paths
      const output = `FAILED tests/test_calc.py::test_divide
========================= 1 failed, 4 passed in 0.45s =========================`;

      const result = pytestPlugin.detect(output);
      expect(result.confidence).toBe(85);
      expect(result.patterns).toContain('pytest summary format');
    });

    it('should NOT detect non-pytest output', () => {
      const output = `src/index.ts:42:5 - error TS2322: Type 'string' is not assignable to type 'number'.`;
      const result = pytestPlugin.detect(output);
      expect(result.confidence).toBe(0);
    });

    it('should NOT detect Jasmine output (regression guard)', () => {
      const output = `Started
F

Failures:
1) Test Suite should work
  Message:
    Expected 4 to equal 5.
  Stack:
        at <Jasmine>
        at UserContext.<anonymous> (test.js:9:17)

1 spec, 1 failure
Finished in 0.037 seconds`;

      const result = pytestPlugin.detect(output);
      expect(result.confidence).toBe(0);
    });
  });

  describe('extract', () => {
    describe('FAILURES section (assertion errors)', () => {
      it('should extract assertion failures from FAILURES section', () => {
        const output = `============================= test session starts ==============================
platform linux -- Python 3.11.0, pytest-7.4.0, pluggy-1.3.0
rootdir: /home/dev/project
collected 5 items

tests/test_calc.py F.                                                    [ 40%]
tests/test_utils.py .F.                                                  [ 100%]

================================== FAILURES ===================================
___________________________ TestCalc.test_divide ___________________________

    def test_divide(self):
>       assert divide(10, 0) == float('inf')
E       ZeroDivisionError: division by zero

tests/test_calc.py:15: ZeroDivisionError
___________________________ TestUtils.test_parse ___________________________

    def test_parse(self):
>       assert parse("abc") == 123
E       AssertionError: assert None == 123
E        +  where None = parse('abc')

tests/test_utils.py:22: AssertionError
=========================== short test summary info ============================
FAILED tests/test_calc.py::TestCalc::test_divide - ZeroDivisionError: division by zero
FAILED tests/test_utils.py::TestUtils::test_parse - AssertionError: assert None == 123
========================= 2 failed, 3 passed in 0.45s =========================`;

        const result = pytestPlugin.extract(output);
        expectExtractionResult(result, { errorCount: 2 });

        // First failure: ZeroDivisionError with file:line
        expect(result.errors[0].file).toBe('tests/test_calc.py');
        expect(result.errors[0].line).toBe(15);
        expect(result.errors[0].message).toContain('ZeroDivisionError');

        // Second failure: AssertionError with file:line
        expect(result.errors[1].file).toBe('tests/test_utils.py');
        expect(result.errors[1].line).toBe(22);
        expect(result.errors[1].message).toContain('AssertionError');
      });
    });

    describe('ERRORS section (collection errors)', () => {
      it('should extract collection errors from ERRORS section', () => {
        // Real-world scenario: lfa-cc-marketplace powerpoint plugin failure
        const output = `============================= test session starts ==============================
platform darwin -- Python 3.9.6, pytest-8.4.1, pluggy-1.6.0
rootdir: /Users/dev/project
collected 10 items / 2 errors

==================================== ERRORS ====================================
________ ERROR collecting tests/test_foo.py ________
tests/test_foo.py:9: in <module>
    from mymodule import MyClass
mymodule.py:50: in <module>
    class MyClass:
mymodule.py:55: in MyClass
    def method(self, arg: str | None = None) -> dict:
E   TypeError: unsupported operand type(s) for |: 'type' and 'NoneType'
________ ERROR collecting tests/test_bar.py ________
tests/test_bar.py:3: in <module>
    from missing_module import func
E   ModuleNotFoundError: No module named 'missing_module'
=========================== short test summary info ============================
ERROR tests/test_foo.py - TypeError: unsupported operand type(s) for |: 'type' and 'NoneType'
ERROR tests/test_bar.py - ModuleNotFoundError: No module named 'missing_module'
========================= 2 errors in 0.50s =========================`;

        const result = pytestPlugin.extract(output);
        expectExtractionResult(result, { errorCount: 2 });

        // First error: TypeError from traceback
        expect(result.errors[0].file).toBe('mymodule.py');
        expect(result.errors[0].line).toBe(55);
        expect(result.errors[0].message).toContain('TypeError');

        // Second error: ModuleNotFoundError
        expect(result.errors[1].message).toContain('ModuleNotFoundError');
      });
    });

    describe('Short summary fallback', () => {
      it('should extract from short summary when no FAILURES/ERRORS sections', () => {
        const output = `=========================== short test summary info ============================
FAILED tests/test_calc.py::TestCalc::test_divide - ZeroDivisionError: division by zero
ERROR tests/test_bar.py - ModuleNotFoundError: No module named 'missing_module'
========================= 1 failed, 1 error in 0.50s =========================`;

        const result = pytestPlugin.extract(output);
        expectExtractionResult(result, { errorCount: 2 });

        expect(result.errors[0].file).toBe('tests/test_calc.py');
        expect(result.errors[0].message).toContain('ZeroDivisionError');
        expect(result.errors[1].file).toBe('tests/test_bar.py');
        expect(result.errors[1].message).toContain('ModuleNotFoundError');
      });
    });

    describe('Edge cases', () => {
      it('should return 0 errors for all-passing output', () => {
        const output = `============================= test session starts ==============================
platform darwin -- Python 3.9.6, pytest-8.4.1, pluggy-1.6.0
rootdir: /Users/dev/project
collected 10 items

tests/test_calc.py ..........                                            [100%]

============================== 10 passed in 0.50s ==============================`;

        const result = pytestPlugin.extract(output);
        expectExtractionResult(result, { errorCount: 0 });
      });
    });
  });

  describe('metadata', () => {
    it('should have correct plugin metadata', () => {
      expect(pytestPlugin.metadata.name).toBe('pytest');
      expect(pytestPlugin.priority).toBe(92);
      expect(pytestPlugin.hints?.anyOf).toContain('pytest');
      expect(pytestPlugin.hints?.anyOf).toContain('.py::');
      expect(pytestPlugin.hints?.forbidden).toContain('at <Jasmine>');
      expect(pytestPlugin.metadata.tags).toContain('python');
      expect(pytestPlugin.metadata.tags).toContain('testing');
    });
  });

  describe('samples', () => {
    it('should have at least 2 sample test cases', () => {
      expect(pytestPlugin.samples.length).toBeGreaterThanOrEqual(2);
    });

    it('should successfully parse all sample inputs', () => {
      expectSamplesParseSuccessfully(pytestPlugin);
    });
  });
});

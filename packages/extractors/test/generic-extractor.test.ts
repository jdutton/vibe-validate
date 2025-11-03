/**
 * Generic Extractor Tests
 *
 * Tests for intelligent keyword extraction from various language test frameworks
 */

import { describe, it, expect } from 'vitest';
import { extractGenericErrors } from '../src/generic-extractor.js';

describe('Generic Extractor', () => {
  describe('Python pytest output', () => {
    it('should extract FAILED lines and AssertionError from pytest output', () => {
      const pytestOutput = `
============================= test session starts ==============================
platform darwin -- Python 3.11.0, pytest-7.4.0
collected 5 items

tests/test_foo.py F...                                                  [ 40%]
tests/test_bar.py .F...                                                 [100%]

=================================== FAILURES ===================================
_________________________________ test_divide __________________________________

    def test_divide():
>       assert divide(10, 0) == 0
E       ZeroDivisionError: division by zero

tests/test_foo.py:42: ZeroDivisionError
_________________________________ test_validate _________________________________

    def test_validate():
>       assert validate("") == True
E       AssertionError: assert False == True

tests/test_bar.py:15: AssertionError
=========================== short test summary info ============================
FAILED tests/test_foo.py::test_divide - ZeroDivisionError: division by zero
FAILED tests/test_bar.py::test_validate - AssertionError
========================= 2 failed, 3 passed in 0.45s ==========================
`;

      const result = extractGenericErrors(pytestOutput);

      expect(result.errors).toEqual([]);
      expect(result.summary).toBe('Command failed - see output');
      expect(result.errorSummary).toContain('ZeroDivisionError');
      expect(result.errorSummary).toContain('AssertionError');
      expect(result.errorSummary).toContain('FAILED tests/test_foo.py');
      expect(result.errorSummary).toContain('FAILED tests/test_bar.py');
      expect(result.errorSummary).toContain('tests/test_foo.py:42');
      expect(result.errorSummary).toContain('tests/test_bar.py:15');
      expect(result.errorSummary).toContain('2 failed, 3 passed');

      // Should NOT contain test session noise
      expect(result.errorSummary).not.toContain('test session starts');
      expect(result.errorSummary).not.toContain('platform darwin');
      expect(result.errorSummary).not.toContain('collected 5 items');
    });

    it('should extract multiple pytest failures', () => {
      const pytestOutput = `
FAILED tests/test_api.py::test_create_user - AssertionError: Expected 201, got 400
FAILED tests/test_api.py::test_update_user - TypeError: 'NoneType' object is not subscriptable
FAILED tests/test_db.py::test_connection - ValueError: Database not found
3 failed, 12 passed in 2.34s
`;

      const result = extractGenericErrors(pytestOutput);

      expect(result.errorSummary).toContain('FAILED tests/test_api.py::test_create_user');
      expect(result.errorSummary).toContain('FAILED tests/test_api.py::test_update_user');
      expect(result.errorSummary).toContain('FAILED tests/test_db.py::test_connection');
      expect(result.errorSummary).toContain('AssertionError');
      expect(result.errorSummary).toContain('TypeError');
      expect(result.errorSummary).toContain('ValueError');
      expect(result.errorSummary).toContain('3 failed, 12 passed');
    });
  });

  describe('Go test output', () => {
    it('should extract FAIL lines and panic from Go test output', () => {
      const goOutput = `
=== RUN   TestDivide
    calc_test.go:42: Expected 0, got panic
--- FAIL: TestDivide (0.00s)
panic: runtime error: integer divide by zero

goroutine 6 [running]:
main.Divide(0xa, 0x0)
        /Users/test/calc.go:15 +0x27
main.TestDivide(0xc00012e000)
        /Users/test/calc_test.go:42 +0x45

=== RUN   TestValidate
    validator_test.go:25: Expected true, got false
--- FAIL: TestValidate (0.00s)

FAIL
FAIL    example.com/project 0.123s
`;

      const result = extractGenericErrors(goOutput);

      expect(result.errorSummary).toContain('FAIL: TestDivide');
      expect(result.errorSummary).toContain('FAIL: TestValidate');
      expect(result.errorSummary).toContain('panic:');
      expect(result.errorSummary).toContain('calc.go:15');
      expect(result.errorSummary).toContain('calc_test.go:42');
      expect(result.errorSummary).toContain('validator_test.go:25');
    });

    it('should extract Go compilation errors', () => {
      const goOutput = `
# example.com/project
./main.go:15:10: undefined: someFunction
./main.go:42:5: cannot use 5 (type int) as type string in assignment
./config.go:23:1: syntax error: unexpected }, expecting )
`;

      const result = extractGenericErrors(goOutput);

      expect(result.errorSummary).toContain('main.go:15:10');
      expect(result.errorSummary).toContain('main.go:42:5');
      expect(result.errorSummary).toContain('config.go:23:1');
      expect(result.errorSummary).toContain('error'); // Go uses lowercase "error:"
    });
  });

  describe('Rust cargo test output', () => {
    it('should extract test failures and panic from Rust output', () => {
      const rustOutput = `
   Compiling myproject v0.1.0 (/Users/test/myproject)
    Finished test [unoptimized + debuginfo] target(s) in 1.23s
     Running unittests src/lib.rs (target/debug/deps/myproject-abc123)

running 3 tests
test tests::test_divide ... FAILED
test tests::test_add ... ok
test tests::test_multiply ... ok

failures:

---- tests::test_divide stdout ----
thread 'tests::test_divide' panicked at 'assertion failed: \`(left == right)\`
  left: \`5\`,
 right: \`0\`', src/lib.rs:42:5
note: run with \`RUST_BACKTRACE=1\` environment variable to display a backtrace

failures:
    tests::test_divide

test result: FAILED. 1 passed; 1 failed; 0 ignored; 0 measured; 0 filtered out
`;

      const result = extractGenericErrors(rustOutput);

      expect(result.errorSummary).toContain('FAILED');
      expect(result.errorSummary).toContain('panic');
      expect(result.errorSummary).toContain('lib.rs:42');
      expect(result.errorSummary).toContain('1 passed; 1 failed');
    });

    it('should extract Rust compilation errors', () => {
      const rustOutput = `
   Compiling myproject v0.1.0
error[E0425]: cannot find value \`x\` in this scope
 --> src/main.rs:15:10
  |
15 |     let y = x + 5;
   |             ^ not found in this scope

error[E0308]: mismatched types
 --> src/lib.rs:42:5
  |
42 |     5
   |     ^ expected \`String\`, found integer

error: aborting due to 2 previous errors
`;

      const result = extractGenericErrors(rustOutput);

      expect(result.errorSummary).toContain('error');
      expect(result.errorSummary).toContain('main.rs:15');
      expect(result.errorSummary).toContain('lib.rs:42');
      expect(result.errorSummary).toContain('2 previous errors');
    });
  });

  describe('Ruby RSpec output', () => {
    it('should extract RSpec failures', () => {
      const rspecOutput = `
Randomized with seed 12345

Calculator
  #divide
    FAILED - 1) Expected 0 but got error

Failures:

  1) Calculator#divide divides by zero
     Failure/Error: expect(calc.divide(10, 0)).to eq(0)

       ZeroDivisionError:
         divided by 0
     # ./spec/calculator_spec.rb:42:in \`/\`
     # ./spec/calculator_spec.rb:42:in \`block (3 levels) in <top (required)>\`

Finished in 0.05 seconds (files took 0.2 seconds to load)
5 examples, 1 failure

Failed examples:

rspec ./spec/calculator_spec.rb:40 # Calculator#divide divides by zero
`;

      const result = extractGenericErrors(rspecOutput);

      expect(result.errorSummary).toContain('FAILED');
      expect(result.errorSummary).toContain('ZeroDivisionError');
      expect(result.errorSummary).toContain('calculator_spec.rb:42');
      expect(result.errorSummary).toContain('5 examples, 1 failure');
    });
  });

  describe('Java JUnit output', () => {
    it('should extract JUnit test failures', () => {
      const junitOutput = `
[INFO] -------------------------------------------------------
[INFO]  T E S T S
[INFO] -------------------------------------------------------
[INFO] Running com.example.CalculatorTest
[ERROR] Tests run: 5, Failures: 1, Errors: 1, Skipped: 0, Time elapsed: 0.5 s <<< FAILURE! - in com.example.CalculatorTest
[ERROR] testDivide(com.example.CalculatorTest)  Time elapsed: 0.001 s  <<< ERROR!
java.lang.ArithmeticException: / by zero
	at com.example.Calculator.divide(Calculator.java:15)
	at com.example.CalculatorTest.testDivide(CalculatorTest.java:42)

[ERROR] testValidate(com.example.ValidatorTest)  Time elapsed: 0.001 s  <<< FAILURE!
org.junit.ComparisonFailure: expected:<[true]> but was:<[false]>
	at com.example.ValidatorTest.testValidate(ValidatorTest.java:25)

Results:

Tests run: 5, Failures: 1, Errors: 1, Skipped: 0
`;

      const result = extractGenericErrors(junitOutput);

      expect(result.errorSummary).toContain('ERROR');
      expect(result.errorSummary).toContain('FAILURE');
      expect(result.errorSummary).toContain('ArithmeticException');
      expect(result.errorSummary).toContain('ComparisonFailure');
      expect(result.errorSummary).toContain('Calculator.java:15');
      expect(result.errorSummary).toContain('CalculatorTest.java:42');
      expect(result.errorSummary).toContain('ValidatorTest.java:25');
      expect(result.errorSummary).toContain('Tests run: 5, Failures: 1, Errors: 1');
    });
  });

  describe('C/C++ compilation errors', () => {
    it('should extract GCC/Clang compilation errors', () => {
      const gccOutput = `
main.cpp:15:10: error: use of undeclared identifier 'x'
    int y = x + 5;
            ^
main.cpp:42:5: error: no matching function for call to 'divide'
    divide(10, 0);
    ^~~~~~
main.cpp:10:5: note: candidate function not viable: requires 1 argument, but 2 were provided
int divide(int a);
    ^
2 errors generated.
`;

      const result = extractGenericErrors(gccOutput);

      expect(result.errorSummary).toContain('error');
      expect(result.errorSummary).toContain('main.cpp:15:10');
      expect(result.errorSummary).toContain('main.cpp:42:5');
      expect(result.errorSummary).toContain('2 errors generated');
    });
  });

  describe('npm noise filtering', () => {
    it('should filter out npm script headers and noise', () => {
      const npmOutput = `
> myproject@1.0.0 test
> vitest run

Download complete
Resolving packages...
Already up-to-date

npm ERR! code ELIFECYCLE
npm ERR! errno 1
npm WARN deprecated package@1.0.0

Error: Test failed at line 42
FAILED tests/foo.test.ts
`;

      const result = extractGenericErrors(npmOutput);

      // Should include error lines
      expect(result.errorSummary).toContain('Error: Test failed');
      expect(result.errorSummary).toContain('FAILED tests/foo.test.ts');

      // Should NOT include npm noise
      expect(result.errorSummary).not.toContain('myproject@1.0.0 test');
      expect(result.errorSummary).not.toContain('npm ERR!');
      expect(result.errorSummary).not.toContain('npm WARN');
      expect(result.errorSummary).not.toContain('Download complete');
      expect(result.errorSummary).not.toContain('Resolving packages');
      expect(result.errorSummary).not.toContain('Already up-to-date');
    });
  });

  describe('fallback to basic cleaning', () => {
    it('should fall back to basic cleaning when no error keywords found', () => {
      const genericOutput = `
> myproject@1.0.0 build
> tsc

Build step 1 of 3
Build step 2 of 3
Build step 3 of 3
Some other line
Another line
Yet another line
`;

      const result = extractGenericErrors(genericOutput);

      // Should remove npm headers
      expect(result.errorSummary).not.toContain('myproject@1.0.0 build');

      // Should include remaining lines
      expect(result.errorSummary).toContain('Build step');
    });
  });

  describe('token efficiency', () => {
    it('should limit errorSummary to 20 lines max', () => {
      const manyErrors = Array.from({ length: 50 }, (_, i) =>
        `FAILED tests/test${i}.py::test_function - AssertionError`
      ).join('\n');

      const result = extractGenericErrors(manyErrors);

      const lineCount = result.errorSummary.split('\n').length;
      expect(lineCount).toBeLessThanOrEqual(20);
    });

    it('should extract only relevant lines for better token efficiency', () => {
      const mixedOutput = `
Line 1 - setup output
Line 2 - configuration loaded
Line 3 - starting tests
FAILED tests/test1.py
Line 5 - continuing
Line 6 - processing
FAILED tests/test2.py
Line 8 - more output
AssertionError at line 42
Line 10 - test complete
`;

      const result = extractGenericErrors(mixedOutput);

      // Should only extract error-related lines
      expect(result.errorSummary).toContain('FAILED tests/test1.py');
      expect(result.errorSummary).toContain('FAILED tests/test2.py');
      expect(result.errorSummary).toContain('AssertionError');

      // Should not include irrelevant lines
      expect(result.errorSummary).not.toContain('setup output');
      expect(result.errorSummary).not.toContain('configuration loaded');
    });
  });

  describe('language support', () => {
    it('should detect file extensions from various languages', () => {
      const multiLangOutput = `
Error in main.py:42
TypeError in app.js:15
panic in server.go:123
error in lib.rs:88
Exception in Main.java:99
SyntaxError in script.rb:33
`;

      const result = extractGenericErrors(multiLangOutput);

      expect(result.errorSummary).toContain('main.py:42');
      expect(result.errorSummary).toContain('app.js:15');
      expect(result.errorSummary).toContain('server.go:123');
      expect(result.errorSummary).toContain('lib.rs:88');
      expect(result.errorSummary).toContain('Main.java:99');
      expect(result.errorSummary).toContain('script.rb:33');
    });
  });

  describe('Success scenarios (no errors)', () => {
    it('should return totalCount 0 for clean output with no error keywords', () => {
      const cleanOutput = `
All tests passed!
✓ 100% coverage
Build successful
No issues found
`.trim();

      const result = extractGenericErrors(cleanOutput);

      expect(result.totalCount).toBe(0);
      expect(result.summary).toBe('No errors detected');
      expect(result.guidance).toBe('');
      expect(result.errors).toEqual([]);
      // errorSummary contains the fallback cleaned output (no error keywords found, so basic cleaning applied)
      expect(result.errorSummary).toContain('All tests passed');
    });

    it('should return totalCount 0 for empty output', () => {
      const result = extractGenericErrors('');

      expect(result.totalCount).toBe(0);
      expect(result.summary).toBe('No errors detected');
      expect(result.guidance).toBe('');
    });

    it('should return totalCount 0 for ESLint success output', () => {
      const eslintSuccess = `
> eslint --max-warnings=0 "packages/**/*.ts"

✨  Done in 2.5s
`.trim();

      const result = extractGenericErrors(eslintSuccess);

      expect(result.totalCount).toBe(0);
      expect(result.summary).toBe('No errors detected');
    });

    it('should return totalCount 1 when error keywords are present', () => {
      const outputWithErrors = `
FAILED tests/test_foo.py::test_division
AssertionError: Expected 1, got 0
`.trim();

      const result = extractGenericErrors(outputWithErrors);

      expect(result.totalCount).toBe(1);
      expect(result.summary).toBe('Command failed - see output');
      expect(result.guidance).toBe('Review the output above and fix the errors');
      expect(result.errorSummary).toContain('FAILED');
      expect(result.errorSummary).toContain('AssertionError');
    });
  });
});

/**
 * Pytest Error Extractor Plugin
 *
 * @package @vibe-validate/extractors
 */

import type {
  ExtractorPlugin,
  ErrorExtractorResult,
  DetectionResult,
  ExtractorSample,
} from '../../types.js';
import { extractErrorType } from '../../utils/parser-utils.js';
import { processTestFailures, type TestFailureInfo } from '../../utils/test-framework-utils.js';

const PLATFORM_RE = /platform\s+\S+\s+--\s+Python\s+[\d.]+,\s+pytest-[\d.]+/;
const PY_TEST_PATHS_RE = /(?:FAILED|ERROR)\s+\S+\.py/;
const SHORT_SUMMARY_KEYWORD = 'short test summary';
// eslint-disable-next-line sonarjs/slow-regex -- Safe: only parses pytest summary line (controlled output), not user input
const PASSED_RE = /\d+\s+passed/;
// eslint-disable-next-line sonarjs/slow-regex -- Safe: only parses pytest summary line (controlled output), not user input
const FAILED_SUMMARY_RE = /\d+\s+failed/;
// eslint-disable-next-line sonarjs/slow-regex -- Safe: only parses pytest summary line (controlled output), not user input
const ERROR_SUMMARY_RE = /\d+\s+error/;

function detect(output: string): DetectionResult {
  if (PLATFORM_RE.test(output)) {
    return {
      confidence: 95,
      patterns: ['pytest platform line'],
      reason: 'Python pytest output detected (platform line with pytest version)',
    };
  }

  const hasShortSummary = output.includes(SHORT_SUMMARY_KEYWORD);
  const hasPyTestPaths = PY_TEST_PATHS_RE.test(output);

  if (hasShortSummary && hasPyTestPaths) {
    return {
      confidence: 90,
      patterns: [SHORT_SUMMARY_KEYWORD, 'FAILED/ERROR .py paths'],
      reason: 'Python pytest output detected (short test summary with .py paths)',
    };
  }

  // Weaker signal: pytest-style summary line with .py paths
  const hasPytestSummary = PASSED_RE.test(output) && (
    FAILED_SUMMARY_RE.test(output) ||
    ERROR_SUMMARY_RE.test(output) ||
    output.includes('= FAILURES =') ||
    output.includes('= ERRORS =')
  );

  if (hasPytestSummary && hasPyTestPaths) {
    return {
      confidence: 85,
      patterns: ['pytest summary format', 'FAILED/ERROR .py paths'],
      reason: 'Possible pytest output (summary format with .py paths)',
    };
  }

  return { confidence: 0, patterns: [], reason: '' };
}

/** Parse E-prefixed error lines: "E   message" */
const E_LINE_RE = /^E\s{3}(.+)$/;

/** Parse file:line:ErrorType from FAILURES block location line */
const LOCATION_RE = /^(\S[^:]*\.py):(\d+):\s*(\w+(?:Error|Exception|Warning)?)/;

/** Parse file:line from traceback "in <module>" lines */
const TRACE_RE = /^(\S[^:]*\.py):(\d+):\s*in\s+/;

/** Check if a line is a pytest section header (=== ... ===) */
function isSectionHeader(line: string, excludeSection: string): boolean {
  return /^={3,}\s/.test(line) && !line.includes(excludeSection);
}

/** Check if a line is a pytest block header (___ ... ___) */
// eslint-disable-next-line sonarjs/slow-regex -- Safe: only parses pytest output (controlled output), not user input
const BLOCK_HEADER_RE = /^_{3,}\s+(.+?)\s+_{3,}$/;

/** Check if a line starts a new block or section */
function isBlockOrSectionBoundary(line: string, excludeSection: string): boolean {
  return BLOCK_HEADER_RE.test(line) || isSectionHeader(line, excludeSection);
}

/**
 * Scan a FAILURES block for E-prefixed errors and file:line location.
 */
function scanBlockForErrors(
  lines: string[],
  startIndex: number,
  excludeSection: string,
): { eLines: string[]; file?: string; lineNumber?: number; errorType?: string; nextIndex: number } {
  const eLines: string[] = [];
  let file: string | undefined;
  let lineNumber: number | undefined;
  let errorType: string | undefined;

  let j = startIndex;
  while (j < lines.length) {
    const blockLine = lines[j];

    if (isBlockOrSectionBoundary(blockLine, excludeSection)) {
      break;
    }

    const eMatch = E_LINE_RE.exec(blockLine);
    if (eMatch) {
      eLines.push(eMatch[1]);
    }

    const locationMatch = LOCATION_RE.exec(blockLine);
    if (locationMatch) {
      file = locationMatch[1];
      lineNumber = Number.parseInt(locationMatch[2], 10);
      errorType ??= locationMatch[3] || undefined;
    }

    j++;
  }

  return { eLines, file, lineNumber, errorType, nextIndex: j };
}

/**
 * Parse failures from the FAILURES section
 */
function parseFailuresSection(output: string): TestFailureInfo[] {
  const failures: TestFailureInfo[] = [];
  const failuresStart = output.indexOf('= FAILURES =');
  if (failuresStart === -1) return failures;

  const lines = output.slice(failuresStart).split('\n');

  let i = 1;
  while (i < lines.length) {
    const line = lines[i];

    if (i > 1 && isSectionHeader(line, 'FAILURES')) {
      break;
    }

    const blockMatch = BLOCK_HEADER_RE.exec(line);
    if (blockMatch) {
      const testName = blockMatch[1];
      const scan = scanBlockForErrors(lines, i + 1, 'FAILURES');

      let errorMessage: string | undefined;
      let { errorType } = scan;
      if (scan.eLines.length > 0) {
        errorMessage = scan.eLines.join(' ').trim();
        errorType ??= extractErrorType(errorMessage);
      }

      failures.push({
        testName,
        message: errorMessage ?? 'Test failed',
        errorType,
        file: scan.file,
        line: scan.lineNumber,
      });

      i = scan.nextIndex;
    } else {
      i++;
    }
  }

  return failures;
}

/**
 * Scan an ERRORS block for traceback file:line and E-prefixed errors.
 * Keeps last traceback location (closest to error source).
 */
function scanErrorBlockForErrors(
  lines: string[],
  startIndex: number,
  excludeSection: string,
): { errorMessage?: string; errorType?: string; file?: string; lineNumber?: number; nextIndex: number } {
  let errorMessage: string | undefined;
  let errorType: string | undefined;
  let file: string | undefined;
  let lineNumber: number | undefined;

  let j = startIndex;
  while (j < lines.length) {
    const blockLine = lines[j];

    if (isBlockOrSectionBoundary(blockLine, excludeSection)) {
      break;
    }

    const traceMatch = TRACE_RE.exec(blockLine);
    if (traceMatch) {
      file = traceMatch[1];
      lineNumber = Number.parseInt(traceMatch[2], 10);
    }

    const eMatch = E_LINE_RE.exec(blockLine);
    if (eMatch) {
      errorMessage = eMatch[1].trim();
      errorType = extractErrorType(errorMessage);
    }

    j++;
  }

  return { errorMessage, errorType, file, lineNumber, nextIndex: j };
}

/**
 * Parse errors from the ERRORS section (collection/import errors)
 */
function parseErrorsSection(output: string): TestFailureInfo[] {
  const errors: TestFailureInfo[] = [];
  const errorsStart = output.indexOf('= ERRORS =');
  if (errorsStart === -1) return errors;

  const lines = output.slice(errorsStart).split('\n');
  // eslint-disable-next-line sonarjs/slow-regex -- Safe: only parses pytest section headers (controlled output), not user input
  const errorCollectingRe = /^_{3,}\s+ERROR\s+collecting\s+(.+?)\s+_{3,}$/;

  let i = 1;
  while (i < lines.length) {
    const line = lines[i];

    if (i > 1 && isSectionHeader(line, 'ERRORS')) {
      break;
    }

    const blockMatch = errorCollectingRe.exec(line);
    if (blockMatch) {
      const testFile = blockMatch[1];
      const scan = scanErrorBlockForErrors(lines, i + 1, 'ERRORS');

      errors.push({
        testName: `ERROR collecting ${testFile}`,
        message: scan.errorMessage ?? 'Collection error',
        errorType: scan.errorType,
        file: scan.file ?? testFile,
        line: scan.lineNumber,
      });

      i = scan.nextIndex;
    } else {
      i++;
    }
  }

  return errors;
}

/** Parse FAILED line from short test summary */
// eslint-disable-next-line sonarjs/slow-regex, security/detect-unsafe-regex -- Safe: only parses pytest summary lines (controlled output), not user input
const FAILED_RE = /^FAILED\s+(\S+\.py)(?:::(\S+))?\s+-\s+(.+)$/;

/** Parse ERROR line from short test summary */
// eslint-disable-next-line sonarjs/slow-regex -- Safe: only parses pytest summary lines (controlled output), not user input
const ERROR_RE = /^ERROR\s+(\S+\.py)\s+-\s+(.+)$/;

/**
 * Parse the short test summary info section (fallback)
 */
function parseShortSummary(output: string): TestFailureInfo[] {
  const failures: TestFailureInfo[] = [];

  for (const line of output.split('\n')) {
    const failedMatch = FAILED_RE.exec(line);
    if (failedMatch) {
      const errorType = extractErrorType(failedMatch[3]);
      failures.push({
        testName: failedMatch[2] ?? failedMatch[1],
        message: failedMatch[3].trim(),
        errorType,
        file: failedMatch[1],
      });
      continue;
    }

    const errorMatch = ERROR_RE.exec(line);
    if (errorMatch) {
      const errorType = extractErrorType(errorMatch[2]);
      failures.push({
        testName: `ERROR collecting ${errorMatch[1]}`,
        message: errorMatch[2].trim(),
        errorType,
        file: errorMatch[1],
      });
    }
  }

  return failures;
}

function extract(output: string): ErrorExtractorResult {
  const failuresFromSection = parseFailuresSection(output);
  const errorsFromSection = parseErrorsSection(output);
  const allFromSections = [...failuresFromSection, ...errorsFromSection];

  if (allFromSections.length > 0) {
    return processTestFailures(allFromSections, 95);
  }

  const summaryFailures = parseShortSummary(output);
  if (summaryFailures.length > 0) {
    return processTestFailures(summaryFailures, 90);
  }

  return processTestFailures([], 95);
}

const samples: ExtractorSample[] = [
  {
    name: 'collection-errors',
    description: 'Pytest collection errors (import failures)',
    input: `============================= test session starts ==============================
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
========================= 2 errors in 0.50s =========================`,
    expectedErrors: 2,
    expectedPatterns: ['TypeError', 'ModuleNotFoundError'],
  },
  {
    name: 'assertion-failures',
    description: 'Pytest assertion failures in test functions',
    input: `============================= test session starts ==============================
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
========================= 2 failed, 3 passed in 0.45s =========================`,
    expectedErrors: 2,
    expectedPatterns: ['ZeroDivisionError', 'AssertionError'],
  },
];

const pytestPlugin: ExtractorPlugin = {
  metadata: {
    name: 'pytest',
    version: '1.0.0',
    author: 'vibe-validate',
    description: 'Extracts Python pytest test framework errors',
    repository: 'https://github.com/jdutton/vibe-validate',
    tags: ['pytest', 'testing', 'python'],
  },
  hints: {
    anyOf: ['pytest', '.py::'],
    forbidden: ['at <Jasmine>', 'at Context.<anonymous>'],
  },
  priority: 92,
  detect,
  extract,
  samples,
};

export default pytestPlugin;

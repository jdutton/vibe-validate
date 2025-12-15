/**
 * Maven Surefire/Failsafe Test Extractor Plugin
 *
 * Extracts test failures from Maven Surefire and Failsafe plugin output.
 * Supports JUnit 4, JUnit 5, and AssertJ assertion failures.
 *
 * @package @vibe-validate/extractors
 */

import { MAX_ERRORS_IN_ARRAY } from '../../result-schema.js';
import type {
  ExtractorPlugin,
  DetectionResult,
  ErrorExtractorResult,
  FormattedError,
} from '../../types.js';

/**
 * Maven Surefire/Failsafe output format:
 *
 * [ERROR] Tests run: 12, Failures: 8, Errors: 3, Skipped: 1
 * [ERROR] com.example.FooTest.testBar -- Time elapsed: 0.123 s <<< FAILURE!
 * java.lang.AssertionError: Expected 5 but was 3
 *   at com.example.FooTest.testBar(FooTest.java:42)
 *   at java.base/java.lang.reflect.Method.invoke(Method.java:565)
 */

interface TestFailure {
  testClass: string;
  testMethod: string;
  file?: string;
  line?: number;
  errorType: 'FAILURE' | 'ERROR';
  exceptionType?: string;
  message: string;
  stackTrace?: string[];
}

/* eslint-disable sonarjs/slow-regex -- All regexes safe: Maven Surefire output is structured with limited line length */
const SUREFIRE_PATTERNS = {
  // [ERROR] Tests run: 12, Failures: 8, Errors: 3, Skipped: 1
  testSummary: /^\[ERROR\]\s+Tests run:\s+(\d+),\s+Failures:\s+(\d+),\s+Errors:\s+(\d+)/,

  // [ERROR] com.example.FooTest.testBar:42 Expected 5 but was 3
  errorShort:
    /^\[ERROR\]\s+([^:]+)\.([^:]+):(\d+)\s+(\w+(?:Error|Exception|Failure))?\s*(.+)$/,

  // [ERROR] com.example.FooTest.testBar -- Time elapsed: 0.123 s <<< FAILURE!
  errorHeader: /^\[ERROR\]\s+([^.]+)\.([^\s]+)\s+.*<<<\s+(FAILURE|ERROR)!/,

  // Exception type line
  exceptionType: /^([\w.]+(?:Error|Exception|AssertionError|AssertionFailedError)):\s*(.*)$/,

  // "at package.Class.method(File.java:123)"
  stackTraceLine: /^\s+at\s+([^(]+)\(([^:]+):(\d+)\)/,
};
/* eslint-enable sonarjs/slow-regex */

/**
 * Detects if output is from Maven Surefire/Failsafe
 */
export function detectMavenSurefire(output: string): DetectionResult {
  const lines = output.split('\n');
  let score = 0;
  const foundPatterns: string[] = [];

  for (const line of lines) {
    if (line.includes('maven-surefire-plugin') || line.includes('maven-failsafe-plugin')) {
      score += 40;
      foundPatterns.push('Maven test plugin reference');
    }
    if (SUREFIRE_PATTERNS.testSummary.exec(line)) {
      score += 40;
      foundPatterns.push('Test summary (Tests run, Failures, Errors)');
    }
    if (line.includes('<<< FAILURE!') || line.includes('<<< ERROR!')) {
      score += 20;
      foundPatterns.push('Test failure markers');
    }
    if (line.includes('[ERROR] Failures:') || line.includes('[ERROR] Errors:')) {
      score += 15;
      foundPatterns.push('Test failure section headers');
    }
    if (/AssertionError|AssertionFailedError/.exec(line)) {
      score += 10;
      foundPatterns.push('JUnit assertion errors');
    }
  }

  // Determine reason based on score
  let reason: string;
  if (score >= 70) {
    reason = 'Maven Surefire/Failsafe test output detected';
  } else if (score >= 40) {
    reason = 'Possible Maven test output';
  } else {
    reason = 'Not Maven test output';
  }

  return {
    confidence: Math.min(score, 100),
    patterns: foundPatterns,
    reason,
  };
}

/**
 * Extracts test failures from Maven Surefire/Failsafe output
 */
// eslint-disable-next-line sonarjs/cognitive-complexity -- Complexity 43 acceptable for Maven Surefire parser (handles multiple test output formats with state machine)
export function extractMavenSurefire(
  output: string,
  command?: string,
): ErrorExtractorResult {
  const detection = detectMavenSurefire(output);

  if (detection.confidence < 40) {
    return {
      summary: 'Not Maven test output',
      totalErrors: 0,
      errors: [],
      metadata: {
        detection: {
          extractor: 'maven-surefire',
          confidence: detection.confidence,
          patterns: detection.patterns,
          reason: detection.reason,
        },
        confidence: detection.confidence,
        completeness: 100,
        issues: [],
      },
    };
  }

  const failures: TestFailure[] = [];
  const lines = output.split('\n');

  // Extract test summary for metadata
  let totalFailures = 0;
  let totalErrors = 0;

  for (const line of lines) {
    const summaryMatch = SUREFIRE_PATTERNS.testSummary.exec(line);
    if (summaryMatch) {
      // totalTests would be summaryMatch[1] if needed
      totalFailures = Number.parseInt(summaryMatch[2], 10);
      totalErrors = Number.parseInt(summaryMatch[3], 10);
    }
  }

  // Parse failure details
  let currentFailure: Partial<TestFailure> | null = null;
  let inStackTrace = false;

  for (const line of lines) {

    // Check for error header: [ERROR] Class.method -- Time elapsed: ... <<< FAILURE!
    const headerMatch = SUREFIRE_PATTERNS.errorHeader.exec(line);
    if (headerMatch) {
      // Save previous failure if exists
      if (currentFailure?.testClass && currentFailure?.testMethod) {
        failures.push(currentFailure as TestFailure);
      }

      const [, testClass, testMethod, errorType] = headerMatch;
      currentFailure = {
        testClass: testClass.trim(),
        testMethod: testMethod.trim(),
        errorType: errorType as 'FAILURE' | 'ERROR',
        message: '',
        stackTrace: [],
      };
      inStackTrace = false;
      continue;
    }

    // Check for short error format: [ERROR] Class.method:line Message
    const shortMatch = SUREFIRE_PATTERNS.errorShort.exec(line);
    if (shortMatch && !currentFailure) {
      const [, fullMethod, testMethod, lineStr, exceptionType, message] = shortMatch;
      const testClass = fullMethod.substring(0, fullMethod.lastIndexOf('.'));

      failures.push({
        testClass,
        testMethod,
        line: Number.parseInt(lineStr, 10),
        errorType: 'FAILURE',
        exceptionType: exceptionType ?? undefined,
        message: message.trim(),
      });
      continue;
    }

    // Parse exception type and message
    if (currentFailure && !currentFailure.message) {
      const exceptionMatch = SUREFIRE_PATTERNS.exceptionType.exec(line);
      if (exceptionMatch) {
        const [, exceptionType, message] = exceptionMatch;
        currentFailure.exceptionType = exceptionType;
        currentFailure.message = message.trim();
        inStackTrace = true;
        continue;
      }
    }

    // Parse stack trace
    if (currentFailure && inStackTrace) {
      const stackMatch = SUREFIRE_PATTERNS.stackTraceLine.exec(line);
      if (stackMatch) {
        const [, method, file, lineStr] = stackMatch;

        // Extract file and line from first stack frame
        if (!currentFailure.file && file.endsWith('.java')) {
          currentFailure.file = file;
          currentFailure.line = Number.parseInt(lineStr, 10);
        }

        currentFailure.stackTrace = currentFailure.stackTrace ?? [];
        currentFailure.stackTrace.push(`  at ${method}(${file}:${lineStr})`);

        // Limit stack trace depth
        if (currentFailure.stackTrace.length >= 3) {
          inStackTrace = false;
        }
      }
    }

    // End of error block
    if (line.trim() === '' && currentFailure) {
      inStackTrace = false;
    }
  }

  // Save last failure
  if (currentFailure?.testClass && currentFailure?.testMethod) {
    failures.push(currentFailure as TestFailure);
  }

  // Convert to FormattedError format
  const errors: FormattedError[] = failures.slice(0, MAX_ERRORS_IN_ARRAY).map((f) => {
    const testId = `${f.testClass}.${f.testMethod}`;
    let message = f.message ?? 'Test failed';

    // Include exception type if available
    if (f.exceptionType && !message.includes(f.exceptionType)) {
      message = `${f.exceptionType}: ${message}`;
    }

    // Add stack trace preview (first line only)
    if (f.stackTrace && f.stackTrace.length > 0) {
      message += `\n${f.stackTrace[0]}`;
    }

    return {
      file: f.file ?? `${f.testClass.replaceAll('.', '/')}.java`,
      line: f.line,
      message: `Test: ${testId}\n${message}`,
    };
  });

  const failureCount = totalFailures ?? failures.filter((f) => f.errorType === 'FAILURE').length;
  const errorCount = totalErrors ?? failures.filter((f) => f.errorType === 'ERROR').length;

  const summary = `${failureCount + errorCount} test failure(s): ${failureCount} failures, ${errorCount} errors`;

  // Generate guidance
  const guidance =
    failures.length > 0
      ? `Fix test failures. Run ${command ?? 'mvn test'} to see full details.`
      : undefined;

  // Create error summary
  const errorSummary = errors.length > 0
    ? errors.map((e, i) => `[Test ${i + 1}/${errors.length}] ${e.file}:${e.line ?? '?'}\n${e.message}`).join('\n\n')
    : undefined;

  return {
    summary,
    totalErrors: failures.length,
    errors,
    guidance,
    errorSummary,
    metadata: {
      detection: {
        extractor: 'maven-surefire',
        confidence: detection.confidence,
        patterns: detection.patterns,
        reason: detection.reason,
      },
      confidence: 95,
      completeness: 90,
      issues: failures.length > 20 ? ['Many test failures - output may be truncated'] : [],
    },
  };
}

/**
 * Maven Surefire/Failsafe Extractor Plugin
 */
const mavenSurefireExtractor: ExtractorPlugin = {
  metadata: {
    name: 'maven-surefire',
    version: '1.0.0',
    author: 'Jeff Dutton <jeff@duckcreek.com>',
    description: 'Extracts test failures from Maven Surefire and Failsafe plugin output',
    repository: 'https://github.com/jdutton/vibe-validate',
    tags: ['maven', 'java', 'junit', 'testing', 'surefire', 'failsafe'],
  },

  hints: {
    required: ['[ERROR]', 'Tests run:'],
    anyOf: ['FAILURE!', 'ERROR!', 'maven-surefire-plugin', 'maven-failsafe-plugin'],
  },

  priority: 95, // Higher than Jasmine (90) to avoid false matches

  detect: detectMavenSurefire,
  extract: extractMavenSurefire,

  samples: [
    {
      name: 'basic-assertion-failure',
      description: 'Simple JUnit assertion failure',
      input: `[ERROR] Tests run: 1, Failures: 1, Errors: 0
[ERROR] com.example.FooTest.testBar -- Time elapsed: 0.123 s <<< FAILURE!
java.lang.AssertionError: Expected 5 but was 3
\tat com.example.FooTest.testBar(FooTest.java:42)
\tat java.base/java.lang.reflect.Method.invoke(Method.java:565)`,
      expected: {
        totalErrors: 1,
      },
    },
    {
      name: 'null-pointer-exception',
      description: 'NullPointerException during test',
      input: `[ERROR] Tests run: 1, Failures: 0, Errors: 1
[ERROR] com.example.FooTest.testNull -- Time elapsed: 0.01 s <<< ERROR!
java.lang.NullPointerException: Cannot invoke "String.length()" because "value" is null
\tat com.example.FooTest.testNull(FooTest.java:77)`,
      expected: {
        totalErrors: 1,
      },
    },
    {
      name: 'assertj-failure',
      description: 'AssertJ assertion with multi-line message',
      input: `[ERROR] Tests run: 1, Failures: 1, Errors: 0
[ERROR] com.example.Test.testAssertJ -- <<< FAILURE!
java.lang.AssertionError:

Expecting actual:
  "Hello World"
to contain:
  "Goodbye"
\tat com.example.Test.testAssertJ(Test.java:25)`,
      expected: {
        totalErrors: 1,
      },
    },
  ],
};

export default mavenSurefireExtractor;

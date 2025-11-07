/**
 * Smart Error Extractor
 *
 * Auto-detects validation step type and applies appropriate extractor.
 *
 * @package @vibe-validate/extractors
 */

import type { ErrorExtractorResult, ExtractorInput } from './types.js';
import { extractTypeScriptErrors } from './typescript-extractor.js';
import { extractESLintErrors } from './eslint-extractor.js';
import { extractVitestErrors } from './vitest-extractor.js';
import { extractJestErrors } from './jest-extractor.js';
import { extractJUnitErrors } from './junit-extractor.js';
import { extractMochaErrors } from './mocha-extractor.js';
import { extractJasmineErrors } from './jasmine-extractor.js';
import { extractPlaywrightErrors } from './playwright-extractor.js';
import { extractGenericErrors } from './generic-extractor.js';
import { stripAnsiCodes } from './utils.js';

/**
 * Auto-detect tool type from output patterns and extract errors
 *
 * Detection is 100% pattern-based from output analysis only.
 * This ensures robust detection regardless of how users name their validation steps.
 *
 * Auto-detection rules (checked in order):
 * 1. **TypeScript**: `error TS####:` pattern (e.g., `error TS2322:`)
 * 2. **ESLint**: `✖ X problems` summary or `line:col error/warning` format
 * 3. **JUnit XML**: `<?xml` + `<testsuite>` tags
 * 4. **Jasmine**: `Failures:` header + numbered list (`1) test name`)
 * 5. **Jest**: `●` bullets or `Test Suites:` summary (checked before Mocha)
 * 6. **Mocha**: `X passing`/`X failing` summary + numbered list
 * 7. **Playwright**: `.spec.ts` files + numbered failures with `›` separator
 * 8. **Vitest**: `×`/`❯`/`❌` symbols + `Test Files` summary
 * 9. **Generic**: Fallback for all other formats
 *
 * @param input - Raw command output (string) or separated streams (ExtractorInput)
 * @returns Structured error information from appropriate extractor
 *
 * @example
 * ```typescript
 * // Legacy usage (string)
 * const result1 = autoDetectAndExtract(tscOutput);
 *
 * // New usage (separated streams)
 * const result2 = autoDetectAndExtract({
 *   stdout: stdoutString,
 *   stderr: stderrString,
 *   combined: combinedString
 * });
 * ```
 */
// eslint-disable-next-line sonarjs/cognitive-complexity -- Complexity 26 acceptable for smart extractor (sequentially detects 9 different test framework output formats with pattern matching)
export function autoDetectAndExtract(input: string | ExtractorInput): ErrorExtractorResult {
  // Normalize input to string for backwards compatibility
  // Most extractors currently use combined output, but this structure
  // allows future extractors to be stream-specific
  const output = typeof input === 'string' ? input : input.combined;

  // CRITICAL: Strip ANSI codes centrally before routing to extractors
  //
  // Design Decision: Central stripping (DRY & fail-safe)
  // - All extractors receive clean, parseable text
  // - Prevents bugs from forgetting to strip in individual extractors
  // - Single point of control for preprocessing
  // - If future extractors need raw ANSI for detection, this is the right
  //   place to add conditional logic (e.g., detect first, then strip)
  //
  // Benefits:
  // - Impossible to forget (enforced for all extractors)
  // - Consistent behavior across all extraction paths
  // - Easier to maintain and test
  const errorSummary = stripAnsiCodes(output);

  // TypeScript detection: Check for TypeScript compiler error patterns
  // - "error TS####:" (error code like TS2322, TS2345)
  // - Format: file.ts(line,col): error TS####:
  const hasTypeScriptMarkers = /error TS\d+:/.exec(errorSummary);

  if (hasTypeScriptMarkers) {
    const result = extractTypeScriptErrors(errorSummary);
    return addDetectionMetadata(result, 'typescript', 95, ['error TS#### pattern'], 'TypeScript compiler error format detected');
  }

  // ESLint detection: Check for ESLint-specific patterns
  // - "✖ X problem(s)" summary line
  // - File paths with line:col followed by error/warning (with optional colon)
  const hasESLintMarkers =
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- Boolean OR for pattern matching, not nullish check
    /✖ \d+ problems?/.exec(errorSummary) ||
    // eslint-disable-next-line sonarjs/slow-regex -- Safe: only detects ESLint output format (controlled linter output), limited input size
    /\d+:\d+:?\s+(error|warning)\s+/.exec(errorSummary);

  if (hasESLintMarkers) {
    const result = extractESLintErrors(errorSummary);
    const patterns = [];
    if (/✖ \d+ problems?/.exec(errorSummary)) patterns.push('✖ X problems summary');
    // eslint-disable-next-line sonarjs/slow-regex -- Safe: only detects ESLint output format (controlled linter output), limited input size
    if (/\d+:\d+:?\s+(error|warning)\s+/.exec(errorSummary)) patterns.push('line:col error/warning format');
    return addDetectionMetadata(result, 'eslint', 90, patterns, 'ESLint error format detected');
  }

  // Vitest priority detection: Check for "RUN  v" pattern (100% unique to vitest)
  // CRITICAL: Must check BEFORE Jest to prevent false positives
  // Jest's loose ● detection can match test names that mention Jest patterns
  // (e.g., "should detect Jest from ● bullet marker")
  // The "RUN  v" pattern at the start of vitest output is unmistakable
  // Note: Allow optional leading whitespace (ANSI stripping can leave spaces)
  // eslint-disable-next-line sonarjs/slow-regex -- False positive: regex is anchored and has limited repetition
  if (/^\s*RUN\s+v\d+\.\d+\.\d+/m.test(errorSummary)) {
    const result = extractVitestErrors(errorSummary);
    const patterns = ['RUN v#### version header'];
    if (errorSummary.includes('×')) patterns.push('× symbol (U+00D7)');
    if (errorSummary.includes('❌')) patterns.push('❌ cross mark');
    if (errorSummary.includes(' ❯ ')) patterns.push('❯ arrow marker');
    if (errorSummary.includes('Test Files')) patterns.push('Test Files summary');
    if (errorSummary.includes('.test.ts')) patterns.push('.test.ts files');
    if (/FAIL\s+\d+\s+test\s+(file|case)/i.exec(errorSummary)) patterns.push('FAIL N test files/cases pattern');
    return addDetectionMetadata(result, 'vitest', 100, patterns, 'Vitest test output format detected (RUN v#### header)');
  }

  // Auto-detect JUnit XML format
  // Must have both <?xml at start of line AND <testsuite tag (not just mentioned in text)
  if (/^<\?xml\s+/m.exec(errorSummary) && errorSummary.includes('<testsuite')) {
    const result = extractJUnitErrors(errorSummary);
    return addDetectionMetadata(result, 'junit', 100, ['<?xml header', '<testsuite> tag'], 'JUnit XML format detected');
  }

  // Auto-detect Jasmine format (distinctive "Failures:" header)
  if (errorSummary.includes('Failures:') && /^\d+\)\s+/m.exec(errorSummary)) {
    const result = extractJasmineErrors(errorSummary);
    return addDetectionMetadata(result, 'jasmine', 85, ['Failures: header', 'numbered test list'], 'Jasmine test output format detected');
  }

  // Jest detection: Check output for Jest-specific patterns
  // CRITICAL: Must check BEFORE Mocha to avoid false positives
  // - "●" bullet marker for detailed errors (Jest-specific, Vitest uses ×)
  // - "Test Suites:" summary line (Jest-specific, Vitest uses "Test Files")
  // Jest patterns are highly distinctive (confidence 90) vs Mocha's generic patterns (confidence 80)
  // Mocha's "passing"/"failing" patterns can appear in Jest test names, causing misdetection
  const hasJestMarkers = errorSummary.includes('●') ||
                        errorSummary.includes('Test Suites:');

  if (hasJestMarkers) {
    const result = extractJestErrors(errorSummary);
    const patterns = [];
    if (errorSummary.includes('●')) patterns.push('● bullet marker');
    if (errorSummary.includes('Test Suites:')) patterns.push('Test Suites: summary');
    // eslint-disable-next-line sonarjs/slow-regex -- Safe: only detects Jest test framework output format (controlled test framework output), not user input
    if (/^\s*FAIL\s+/m.exec(errorSummary)) patterns.push('FAIL marker');
    // eslint-disable-next-line sonarjs/slow-regex -- Safe: only detects Jest test framework output format (controlled test framework output), not user input
    if (/^\s*PASS\s+/m.exec(errorSummary)) patterns.push('PASS marker');
    return addDetectionMetadata(result, 'jest', 90, patterns, 'Jest test output format detected');
  }

  // Auto-detect Mocha format (distinctive "X passing"/"X failing" pattern)
  // NOTE: Checked AFTER Jest because "passing"/"failing" can appear in Jest test names
  if ((errorSummary.includes(' passing') || errorSummary.includes(' failing')) &&
      // eslint-disable-next-line sonarjs/slow-regex -- Safe: only detects Mocha test framework output format (controlled test framework output), not user input
      /\s+\d+\)\s+/.exec(errorSummary)) {
    const result = extractMochaErrors(errorSummary);
    return addDetectionMetadata(result, 'mocha', 80, ['passing/failing summary', 'numbered failures'], 'Mocha test output format detected');
  }

  // Playwright detection: Check for Playwright-specific patterns
  // - .spec.ts files (Playwright convention, Jest/Vitest use .test.ts)
  // - Numbered failures with › separator: "1) file.spec.ts:26:5 › test name"
  // - ✘ symbol followed by .spec.ts file path
  // IMPORTANT: Require .spec.ts with › separator OR ✘ + .spec.ts (not just mentioned in text)
  // Must check BEFORE Vitest to avoid misdetection (.spec.ts vs .test.ts)
  const hasPlaywrightMarkers = (errorSummary.includes('.spec.ts') &&
                                 // eslint-disable-next-line sonarjs/slow-regex, @typescript-eslint/prefer-nullish-coalescing -- Safe: only detects Playwright test framework output format (controlled test framework output), not user input. Boolean OR for pattern matching.
                                 (/\d+\)\s+.*\.spec\.ts:\d+:\d+\s+›/.exec(errorSummary) ||
                                  // eslint-disable-next-line sonarjs/slow-regex -- Safe: only detects Playwright test framework output format (controlled test framework output), not user input
                                  /✘.*\.spec\.ts/.exec(errorSummary)));

  if (hasPlaywrightMarkers) {
    const result = extractPlaywrightErrors(errorSummary);
    const patterns = [];
    if (errorSummary.includes('.spec.ts')) patterns.push('.spec.ts files');
    // eslint-disable-next-line sonarjs/slow-regex -- Safe: only detects Playwright test framework output format (controlled test framework output), not user input
    if (/\d+\)\s+.*\.spec\.ts:\d+:\d+\s+›/.exec(errorSummary)) patterns.push('numbered failures with › separator');
    // eslint-disable-next-line sonarjs/slow-regex -- Safe: only detects Playwright test framework output format (controlled test framework output), not user input
    if (/✘.*\.spec\.ts/.exec(errorSummary)) patterns.push('✘ failure with .spec.ts file');
    return addDetectionMetadata(result, 'playwright', 95, patterns, 'Playwright test output format detected');
  }

  // Vitest detection: Check output for Vitest-specific patterns
  // - "×" symbol (U+00D7 multiplication, Vitest-specific - Jest uses ✕ U+2715)
  // - "❌" cross mark symbol (Vitest failure marker in some formats)
  // - " ❯ " arrow symbol (Vitest-specific file marker)
  // - "Test Files" summary line (Vitest-specific, Jest uses "Test Suites:")
  // - "FAIL N test files" pattern (Vitest-specific)
  // - ".test.ts" file extension (Vitest convention, Playwright uses .spec.ts)
  // NOTE: Both Vitest and Jest use ✓ (check mark), so we don't check for it alone
  // IMPORTANT: Require MULTIPLE patterns together to avoid false positives
  // (e.g., ❯ can appear in Jest stack traces from source code comments)
  const hasVitestMarkers = (errorSummary.includes('×') || errorSummary.includes(' ❯ ') || errorSummary.includes('❌')) &&
                          // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- Boolean OR for pattern matching, not nullish check
                          (errorSummary.includes('Test Files') || /FAIL\s+\d+\s+test\s+(file|case)/i.exec(errorSummary) || errorSummary.includes('.test.ts'));

  if (hasVitestMarkers) {
    const result = extractVitestErrors(errorSummary);
    const patterns = [];
    if (errorSummary.includes('×')) patterns.push('× symbol (U+00D7)');
    if (errorSummary.includes('❌')) patterns.push('❌ cross mark');
    if (errorSummary.includes(' ❯ ')) patterns.push('❯ arrow marker');
    if (errorSummary.includes('Test Files')) patterns.push('Test Files summary');
    if (errorSummary.includes('.test.ts')) patterns.push('.test.ts files');
    if (/FAIL\s+\d+\s+test\s+(file|case)/i.exec(errorSummary)) patterns.push('FAIL N test files/cases pattern');
    return addDetectionMetadata(result, 'vitest', 90, patterns, 'Vitest test output format detected');
  }

  // No specific pattern detected - use generic extractor
  const result = extractGenericErrors(errorSummary);
  return addDetectionMetadata(result, 'generic', 50, ['no specific patterns'], 'No specific tool detected, using generic extractor');
}

/**
 * Add detection metadata to extraction result
 *
 * CONFIDENCE LEVEL GUIDELINES (hardcoded, subjective estimates):
 *
 * When adding a new extractor or updating detection logic, choose confidence based on
 * pattern uniqueness and likelihood of misdetection:
 *
 * - **100**: Absolutely unmistakable patterns (e.g., JUnit's <?xml + <testsuite>)
 * - **95**: Very distinctive, tool-specific patterns unlikely to be confused
 *   - TypeScript: `error TS####:` format (tsc-specific error codes)
 *   - Playwright: `.spec.ts` files + `›` separator (unique to Playwright)
 *
 * - **90**: Strong, reliable patterns with minimal overlap potential
 *   - ESLint: `✖ X problems` summary or `line:col error/warning` format
 *   - Jest: `FAIL`/`PASS` markers + `●` bullets + `Test Suites:` summary
 *   - Vitest: `✓`/`✕` symbols + `Test Files` summary
 *
 * - **85**: Good patterns but less unique (potential for overlap)
 *   - Jasmine: `Failures:` header + numbered list
 *
 * - **80**: Somewhat generic patterns (more likely to overlap)
 *   - Mocha: `passing/failing` wording (other tools could use similar text)
 *
 * - **50**: Fallback/generic (no confidence in specific format)
 *
 * IMPORTANT: Detection order matters! Check more specific patterns first.
 * Earlier checks = higher confidence (less chance of false positives).
 *
 * @param result - The extraction result from the specific extractor
 * @param extractor - Name of the extractor used (e.g., 'jest', 'playwright', 'typescript')
 * @param confidence - Detection confidence (0-100) based on pattern uniqueness (see guidelines above)
 * @param patterns - List of patterns that matched (for debugging/transparency)
 * @param reason - Human-readable explanation of why this extractor was chosen
 * @returns The result with detection metadata added
 */
function addDetectionMetadata(
  result: ErrorExtractorResult,
  extractor: string,
  confidence: number,
  patterns: string[],
  reason: string
): ErrorExtractorResult {
  // Only add detection metadata if it doesn't already exist
  // (individual extractors might have their own metadata)
  result.metadata ??= {
      confidence: 100,
      completeness: 100,
      issues: [],
    };

  result.metadata.detection = {
    extractor,
    confidence,
    patterns,
    reason,
  };

  return result;
}

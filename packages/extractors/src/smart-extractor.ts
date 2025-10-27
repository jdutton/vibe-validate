/**
 * Smart Error Extractor
 *
 * Auto-detects validation step type and applies appropriate extractor.
 *
 * @package @vibe-validate/extractors
 */

import type { ErrorExtractorResult } from './types.js';
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
 * Detection is 100% pattern-based - context parameter is NOT used for routing decisions.
 * This ensures robust detection regardless of how users name their validation steps.
 *
 * Auto-detection rules (checked in order):
 * 1. **TypeScript**: `error TS####:` pattern (e.g., `error TS2322:`)
 * 2. **ESLint**: `✖ X problems` summary or `line:col error/warning` format
 * 3. **JUnit XML**: `<?xml` + `<testsuite>` tags
 * 4. **Jasmine**: `Failures:` header + numbered list (`1) test name`)
 * 5. **Mocha**: `X passing`/`X failing` summary + numbered list
 * 6. **Playwright**: `.spec.ts` files + numbered failures with `›` separator
 * 7. **Jest**: `FAIL`/`PASS`/`●` markers or `Test Suites:` summary
 * 8. **Vitest**: `✓`/`✕` symbols or `Test Files` summary
 * 9. **Generic**: Fallback for all other formats
 *
 * @param context - Context string (e.g., step name) preserved for generic extractor error messages only
 * @param output - Raw command output (may contain ANSI color codes)
 * @returns Structured error information from appropriate extractor
 *
 * @example
 * ```typescript
 * // TypeScript detection (from "error TS2322:" pattern, not context)
 * const result1 = autoDetectAndExtract('Build', tscOutput);
 * // Uses extractTypeScriptErrors
 *
 * // Jest detection (from "FAIL" markers, not context)
 * const result2 = autoDetectAndExtract('Validation', jestOutput);
 * // Uses extractJestErrors
 *
 * // Vitest detection (from "✓" symbols, not context)
 * const result3 = autoDetectAndExtract('Check', vitestOutput);
 * // Uses extractVitestErrors
 * ```
 */
export function autoDetectAndExtract(context: string, output: string): ErrorExtractorResult {
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
  const cleanOutput = stripAnsiCodes(output);

  // TypeScript detection: Check for TypeScript compiler error patterns
  // - "error TS####:" (error code like TS2322, TS2345)
  // - Format: file.ts(line,col): error TS####:
  const hasTypeScriptMarkers = cleanOutput.match(/error TS\d+:/);

  if (hasTypeScriptMarkers) {
    const result = extractTypeScriptErrors(cleanOutput);
    return addDetectionMetadata(result, 'typescript', 95, ['error TS#### pattern'], 'TypeScript compiler error format detected');
  }

  // ESLint detection: Check for ESLint-specific patterns
  // - "✖ X problem(s)" summary line
  // - File paths with line:col followed by error/warning (with optional colon)
  const hasESLintMarkers = cleanOutput.match(/✖ \d+ problems?/) ||
                          cleanOutput.match(/\d+:\d+:?\s+(error|warning)\s+/);

  if (hasESLintMarkers) {
    const result = extractESLintErrors(cleanOutput);
    const patterns = [];
    if (cleanOutput.match(/✖ \d+ problems?/)) patterns.push('✖ X problems summary');
    if (cleanOutput.match(/\d+:\d+:?\s+(error|warning)\s+/)) patterns.push('line:col error/warning format');
    return addDetectionMetadata(result, 'eslint', 90, patterns, 'ESLint error format detected');
  }

  // Auto-detect JUnit XML format
  if (cleanOutput.includes('<?xml') && cleanOutput.includes('<testsuite')) {
    const result = extractJUnitErrors(cleanOutput);
    return addDetectionMetadata(result, 'junit', 100, ['<?xml header', '<testsuite> tag'], 'JUnit XML format detected');
  }

  // Auto-detect Jasmine format (distinctive "Failures:" header)
  if (cleanOutput.includes('Failures:') && cleanOutput.match(/^\d+\)\s+/m)) {
    const result = extractJasmineErrors(cleanOutput);
    return addDetectionMetadata(result, 'jasmine', 85, ['Failures: header', 'numbered test list'], 'Jasmine test output format detected');
  }

  // Auto-detect Mocha format (distinctive "X passing"/"X failing" pattern)
  if ((cleanOutput.includes(' passing') || cleanOutput.includes(' failing')) &&
      cleanOutput.match(/\s+\d+\)\s+/)) {
    const result = extractMochaErrors(cleanOutput);
    return addDetectionMetadata(result, 'mocha', 80, ['passing/failing summary', 'numbered failures'], 'Mocha test output format detected');
  }

  // Playwright detection: Check for Playwright-specific patterns
  // - .spec.ts files (Playwright convention, Jest/Vitest use .test.ts)
  // - Numbered failures with › separator: "1) file.spec.ts:26:5 › test name"
  // - ✘ symbol for failures
  // Must check BEFORE Jest/Vitest to avoid misdetection
  const hasPlaywrightMarkers = (cleanOutput.includes('.spec.ts') &&
                                 cleanOutput.match(/\d+\)\s+.*\.spec\.ts:\d+:\d+\s+›/)) ||
                                (cleanOutput.includes('✘') && cleanOutput.includes('.spec.ts'));

  if (hasPlaywrightMarkers) {
    const result = extractPlaywrightErrors(cleanOutput);
    const patterns = [];
    if (cleanOutput.includes('.spec.ts')) patterns.push('.spec.ts files');
    if (cleanOutput.match(/\d+\)\s+.*\.spec\.ts:\d+:\d+\s+›/)) patterns.push('numbered failures with › separator');
    if (cleanOutput.includes('✘')) patterns.push('✘ failure symbol');
    return addDetectionMetadata(result, 'playwright', 95, patterns, 'Playwright test output format detected');
  }

  // Jest detection: Check output for Jest-specific patterns FIRST (before Vitest)
  // Jest has very distinctive markers that should be checked first to avoid misdetection
  // - " ● " bullet marker for detailed errors (Jest-specific, Vitest uses ×)
  // - "Test Suites:" summary line (Jest-specific, Vitest uses "Test Files")
  // NOTE: We don't use "FAIL" alone because Vitest also uses it (e.g., "FAIL tests/...")
  // CRITICAL: Must check BEFORE Vitest because Jest stack traces can contain ❯ symbol
  // from source code (e.g., in comments), which would trigger Vitest detection
  const hasJestMarkers = cleanOutput.includes(' ● ') ||
                        cleanOutput.includes('Test Suites:');

  if (hasJestMarkers) {
    const result = extractJestErrors(cleanOutput);
    const patterns = [];
    if (cleanOutput.includes(' ● ')) patterns.push('● bullet marker');
    if (cleanOutput.includes('Test Suites:')) patterns.push('Test Suites: summary');
    if (cleanOutput.match(/^\s*FAIL\s+/m)) patterns.push('FAIL marker');
    if (cleanOutput.match(/^\s*PASS\s+/m)) patterns.push('PASS marker');
    return addDetectionMetadata(result, 'jest', 90, patterns, 'Jest test output format detected');
  }

  // Vitest detection: Check output for Vitest-specific patterns
  // - "×" symbol (U+00D7 multiplication, Vitest-specific - Jest uses ✕ U+2715)
  // - " ❯ " arrow symbol (Vitest-specific file marker)
  // - "Test Files" summary line (Vitest-specific, Jest uses "Test Suites:")
  // - "FAIL N test files" pattern (Vitest-specific)
  // NOTE: Both Vitest and Jest use ✓ (check mark), so we don't check for it alone
  // IMPORTANT: Require MULTIPLE patterns together to avoid false positives
  // (e.g., ❯ can appear in Jest stack traces from source code comments)
  const hasVitestMarkers = (cleanOutput.includes('×') || cleanOutput.includes(' ❯ ')) &&
                          (cleanOutput.includes('Test Files') || cleanOutput.match(/FAIL\s+\d+\s+test\s+(file|case)/i));

  if (hasVitestMarkers) {
    const result = extractVitestErrors(cleanOutput);
    const patterns = [];
    if (cleanOutput.includes('×')) patterns.push('× symbol (U+00D7)');
    if (cleanOutput.includes(' ❯ ')) patterns.push('❯ arrow marker');
    if (cleanOutput.includes('Test Files')) patterns.push('Test Files summary');
    if (cleanOutput.match(/FAIL\s+\d+\s+test\s+(file|case)/i)) patterns.push('FAIL N test files/cases pattern');
    return addDetectionMetadata(result, 'vitest', 90, patterns, 'Vitest test output format detected');
  }

  // No specific pattern detected - use generic extractor
  const result = extractGenericErrors(cleanOutput, context);
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
  if (!result.metadata) {
    result.metadata = {
      confidence: 100,
      completeness: 100,
      issues: [],
    };
  }

  result.metadata.detection = {
    extractor,
    confidence,
    patterns,
    reason,
  };

  return result;
}

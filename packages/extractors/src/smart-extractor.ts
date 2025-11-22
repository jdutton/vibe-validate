/**
 * Smart Error Extractor
 *
 * Auto-detects validation step type and applies appropriate extractor.
 *
 * @package @vibe-validate/extractors
 */

import type { ErrorExtractorResult, ExtractorInput } from './types.js';
import { EXTRACTOR_REGISTRY } from './extractor-registry.js';
import genericPlugin from './extractors/generic/index.js';
import { stripAnsiCodes } from './utils.js';

/**
 * Auto-detect tool type from output patterns and extract errors
 *
 * Detection is 100% pattern-based from output analysis only.
 * This ensures robust detection regardless of how users name their validation steps.
 *
 * **Multi-Extractor Fallback Strategy** (new in v0.17.0-rc4):
 * When exitCode != 0 but primary extractor finds 0 errors, tries other extractors
 * until one produces results. This prevents false positives (e.g., Checkstyle
 * detecting compiler errors with 70% confidence but extracting nothing).
 *
 * Auto-detection rules (checked in order):
 * 1. **TypeScript**: `error TS####:` pattern (e.g., `error TS2322:`)
 * 2. **ESLint**: `✖ X problems` summary or `line:col error/warning` format
 * 3. **Maven Checkstyle**: Checkstyle plugin markers
 * 4. **Maven Surefire**: Test plugin markers
 * 5. **Maven Compiler**: Compilation error markers
 * 6. **JUnit XML**: `<?xml` + `<testsuite>` tags
 * 7. **Jasmine**: `Failures:` header + numbered list (`1) test name`)
 * 8. **Jest**: `●` bullets or `Test Suites:` summary (checked before Mocha)
 * 9. **Mocha**: `X passing`/`X failing` summary + numbered list
 * 10. **Playwright**: `.spec.ts` files + numbered failures with `›` separator
 * 11. **Vitest**: `×`/`❯`/`❌` symbols + `Test Files` summary
 * 12. **Generic**: Fallback for all other formats
 *
 * @param input - Raw command output (string) or separated streams (ExtractorInput)
 * @param exitCode - Optional exit code from command (enables fallback logic)
 * @returns Structured error information from appropriate extractor
 *
 * @example
 * ```typescript
 * // Legacy usage (string)
 * const result1 = autoDetectAndExtract(tscOutput);
 *
 * // New usage with exit code (enables fallback)
 * const result2 = autoDetectAndExtract(output, 1);
 *
 * // New usage (separated streams)
 * const result3 = autoDetectAndExtract({
 *   stdout: stdoutString,
 *   stderr: stderrString,
 *   combined: combinedString
 * }, 0);
 * ```
 */
export function autoDetectAndExtract(input: string | ExtractorInput, exitCode?: number): ErrorExtractorResult {
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

  // NEW: Multi-extractor fallback when exitCode provided
  // This prevents false positives where detector matches but extractor finds nothing
  if (exitCode !== undefined) {
    return autoDetectWithFallback(errorSummary, exitCode);
  }

  // LEGACY: Sequential detection (for backward compatibility when exitCode not provided)
  return sequentialDetection(errorSummary);
}

/**
 * Sequential detection (legacy behavior)
 * Returns first extractor that matches with confidence >= 70
 */
function sequentialDetection(errorSummary: string): ErrorExtractorResult {
  // Try each extractor in the registry in order
  for (const descriptor of EXTRACTOR_REGISTRY) {
    const detection = descriptor.detect(errorSummary);

    // Return first match with confidence >= 70 (legacy threshold)
    if (detection.confidence >= 70) {
      const result = descriptor.extract(errorSummary);
      return addDetectionMetadata(
        result,
        descriptor.name,
        detection.confidence,
        detection.patterns,
        detection.reason
      );
    }
  }

  // No specific pattern detected - use generic extractor
  const result = genericPlugin.extract(errorSummary);
  return addDetectionMetadata(result, 'generic', 50, ['no specific patterns'], 'No specific tool detected, using generic extractor');
}

/**
 * Multi-extractor fallback strategy (new in v0.17.0-rc4)
 *
 * **RED FLAG HEURISTIC**: When exitCode != 0 but extractor finds 0 errors,
 * this is a strong signal of false positive detection. We try other extractors
 * until we find one that actually extracts errors, or fall back to generic.
 *
 * This solves real-world issues like:
 * - Checkstyle detector matches (70% confidence) on compiler output
 * - But extracts 0 errors (wrong format)
 * - User gets no actionable feedback despite command failure
 *
 * @param errorSummary - ANSI-stripped command output
 * @param exitCode - Command exit code (0 = success, non-zero = failure)
 * @returns Best extraction result based on confidence AND actual error count
 */
function autoDetectWithFallback(errorSummary: string, exitCode: number): ErrorExtractorResult {
  // Step 1: Try ALL extractors and collect results
  interface ExtractorCandidate {
    name: string;
    result: ErrorExtractorResult;
    confidence: number;
    errorCount: number;
  }

  const allCandidates: ExtractorCandidate[] = [];

  // Try each extractor in the registry
  // Track which extractors we've already tried (by name) to avoid duplicates
  const triedExtractors = new Set<string>();

  for (const descriptor of EXTRACTOR_REGISTRY) {
    // Skip if we've already tried this extractor name
    if (triedExtractors.has(descriptor.name)) {
      continue;
    }

    const detection = descriptor.detect(errorSummary);

    // Only consider extractors with confidence >= 40
    if (detection.confidence >= 40) {
      triedExtractors.add(descriptor.name);

      const result = descriptor.extract(errorSummary);
      const enrichedResult = addDetectionMetadata(
        result,
        descriptor.name,
        detection.confidence,
        detection.patterns,
        detection.reason
      );

      allCandidates.push({
        name: descriptor.name,
        result: enrichedResult,
        confidence: detection.confidence,
        errorCount: result.totalErrors,
      });
    }
  }

  // Step 2: Apply RED FLAG HEURISTIC for failed commands
  if (exitCode !== 0 && allCandidates.length > 0) {
    // Prefer extractors that actually found errors
    const withErrors = allCandidates.filter(c => c.errorCount > 0);

    if (withErrors.length > 0) {
      // Pick highest confidence among extractors that found errors
      withErrors.sort((a, b) => b.confidence - a.confidence);
      return withErrors[0].result;
    }

    // RED FLAG: Exit code != 0 but NO extractor found errors
    // Fall back to generic extractor (shows raw output context)
    const result = genericPlugin.extract(errorSummary);
    return addDetectionMetadata(
      result,
      'generic',
      50,
      ['exit code != 0 but no extractor found errors (fallback)'],
      `Command failed (exit code ${exitCode}) but no extractor found errors. Using generic extractor.`
    );
  }

  // Step 3: Command succeeded with candidates - use highest confidence
  if (exitCode === 0 && allCandidates.length > 0) {
    allCandidates.sort((a, b) => b.confidence - a.confidence);
    return allCandidates[0].result;
  }

  // Step 4: No extractors matched at all
  if (allCandidates.length === 0) {
    const result = genericPlugin.extract(errorSummary);
    if (exitCode !== 0) {
      // Command failed but no extractor could parse the output
      return addDetectionMetadata(
        result,
        'generic',
        50,
        ['exit code != 0 but no extractor matched output'],
        `Command failed (exit code ${exitCode}) but no extractor found errors. Using generic extractor.`
      );
    }
    // Command succeeded and no extractor needed
    return addDetectionMetadata(result, 'generic', 50, ['no specific patterns'], 'No specific tool detected, using generic extractor');
  }

  // Step 5: Have candidates but not handled above - use highest confidence
  allCandidates.sort((a, b) => b.confidence - a.confidence);
  return allCandidates[0].result;
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

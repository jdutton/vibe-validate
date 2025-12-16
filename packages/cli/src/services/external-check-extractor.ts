/**
 * ExternalCheckExtractor - Extract details from external checks (codecov, SonarCloud, etc.)
 *
 * Provides pluggable extractor registry for external status checks.
 * Extractors fetch and parse details from external providers.
 *
 * @packageDocumentation
 */

import type { ExternalCheck, ExternalCheckDetails } from '../schemas/watch-pr-result.schema.js';

/**
 * External check extractor interface
 */
export interface ExternalCheckExtractor {
  /** Extractor name */
  name: string;

  /** Check if this extractor can handle the given check */
  // eslint-disable-next-line no-unused-vars
  canHandle(check: ExternalCheck): boolean;

  /** Extract details from check */
  // eslint-disable-next-line no-unused-vars
  extract(check: ExternalCheck): Promise<ExternalCheckDetails | null>;
}

/**
 * Codecov extractor
 *
 * Extracts coverage information from codecov checks.
 */
export class CodecovExtractor implements ExternalCheckExtractor {
  name = 'codecov';

  canHandle(check: ExternalCheck): boolean {
    return check.name.toLowerCase().includes('codecov');
  }

  async extract(check: ExternalCheck): Promise<ExternalCheckDetails | null> {
    try {
      // Basic extraction from check conclusion
      const summary =
        check.conclusion === 'success'
          ? 'Code coverage check passed'
          : 'Code coverage check failed - coverage below threshold';

      return {
        summary,
        severity: check.conclusion === 'success' ? 'info' : 'warning',
      };
    } catch {
      return null;
    }
  }
}

/**
 * SonarCloud extractor
 *
 * Extracts code quality information from SonarCloud checks.
 */
export class SonarCloudExtractor implements ExternalCheckExtractor {
  name = 'sonarcloud';

  canHandle(check: ExternalCheck): boolean {
    return check.name.toLowerCase().includes('sonar');
  }

  async extract(check: ExternalCheck): Promise<ExternalCheckDetails | null> {
    try {
      // Basic extraction from check conclusion
      const summary =
        check.conclusion === 'success' ? 'Code quality check passed' : 'Code quality issues detected';

      return {
        summary,
        severity: check.conclusion === 'success' ? 'info' : 'warning',
      };
    } catch {
      return null;
    }
  }
}

/**
 * Extracted check (ExternalCheck with extraction results)
 */
export type ExtractedCheck = ExternalCheck;

/**
 * External extractor registry
 *
 * Manages external check extractors and coordinates extraction.
 */
export class ExternalExtractorRegistry {
  private readonly extractors: ExternalCheckExtractor[] = [];

  /**
   * Register an extractor
   *
   * @param extractor - Extractor to register
   */
  register(extractor: ExternalCheckExtractor): void {
    this.extractors.push(extractor);
  }

  /**
   * Extract from all checks
   *
   * @param checks - External checks
   * @returns Extracted checks
   */
  async extractAll(checks: ExternalCheck[]): Promise<ExtractedCheck[]> {
    const results: ExtractedCheck[] = [];

    for (const check of checks) {
      try {
        // Find matching extractor
        const extractor = this.extractors.find((e) => e.canHandle(check));

        if (extractor) {
          // Extract details
          const extracted = await extractor.extract(check);

          results.push({
            ...check,
            extracted,
          });
        } else {
          // No matching extractor
          results.push({
            ...check,
            extracted: null,
          });
        }
      } catch (error) {
        // Extraction failed - include error
        results.push({
          ...check,
          extracted: null,
          extraction_error: error instanceof Error ? error.message : 'Extraction failed',
        });
      }
    }

    return results;
  }
}

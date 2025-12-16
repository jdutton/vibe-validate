/**
 * ExtractionModeDetector - Detect and extract errors from GitHub Actions logs
 *
 * Supports two modes:
 * 1. Matrix mode: Validate YAML output with extraction field (pass through faithfully)
 * 2. Non-matrix mode: Raw test output (detect extractor and extract errors)
 *
 * Try matrix first, fall back to non-matrix if YAML not found.
 *
 * @packageDocumentation
 */

import { autoDetectAndExtract } from '@vibe-validate/extractors';
import type { ErrorExtractorResult } from '@vibe-validate/extractors';
import YAML from 'yaml';

import type { GitHubActionCheck } from '../schemas/watch-pr-result.schema.js';

/**
 * ExtractionModeDetector - Detect extraction mode and extract errors
 *
 * Tries matrix mode first (YAML with extraction field), falls back to non-matrix mode.
 */
export class ExtractionModeDetector {
  /**
   * Detect extraction mode and extract errors
   *
   * @param check - GitHub Actions check
   * @param logs - Raw log output
   * @returns ErrorExtractorResult or null if extraction failed
   */
  async detectAndExtract(check: GitHubActionCheck, logs: string): Promise<ErrorExtractorResult | null> {
    // Handle empty logs
    if (!logs || logs.trim().length === 0) {
      return null;
    }

    // Try matrix mode first
    const matrixResult = await this.extractFromMatrixMode(logs);
    if (matrixResult) {
      return matrixResult;
    }

    // Fall back to non-matrix mode
    return await this.extractFromNonMatrixMode(check.name, logs);
  }

  /**
   * Extract from matrix mode (validate YAML output)
   *
   * Looks for YAML markers (---...---) and extracts the "extraction" field.
   *
   * @param logs - Raw log output
   * @returns ErrorExtractorResult or null if not matrix mode
   */
  private async extractFromMatrixMode(logs: string): Promise<ErrorExtractorResult | null> {
    try {
      // Strip GitHub Actions timestamps from each line (format: 2025-12-16T10:01:01.000Z)
      // Preserve indentation after timestamps
      const cleanedLogs = logs
        .split('\n')
        .map((line) => {
          // Match timestamp pattern and keep everything after it (using RegExp.exec for sonarjs compliance)
          const timestampRegex = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)\s(.*)$/;
          const timestampMatch = timestampRegex.exec(line);
          if (timestampMatch) {
            return timestampMatch[2]; // Return content after timestamp and single space
          }
          return line; // Return line as-is if no timestamp
        })
        .join('\n');

      // Find YAML document between --- markers (using RegExp.exec for sonarjs compliance)
      // eslint-disable-next-line sonarjs/slow-regex -- NOSONAR: False positive - regex is safe for YAML markers
      const yamlRegex = /^---\s*\n([\s\S]*?)\n---\s*$/m;
      const yamlMatch = yamlRegex.exec(cleanedLogs);
      if (!yamlMatch) {
        return null;
      }

      // Parse YAML
      const yamlContent = yamlMatch[1];
      const parsed = YAML.parse(yamlContent);

      // Check if extraction field exists
      if (!parsed || typeof parsed !== 'object' || !('extraction' in parsed)) {
        return null;
      }

      // Validate extraction structure
      const extraction = parsed.extraction;
      if (
        !extraction ||
        typeof extraction !== 'object' ||
        !('summary' in extraction) ||
        !('totalErrors' in extraction) ||
        !('errors' in extraction)
      ) {
        return null;
      }

      // Return extraction faithfully (already in correct format)
      return extraction as ErrorExtractorResult;
    } catch {
      // YAML parsing failed - not matrix mode
      return null;
    }
  }

  /**
   * Extract from non-matrix mode (raw test output)
   *
   * Detects extractor from check name or logs, then runs extraction.
   *
   * @param _checkName - Check name (unused - autoDetectAndExtract handles detection)
   * @param logs - Raw log output
   * @returns ErrorExtractorResult or null if extraction failed
   */
  private async extractFromNonMatrixMode(_checkName: string, logs: string): Promise<ErrorExtractorResult | null> {
    try {
      // Use autoDetectAndExtract from @vibe-validate/extractors
      // It handles extractor detection and extraction automatically
      return autoDetectAndExtract(logs);
    } catch {
      // Extraction failed
      return null;
    }
  }

}

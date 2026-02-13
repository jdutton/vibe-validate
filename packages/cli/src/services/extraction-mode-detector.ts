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
    // Strip GitHub Actions log prefixes from each line
    // Format: <job-name>\t<step-name>\t[BOM]<timestamp> <content>
    // Where BOM is optional UTF-8 BOM (U+FEFF)
    const cleanedLogs = logs
      .split('\n')
      .map((line) => this.stripLogPrefix(line))
      .join('\n');

    // Find all YAML documents between --- markers and try each one
    // Multiple YAML blocks may exist (e.g., skills validation output before validate state)
    // Earlier blocks may fail to parse (e.g., @ in package names), so try all of them
    // eslint-disable-next-line sonarjs/slow-regex -- False positive: regex matches YAML document markers, input is bounded CI log output
    const yamlRegex = /^---\s*\n([\s\S]*?)\n---\s*$/gm;
    let yamlMatch: RegExpExecArray | null;

    while ((yamlMatch = yamlRegex.exec(cleanedLogs)) !== null) {
      try {
        const yamlContent = yamlMatch[1];
        const parsed = YAML.parse(yamlContent);

        if (!parsed || typeof parsed !== 'object') {
          continue;
        }

        // Try extracting from root level first, then nested
        const result = this.extractFromYAML(parsed);
        if (result) {
          return result;
        }
      } catch {
        // YAML parsing failed for this block - try next one
        continue;
      }
    }

    return null;
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
      // Strip GitHub Actions log prefixes (same cleaning as matrix mode)
      const cleanedLogs = logs
        .split('\n')
        .map((line) => this.stripLogPrefix(line))
        .join('\n');

      // Use autoDetectAndExtract from @vibe-validate/extractors
      // It handles extractor detection and extraction automatically
      return autoDetectAndExtract(cleanedLogs);
    } catch {
      // Extraction failed
      return null;
    }
  }

  /**
   * Strip GitHub Actions log prefix from a single line
   *
   * @param line - Log line
   * @returns Cleaned line
   */
  private stripLogPrefix(line: string): string {
    // Match GitHub Actions log prefix (job name + step name + timestamp with optional BOM)
    // Example: "Run job\tStep name\t2025-12-16T16:33:10.1212265Z content"
    const githubActionsRegex = /^[^\t]+\t[^\t]+\t\uFEFF?\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z\s(.*)$/;
    const githubMatch = githubActionsRegex.exec(line);
    if (githubMatch) {
      return githubMatch[1]; // Return content after prefix
    }

    // Fall back to simple timestamp stripping (for non-GitHub Actions logs)
    const timestampRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z\s(.*)$/;
    const timestampMatch = timestampRegex.exec(line);
    if (timestampMatch) {
      return timestampMatch[1]; // Return content after timestamp and space
    }

    return line; // Return line as-is if no prefix matched
  }

  /**
   * Extract ErrorExtractorResult from parsed YAML
   *
   * Tries root level first (vibe-validate run output), then nested (vibe-validate validate output)
   *
   * @param parsed - Parsed YAML object
   * @returns ErrorExtractorResult or null
   */
  private extractFromYAML(parsed: Record<string, unknown>): ErrorExtractorResult | null {
    // Check if extraction field exists at root (vibe-validate run output)
    if ('extraction' in parsed) {
      const extraction = this.validateExtraction(parsed.extraction);
      if (extraction) {
        return extraction;
      }
    }

    // Check if extraction is nested in phases/steps (vibe-validate validate output)
    if ('phases' in parsed && Array.isArray(parsed.phases)) {
      return this.extractFromPhases(parsed.phases);
    }

    return null;
  }

  /**
   * Extract ErrorExtractorResult from phases array (validate output)
   *
   * @param phases - Phases array
   * @returns ErrorExtractorResult or null
   */
  private extractFromPhases(phases: unknown[]): ErrorExtractorResult | null {
    for (const phase of phases) {
      const extraction = this.extractFromPhaseSteps(phase);
      if (extraction) {
        return extraction;
      }
    }
    return null;
  }

  /**
   * Extract ErrorExtractorResult from a single phase's steps
   *
   * @param phase - Phase object
   * @returns ErrorExtractorResult or null
   */
  private extractFromPhaseSteps(phase: unknown): ErrorExtractorResult | null {
    if (!phase || typeof phase !== 'object' || !('steps' in phase) || !Array.isArray(phase.steps)) {
      return null;
    }

    for (const step of phase.steps) {
      if (step && typeof step === 'object' && 'extraction' in step) {
        const extraction = this.validateExtraction(step.extraction);
        if (extraction) {
          // Return first extraction found (usually the failed step)
          return extraction;
        }
      }
    }
    return null;
  }

  /**
   * Validate extraction structure
   *
   * @param extraction - Extraction object
   * @returns ErrorExtractorResult or null
   */
  private validateExtraction(extraction: unknown): ErrorExtractorResult | null {
    if (
      extraction &&
      typeof extraction === 'object' &&
      'summary' in extraction &&
      'totalErrors' in extraction &&
      'errors' in extraction
    ) {
      return extraction as ErrorExtractorResult;
    }
    return null;
  }

}

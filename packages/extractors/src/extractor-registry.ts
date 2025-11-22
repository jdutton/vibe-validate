/**
 * Extractor Registry
 *
 * Centralized registry of all error extractors with detection logic.
 * Eliminates code duplication in smart-extractor.ts by providing a
 * single source of truth for extractor metadata and detection patterns.
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
import { detectMavenCheckstyle, extractMavenCheckstyle } from './maven-checkstyle-extractor.js';
import { detectMavenSurefire, extractMavenSurefire } from './maven-surefire-extractor.js';
import { detectMavenCompiler, extractMavenCompiler } from './maven-compiler-extractor.js';

/**
 * Detection result from pattern matching
 */
export interface DetectionResult {
  /** Confidence level (0-100) - higher means more certain */
  confidence: number;
  /** Patterns that matched in the output */
  patterns: string[];
  /** Human-readable explanation of detection */
  reason: string;
}

/**
 * Extractor descriptor with detection and extraction logic
 */
export interface ExtractorDescriptor {
  /** Unique name identifying this extractor */
  name: string;
  /** Detection function that analyzes output and returns confidence */
  detect: (_output: string) => DetectionResult;
  /** Extraction function that parses errors from output */
  extract: (_output: string) => ErrorExtractorResult;
  /** Priority for detection order (higher = check first) */
  priority: number;
}

/**
 * Registry of all available extractors
 *
 * Extractors are defined in priority order:
 * 1. TypeScript (95 confidence) - Very specific error codes
 * 2. ESLint (90 confidence) - Distinctive format
 * 3. Maven Checkstyle (variable) - Checkstyle-specific patterns
 * 4. Maven Surefire (variable) - Test plugin patterns
 * 5. Maven Compiler (variable) - Compilation error patterns
 * 6. Vitest (100 priority check, 90 fallback) - "RUN v" header is unmistakable
 * 7. JUnit (100 confidence) - XML format is unique
 * 8. Jasmine (85 confidence) - Distinctive "Failures:" header
 * 9. Jest (90 confidence) - Must check before Mocha
 * 10. Mocha (80 confidence) - Generic "passing/failing" patterns
 * 11. Playwright (95 confidence) - .spec.ts files with › separator
 * 12. Vitest secondary (90 confidence) - Fallback patterns
 */
export const EXTRACTOR_REGISTRY: ExtractorDescriptor[] = [
  // TypeScript - Very distinctive error codes (TS####)
  {
    name: 'typescript',
    priority: 95,
    detect: (output: string): DetectionResult => {
      const match = /error TS\d+:/.exec(output);
      if (match) {
        return {
          confidence: 95,
          patterns: ['error TS#### pattern'],
          reason: 'TypeScript compiler error format detected',
        };
      }
      return { confidence: 0, patterns: [], reason: '' };
    },
    extract: extractTypeScriptErrors,
  },

  // ESLint - Distinctive problem summary and line:col format
  {
    name: 'eslint',
    priority: 90,
    detect: (output: string): DetectionResult => {
      const hasProblemsSummary = /✖ \d+ problems?/.exec(output);
      // eslint-disable-next-line sonarjs/slow-regex -- Safe: only detects ESLint output format (controlled linter output), limited input size
      const hasLineColFormat = /\d+:\d+:?\s+(error|warning)\s+/.exec(output);

      if (hasProblemsSummary || hasLineColFormat) {
        const patterns = [];
        if (hasProblemsSummary) patterns.push('✖ X problems summary');
        if (hasLineColFormat) patterns.push('line:col error/warning format');
        return {
          confidence: 90,
          patterns,
          reason: 'ESLint error format detected',
        };
      }
      return { confidence: 0, patterns: [], reason: '' };
    },
    extract: extractESLintErrors,
  },

  // Maven Checkstyle - Checkstyle plugin markers
  {
    name: 'maven-checkstyle',
    priority: 70,
    detect: detectMavenCheckstyle,
    extract: extractMavenCheckstyle,
  },

  // Maven Surefire - Test plugin markers
  {
    name: 'maven-surefire',
    priority: 70,
    detect: detectMavenSurefire,
    extract: extractMavenSurefire,
  },

  // Maven Compiler - Compilation error markers
  {
    name: 'maven-compiler',
    priority: 70,
    detect: detectMavenCompiler,
    extract: extractMavenCompiler,
  },

  // Vitest (Priority Check) - "RUN v" header is 100% unique to Vitest
  // Must check BEFORE other test frameworks to prevent false positives
  {
    name: 'vitest',
    priority: 100,
    detect: (output: string): DetectionResult => {
      // eslint-disable-next-line sonarjs/slow-regex -- False positive: regex is anchored and has limited repetition
      if (/^\s*RUN\s+v\d+\.\d+\.\d+/m.test(output)) {
        const patterns = ['RUN v#### version header'];
        if (output.includes('×')) patterns.push('× symbol (U+00D7)');
        if (output.includes('❌')) patterns.push('❌ cross mark');
        if (output.includes(' ❯ ')) patterns.push('❯ arrow marker');
        if (output.includes('Test Files')) patterns.push('Test Files summary');
        if (output.includes('.test.ts')) patterns.push('.test.ts files');
        if (/FAIL\s+\d+\s+test\s+(file|case)/i.exec(output)) patterns.push('FAIL N test files/cases pattern');
        return {
          confidence: 100,
          patterns,
          reason: 'Vitest test output format detected (RUN v#### header)',
        };
      }
      return { confidence: 0, patterns: [], reason: '' };
    },
    extract: extractVitestErrors,
  },

  // JUnit XML - Unique XML format
  {
    name: 'junit',
    priority: 100,
    detect: (output: string): DetectionResult => {
      if (/^<\?xml\s+/m.exec(output) && output.includes('<testsuite')) {
        return {
          confidence: 100,
          patterns: ['<?xml header', '<testsuite> tag'],
          reason: 'JUnit XML format detected',
        };
      }
      return { confidence: 0, patterns: [], reason: '' };
    },
    extract: extractJUnitErrors,
  },

  // Jasmine - Distinctive "Failures:" header
  {
    name: 'jasmine',
    priority: 85,
    detect: (output: string): DetectionResult => {
      if (output.includes('Failures:') && /^\d+\)\s+/m.exec(output)) {
        return {
          confidence: 85,
          patterns: ['Failures: header', 'numbered test list'],
          reason: 'Jasmine test output format detected',
        };
      }
      return { confidence: 0, patterns: [], reason: '' };
    },
    extract: extractJasmineErrors,
  },

  // Jest - Must check BEFORE Mocha to avoid false positives
  {
    name: 'jest',
    priority: 90,
    detect: (output: string): DetectionResult => {
      const hasBullet = output.includes('●');
      const hasSummary = output.includes('Test Suites:');

      if (hasBullet || hasSummary) {
        const patterns = [];
        if (hasBullet) patterns.push('● bullet marker');
        if (hasSummary) patterns.push('Test Suites: summary');
        // eslint-disable-next-line sonarjs/slow-regex -- Safe: only detects Jest test framework output format (controlled test framework output), not user input
        if (/^\s*FAIL\s+/m.exec(output)) patterns.push('FAIL marker');
        // eslint-disable-next-line sonarjs/slow-regex -- Safe: only detects Jest test framework output format (controlled test framework output), not user input
        if (/^\s*PASS\s+/m.exec(output)) patterns.push('PASS marker');
        return {
          confidence: 90,
          patterns,
          reason: 'Jest test output format detected',
        };
      }
      return { confidence: 0, patterns: [], reason: '' };
    },
    extract: extractJestErrors,
  },

  // Mocha - Generic patterns, checked AFTER Jest
  {
    name: 'mocha',
    priority: 80,
    detect: (output: string): DetectionResult => {
      if (
        (output.includes(' passing') || output.includes(' failing')) &&
        // eslint-disable-next-line sonarjs/slow-regex -- Safe: only detects Mocha test framework output format (controlled test framework output), not user input
        /\s+\d+\)\s+/.exec(output)
      ) {
        return {
          confidence: 80,
          patterns: ['passing/failing summary', 'numbered failures'],
          reason: 'Mocha test output format detected',
        };
      }
      return { confidence: 0, patterns: [], reason: '' };
    },
    extract: extractMochaErrors,
  },

  // Playwright - .spec.ts files with › separator
  {
    name: 'playwright',
    priority: 95,
    detect: (output: string): DetectionResult => {
      const hasSpecFiles = output.includes('.spec.ts');
      // eslint-disable-next-line sonarjs/slow-regex -- Safe: only detects Playwright test framework output format (controlled test framework output), not user input
      const hasNumberedFailures = /\d+\)\s+.*\.spec\.ts:\d+:\d+\s+›/.exec(output);
      // eslint-disable-next-line sonarjs/slow-regex -- Safe: only detects Playwright test framework output format (controlled test framework output), not user input
      const hasFailureMarker = /✘.*\.spec\.ts/.exec(output);

      if (hasSpecFiles && (hasNumberedFailures ?? hasFailureMarker)) {
        const patterns = [];
        patterns.push('.spec.ts files');
        if (hasNumberedFailures) patterns.push('numbered failures with › separator');
        if (hasFailureMarker) patterns.push('✘ failure with .spec.ts file');
        return {
          confidence: 95,
          patterns,
          reason: 'Playwright test output format detected',
        };
      }
      return { confidence: 0, patterns: [], reason: '' };
    },
    extract: extractPlaywrightErrors,
  },

  // Vitest (Secondary) - Fallback patterns if "RUN v" not found
  {
    name: 'vitest',
    priority: 90,
    detect: (output: string): DetectionResult => {
      // Require MULTIPLE patterns together to avoid false positives:
      // - "Test Files" keyword (unique to Vitest) OR
      // - (× OR ❯ OR ❌) AND (FAIL pattern OR .test.ts files)
      const hasVitestErrorMarkers = output.includes('×') || output.includes(' ❯ ') || output.includes('❌');
      const hasTestFilesKeyword = output.includes('Test Files');
      const hasFailPattern = /FAIL\s+\d+\s+test\s+(file|case)/i.exec(output);
      const hasTestTsFiles = output.includes('.test.ts');

      // Option 1: "Test Files" keyword is very distinctive (Vitest-specific)
      // Option 2: Error markers + test file patterns
      const hasVitestMarkers = hasTestFilesKeyword || (hasVitestErrorMarkers && (hasFailPattern ?? hasTestTsFiles));

      if (hasVitestMarkers) {
        const patterns = [];
        if (output.includes('×')) patterns.push('× symbol (U+00D7)');
        if (output.includes('❌')) patterns.push('❌ cross mark');
        if (output.includes(' ❯ ')) patterns.push('❯ arrow marker');
        if (hasTestFilesKeyword) patterns.push('Test Files summary');
        if (hasTestTsFiles) patterns.push('.test.ts files');
        if (hasFailPattern) patterns.push('FAIL N test files/cases pattern');
        return {
          confidence: 90,
          patterns,
          reason: 'Vitest test output format detected',
        };
      }
      return { confidence: 0, patterns: [], reason: '' };
    },
    extract: extractVitestErrors,
  },
];

/**
 * Extractor Registry
 *
 * Centralized registry of all error extractors with detection logic.
 * All extractors now use the plugin structure with co-located tests and documentation.
 *
 * **Trust Levels** (Phase 2B):
 * - All built-in extractors have `trust: 'full'` (run directly, no sandbox)
 * - External plugins will have `trust: 'sandbox'` (run in isolated-vm)
 * - Use `getSandboxedExtractor()` to get wrapped extract function
 *
 * @package @vibe-validate/extractors
 */

import type { ErrorExtractorResult } from './types.js';
import type { DetectionResult } from './types.js';

// Import all extractor plugins
import typescriptPlugin from './extractors/typescript/index.js';
import eslintPlugin from './extractors/eslint/index.js';
import vitestPlugin from './extractors/vitest/index.js';
import jestPlugin from './extractors/jest/index.js';
import mochaPlugin from './extractors/mocha/index.js';
import jasminePlugin from './extractors/jasmine/index.js';
import playwrightPlugin from './extractors/playwright/index.js';
import junitPlugin from './extractors/junit/index.js';
import mavenCheckstylePlugin from './extractors/maven-checkstyle/index.js';
import mavenSurefirePlugin from './extractors/maven-surefire/index.js';
import mavenCompilerPlugin from './extractors/maven-compiler/index.js';
import avaPlugin from './extractors/ava/index.js';
import tapPlugin from './extractors/tap/index.js';
import genericPlugin from './extractors/generic/index.js';

/**
 * Trust level for extractor execution
 * - 'full': Run with full Node.js access (built-in trusted code, no sandbox)
 * - 'sandbox': Run in isolated V8 context (external plugins, secure)
 */
export type ExtractorTrustLevel = 'full' | 'sandbox';

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
  /** Trust level for execution (default: 'full' for built-ins) */
  trust: ExtractorTrustLevel;
}

/**
 * Registry of all available extractors
 *
 * All extractors now use the ExtractorPlugin structure with:
 * - Co-located tests (*.test.ts)
 * - Documentation (README.md + CLAUDE.md)
 * - Sample test cases
 * - Fast filtering hints
 * - Structured metadata
 *
 * Extractors are sorted by priority (highest first):
 * 1. Vitest (Priority 100) - "RUN v" header is unmistakable
 * 2. JUnit (Priority 100) - XML format is unique
 * 3. TypeScript (Priority 95) - Very specific error codes
 * 4. Playwright (Priority 95) - .spec.ts files with › separator
 * 5. Jest (Priority 90) - Must check before Mocha
 * 6. Vitest (Priority 90) - Secondary fallback patterns
 * 7. ESLint (Priority 85) - Distinctive format
 * 8. Jasmine (Priority 85) - Distinctive "Failures:" header
 * 9. Ava (Priority 82) - Ava v6+ format with ✘ markers
 * 10. Mocha (Priority 80) - Generic "passing/failing" patterns
 * 11. TAP (Priority 78) - TAP version 13 protocol
 * 12. Maven Compiler (Priority 70) - Compilation error patterns
 * 13. Maven Checkstyle (Priority 60) - Checkstyle-specific patterns
 * 14. Maven Surefire (Priority 65) - Test plugin patterns
 * 15. Generic (Priority 10) - Fallback for unknown formats
 */
export const EXTRACTOR_REGISTRY: ExtractorDescriptor[] = [
  // Vitest (Priority Check) - "RUN v" header is 100% unique to Vitest
  // Must check BEFORE other test frameworks to prevent false positives
  {
    name: vitestPlugin.metadata.name,
    priority: 100, // Explicit priority for RUN v header check
    trust: 'full', // Built-in trusted code
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
    extract: vitestPlugin.extract,
  },

  // JUnit XML - Unique XML format
  {
    name: junitPlugin.metadata.name,
    priority: junitPlugin.priority,
    trust: 'full', // Built-in trusted code
    detect: junitPlugin.detect,
    extract: junitPlugin.extract,
  },

  // TypeScript - Very distinctive error codes (TS####)
  {
    name: typescriptPlugin.metadata.name,
    priority: typescriptPlugin.priority,
    trust: 'full', // Built-in trusted code
    detect: typescriptPlugin.detect,
    extract: typescriptPlugin.extract,
  },

  // Playwright - .spec.ts files with › separator
  {
    name: playwrightPlugin.metadata.name,
    priority: playwrightPlugin.priority,
    trust: 'full', // Built-in trusted code
    detect: playwrightPlugin.detect,
    extract: playwrightPlugin.extract,
  },

  // Jest - Must check BEFORE Mocha to avoid false positives
  {
    name: jestPlugin.metadata.name,
    priority: jestPlugin.priority,
    trust: 'full', // Built-in trusted code
    detect: jestPlugin.detect,
    extract: jestPlugin.extract,
  },

  // Vitest (Secondary) - Fallback patterns if "RUN v" not found
  {
    name: vitestPlugin.metadata.name,
    priority: 90, // Secondary check with fallback patterns
    trust: 'full', // Built-in trusted code
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
    extract: vitestPlugin.extract,
  },

  // ESLint - Distinctive problem summary and line:col format
  {
    name: eslintPlugin.metadata.name,
    priority: eslintPlugin.priority,
    trust: 'full', // Built-in trusted code
    detect: eslintPlugin.detect,
    extract: eslintPlugin.extract,
  },

  // Jasmine - Distinctive "Failures:" header
  {
    name: jasminePlugin.metadata.name,
    priority: jasminePlugin.priority,
    trust: 'full', // Built-in trusted code
    detect: jasminePlugin.detect,
    extract: jasminePlugin.extract,
  },

  // Ava - Ava v6+ format with ✘ markers
  {
    name: avaPlugin.metadata.name,
    priority: avaPlugin.priority,
    trust: 'full', // Built-in trusted code
    detect: avaPlugin.detect,
    extract: avaPlugin.extract,
  },

  // Mocha - Generic patterns, checked AFTER Jest and Jasmine
  {
    name: mochaPlugin.metadata.name,
    priority: mochaPlugin.priority,
    trust: 'full', // Built-in trusted code
    detect: mochaPlugin.detect,
    extract: mochaPlugin.extract,
  },

  // TAP - TAP version 13 protocol
  {
    name: tapPlugin.metadata.name,
    priority: tapPlugin.priority,
    trust: 'full', // Built-in trusted code
    detect: tapPlugin.detect,
    extract: tapPlugin.extract,
  },

  // Maven Compiler - Compilation error markers
  {
    name: mavenCompilerPlugin.metadata.name,
    priority: mavenCompilerPlugin.priority,
    trust: 'full', // Built-in trusted code
    detect: mavenCompilerPlugin.detect,
    extract: mavenCompilerPlugin.extract,
  },

  // Maven Surefire - Test plugin patterns
  {
    name: mavenSurefirePlugin.metadata.name,
    priority: mavenSurefirePlugin.priority,
    trust: 'full', // Built-in trusted code
    detect: mavenSurefirePlugin.detect,
    extract: mavenSurefirePlugin.extract,
  },

  // Maven Checkstyle - Checkstyle plugin markers
  {
    name: mavenCheckstylePlugin.metadata.name,
    priority: mavenCheckstylePlugin.priority,
    trust: 'full', // Built-in trusted code
    detect: mavenCheckstylePlugin.detect,
    extract: mavenCheckstylePlugin.extract,
  },

  // Generic - Fallback extractor (lowest priority)
  {
    name: genericPlugin.metadata.name,
    priority: genericPlugin.priority,
    trust: 'full', // Built-in trusted code
    detect: genericPlugin.detect,
    extract: genericPlugin.extract,
  },
];

/**
 * Get an extractor descriptor by name
 *
 * @param name - The extractor name to find
 * @returns The extractor descriptor, or undefined if not found
 */
export function getExtractorByName(name: string): ExtractorDescriptor | undefined {
  return EXTRACTOR_REGISTRY.find(descriptor => descriptor.name === name);
}

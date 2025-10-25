/**
 * @vibe-validate/extractors
 *
 * LLM-optimized error extractors for validation output.
 *
 * Provides intelligent error parsing and formatting for common development tools:
 * - TypeScript (tsc)
 * - ESLint
 * - Vitest/Jest
 * - JUnit XML (auto-detected)
 * - OpenAPI validators
 * - Generic fallback
 *
 * @example
 * ```typescript
 * import { extractByStepName } from '@vibe-validate/extractors';
 *
 * const result = extractByStepName('TypeScript Type Checking', tscOutput);
 * console.log(result.summary); // "3 type error(s), 0 warning(s)"
 * console.log(result.guidance); // "Type mismatch - check variable/parameter types"
 * console.log(result.cleanOutput); // Clean, formatted error list
 * ```
 *
 * @package @vibe-validate/extractors
 * @version 0.1.0
 */

// Type definitions
export type {
  FormattedError,
  ErrorExtractorResult,
  ErrorExtractor
} from './types.js';

// Individual extractors (for direct use)
export { extractTypeScriptErrors } from './typescript-extractor.js';
export { extractESLintErrors } from './eslint-extractor.js';
export { extractVitestErrors } from './vitest-extractor.js';
export { extractJestErrors } from './jest-extractor.js';
export { extractJUnitErrors } from './junit-extractor.js';
export { extractOpenAPIErrors } from './openapi-extractor.js';
export { extractGenericErrors } from './generic-extractor.js';

// Smart extractor (auto-detection - recommended)
export { extractByStepName } from './smart-extractor.js';

// Utilities
export { stripAnsiCodes, extractErrorLines } from './utils.js';

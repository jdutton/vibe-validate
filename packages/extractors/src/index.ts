/**
 * @vibe-validate/extractors
 *
 * LLM-optimized error extractors for validation output.
 *
 * Provides intelligent error parsing and formatting for common development tools:
 * - TypeScript (tsc)
 * - ESLint
 * - Vitest/Jest/Mocha/Jasmine
 * - JUnit XML (auto-detected)
 * - Generic fallback for all other formats
 *
 * @example
 * ```typescript
 * import { autoDetectAndExtract } from '@vibe-validate/extractors';
 *
 * const result = autoDetectAndExtract('TypeScript Type Checking', tscOutput);
 * console.log(result.summary); // "3 type error(s), 0 warning(s)"
 * console.log(result.guidance); // "Type mismatch - check variable/parameter types"
 * console.log(result.errorSummary); // Clean, formatted error list
 * ```
 *
 * @package @vibe-validate/extractors
 * @version 0.1.0
 */

// Type definitions (from Zod schemas for runtime validation)
export type {
  FormattedError,
  ErrorExtractorResult,
  DetectionMetadata,
  ExtractionMetadata,
} from './result-schema.js';

// Legacy type (interface-only, not validated)
export type { ErrorExtractor } from './types.js';

// Zod schemas for runtime validation
export {
  FormattedErrorSchema,
  ErrorExtractorResultSchema,
  DetectionMetadataSchema,
  ExtractionMetadataSchema,
  safeValidateExtractorResult,
  validateExtractorResult,
} from './result-schema.js';

// Individual extractors (for direct use)
export { extractTypeScriptErrors } from './typescript-extractor.js';
export { extractESLintErrors } from './eslint-extractor.js';
export { extractVitestErrors } from './vitest-extractor.js';
export { extractJestErrors } from './jest-extractor.js';
export { extractJUnitErrors } from './junit-extractor.js';
export { extractMochaErrors } from './mocha-extractor.js';
export { extractJasmineErrors } from './jasmine-extractor.js';
export { extractGenericErrors } from './generic-extractor.js';

// Smart extractor (auto-detection - recommended)
export { autoDetectAndExtract } from './smart-extractor.js';

// Utilities
export { stripAnsiCodes, extractErrorLines } from './utils.js';

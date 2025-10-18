/**
 * @vibe-validate/formatters
 *
 * LLM-optimized error formatters for validation output.
 *
 * Provides intelligent error parsing and formatting for common development tools:
 * - TypeScript (tsc)
 * - ESLint
 * - Vitest/Jest
 * - OpenAPI validators
 * - Generic fallback
 *
 * @example
 * ```typescript
 * import { formatByStepName } from '@vibe-validate/formatters';
 *
 * const result = formatByStepName('TypeScript Type Checking', tscOutput);
 * console.log(result.summary); // "3 type error(s), 0 warning(s)"
 * console.log(result.guidance); // "Type mismatch - check variable/parameter types"
 * console.log(result.cleanOutput); // Clean, formatted error list
 * ```
 *
 * @package @vibe-validate/formatters
 * @version 0.1.0
 */

// Type definitions
export type {
  FormattedError,
  ErrorFormatterResult,
  ErrorFormatter
} from './types.js';

// Individual formatters (for direct use)
export { formatTypeScriptErrors } from './typescript-formatter.js';
export { formatESLintErrors } from './eslint-formatter.js';
export { formatVitestErrors } from './vitest-formatter.js';
export { formatOpenAPIErrors } from './openapi-formatter.js';
export { formatGenericErrors } from './generic-formatter.js';

// Smart formatter (auto-detection - recommended)
export { formatByStepName } from './smart-formatter.js';

// Utilities
export { stripAnsiCodes, extractErrorLines } from './utils.js';

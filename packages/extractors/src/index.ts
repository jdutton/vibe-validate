/**
 * @vibe-validate/extractors
 *
 * LLM-optimized error extractors for validation output.
 *
 * Provides intelligent error parsing and formatting for common development tools:
 * - TypeScript (tsc)
 * - ESLint
 * - Vitest/Jest/Mocha/Jasmine/Playwright
 * - JUnit XML (auto-detected)
 * - Maven (Compiler, Checkstyle, Surefire)
 * - Ava, TAP
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
 * @version 0.17.0
 */

// Type definitions (from Zod schemas for runtime validation)
export type {
  FormattedError,
  ErrorExtractorResult,
  DetectionMetadata,
  ExtractionMetadata,
} from './result-schema.js';

// Plugin types
export type {
  ErrorExtractor,
  ExtractorInput,
  DetectionResult,
  ExtractorPlugin,
  ExtractorHints,
  ExtractorSample,
  ExtractorMetadata,
} from './types.js';

// Zod schemas for runtime validation
export {
  FormattedErrorSchema,
  ErrorExtractorResultSchema,
  DetectionMetadataSchema,
  ExtractionMetadataSchema,
  safeValidateExtractorResult,
  validateExtractorResult,
} from './result-schema.js';

// Extractor plugins (NEW - plugin structure with metadata, hints, samples)
export { default as typescriptPlugin } from './extractors/typescript/index.js';
export { default as eslintPlugin } from './extractors/eslint/index.js';
export { default as vitestPlugin } from './extractors/vitest/index.js';
export { default as jestPlugin } from './extractors/jest/index.js';
export { default as mochaPlugin } from './extractors/mocha/index.js';
export { default as jasminePlugin } from './extractors/jasmine/index.js';
export { default as playwrightPlugin } from './extractors/playwright/index.js';
export { default as junitPlugin } from './extractors/junit/index.js';
export { default as mavenCompilerPlugin } from './extractors/maven-compiler/index.js';
export { default as mavenCheckstylePlugin } from './extractors/maven-checkstyle/index.js';
export { default as mavenSurefirePlugin } from './extractors/maven-surefire/index.js';
export { default as avaPlugin } from './extractors/ava/index.js';
export { default as tapPlugin } from './extractors/tap/index.js';
export { default as genericPlugin } from './extractors/generic/index.js';

// Smart extractor (auto-detection - recommended)
export { autoDetectAndExtract } from './smart-extractor.js';

// Extractor registry (for advanced use cases)
export { EXTRACTOR_REGISTRY, registerPlugins as registerPluginsToRegistry } from './extractor-registry.js';
export type { ExtractorDescriptor, ExtractorTrustLevel } from './extractor-registry.js';

// Plugin loader (NEW - external plugin support)
export {
  loadPlugin,
  discoverPlugins,
  registerPlugins,
  validatePluginInterface,
  PluginValidationError,
} from './plugin-loader.js';
export type { PluginSource, PluginDiscoveryConfig } from './plugin-loader.js';

// Sandbox (NEW - secure plugin execution)
export {
  runInSandbox,
  createSandboxedCode,
  SandboxExecutionError,
  SandboxStatsCollector,
} from './sandbox.js';
export type { SandboxOptions, SandboxResult, SandboxStats } from './sandbox.js';

// Sandboxed Extractor Wrapper (NEW - trust-based execution)
export {
  createSandboxedExtractor,
} from './sandboxed-extractor.js';
export type {
  SandboxedExtractorOptions,
} from './sandboxed-extractor.js';

// Utilities
export { stripAnsiCodes, extractErrorLines } from './utils.js';

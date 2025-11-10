/**
 * @vibe-validate/core
 *
 * Core validation engine with git tree hash caching, parallel execution, and fail-fast support.
 *
 * ## Features
 *
 * - **Git Tree Hash Caching**: Skip validation if code unchanged
 * - **Parallel Execution**: Run validation steps concurrently for speed
 * - **Fail-Fast**: Stop on first failure with proper process cleanup
 * - **Signal Handling**: Graceful cleanup on SIGTERM/SIGINT
 * - **Language Agnostic**: Works with any command-line tool
 *
 * ## Example Usage
 *
 * ```typescript
 * import { runValidation } from '@vibe-validate/core';
 *
 * const result = await runValidation({
 *   phases: [
 *     {
 *       name: 'Type Checking',
 *       steps: [
 *         { name: 'TypeScript', command: 'tsc --noEmit' },
 *         { name: 'ESLint', command: 'eslint src/' },
 *       ],
 *     },
 *     {
 *       name: 'Testing',
 *       steps: [
 *         { name: 'Unit Tests', command: 'npm test' },
 *       ],
 *     },
 *   ],
 *   enableFailFast: true,
 * });
 *
 * if (result.passed) {
 *   console.log('✅ Validation passed!');
 * } else {
 *   console.error('❌ Validation failed:', result.failedStep);
 * }
 * ```
 *
 * @packageDocumentation
 */

// Export configuration types (Zod-inferred from @vibe-validate/config)
export type {
  ValidationStep,
  ValidationPhase,
} from '@vibe-validate/config';

// Export result types (Zod-inferred from result-schema)
export type {
  ValidationResult,
  StepResult,
  PhaseResult,
  OutputFiles,
} from './result-schema.js';

// Export runtime types (from runner.ts - non-serializable)
export type {
  ValidationConfig,
} from './runner.js';

// Export core runner functions
export {
  runValidation,
  runStepsInParallel,
  parseFailures,
  setupSignalHandlers,
} from './runner.js';

// Export process utilities
export {
  stopProcessGroup,
  spawnCommand,
  captureCommandOutput,
  type CaptureCommandOptions,
} from './process-utils.js';

// Export filesystem utilities
export {
  ensureDir,
  getTempDir,
  createLogFileWrite,
  createCombinedJsonl,
} from './fs-utils.js';

// Export validation result schema and validators
export {
  ValidationResultSchema,
  StepResultSchema,
  PhaseResultSchema,
  CommandExecutionSchema,
  OperationMetadataSchema,
  OutputFilesSchema,
  safeValidateResult,
  validateResult,
} from './result-schema.js';

// Export shared schema utilities
export {
  createSafeValidator,
  createStrictValidator,
} from './schema-utils.js';

// Export JSON Schema generation
export {
  validationResultJsonSchema,
  generateValidationResultJsonSchema,
} from './result-schema-export.js';

// Export run output parser (shared by run command and phase runner)
export {
  parseVibeValidateOutput,
  type ParsedVibeValidateOutput,
} from './run-output-parser.js';

// Export output capture schemas and types
export type {
  OutputLine,
  CapturedOutput,
} from './output-capture-schema.js';

export {
  OutputLineSchema,
  CapturedOutputSchema,
} from './output-capture-schema.js';

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

// Export all types
export type {
  ValidationStep,
  ValidationPhase,
  ValidationConfig,
  ValidationResult,
  StepResult,
  PhaseResult,
} from './types.js';

// Export core runner functions
export {
  runValidation,
  runStepsInParallel,
  getWorkingTreeHash,
  checkExistingValidation,
  parseFailures,
  setupSignalHandlers,
} from './runner.js';

// Export process utilities
export {
  stopProcessGroup,
} from './process-utils.js';

/**
 * Validation history tracking via git notes
 *
 * @packageDocumentation
 */

// Types
export type {
  ValidationRun,
  HistoryNote,
  RecordResult,
  StabilityCheck,
  HistoryConfig,
  HealthCheckResult,
  PruneResult,
} from './types.js';

export { DEFAULT_HISTORY_CONFIG } from './types.js';

// Recorder
export {
  recordValidationHistory,
  checkWorktreeStability,
} from './recorder.js';

// Reader
export {
  readHistoryNote,
  listHistoryTreeHashes,
  getAllHistoryNotes,
  hasHistoryForTree,
} from './reader.js';

// Pruner
export { pruneHistoryByAge, pruneAllHistory } from './pruner.js';

// Health check
export { checkHistoryHealth } from './health-check.js';

// Truncate
export { truncateValidationOutput } from './truncate.js';

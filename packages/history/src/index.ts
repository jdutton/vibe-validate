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
  RunCacheNote,
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

// Cache lookup
export { findCachedValidation } from './lookup.js';

// Run cache reader
export {
  listRunCacheEntries,
  getRunCacheEntry,
  getAllRunCacheForTree,
  listRunCacheTreeHashes,
  getAllRunCacheEntries,
  type RunCacheEntryMeta,
} from './run-cache-reader.js';

// Pruner
export { pruneHistoryByAge, pruneAllHistory, pruneLegacyNotes, pruneAllRunCache } from './pruner.js';

// Health check
export { checkHistoryHealth } from './health-check.js';

// Truncate
export { truncateValidationOutput } from './truncate.js';

/**
 * Validation history types
 *
 * Re-exports YAML-serializable types from schemas (Zod-inferred).
 * Defines function return types (non-serializable).
 *
 * @packageDocumentation
 */

// Re-export YAML-serializable types from Zod schemas
export type {
  ValidationRun,
  HistoryNote,
  HistoryConfig,
  RunCacheNote,
} from './schemas.js';

export {
  ValidationRunSchema,
  HistoryNoteSchema,
  HistoryConfigSchema,
  RunCacheNoteSchema,
  DEFAULT_HISTORY_CONFIG,
} from './schemas.js';

/**
 * Result of recording validation history (function return type)
 */
export interface RecordResult {
  /** Was history successfully recorded? */
  recorded: boolean;

  /** Reason if not recorded */
  reason?: string;

  /** Tree hash that was recorded (or attempted) */
  treeHash: string;
}

/**
 * Worktree stability check result (function return type)
 */
export interface StabilityCheck {
  /** Is worktree stable? */
  stable: boolean;

  /** Tree hash before validation */
  treeHashBefore: string;

  /** Tree hash after validation */
  treeHashAfter: string;
}

/**
 * Health check result (function return type)
 */
export interface HealthCheckResult {
  /** Total number of tree hashes with notes */
  totalNotes: number;

  /** Number of notes older than retention policy */
  oldNotesCount: number;

  /** Should warn user about cleanup? */
  shouldWarn: boolean;

  /** Warning message (if any) */
  warningMessage?: string;
}

/**
 * Prune result (function return type)
 */
export interface PruneResult {
  /** Number of notes pruned */
  notesPruned: number;

  /** Number of runs pruned (across all notes) */
  runsPruned: number;

  /** Number of notes remaining */
  notesRemaining: number;

  /** Tree hashes that were pruned */
  prunedTreeHashes: string[];
}

/**
 * Validation history types
 */

import type { ValidationResult } from '@vibe-validate/core';

/**
 * Single validation run entry
 */
export interface ValidationRun {
  /** Unique run ID (run-{timestamp}) */
  id: string;

  /** ISO 8601 timestamp */
  timestamp: string;

  /** Duration in milliseconds */
  duration: number;

  /** Did validation pass? */
  passed: boolean;

  /** Branch name at time of validation */
  branch: string;

  /** HEAD commit SHA at time of validation */
  headCommit: string;

  /** Were there uncommitted changes? */
  uncommittedChanges: boolean;

  /** Full validation result (with truncated output) */
  result: ValidationResult;
}

/**
 * Git note structure (stored as YAML)
 */
export interface HistoryNote {
  /** Tree hash this note is attached to */
  treeHash: string;

  /** Array of validation runs for this tree */
  runs: ValidationRun[];
}

/**
 * Result of recording validation history
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
 * Worktree stability check result
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
 * History configuration
 */
export interface HistoryConfig {
  /** Enable history recording */
  enabled?: boolean;

  /** Git notes configuration */
  gitNotes?: {
    /** Git ref namespace */
    ref?: string;

    /** Max runs to keep per tree */
    maxRunsPerTree?: number;

    /** Truncate output to max bytes */
    maxOutputBytes?: number;
  };

  /** Retention policy */
  retention?: {
    /** Warn after this many days */
    warnAfterDays?: number;

    /** Warn after this many total notes */
    warnAfterCount?: number;
  };
}

/**
 * Default history configuration
 */
export const DEFAULT_HISTORY_CONFIG: Required<HistoryConfig> = {
  enabled: true,
  gitNotes: {
    ref: 'vibe-validate/runs',
    maxRunsPerTree: 10,
    maxOutputBytes: 10000,
  },
  retention: {
    warnAfterDays: 90,
    warnAfterCount: 100,
  },
};

/**
 * Health check result
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
 * Prune result
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

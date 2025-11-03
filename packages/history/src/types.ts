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
 *
 * v0.15.0: Adjusted retention thresholds for run command caching
 * - warnAfterDays: 90 → 30 (more frequent pruning recommended)
 * - warnAfterCount: 100 → 1000 (run cache creates many more notes)
 *
 * Note count estimation with run caching:
 * - Validation history: ~50-200 notes (one per tree hash)
 * - Run cache: ~500-1000+ notes (tree hash × command × workdir)
 * - Total: Can easily reach 500-1500 notes in active development
 */
export const DEFAULT_HISTORY_CONFIG: Required<HistoryConfig> = {
  enabled: true,
  gitNotes: {
    ref: 'vibe-validate/validate',
    maxRunsPerTree: 10,
    maxOutputBytes: 10000,
  },
  retention: {
    warnAfterDays: 30,
    warnAfterCount: 1000,
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

/**
 * Run cache note structure (stored in git notes)
 *
 * Cached result of a `vibe-validate run` command execution.
 * Stored at: refs/notes/vibe-validate/run/{treeHash}/{encoded-cache-key}
 *
 * NOTE: Only successful runs (exitCode === 0) are cached.
 * Failed runs are never cached as they may be transient/environment-specific.
 */
export interface RunCacheNote {
  /** Git tree hash when command was run */
  treeHash: string;

  /** Command that was executed */
  command: string;

  /** Working directory relative to git root ("" for root, "packages/cli" for subdirectory) */
  workdir: string;

  /** ISO 8601 timestamp */
  timestamp: string;

  /** Exit code from command execution (always 0 for cached entries) */
  exitCode: number;

  /** Duration in milliseconds */
  duration: number;

  /** Full extraction result (preserves all metadata and structure) */
  extraction: {
    errors: Array<{
      file?: string;
      line?: number;
      column?: number;
      message: string;
      code?: string;
      severity?: 'error' | 'warning';
      context?: string;
      guidance?: string;
    }>;
    summary: string;
    totalCount: number;
    guidance?: string;
    errorSummary: string;
    metadata?: {
      confidence: number;
      completeness: number;
      issues: string[];
      detection?: {
        extractor: string;
        confidence: number;
        patterns: string[];
        reason: string;
      };
      suggestions?: string[];
    };
  };

  /** Path to full output log file (may not exist if old/cleaned up) */
  fullOutputFile?: string;
}

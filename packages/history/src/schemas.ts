/**
 * Validation History Schemas
 *
 * Zod schemas for validation history and run cache data structures.
 * These are stored in git notes as YAML.
 *
 * @packageDocumentation
 */

import { z } from 'zod';
import {
  ValidationResultSchema,
  OperationMetadataSchema,
  CommandExecutionSchema,
} from '@vibe-validate/core';

/**
 * Output files structure for organized temp directory (v0.15.0+)
 */
const OutputFilesSchema = z.object({
  /** Path to stdout.log (omitted if empty) */
  stdout: z.string().optional(),
  /** Path to stderr.log (omitted if empty) */
  stderr: z.string().optional(),
  /** Path to combined.jsonl (chronological, ANSI-stripped) */
  combined: z.string(),
}).optional();

/**
 * Run Cache Note Schema
 *
 * Extends CommandExecutionSchema + OperationMetadataSchema with run-specific fields.
 * Stored in: refs/notes/vibe-validate/run/{treeHash}/{cacheKey}
 *
 * Represents a cached result of a `vibe-validate run` command execution.
 * Only successful runs (exitCode === 0) are cached.
 *
 * v0.15.0 BREAKING CHANGES:
 * - Now uses `durationSecs` (seconds) instead of `duration` (milliseconds)
 * - Added outputFiles with organized temp structure (stdout.log, stderr.log, combined.jsonl)
 * - REMOVED fullOutputFile (use outputFiles.combined instead)
 */
export const RunCacheNoteSchema = OperationMetadataSchema
  .merge(CommandExecutionSchema)
  .extend({
    /** Working directory relative to git root ("" for root, "packages/cli" for subdirectory) */
    workdir: z.string(),

    /** Organized output files (v0.15.0+) */
    outputFiles: OutputFilesSchema,

    /** Whether this result is from cache (true) or fresh execution (false/omitted) */
    isCachedResult: z.boolean().optional(),
  });

/**
 * Validation Run Schema
 *
 * Extends ValidationResultSchema with git metadata.
 * Represents a single validation run entry in history.
 *
 * Note: The 'result' field contains the full ValidationResult (with truncated output)
 */
export const ValidationRunSchema = z.object({
  /** Unique run ID (run-{timestamp}) */
  id: z.string(),

  /** ISO 8601 timestamp */
  timestamp: z.string().datetime(),

  /** Duration in milliseconds */
  duration: z.number(),

  /** Did validation pass? */
  passed: z.boolean(),

  /** Branch name at time of validation */
  branch: z.string(),

  /** HEAD commit SHA at time of validation */
  headCommit: z.string(),

  /** Were there uncommitted changes? */
  uncommittedChanges: z.boolean(),

  /** Full validation result (with truncated output) */
  result: ValidationResultSchema,
});

/**
 * History Note Schema
 *
 * Git note structure stored as YAML in refs/notes/vibe-validate/validate/{treeHash}
 */
export const HistoryNoteSchema = z.object({
  /** Tree hash this note is attached to */
  treeHash: z.string().min(1),

  /** Array of validation runs for this tree */
  runs: z.array(ValidationRunSchema),
});

/**
 * History Configuration Schema
 */
export const HistoryConfigSchema = z.object({
  /** Enable history recording */
  enabled: z.boolean().optional(),

  /** Git notes configuration */
  gitNotes: z.object({
    /** Git ref namespace */
    ref: z.string().optional(),

    /** Max runs to keep per tree */
    maxRunsPerTree: z.number().positive().optional(),

    /** Truncate output to max bytes */
    maxOutputBytes: z.number().positive().optional(),
  }).optional(),

  /** Retention policy */
  retention: z.object({
    /** Warn after this many days */
    warnAfterDays: z.number().positive().optional(),

    /** Warn after this many total notes */
    warnAfterCount: z.number().positive().optional(),
  }).optional(),
}).optional();

/**
 * Inferred TypeScript types from Zod schemas
 */
export type RunCacheNote = z.infer<typeof RunCacheNoteSchema>;
export type ValidationRun = z.infer<typeof ValidationRunSchema>;
export type HistoryNote = z.infer<typeof HistoryNoteSchema>;
export type HistoryConfig = z.infer<typeof HistoryConfigSchema>;

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
export const DEFAULT_HISTORY_CONFIG = {
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
} as const;

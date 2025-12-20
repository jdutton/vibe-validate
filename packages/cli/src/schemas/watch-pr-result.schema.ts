/**
 * Zod Schema for Watch PR Results
 *
 * CRITICAL PROJECT REQUIREMENT: All YAML-serializable types MUST be Zod schemas.
 * Use z.infer<> to derive TypeScript types. Manual interfaces only for non-serializable data.
 *
 * This schema defines the complete structure of watch-pr command output,
 * enabling runtime validation and JSON Schema generation.
 *
 * Output follows "Newspaper Philosophy" ordering: most important info first.
 *
 * @packageDocumentation
 */

import { ErrorExtractorResultSchema } from '@vibe-validate/extractors';
import { z } from 'zod';

// ============================================================================
// Enums
// ============================================================================

/**
 * Check Status Enum
 *
 * GitHub check run status
 */
export const CheckStatusSchema = z.enum(['queued', 'in_progress', 'completed']);

/**
 * Check Conclusion Enum
 *
 * GitHub check run conclusion (present when status is 'completed')
 */
export const CheckConclusionSchema = z.enum([
  'success',
  'failure',
  'neutral',
  'cancelled',
  'skipped',
  'timed_out',
  'action_required',
]);

/**
 * Merge State Status Enum
 *
 * GitHub PR merge state status
 */
export const MergeStateStatusSchema = z.enum([
  'BEHIND',
  'BLOCKED',
  'CLEAN',
  'DIRTY',
  'DRAFT',
  'HAS_HOOKS',
  'UNKNOWN',
  'UNSTABLE',
]);

/**
 * Severity Enum
 *
 * Severity level for guidance and external checks
 */
export const SeveritySchema = z.enum(['error', 'warning', 'info']);

// ============================================================================
// PR Context Schemas
// ============================================================================

/**
 * Linked Issue Schema
 *
 * GitHub issue linked to the PR (via closing keywords or manually)
 */
export const LinkedIssueSchema = z.object({
  /** Issue number */
  number: z.number().int().positive(),

  /** Issue title */
  title: z.string(),

  /** Issue URL */
  url: z.string().url(),
});

/**
 * PR Metadata Schema
 *
 * Complete PR context including metadata, labels, and linked issues
 */
export const PRMetadataSchema = z.object({
  /** PR number */
  number: z.number().int().positive(),

  /** PR title */
  title: z.string(),

  /** PR URL */
  url: z.string().url(),

  /** Head branch name */
  branch: z.string(),

  /** Base branch name (usually 'main' or 'develop') */
  base_branch: z.string(),

  /** PR author username */
  author: z.string(),

  /** Is this a draft PR? */
  draft: z.boolean(),

  /** Is the PR mergeable? */
  mergeable: z.boolean(),

  /** Merge state status (CLEAN, UNSTABLE, BLOCKED, etc.) */
  merge_state_status: MergeStateStatusSchema,

  /** PR labels */
  labels: z.array(z.string()),

  /** Issues linked to this PR (via closing keywords) */
  linked_issues: z.array(LinkedIssueSchema).optional(),
});

// ============================================================================
// Check Schemas
// ============================================================================

/**
 * GitHub Actions Check Schema
 *
 * Check run from GitHub Actions workflow.
 * Includes run_id for drilling down with `gh run view`.
 * May include extraction (from matrix or non-matrix mode).
 */
export const GitHubActionCheckSchema = z.object({
  /** Check name */
  name: z.string(),

  /** Check status (queued, in_progress, completed) */
  status: CheckStatusSchema,

  /** Check conclusion (present when completed) */
  conclusion: CheckConclusionSchema.optional(),

  /** GitHub run ID for this check */
  run_id: z.number().int().positive(),

  /** Workflow name */
  workflow: z.string(),

  /** When the check started (ISO 8601) */
  started_at: z.string().datetime(),

  /** Human-readable duration (e.g., "2m15s") */
  duration: z.string(),

  /** Local path to cached log file (if cached) */
  log_file: z.string().optional(),

  /**
   * Extraction result (CRITICAL: NEW FEATURE)
   *
   * Errors extracted from check logs using one of two modes:
   * - Matrix mode: Parsed from validate YAML output, passed through faithfully
   * - Non-matrix mode: Extracted from raw test output using extractors
   *
   * Both modes produce ErrorExtractorResult schema (from @vibe-validate/extractors)
   */
  extraction: ErrorExtractorResultSchema.optional(),
});

/**
 * External Check Details Schema
 *
 * Details extracted from external checks (codecov, SonarCloud, etc.)
 */
export const ExternalCheckDetailsSchema = z.object({
  /** Human-readable summary of the check result */
  summary: z.string(),

  /** Additional details (provider-specific) */
  details: z.record(z.any()).optional(),

  /** Severity level */
  severity: SeveritySchema.optional(),
});

/**
 * External Check Schema
 *
 * Status check from external provider (codecov, SonarCloud, etc.)
 * These don't have GitHub run IDs, only detailsUrl.
 */
export const ExternalCheckSchema = z.object({
  /** Check name (e.g., "codecov/patch", "SonarCloud Code Analysis") */
  name: z.string(),

  /** Check status */
  status: CheckStatusSchema,

  /** Check conclusion (present when completed) */
  conclusion: CheckConclusionSchema.optional(),

  /** URL to view check details on external provider */
  url: z.string().url(),

  /** Provider name (e.g., "codecov", "sonarcloud") */
  provider: z.string().optional(),

  /** Extracted details (if extraction succeeded) */
  extracted: ExternalCheckDetailsSchema.optional().nullable(),

  /** Error message if extraction failed */
  extraction_error: z.string().optional(),
});

/**
 * Check History Summary Schema
 *
 * Condensed history for pattern recognition (~75 tokens)
 * Provides recent pattern and success rate without full history details.
 */
export const CheckHistorySummarySchema = z.object({
  /** Total number of workflow runs for this PR branch */
  total_runs: z.number().int().nonnegative(),

  /** Recent pattern description (e.g., "Passed last 2 runs", "Failed last 3 runs") */
  recent_pattern: z.string(),

  /** Success rate percentage (e.g., "75%") based on last 10 runs */
  success_rate: z.string().optional(),
});

/**
 * Checks Summary Schema
 *
 * Complete check results with history context.
 * Ordered by newspaper philosophy: failed checks before passed checks.
 */
export const ChecksSummarySchema = z.object({
  /** Total number of checks */
  total: z.number().int().nonnegative(),

  /** Number of passed checks */
  passed: z.number().int().nonnegative(),

  /** Number of failed checks */
  failed: z.number().int().nonnegative(),

  /** Number of pending checks */
  pending: z.number().int().nonnegative(),

  /** Condensed history for pattern recognition (cheap tokens, high value) */
  history_summary: CheckHistorySummarySchema.optional(),

  /** GitHub Actions checks (with run_id and optional extraction) */
  github_actions: z.array(GitHubActionCheckSchema),

  /** External checks (with detailsUrl and optional extraction) */
  external_checks: z.array(ExternalCheckSchema),
});

// ============================================================================
// Changes Context Schemas
// ============================================================================

/**
 * File Change Schema
 *
 * Git diff statistics for a single file
 */
export const FileChangeSchema = z.object({
  /** File path */
  file: z.string(),

  /** Number of lines inserted */
  insertions: z.number().int().nonnegative(),

  /** Number of lines deleted */
  deletions: z.number().int().nonnegative(),

  /** Is this a new file? */
  new_file: z.boolean().optional(),
});

/**
 * Changes Context Schema
 *
 * File change statistics for the PR
 * Helps understand scope and potential impact areas.
 */
export const ChangesContextSchema = z.object({
  /** Total number of files changed */
  files_changed: z.number().int().nonnegative(),

  /** Total lines inserted across all files */
  insertions: z.number().int().nonnegative(),

  /** Total lines deleted across all files */
  deletions: z.number().int().nonnegative(),

  /** Number of commits in the PR */
  commits: z.number().int().positive(),

  /** Top files by lines changed (limited to 10 for token efficiency) */
  top_files: z.array(FileChangeSchema).optional(),
});

// ============================================================================
// Guidance Schemas
// ============================================================================

/**
 * Next Step Schema
 *
 * Actionable next step with severity and context
 */
export const NextStepSchema = z.object({
  /** Action description */
  action: z.string(),

  /** URL to perform the action (if applicable) */
  url: z.string().url().optional(),

  /** Severity level (prioritization) */
  severity: SeveritySchema,

  /** Reason or context for this action */
  reason: z.string().optional(),
});

/**
 * Guidance Schema
 *
 * Intelligent guidance based on check results.
 * Provides context-aware next steps with severity-based prioritization.
 */
export const GuidanceSchema = z.object({
  /** Overall status (passed, failed, pending) */
  status: z.enum(['passed', 'failed', 'pending']),

  /** Does this failure block merging? */
  blocking: z.boolean(),

  /** Overall severity */
  severity: SeveritySchema,

  /** Human-readable summary */
  summary: z.string(),

  /** Prioritized list of next steps */
  next_steps: z.array(NextStepSchema).optional(),
});

// ============================================================================
// Cache Schemas
// ============================================================================

/**
 * Cache Info Schema
 *
 * Metadata about the local cache
 */
export const CacheInfoSchema = z.object({
  /** Cache directory location */
  location: z.string(),

  /** When the cache was created (ISO 8601) */
  cached_at: z.string().datetime(),

  /** When the cache expires (ISO 8601) */
  expires_at: z.string().datetime(),
});

// ============================================================================
// Complete Result Schema
// ============================================================================

/**
 * Watch PR Result Schema
 *
 * Complete result structure from watch-pr command.
 *
 * Field ordering follows "Newspaper Philosophy":
 * 1. PR context & status (always needed)
 * 2. Check summary + history (quick overview)
 * 3. Failed checks FIRST (most actionable)
 * 4. Passed checks (confirmation)
 * 5. Guidance (what to do next)
 * 6. Changes (context)
 * 7. Cache (metadata, least important)
 *
 * If output is truncated, LLM still sees critical details.
 */
export const WatchPRResultSchema = z.object({
  /** PR metadata (number, title, branch, mergeable, labels, linked issues) */
  pr: PRMetadataSchema,

  /** Overall status (passed, failed, pending) */
  status: z.enum(['passed', 'failed', 'pending']),

  /** Check results with history context */
  checks: ChecksSummarySchema,

  /** File change context (optional, helps understand scope) */
  changes: ChangesContextSchema.optional(),

  /** Intelligent guidance with next steps (optional) */
  guidance: GuidanceSchema.optional(),

  /** Cache metadata (optional) */
  cache: CacheInfoSchema.optional(),
});

// ============================================================================
// Type Exports (derived from Zod schemas)
// ============================================================================

export type CheckStatus = z.infer<typeof CheckStatusSchema>;
export type CheckConclusion = z.infer<typeof CheckConclusionSchema>;
export type MergeStateStatus = z.infer<typeof MergeStateStatusSchema>;
export type Severity = z.infer<typeof SeveritySchema>;
export type LinkedIssue = z.infer<typeof LinkedIssueSchema>;

/** PR overall status type */
export type PRStatus = 'passed' | 'failed' | 'pending';
export type PRMetadata = z.infer<typeof PRMetadataSchema>;
export type GitHubActionCheck = z.infer<typeof GitHubActionCheckSchema>;
export type ExternalCheckDetails = z.infer<typeof ExternalCheckDetailsSchema>;
export type ExternalCheck = z.infer<typeof ExternalCheckSchema>;
export type CheckHistorySummary = z.infer<typeof CheckHistorySummarySchema>;
export type ChecksSummary = z.infer<typeof ChecksSummarySchema>;
export type FileChange = z.infer<typeof FileChangeSchema>;
export type ChangesContext = z.infer<typeof ChangesContextSchema>;
export type NextStep = z.infer<typeof NextStepSchema>;
export type Guidance = z.infer<typeof GuidanceSchema>;
export type CacheInfo = z.infer<typeof CacheInfoSchema>;
export type WatchPRResult = z.infer<typeof WatchPRResultSchema>;

/**
 * Output capture schemas for command execution
 *
 * These schemas define the structure for capturing and organizing
 * command output (stdout/stderr) with timestamps and proper separation.
 *
 * All types are derived from Zod schemas (not manual interfaces) to ensure
 * consistency between runtime validation and TypeScript types.
 */

import { z } from 'zod';

/**
 * A single line of output with timestamp and stream identification
 */
export const OutputLineSchema = z.object({
  /** ISO8601 timestamp: "2025-11-05T17:30:45.123Z" */
  ts: z.string(),
  /** Output stream (stdout or stderr) */
  stream: z.enum(['stdout', 'stderr']),
  /** Line content (ANSI codes stripped) */
  line: z.string(),
});

/**
 * Complete captured output from command execution
 */
export const CapturedOutputSchema = z.object({
  /** Standard output */
  stdout: z.object({
    /** Raw stdout with ANSI codes */
    raw: z.string(),
    /** Path to stdout.log file (omitted if empty) */
    file: z.string().optional(),
  }),
  /** Standard error */
  stderr: z.object({
    /** Raw stderr with ANSI codes */
    raw: z.string(),
    /** Path to stderr.log file (omitted if empty) */
    file: z.string().optional(),
  }),
  /** Combined chronological output */
  combined: z.object({
    /** Chronologically ordered lines (ANSI-stripped) */
    lines: z.array(OutputLineSchema),
    /** Path to combined.jsonl file */
    file: z.string(),
  }),
  /** Command exit code */
  exitCode: z.number(),
  /** Execution duration in seconds */
  durationSecs: z.number(),
});

/**
 * TypeScript types derived from Zod schemas
 */
export type OutputLine = z.infer<typeof OutputLineSchema>;
export type CapturedOutput = z.infer<typeof CapturedOutputSchema>;

import { z } from 'zod';

/**
 * Zod schema for watch-pr command result
 *
 * This schema defines the structure of YAML output from the watch-pr command.
 * Enables validation of watch-pr output in tests and documentation.
 */

export const WatchPRResultSchema = z.object({
  pr: z.object({
    id: z.union([z.number(), z.string()]),
    title: z.string(),
    url: z.string().url(),
  }),
  status: z.enum(['pending', 'in_progress', 'completed', 'timeout']),
  result: z.enum(['success', 'failure', 'cancelled', 'unknown']),
  duration: z.string(),
  summary: z.string(),
  checks: z.array(
    z.object({
      name: z.string(),
      status: z.string(),
      conclusion: z.string().nullable(),
      duration: z.string().optional(),
      url: z.string().url().optional(),
    })
  ),
  failures: z
    .array(
      z.object({
        name: z.string(),
        checkId: z.string(),
        errorSummary: z.string().optional(),
        stateFile: z
          .object({
            passed: z.boolean(),
            timestamp: z.string().optional(),
            treeHash: z.string().optional(),
            failedStep: z.string().optional(),
            rerunCommand: z.string().optional(),
            failedStepOutput: z.string().optional(),
            phases: z
              .array(
                z.object({
                  name: z.string(),
                  passed: z.boolean(),
                  steps: z
                    .array(
                      z.object({
                        name: z.string(),
                        passed: z.boolean(),
                        durationSecs: z.number().optional(),
                        output: z.string().optional(),
                      })
                    )
                    .optional(),
                })
              )
              .optional(),
          })
          .optional(),
        nextSteps: z.array(z.string()),
      })
    )
    .optional(),
});

export type WatchPRResult = z.infer<typeof WatchPRResultSchema>;

import { z } from 'zod';

export const PARENT_CONTEXT_ENV = 'VV_PARENT_CONTEXT';
export const MAX_NESTED_DEPTH = 3;

export const ParentContextSchema = z.object({
  runId: z.string().min(1),
  treeHash: z.string().min(1),
  depth: z.number().int().nonnegative(),
  stepName: z.string().min(1),
  phaseName: z.string().min(1).optional(),
  outputDir: z.string().min(1),
  capturing: z.boolean(),
  caching: z.boolean(),
  extracting: z.boolean(),
  verbose: z.boolean(),
  forceExecution: z.boolean(),
}).strict();

export type ParentContext = z.infer<typeof ParentContextSchema>;

export interface ChildContextInput {
  runId: string;
  treeHash: string;
  stepName: string;
  phaseName?: string;
  outputDir: string;
  verbose: boolean;
  forceExecution: boolean;
}

export function readParentContext(): ParentContext | null {
  const raw = process.env[PARENT_CONTEXT_ENV];
  if (!raw) return null;
  try {
    return ParentContextSchema.parse(JSON.parse(raw));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Invalid ${PARENT_CONTEXT_ENV}: ${detail}. ` +
      `Unset ${PARENT_CONTEXT_ENV} and retry.`
    );
  }
}

export function buildChildContext(
  parent: ParentContext | null,
  input: ChildContextInput
): ParentContext {
  const depth = (parent?.depth ?? 0) + 1;
  if (depth > MAX_NESTED_DEPTH) {
    throw new Error(
      `Nested vibe-validate depth exceeded ${MAX_NESTED_DEPTH} — likely a recursive ` +
      `'vibe-validate run' wrapper inside a package.json script invoked from 'vibe-validate validate'. ` +
      `Remove the inner 'vibe-validate run' wrapper; the outer already handles capture, extraction, and caching.`
    );
  }
  return {
    runId: input.runId,
    treeHash: input.treeHash,
    depth,
    stepName: input.stepName,
    ...(input.phaseName ? { phaseName: input.phaseName } : {}),
    outputDir: input.outputDir,
    capturing: true,
    caching: true,
    extracting: true,
    verbose: input.verbose,
    forceExecution: input.forceExecution,
  };
}

export function serializeForEnv(ctx: ParentContext): string {
  return JSON.stringify(ctx);
}

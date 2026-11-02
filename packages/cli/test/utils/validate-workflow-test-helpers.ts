/**
 * Shared test helpers for validate workflow tests
 *
 * Provides common mock factories and setup utilities to eliminate duplication
 * across workflow test files.
 */

import type { VibeValidateConfig } from '@vibe-validate/config';
import type { ValidationResult } from '@vibe-validate/core';
import type { TreeHash, TreeHashResult } from '@vibe-validate/git';
import { getGitTreeHash } from '@vibe-validate/git';
import { readHistoryNote, type HistoryNote, type ValidationRun } from '@vibe-validate/history';
import { vi } from 'vitest';

import type { AgentContext } from '../../src/utils/context-detector.js';
import type { ValidateWorkflowOptions } from '../../src/utils/validate-workflow.js';
import { runValidateWorkflow } from '../../src/utils/validate-workflow.js';

export type { ValidateWorkflowOptions } from '../../src/utils/validate-workflow.js';

/**
 * Standard mock tree hash result used across tests
 */
export const MOCK_TREE_HASH = 'abc123def456' as TreeHash;
export const MOCK_TREE_HASH_RESULT: TreeHashResult = {
  hash: MOCK_TREE_HASH,
};

/**
 * Standard mock agent context (non-agent, interactive)
 */
export const MOCK_AGENT_CONTEXT: AgentContext = {
  isAgent: false,
  isCI: false,
  isInteractive: true,
  isPreCommit: false,
};

/**
 * Create mock validation result
 */
export function createMockResult(passed: boolean, timestamp = '2026-02-12T10:05:00Z', level = 'full'): ValidationResult {
  return {
    passed,
    timestamp,
    level,
    summary: passed ? 'All steps passed' : 'Tests failed',
    ...(passed ? {} : { failedStep: 'Tests' }),
    phases: [
      {
        name: 'Test Phase',
        passed,
        durationSecs: 5,
        steps: [
          {
            name: 'Tests',
            command: 'npm test',
            passed,
            exitCode: passed ? 0 : 1,
            durationSecs: 5,
          },
        ],
      },
    ],
  };
}

/**
 * Create mock validation run
 */
export function createMockRun(passed: boolean, timestamp = '2026-02-12T10:00:00Z', level = 'full'): ValidationRun {
  return {
    id: 'run-123',
    timestamp,
    duration: 5000,
    passed,
    level,
    branch: 'main',
    headCommit: 'commit123',
    uncommittedChanges: false,
    result: createMockResult(passed, timestamp, level),
  };
}

/**
 * Create mock history note
 */
export function createMockNote(runs: ValidationRun[]): HistoryNote {
  return {
    treeHash: MOCK_TREE_HASH,
    runs,
  };
}

/**
 * Serve `runs` (oldest first) as the tree's history note, or no note at all
 */
export function setupHistoryNote(runs: ValidationRun[] | null): void {
  vi.mocked(readHistoryNote).mockResolvedValue(runs === null ? null : createMockNote(runs));
}

/** A config declaring `commit` then `full` (the runner is mocked, so no steps are needed) */
export const TWO_LEVEL_CONFIG: VibeValidateConfig = {
  validation: { levels: ['commit', 'full'], phases: [] },
};

/**
 * Setup standard console mocks for workflow tests
 */
export function setupConsoleMocks(): {
  /** Console.warn spy */
  warnSpy: ReturnType<typeof vi.spyOn>;
  /** Console.log spy */
  logSpy: ReturnType<typeof vi.spyOn>;
  /** Console.error spy */
  errorSpy: ReturnType<typeof vi.spyOn>;
  /** Process.stderr.write spy */
  stderrSpy: ReturnType<typeof vi.spyOn>;
} {
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  // Type assertion to bypass incompatibility between vi.spyOn and process.stderr.write
  const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true) as any;

  return { warnSpy, logSpy, errorSpy, stderrSpy };
}

/**
 * Setup standard git mock (returns mock tree hash)
 */
export function setupGitMock(): void {
  vi.mocked(getGitTreeHash).mockResolvedValue(MOCK_TREE_HASH_RESULT);
}

/**
 * Execute workflow with default options
 */
export async function executeWorkflow(
  overrides: Partial<ValidateWorkflowOptions> = {},
  config: VibeValidateConfig = { validation: { phases: [] } }
): Promise<ValidationResult> {
  return runValidateWorkflow(config, {
    context: MOCK_AGENT_CONTEXT,
    yaml: false,
    level: 'full',
    ...overrides,
  });
}

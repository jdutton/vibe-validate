import { describe, expect, it } from 'vitest';

import type { ExternalCheck, GitHubActionCheck, WatchPRResult } from '../../src/schemas/watch-pr-result.schema.js';
import {
  allFailedChecksHaveExtraction,
  anyFailedCheckHasExtraction,
} from '../../src/utils/watch-pr-exit-conditions.js';

// ============================================================================
// Test Helpers
// ============================================================================

/** Minimal PR metadata for tests */
const basePR: WatchPRResult['pr'] = {
  number: 1,
  title: 'test',
  url: 'https://github.com/test/test/pull/1',
  branch: 'test',
  base_branch: 'main',
  author: 'test',
  draft: false,
  mergeable: true,
  merge_state_status: 'CLEAN',
  labels: [],
};

/** Create a failed GitHub Action check with optional extraction/log_file */
function createFailedAction(
  overrides: Partial<GitHubActionCheck> = {}
): GitHubActionCheck {
  return {
    name: overrides.name ?? 'Test Job',
    status: 'completed',
    conclusion: 'failure',
    run_id: overrides.run_id ?? 1001,
    workflow: 'CI',
    started_at: '2026-01-01T00:00:00Z',
    duration: '1m30s',
    ...overrides,
  };
}

/** Create a successful GitHub Action check */
function createPassedAction(
  overrides: Partial<GitHubActionCheck> = {}
): GitHubActionCheck {
  return {
    name: overrides.name ?? 'Lint',
    status: 'completed',
    conclusion: 'success',
    run_id: overrides.run_id ?? 1002,
    workflow: 'CI',
    started_at: '2026-01-01T00:00:00Z',
    duration: '0m45s',
    ...overrides,
  };
}

/** Create a failed external check */
function createFailedExternal(
  overrides: Partial<ExternalCheck> = {}
): ExternalCheck {
  return {
    name: overrides.name ?? 'codecov/patch',
    status: overrides.status ?? 'completed',
    conclusion: 'failure',
    url: 'https://codecov.io/test',
    ...overrides,
  };
}

/** Compute PR status from counts */
function computeStatus(failed: number, pending: number): 'passed' | 'failed' | 'pending' {
  if (failed > 0) return 'failed';
  if (pending > 0) return 'pending';
  return 'passed';
}

/** Build a result where one of two failed actions has extraction (partial extraction scenario) */
function buildPartialExtractionResult(): WatchPRResult {
  return buildResult([
    createFailedAction({
      name: 'Job A',
      run_id: 1001,
      extraction: { errors: [], summary: 'fail', totalErrors: 1 },
    }),
    createFailedAction({ name: 'Job B', run_id: 1002 }),
  ]);
}

/** Build a result with only non-failure conclusions (cancelled, timed_out) */
function buildNonFailureConclusionsResult(): WatchPRResult {
  return buildResult([
    { ...createPassedAction(), conclusion: 'cancelled' },
    { ...createPassedAction({ name: 'Timeout', run_id: 2001 }), conclusion: 'timed_out' },
  ]);
}

/** Build a WatchPRResult from check arrays */
function buildResult(
  actions: GitHubActionCheck[],
  externals: ExternalCheck[] = []
): WatchPRResult {
  const failed = [...actions, ...externals].filter(c => c.conclusion === 'failure').length;
  const passed = [...actions, ...externals].filter(c => c.conclusion === 'success').length;
  const pending = [...actions, ...externals].filter(c => c.status !== 'completed').length;
  return {
    pr: basePR,
    status: computeStatus(failed, pending),
    checks: {
      total: actions.length + externals.length,
      passed,
      failed,
      pending,
      github_actions: actions,
      external_checks: externals,
    },
  };
}

// ============================================================================
// allFailedChecksHaveExtraction (used in normal mode)
// ============================================================================

describe('allFailedChecksHaveExtraction', () => {
  it('returns true when no checks are failed', () => {
    const result = buildResult([createPassedAction()]);
    expect(allFailedChecksHaveExtraction(result)).toBe(true);
  });

  it('returns false when a failed action has no extraction or log_file', () => {
    const result = buildResult([
      createFailedAction({ name: 'Job A' }),
    ]);
    expect(allFailedChecksHaveExtraction(result)).toBe(false);
  });

  it('returns true when all failed actions have extraction', () => {
    const result = buildResult([
      createFailedAction({
        name: 'Job A',
        extraction: { errors: [], summary: 'fail', totalErrors: 1 },
      }),
    ]);
    expect(allFailedChecksHaveExtraction(result)).toBe(true);
  });

  it('returns true when all failed actions have log_file', () => {
    const result = buildResult([
      createFailedAction({ name: 'Job A', log_file: './test-logs/log.txt' }),
    ]);
    expect(allFailedChecksHaveExtraction(result)).toBe(true);
  });

  it('returns false when only some failed actions have extraction', () => {
    const result = buildPartialExtractionResult();
    expect(allFailedChecksHaveExtraction(result)).toBe(false);
  });

  it('returns true when all failed actions and externals are complete', () => {
    const result = buildResult(
      [createFailedAction({
        extraction: { errors: [], summary: 'fail', totalErrors: 1 },
      })],
      [createFailedExternal({ status: 'completed' })],
    );
    expect(allFailedChecksHaveExtraction(result)).toBe(true);
  });

  it('returns false when a failed external check is not completed', () => {
    const result = buildResult(
      [createFailedAction({
        extraction: { errors: [], summary: 'fail', totalErrors: 1 },
      })],
      [createFailedExternal({ status: 'in_progress' })],
    );
    expect(allFailedChecksHaveExtraction(result)).toBe(false);
  });

  it('returns true when checks array is completely empty (vacuous truth)', () => {
    const result = buildResult([], []);
    expect(allFailedChecksHaveExtraction(result)).toBe(true);
  });

  it('ignores non-failure conclusions like cancelled or timed_out', () => {
    const result = buildNonFailureConclusionsResult();
    // These are not 'failure', so they should not block extraction readiness
    expect(allFailedChecksHaveExtraction(result)).toBe(true);
  });
});

// ============================================================================
// anyFailedCheckHasExtraction (used in fail-fast mode)
// ============================================================================

describe('anyFailedCheckHasExtraction', () => {
  it('returns false when no checks are failed', () => {
    const result = buildResult([createPassedAction()]);
    expect(anyFailedCheckHasExtraction(result)).toBe(false);
  });

  it('returns false when failed actions have no extraction or log_file', () => {
    const result = buildResult([
      createFailedAction({ name: 'Job A', run_id: 1001 }),
      createFailedAction({ name: 'Job B', run_id: 1002 }),
    ]);
    expect(anyFailedCheckHasExtraction(result)).toBe(false);
  });

  it('returns true when at least one failed action has extraction', () => {
    const result = buildPartialExtractionResult();
    expect(anyFailedCheckHasExtraction(result)).toBe(true);
  });

  it('returns true when at least one failed action has log_file', () => {
    const result = buildResult([
      createFailedAction({ name: 'Job A', run_id: 1001, log_file: './test-logs/log.txt' }),
      createFailedAction({ name: 'Job B', run_id: 1002 }),
    ]);
    expect(anyFailedCheckHasExtraction(result)).toBe(true);
  });

  it('returns true when a failed external check is completed', () => {
    const result = buildResult(
      [],
      [
        createFailedExternal({ name: 'codecov', status: 'completed' }),
        createFailedExternal({ name: 'sonar', status: 'in_progress' }),
      ],
    );
    expect(anyFailedCheckHasExtraction(result)).toBe(true);
  });

  it('returns false when all failed externals are still in_progress', () => {
    const result = buildResult(
      [],
      [
        createFailedExternal({ name: 'codecov', status: 'in_progress' }),
        createFailedExternal({ name: 'sonar', status: 'in_progress' }),
      ],
    );
    expect(anyFailedCheckHasExtraction(result)).toBe(false);
  });

  it('returns false when checks array is completely empty', () => {
    const result = buildResult([], []);
    expect(anyFailedCheckHasExtraction(result)).toBe(false);
  });

  it('returns true with mixed: action extraction ready + external still in_progress', () => {
    const result = buildResult(
      [createFailedAction({
        extraction: { errors: [], summary: 'fail', totalErrors: 1 },
      })],
      [createFailedExternal({ status: 'in_progress' })],
    );
    // Action extraction is enough — don't need to wait for external
    expect(anyFailedCheckHasExtraction(result)).toBe(true);
  });

  it('ignores non-failure conclusions like cancelled or timed_out', () => {
    const result = buildNonFailureConclusionsResult();
    expect(anyFailedCheckHasExtraction(result)).toBe(false);
  });

  describe('fail-fast vs normal mode behavior difference', () => {
    it('anyFailedCheck returns true but allFailedChecks returns false (the bug scenario)', () => {
      // This is the exact scenario that caused the bug:
      // 3 OS jobs fail, only 1 has extraction ready so far
      const result = buildResult([
        createFailedAction({
          name: 'ubuntu',
          run_id: 1001,
          extraction: { errors: [], summary: 'link integrity failed', totalErrors: 2 },
        }),
        createFailedAction({ name: 'macos', run_id: 1002 }),
        createFailedAction({ name: 'windows', run_id: 1003 }),
      ]);

      // fail-fast should exit — we have at least one extraction
      expect(anyFailedCheckHasExtraction(result)).toBe(true);

      // normal mode should wait — not all extractions are ready
      expect(allFailedChecksHaveExtraction(result)).toBe(false);
    });
  });
});

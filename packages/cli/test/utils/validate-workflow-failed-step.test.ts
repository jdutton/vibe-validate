/**
 * Tests for which step a failed run's footer blames
 *
 * The "To retry" hint and the extraction-quality prompt must point at the step
 * whose own command failed — never a same-named step in another phase, and
 * never a sibling that fail-fast merely stopped.
 */

import './validate-workflow-test-setup.js';

import { runValidation, type ValidationResult } from '@vibe-validate/core';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { runValidateWorkflow } from '../../src/utils/validate-workflow.js';

import { MOCK_AGENT_CONTEXT, setupConsoleMocks, setupGitMock, setupHistoryNote } from './validate-workflow-test-helpers.js';

const POOR_EXTRACTION = {
  summary: 'unparsed output',
  totalErrors: 0,
  errors: [],
  metadata: { confidence: 10, completeness: 10, issues: [] },
};

/** Run a fresh (uncached) validation that produces `result`; return what went to stderr. */
async function renderFailure(result: ValidationResult, developerFeedback = false): Promise<string> {
  setupHistoryNote(null);
  vi.mocked(runValidation).mockResolvedValue(result);
  const { errorSpy } = setupConsoleMocks();
  await runValidateWorkflow(
    { validation: { phases: [] }, developerFeedback },
    { context: MOCK_AGENT_CONTEXT, yaml: false, level: 'full' }
  );
  return errorSpy.mock.calls.map(call => call.join(' ')).join('\n');
}

describe('failed-run footer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupGitMock();
    vi.stubEnv('VV_SKIP_DEPENDENCY_CHECK', '1');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it('offers the failing step\'s command when an earlier phase has a passing step of the same name', async () => {
    const stderr = await renderFailure({
      passed: false,
      timestamp: '2026-11-01T10:00:00Z',
      level: 'full',
      treeHash: 'abc123def456',
      failedStep: 'build',
      phases: [
        { name: 'Prepare', passed: true, durationSecs: 1, steps: [{ name: 'build', command: 'pnpm build:deps', exitCode: 0, durationSecs: 1, passed: true }] },
        { name: 'Package', passed: false, durationSecs: 1, steps: [{ name: 'build', command: 'pnpm build', exitCode: 2, durationSecs: 1, passed: false }] },
      ],
    });

    expect(stderr).toContain('pnpm build');
    expect(stderr).not.toContain('pnpm build:deps');
  });

  it('does not report a stopped sibling\'s extraction quality, only the failing step\'s', async () => {
    const stderr = await renderFailure({
      passed: false,
      timestamp: '2026-11-01T10:00:00Z',
      level: 'full',
      treeHash: 'abc123def456',
      failedStep: 'Typecheck',
      phases: [{
        name: 'Checks',
        passed: false,
        durationSecs: 1,
        steps: [
          { name: 'ESLint', command: 'pnpm lint', exitCode: 143, durationSecs: 1, passed: false, stoppedByFailFast: true, extraction: POOR_EXTRACTION },
          { name: 'Typecheck', command: 'pnpm typecheck', exitCode: 2, durationSecs: 1, passed: false },
        ],
      }],
    }, true);

    // The footer rendered (so the absence below is not vacuous) and blames the real failure
    expect(stderr).toContain('pnpm typecheck');
    expect(stderr).not.toContain('Poor extraction quality');
  });
});

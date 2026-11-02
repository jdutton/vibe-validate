/**
 * Tests for how a STORED failure is presented: it never is
 *
 * Only a pass is ever served from cache. A failure recorded for this tree is a
 * record, not a verdict: the steps run again and the output is that of a fresh
 * run, with no "replayed" wording and no cache-key / --force hint (a replayed
 * failure, issue #169, could stick until the tree changed).
 */

import './validate-workflow-test-setup.js';

import { runValidation } from '@vibe-validate/core';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  createMockResult,
  createMockRun,
  setupConsoleMocks,
  setupGitMock,
  setupHistoryNote,
  executeWorkflow,
  type ValidateWorkflowOptions,
} from './validate-workflow-test-helpers.js';

const collect = (spy: ReturnType<typeof vi.spyOn>): string =>
  spy.mock.calls.map((call) => call.join(' ')).join('\n');

/** Every phrase the deleted replay presentation printed */
const REPLAY_WORDING = ['Replayed', 'not re-run', '.gitignore', 'validate --force', 'Validation failed for this code'];

/**
 * Run the workflow over a stored note and a fresh runner result; return what it printed
 */
async function render(
  storedRuns: ReturnType<typeof createMockRun>[] | null,
  freshPassed: boolean,
  overrides: Partial<ValidateWorkflowOptions> = {}
): Promise<{ stdout: string; stderr: string; isCachedResult: boolean | undefined }> {
  setupHistoryNote(storedRuns);
  vi.mocked(runValidation).mockResolvedValue(createMockResult(freshPassed));
  const { logSpy, errorSpy } = setupConsoleMocks();
  const result = await executeWorkflow(overrides);
  return { stdout: collect(logSpy), stderr: collect(errorSpy), isCachedResult: result.isCachedResult };
}

function expectNoReplayWording(text: string): void {
  for (const phrase of REPLAY_WORDING) {
    expect(text).not.toContain(phrase);
  }
}

describe('a stored failure is never replayed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupGitMock();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('runs the steps again and reports the fresh pass', async () => {
    const { stdout, stderr, isCachedResult } = await render([createMockRun(false)], true);

    expect(runValidation).toHaveBeenCalledTimes(1);
    expect(isCachedResult).toBeUndefined();
    // The fresh-run banner, not the cached-pass banner
    expect(stderr).toContain('Working tree:');
    expect(stdout).not.toContain('Validation passed for this code');
    expectNoReplayWording(`${stdout}\n${stderr}`);
  });

  it('a fresh failure over a stored failure keeps the actionable footer and no replay text', async () => {
    const { stdout, stderr } = await render([createMockRun(false)], false);

    expect(runValidation).toHaveBeenCalledTimes(1);
    expect(stderr).toContain('View error details');
    expect(stderr).toContain('To retry');
    // The failed step's own command, so the user can reproduce it directly
    expect(stderr).toContain('npm test');
    expectNoReplayWording(`${stdout}\n${stderr}`);
  });

  it('YAML mode: a stored failure runs again and no human hint leaks into machine output', async () => {
    const { stdout, stderr, isCachedResult } = await render([createMockRun(false)], false, { yaml: true });

    expect(runValidation).toHaveBeenCalledTimes(1);
    expect(isCachedResult).toBeUndefined();
    expectNoReplayWording(`${stdout}\n${stderr}`);
  });
});

describe('fresh and cached-pass presentation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupGitMock();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('a fresh failure with no history keeps the actionable footer', async () => {
    const { stdout, stderr } = await render(null, false);

    expect(stderr).toContain('View error details');
    expect(stderr).toContain('To retry');
    expectNoReplayWording(`${stdout}\n${stderr}`);
  });

  it('the error-details hint names the level the run was asked for', async () => {
    // state defaults to validate's level; after a commit-level failure that is the wrong one
    const { stderr } = await render(null, false, { level: 'commit' });

    expect(stderr).toContain('state --level commit');
  });

  it('a fresh pass says nothing about errors', async () => {
    const { stdout, stderr } = await render(null, true);
    const everything = `${stdout}\n${stderr}`;

    expect(everything).not.toContain('View error details');
    expect(everything).not.toContain('To retry');
  });

  it('a stored pass is served from cache with the cached-pass banner and no failure footer', async () => {
    const { stdout, stderr, isCachedResult } = await render([createMockRun(true)], false);

    expect(runValidation).not.toHaveBeenCalled();
    expect(isCachedResult).toBe(true);
    expect(stdout).toContain('Validation passed for this code');
    expect(stderr).not.toContain('View error details');
    expectNoReplayWording(stderr);
  });
});

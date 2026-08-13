/**
 * Tests for how a REPLAYED failure is presented (issue #169)
 *
 * A cached failure previously lost the actionable footer that fresh failures get
 * ("view details" / "to retry"), leaving the user with a stale verdict and no
 * next step. It must now carry that footer plus the cache-key explanation.
 */

import './validate-workflow-test-setup.js';

import { runValidation } from '@vibe-validate/core';
import { findCachedValidation } from '@vibe-validate/history';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  createMockResult,
  createMockRun,
  setupConsoleMocks,
  setupGitMock,
  executeWorkflow,
  type ValidateWorkflowOptions,
} from './validate-workflow-test-helpers.js';

const collect = (spy: ReturnType<typeof vi.spyOn>): string =>
  spy.mock.calls.map((call) => call.join(' ')).join('\n');

/**
 * Run the workflow and return everything it printed to each stream
 */
async function renderWorkflow(
  overrides: Partial<ValidateWorkflowOptions> = {}
): Promise<{ stdout: string; stderr: string }> {
  const { logSpy, errorSpy } = setupConsoleMocks();
  await executeWorkflow(overrides);
  return { stdout: collect(logSpy), stderr: collect(errorSpy) };
}

/**
 * Serve a cached run (a replay - validation does not execute)
 */
async function renderCachedRun(
  passed: boolean,
  overrides: Partial<ValidateWorkflowOptions> = {}
): Promise<{ stdout: string; stderr: string }> {
  vi.mocked(findCachedValidation).mockResolvedValue(createMockRun(passed));
  return renderWorkflow(overrides);
}

/**
 * Force a cache miss so validation actually runs and produces a fresh result
 */
async function renderFreshRun(passed: boolean): Promise<{ stdout: string; stderr: string }> {
  vi.mocked(findCachedValidation).mockResolvedValue(null);
  vi.mocked(runValidation).mockResolvedValue(createMockResult(passed));
  return renderWorkflow();
}

describe('replayed failure presentation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupGitMock();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should disclose that a cached failure was replayed rather than re-run', async () => {
    const { stdout } = await renderCachedRun(false);

    expect(stdout).toContain('Validation failed for this code');
    expect(stdout).toContain('not re-run just now');
  });

  it('should keep the actionable footer that fresh failures get', async () => {
    const { stderr } = await renderCachedRun(false);

    expect(stderr).toContain('View error details');
    expect(stderr).toContain('To retry');
    // The failed step's own command, so the user can reproduce it directly
    expect(stderr).toContain('npm test');
  });

  it('should explain the cache key and offer the force escape hatch', async () => {
    const { stderr } = await renderCachedRun(false);

    expect(stderr).toContain('.gitignore');
    expect(stderr).toContain('validate --force');
  });

  it('should not show the cache-key explanation on a cached pass', async () => {
    const { stdout, stderr } = await renderCachedRun(true);

    expect(stdout).toContain('Validation passed for this code');
    expect(stdout).not.toContain('not re-run just now');
    expect(stderr).not.toContain('validate --force');
  });
});

/**
 * The hint must be gated on an ACTUAL replay.
 *
 * Emitting it on every failure would teach users - and coding agents especially -
 * to reach for --force reflexively and to blame caching for ordinary broken code.
 * That is a worse failure mode than the one the hint fixes, so these tests exist
 * to kill any mutation that drops or widens the `cachedRun` guard.
 */
describe('fresh failure presentation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupGitMock();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should keep the actionable footer on a fresh failure', async () => {
    const { stderr } = await renderFreshRun(false);

    expect(stderr).toContain('View error details');
    expect(stderr).toContain('To retry');
  });

  it('should NOT suggest the cache is at fault when the failure was just computed', async () => {
    const { stdout, stderr } = await renderFreshRun(false);
    const everything = `${stdout}\n${stderr}`;

    expect(everything).not.toContain('.gitignore');
    expect(everything).not.toContain('validate --force');
    expect(everything).not.toContain('not re-run just now');
  });

  it('should say nothing extra on a fresh pass', async () => {
    const { stdout, stderr } = await renderFreshRun(true);
    const everything = `${stdout}\n${stderr}`;

    expect(everything).not.toContain('validate --force');
    expect(everything).not.toContain('View error details');
  });
});

describe('YAML mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupGitMock();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should not leak the human-readable hint into machine output on a replayed failure', async () => {
    const { stdout, stderr } = await renderCachedRun(false, { yaml: true });
    const everything = `${stdout}\n${stderr}`;

    expect(everything).not.toContain('.gitignore');
    expect(everything).not.toContain('validate --force');
    expect(everything).not.toContain('Replayed from');
  });
});

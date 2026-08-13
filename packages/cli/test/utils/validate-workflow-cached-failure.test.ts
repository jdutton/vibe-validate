/**
 * Tests for how a REPLAYED failure is presented (issue #169)
 *
 * A cached failure previously lost the actionable footer that fresh failures get
 * ("view details" / "to retry"), leaving the user with a stale verdict and no
 * next step. It must now carry that footer plus the cache-key explanation.
 */

import './validate-workflow-test-setup.js';

import { findCachedValidation } from '@vibe-validate/history';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  createMockRun,
  setupConsoleMocks,
  setupGitMock,
  executeWorkflow,
} from './validate-workflow-test-helpers.js';

/**
 * Run the workflow against a cached run and return everything it printed
 */
async function renderCachedRun(passed: boolean): Promise<{ stdout: string; stderr: string }> {
  const { logSpy, errorSpy } = setupConsoleMocks();
  vi.mocked(findCachedValidation).mockResolvedValue(createMockRun(passed));

  await executeWorkflow();

  const collect = (spy: ReturnType<typeof vi.spyOn>): string =>
    spy.mock.calls.map((call) => call.join(' ')).join('\n');

  return { stdout: collect(logSpy), stderr: collect(errorSpy) };
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

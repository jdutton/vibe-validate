/**
 * Tests for levels and the greens-only cache in the validate workflow
 *
 * The history note is served through readHistoryNote; the cache lookups are the
 * real ones, so these tests see exactly what a user's notes would produce.
 */

import './validate-workflow-test-setup.js';

import { runValidation } from '@vibe-validate/core';
import { readHistoryNote, type ValidationRun } from '@vibe-validate/history';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  createMockResult,
  createMockRun,
  executeWorkflow,
  setupConsoleMocks,
  setupGitMock,
  setupHistoryNote,
  TWO_LEVEL_CONFIG,
} from './validate-workflow-test-helpers.js';

const collect = (spy: ReturnType<typeof vi.spyOn>): string =>
  spy.mock.calls.map((call) => call.join(' ')).join('\n');

/** Run a commit-level --retry-failed over `runs` and return the run the runner was asked to build on */
async function previousRunHandedToRunner(runs: ValidationRun[]): Promise<ValidationRun | undefined> {
  setupConsoleMocks();
  setupHistoryNote(runs);
  vi.mocked(runValidation).mockResolvedValue(createMockResult(true, undefined, 'commit'));

  await executeWorkflow({ level: 'commit', retryFailed: true }, TWO_LEVEL_CONFIG);

  return vi.mocked(runValidation).mock.calls[0]?.[0].previousRun;
}

describe('validate workflow: levels and the greens-only cache', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupGitMock();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('never replays a stored failure: the steps run again', async () => {
    setupConsoleMocks();
    setupHistoryNote([createMockRun(false)]);
    vi.mocked(runValidation).mockResolvedValue(createMockResult(true));

    const result = await executeWorkflow();

    expect(runValidation).toHaveBeenCalledTimes(1);
    expect(result.passed).toBe(true);
    expect(result.isCachedResult).toBeUndefined();
  });

  it('a stored pass is a cache hit', async () => {
    setupConsoleMocks();
    setupHistoryNote([createMockRun(true)]);

    const result = await executeWorkflow();

    expect(runValidation).not.toHaveBeenCalled();
    expect(result.isCachedResult).toBe(true);
  });

  it('a later failure overturns an older pass: a forced re-check that went red sticks', async () => {
    setupConsoleMocks();
    setupHistoryNote([createMockRun(true, '2026-02-12T10:00:00Z'), createMockRun(false, '2026-02-12T11:00:00Z')]);
    vi.mocked(runValidation).mockResolvedValue(createMockResult(false));

    const result = await executeWorkflow();

    expect(runValidation).toHaveBeenCalledTimes(1);
    expect(result.passed).toBe(false);
    expect(result.isCachedResult).toBeUndefined();
  });

  it('a later commit-level failure overturns an older full pass for a commit request', async () => {
    setupConsoleMocks();
    setupHistoryNote([
      createMockRun(true, '2026-02-12T10:00:00Z', 'full'),
      createMockRun(false, '2026-02-12T11:00:00Z', 'commit'),
    ]);
    vi.mocked(runValidation).mockResolvedValue(createMockResult(true, undefined, 'commit'));

    await executeWorkflow({ level: 'commit' }, TWO_LEVEL_CONFIG);

    expect(runValidation).toHaveBeenCalledTimes(1);
  });

  it('a commit-level pass does not answer a full request', async () => {
    setupConsoleMocks();
    setupHistoryNote([createMockRun(true, '2026-02-12T10:00:00Z', 'commit')]);
    vi.mocked(runValidation).mockResolvedValue(createMockResult(true));

    await executeWorkflow({ level: 'full' }, TWO_LEVEL_CONFIG);

    expect(runValidation).toHaveBeenCalledTimes(1);
  });

  it('a full-level pass answers a commit request', async () => {
    setupConsoleMocks();
    setupHistoryNote([createMockRun(true, '2026-02-12T10:00:00Z', 'full')]);

    const result = await executeWorkflow({ level: 'commit' }, TWO_LEVEL_CONFIG);

    expect(runValidation).not.toHaveBeenCalled();
    expect(result.isCachedResult).toBe(true);
  });

  it('hands the runner the requested level and the config\'s levels', async () => {
    setupConsoleMocks();
    setupHistoryNote(null);
    vi.mocked(runValidation).mockResolvedValue(createMockResult(true, undefined, 'commit'));

    await executeWorkflow({ level: 'commit' }, TWO_LEVEL_CONFIG);

    expect(runValidation).toHaveBeenCalledWith(
      expect.objectContaining({ level: { name: 'commit', levels: ['commit', 'full'] } })
    );
  });

  it('reads the history note once for cache, retry and flakiness together', async () => {
    setupConsoleMocks();
    setupHistoryNote([createMockRun(false)]);
    vi.mocked(runValidation).mockResolvedValue(createMockResult(true));

    await executeWorkflow({ retryFailed: true });

    expect(readHistoryNote).toHaveBeenCalledTimes(1);
  });

  it('retries the failed run at the requested level, not one at another level', async () => {
    const fullRed = createMockRun(false, '2026-02-12T10:00:00Z', 'full');
    expect(await previousRunHandedToRunner([fullRed])).toBeUndefined();
  });

  it('retries the newest failed run at the requested level', async () => {
    const fullRed = createMockRun(false, '2026-02-12T10:00:00Z', 'full');
    const olderCommitRed = createMockRun(false, '2026-02-12T09:00:00Z', 'commit');
    const commitRed = createMockRun(false, '2026-02-12T11:00:00Z', 'commit');
    expect(await previousRunHandedToRunner([olderCommitRed, fullRed, commitRed])).toBe(commitRed);
  });

  it('never retries on top of a pass a newer failure overturned', async () => {
    setupConsoleMocks();
    setupHistoryNote([
      createMockRun(true, '2026-02-12T10:00:00Z', 'commit'),
      createMockRun(false, '2026-02-12T11:00:00Z', 'full'),
    ]);
    vi.mocked(runValidation).mockResolvedValue(createMockResult(true, undefined, 'commit'));

    await executeWorkflow({ level: 'commit', retryFailed: true }, TWO_LEVEL_CONFIG);

    expect(vi.mocked(runValidation).mock.calls[0]?.[0].previousRun).toBeUndefined();
  });

  it('names the level it runs', async () => {
    const { errorSpy } = setupConsoleMocks();
    setupHistoryNote(null);
    vi.mocked(runValidation).mockResolvedValue(createMockResult(true, undefined, 'commit'));

    await executeWorkflow({ level: 'commit' }, TWO_LEVEL_CONFIG);

    expect(collect(errorSpy)).toContain('level: commit');
  });

  it('names the level a cache hit covered', async () => {
    const { logSpy } = setupConsoleMocks();
    setupHistoryNote([createMockRun(true, '2026-02-12T10:00:00Z', 'full')]);

    await executeWorkflow({ level: 'commit' }, TWO_LEVEL_CONFIG);

    expect(collect(logSpy)).toContain('Level: full');
  });
});

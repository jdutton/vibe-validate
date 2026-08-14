/**
 * Tests for targeted remote ref fetching
 *
 * The point of this module is that a caller pays only for the refs its enabled
 * checks actually read: no fetch at all when nothing is enabled, and one call
 * per remote rather than one per ref.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { fetchRemoteRefs, refKey } from '../src/fetch-refs.js';
import * as gitExecutor from '../src/git-executor.js';

vi.mock('../src/git-executor.js', () => ({
  executeGitCommand: vi.fn(),
}));

function mockFetchResult(success: boolean, stderr = ''): void {
  vi.mocked(gitExecutor.executeGitCommand).mockReturnValue({
    success,
    stdout: '',
    stderr,
    exitCode: success ? 0 : 128,
  });
}

describe('fetchRemoteRefs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should make no network call for an empty ref list', () => {
    const outcomes = fetchRemoteRefs([]);

    expect(outcomes).toEqual({});
    expect(gitExecutor.executeGitCommand).not.toHaveBeenCalled();
  });

  it('should fetch a single ref', () => {
    mockFetchResult(true);

    const outcomes = fetchRemoteRefs([{ remote: 'origin', branch: 'main' }]);

    expect(gitExecutor.executeGitCommand).toHaveBeenCalledWith(
      ['fetch', '--quiet', 'origin', 'main'],
      expect.any(Object)
    );
    expect(outcomes).toEqual({ 'origin/main': { ok: true } });
  });

  it('should combine refs on the same remote into one call', () => {
    mockFetchResult(true);

    fetchRemoteRefs([
      { remote: 'origin', branch: 'main' },
      { remote: 'origin', branch: 'feature/foo' },
    ]);

    expect(gitExecutor.executeGitCommand).toHaveBeenCalledTimes(1);
    expect(gitExecutor.executeGitCommand).toHaveBeenCalledWith(
      ['fetch', '--quiet', 'origin', 'feature/foo', 'main'],
      expect.any(Object)
    );
  });

  it('should de-duplicate repeated refs', () => {
    mockFetchResult(true);

    fetchRemoteRefs([
      { remote: 'origin', branch: 'main' },
      { remote: 'origin', branch: 'main' },
    ]);

    expect(gitExecutor.executeGitCommand).toHaveBeenCalledWith(
      ['fetch', '--quiet', 'origin', 'main'],
      expect.any(Object)
    );
  });

  it('should issue one call per distinct remote', () => {
    mockFetchResult(true);

    const outcomes = fetchRemoteRefs([
      { remote: 'origin', branch: 'main' },
      { remote: 'upstream', branch: 'main' },
    ]);

    expect(gitExecutor.executeGitCommand).toHaveBeenCalledTimes(2);
    expect(outcomes).toEqual({ 'origin/main': { ok: true }, 'upstream/main': { ok: true } });
  });

  it('should report failure instead of throwing', () => {
    // Being offline is a normal state, not an exception. Callers degrade the
    // affected check to "no opinion" rather than crashing the commit path.
    mockFetchResult(false, 'fatal: unable to access remote');

    const outcomes = fetchRemoteRefs([{ remote: 'origin', branch: 'main' }]);

    expect(outcomes['origin/main'].ok).toBe(false);
    expect(outcomes['origin/main'].error).toContain('unable to access remote');
  });

  it('should isolate a failing remote from a succeeding one', () => {
    vi.mocked(gitExecutor.executeGitCommand)
      .mockReturnValueOnce({ success: true, stdout: '', stderr: '', exitCode: 0 })
      .mockReturnValueOnce({ success: false, stdout: '', stderr: 'boom', exitCode: 128 });

    const outcomes = fetchRemoteRefs([
      { remote: 'origin', branch: 'main' },
      { remote: 'upstream', branch: 'main' },
    ]);

    expect(outcomes['origin/main'].ok).toBe(true);
    expect(outcomes['upstream/main'].ok).toBe(false);
  });

  it('should isolate one unresolvable ref from its healthy neighbours on the same remote', () => {
    // git treats an unresolvable refspec as fatal for the WHOLE invocation, so
    // a combined fetch that includes a deleted branch aborts and leaves the
    // good ref unmoved. Reporting that as "origin is unreachable" would
    // silently disable every check pointed at origin — the common case being a
    // merged PR whose remote branch GitHub deleted while the local branch kept
    // its upstream config.
    vi.mocked(gitExecutor.executeGitCommand)
      // Combined call aborts because of feature/gone
      .mockReturnValueOnce({ success: false, stdout: '', stderr: "fatal: couldn't find remote ref feature/gone", exitCode: 128 })
      // Retried individually, sorted: feature/gone then main
      .mockReturnValueOnce({ success: false, stdout: '', stderr: "fatal: couldn't find remote ref feature/gone", exitCode: 128 })
      .mockReturnValueOnce({ success: true, stdout: '', stderr: '', exitCode: 0 });

    const outcomes = fetchRemoteRefs([
      { remote: 'origin', branch: 'main' },
      { remote: 'origin', branch: 'feature/gone' },
    ]);

    expect(outcomes['origin/feature/gone'].ok).toBe(false);
    expect(outcomes['origin/main'].ok).toBe(true);
  });

  it('should not pay for isolation when the combined fetch succeeds', () => {
    mockFetchResult(true);

    fetchRemoteRefs([
      { remote: 'origin', branch: 'main' },
      { remote: 'origin', branch: 'feature/foo' },
    ]);

    // Happy path stays exactly one round-trip per remote.
    expect(gitExecutor.executeGitCommand).toHaveBeenCalledTimes(1);
  });

  it('should not retry when a single-ref group fails', () => {
    mockFetchResult(false, 'boom');

    fetchRemoteRefs([{ remote: 'origin', branch: 'main' }]);

    // Nothing to isolate — a second identical call would be pure waste.
    expect(gitExecutor.executeGitCommand).toHaveBeenCalledTimes(1);
  });

  it('should key outcomes so branch names containing slashes stay distinct', () => {
    mockFetchResult(true);

    const outcomes = fetchRemoteRefs([
      { remote: 'origin', branch: 'release/2.0' },
      { remote: 'origin', branch: 'release' },
    ]);

    expect(outcomes['origin/release/2.0'].ok).toBe(true);
    expect(outcomes['origin/release'].ok).toBe(true);
  });

  it('should ignore blank remotes and branches', () => {
    mockFetchResult(true);

    const outcomes = fetchRemoteRefs([
      { remote: '', branch: 'main' },
      { remote: 'origin', branch: '' },
    ]);

    expect(outcomes).toEqual({});
    expect(gitExecutor.executeGitCommand).not.toHaveBeenCalled();
  });

  it('should still report a failure when git produced no stderr', () => {
    mockFetchResult(false);

    const outcomes = fetchRemoteRefs([{ remote: 'origin', branch: 'main' }]);

    expect(outcomes['origin/main'].ok).toBe(false);
    expect(outcomes['origin/main'].error).toBe('git fetch origin failed');
  });

  // The two tests below pin "failure is reported, never thrown". Callers treat
  // an unfetchable ref as "no opinion" and let the commit through; if this
  // module threw instead, being offline would abort pre-commit outright.
  it('should ask the executor not to throw on a failed fetch', () => {
    mockFetchResult(true);

    fetchRemoteRefs([{ remote: 'origin', branch: 'main' }]);

    expect(gitExecutor.executeGitCommand).toHaveBeenCalledWith(
      ['fetch', '--quiet', 'origin', 'main'],
      expect.objectContaining({ ignoreErrors: true })
    );
  });

  it('should report a failure rather than throw when the executor throws', () => {
    vi.mocked(gitExecutor.executeGitCommand).mockImplementation(() => {
      throw new Error('spawn git ENOENT');
    });

    const outcomes = fetchRemoteRefs([{ remote: 'origin', branch: 'main' }]);

    expect(outcomes['origin/main'].ok).toBe(false);
    expect(outcomes['origin/main'].error).toContain('ENOENT');
  });
});

describe('refKey', () => {
  it('should keep refs distinct when a branch name contains the separator', () => {
    expect(refKey({ remote: 'origin', branch: 'release/2.0' }))
      .not.toBe(refKey({ remote: 'origin', branch: 'release' }));
  });

  it('should match the keys fetchRemoteRefs reports under', () => {
    mockFetchResult(true);
    const ref = { remote: 'upstream', branch: 'feature/foo' };

    const outcomes = fetchRemoteRefs([ref]);

    expect(outcomes[refKey(ref)]).toEqual({ ok: true });
  });
});

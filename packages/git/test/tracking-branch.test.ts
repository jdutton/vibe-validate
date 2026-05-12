/**
 * Tests for checking divergence between current branch and its remote tracking branch
 *
 * CRITICAL: After a rebase, the local branch is BOTH ahead of and behind its tracking
 * branch (the rewritten commits vs the pre-rebase originals). The legacy
 * isCurrentBranchBehindTracking check could not distinguish "purely behind"
 * (someone else pushed) from "diverged" (we rebased), causing pre-commit to
 * incorrectly block legitimate post-rebase commits.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import * as gitExecutor from '../src/git-executor.js';
import {
  getTrackingDivergence,
  // eslint-disable-next-line sonarjs/deprecation -- tests intentionally exercise the deprecated wrapper to verify backwards-compat
  isCurrentBranchBehindTracking,
} from '../src/tracking-branch.js';

// Mock git-executor
vi.mock('../src/git-executor.js', () => ({
  executeGitCommand: vi.fn(),
}));

const UPSTREAM_OK = {
  success: true,
  stdout: 'origin/fix-issue-X\n',
  stderr: '',
  exitCode: 0,
};

function mockDivergence(aheadBehind: string): void {
  vi.mocked(gitExecutor.executeGitCommand)
    .mockReturnValueOnce(UPSTREAM_OK)
    .mockReturnValueOnce({
      success: true,
      stdout: `${aheadBehind}\n`,
      stderr: '',
      exitCode: 0,
    });
}

describe('getTrackingDivergence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return null when branch has no upstream tracking branch', () => {
    vi.mocked(gitExecutor.executeGitCommand).mockReturnValueOnce({
      success: false,
      stdout: '',
      stderr: 'fatal: no upstream configured for branch',
      exitCode: 128,
    });

    const result = getTrackingDivergence();

    expect(result).toBeNull();
    expect(gitExecutor.executeGitCommand).toHaveBeenCalledWith(
      ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'],
      expect.any(Object)
    );
  });

  it('should return {ahead: 0, behind: 0} when branch is up to date', () => {
    mockDivergence('0\t0');

    const result = getTrackingDivergence();

    expect(result).toEqual({ ahead: 0, behind: 0 });
    expect(gitExecutor.executeGitCommand).toHaveBeenNthCalledWith(
      2,
      ['rev-list', '--left-right', '--count', 'HEAD...@{u}'],
      expect.any(Object)
    );
  });

  it('should return {ahead: 0, behind: N} when purely behind (someone else pushed)', () => {
    mockDivergence('0\t3');

    const result = getTrackingDivergence();

    expect(result).toEqual({ ahead: 0, behind: 3 });
  });

  it('should return {ahead: N, behind: 0} when purely ahead (local unpushed commits)', () => {
    mockDivergence('2\t0');

    const result = getTrackingDivergence();

    expect(result).toEqual({ ahead: 2, behind: 0 });
  });

  it('should return {ahead: N, behind: M} when diverged (rebased history)', () => {
    // Classic post-rebase shape: rebased 3 commits onto a base that advanced
    // by 2; locally we now have 5 new commits, while origin still has the
    // 3 pre-rebase originals.
    mockDivergence('5\t3');

    const result = getTrackingDivergence();

    expect(result).toEqual({ ahead: 5, behind: 3 });
  });

  it('should handle whitespace in git output', () => {
    vi.mocked(gitExecutor.executeGitCommand)
      .mockReturnValueOnce({
        success: true,
        stdout: '  origin/fix-issue-X  \n\n',
        stderr: '',
        exitCode: 0,
      })
      .mockReturnValueOnce({
        success: true,
        stdout: '  4\t7  \n',
        stderr: '',
        exitCode: 0,
      });

    const result = getTrackingDivergence();

    expect(result).toEqual({ ahead: 4, behind: 7 });
  });

  it('should return null on unexpected git command failure', () => {
    vi.mocked(gitExecutor.executeGitCommand).mockReturnValueOnce({
      success: false,
      stdout: '',
      stderr: 'Not a git repository',
      exitCode: 128,
    });

    const result = getTrackingDivergence();

    expect(result).toBeNull();
  });

  it('should return null when divergence command fails after upstream lookup succeeds', () => {
    vi.mocked(gitExecutor.executeGitCommand)
      .mockReturnValueOnce(UPSTREAM_OK)
      .mockReturnValueOnce({
        success: false,
        stdout: '',
        stderr: 'fatal: bad revision',
        exitCode: 128,
      });

    const result = getTrackingDivergence();

    expect(result).toBeNull();
  });

  it('should return {ahead: 0, behind: 0} when count output is malformed (defensive)', () => {
    mockDivergence('garbage');

    const result = getTrackingDivergence();

    expect(result).toEqual({ ahead: 0, behind: 0 });
  });
});

// Tests below intentionally call the deprecated wrapper to verify back-compat semantics.
/* eslint-disable sonarjs/deprecation */
describe('isCurrentBranchBehindTracking (backwards-compat wrapper)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return null when there is no upstream', () => {
    vi.mocked(gitExecutor.executeGitCommand).mockReturnValueOnce({
      success: false,
      stdout: '',
      stderr: 'fatal: no upstream configured for branch',
      exitCode: 128,
    });

    expect(isCurrentBranchBehindTracking()).toBeNull();
  });

  it('should return 0 when up to date', () => {
    mockDivergence('0\t0');

    expect(isCurrentBranchBehindTracking()).toBe(0);
  });

  it('should return the behind count when purely behind', () => {
    mockDivergence('0\t3');

    expect(isCurrentBranchBehindTracking()).toBe(3);
  });

  it('should return the behind count even when also ahead (diverged)', () => {
    // Wrapper preserves legacy semantics: only reports behind count.
    // Callers that need to distinguish diverged from purely-behind should
    // migrate to getTrackingDivergence().
    mockDivergence('5\t3');

    expect(isCurrentBranchBehindTracking()).toBe(3);
  });

  it('should return 0 when ahead only', () => {
    mockDivergence('2\t0');

    expect(isCurrentBranchBehindTracking()).toBe(0);
  });
});
/* eslint-enable sonarjs/deprecation */

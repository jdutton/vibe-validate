/**
 * Tests for cached validation result display
 *
 * Only a pass is ever served from cache, so displayCachedResult always reports
 * one. It names the level the stored pass ran at, and says which requested
 * level it covers when a later level's pass answers an earlier request.
 */

import type { ValidationRun } from '@vibe-validate/history';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { displayCachedResult } from '../../src/utils/display-cached-result.js';

const TREE_HASH = 'e9cc190d18d6c66939c9a11a390472b3251521ff';
const TIMESTAMP = '2026-08-12T14:03:11Z';

/**
 * Build a cached passing run for display tests
 */
function createCachedRun(level: string, withPhases = true): ValidationRun {
  return {
    id: 'run-1',
    timestamp: TIMESTAMP,
    duration: 29_700,
    passed: true,
    level,
    branch: 'feat/stray-files',
    headCommit: 'abc123',
    uncommittedChanges: true,
    result: {
      passed: true,
      timestamp: TIMESTAMP,
      level,
      summary: 'All checks passed',
      ...(withPhases
        ? {
            phases: [
              {
                name: 'Pre-Qualification',
                passed: true,
                steps: [
                  { name: 'Repository Structure Validation', passed: true, command: 'pnpm structure' },
                  { name: 'Lint', passed: true, command: 'pnpm lint' },
                ],
              },
            ],
          }
        : {}),
    },
  } as ValidationRun;
}

/**
 * Render displayCachedResult (stdout)
 */
function render(run: ValidationRun, requestedLevel: string): string {
  const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
  try {
    displayCachedResult(run, TREE_HASH, requestedLevel);
    return spy.mock.calls.map((call) => call.join(' ')).join('\n');
  } finally {
    spy.mockRestore();
  }
}

describe('displayCachedResult', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reports the pass with truncated tree hash, branch, timestamp and step counts', () => {
    const output = render(createCachedRun('full'), 'full');

    expect(output).toContain('Validation passed for this code');
    expect(output).toContain('e9cc190d18d6...');
    expect(output).not.toContain(TREE_HASH);
    expect(output).toContain(TIMESTAMP);
    expect(output).toContain('feat/stray-files');
    expect(output).toContain('Phases: 1, Steps: 2 (29.7s)');
  });

  it('names the level without a covers note when it is the requested level', () => {
    const output = render(createCachedRun('full'), 'full');

    expect(output).toContain('Level: full');
    expect(output).not.toContain('covers');
  });

  it('says which requested level a later level\'s pass covers', () => {
    const output = render(createCachedRun('full'), 'commit');

    expect(output).toContain('Level: full (covers commit)');
  });

  it('falls back to the duration when the stored result has no phases', () => {
    const output = render(createCachedRun('full', false), 'full');

    expect(output).toContain('Duration: 29.7s');
    expect(output).not.toContain('Phases:');
  });

  it('never carries replayed-failure wording', () => {
    const output = render(createCachedRun('full'), 'full');

    expect(output).not.toContain('Replayed');
    expect(output).not.toContain('not re-run');
    expect(output).not.toContain('failed');
  });
});

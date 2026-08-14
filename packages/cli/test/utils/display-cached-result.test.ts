/**
 * Tests for cached validation result display
 *
 * Covers issue #169: a replayed FAILURE must disclose that it was not re-run,
 * and must point at the escape hatch for the one case the cache key cannot see
 * (gitignored working-tree state).
 */

import type { ValidationRun } from '@vibe-validate/history';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  displayCachedResult,
  displayCachedFailureHint,
} from '../../src/utils/display-cached-result.js';

const TREE_HASH = 'e9cc190d18d6c66939c9a11a390472b3251521ff';
const TIMESTAMP = '2026-08-12T14:03:11Z';

/**
 * Build a cached validation run for display tests
 */
function createCachedRun(passed: boolean): ValidationRun {
  return {
    id: 'run-1',
    timestamp: TIMESTAMP,
    duration: 29_700,
    passed,
    branch: 'feat/stray-files',
    headCommit: 'abc123',
    uncommittedChanges: true,
    result: {
      passed,
      timestamp: TIMESTAMP,
      summary: passed ? 'All checks passed' : 'Repository Structure Validation failed',
      phases: [
        {
          name: 'Pre-Qualification',
          passed,
          steps: [{ name: 'Repository Structure Validation', passed, command: 'pnpm structure' }],
        },
      ],
    },
  } as ValidationRun;
}

/**
 * Capture everything written to the given console method during fn()
 */
function captureConsole(method: 'log' | 'error', fn: () => void): string {
  const spy = vi.spyOn(console, method).mockImplementation(() => {});
  try {
    fn();
    return spy.mock.calls.map((call) => call.join(' ')).join('\n');
  } finally {
    spy.mockRestore();
  }
}

/**
 * Render displayCachedResult (stdout) for a pass or fail
 */
function renderCachedResult(passed: boolean): string {
  return captureConsole('log', () => {
    displayCachedResult(createCachedRun(passed), TREE_HASH);
  });
}

/**
 * Render displayCachedFailureHint (stderr, alongside the failure footer)
 */
function renderFailureHint(): string {
  return captureConsole('error', () => {
    displayCachedFailureHint();
  });
}

describe('displayCachedResult', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('cached failure', () => {
    it('should disclose that the result was replayed, not re-run', () => {
      const output = renderCachedResult(false);

      expect(output).toContain('Replayed from');
      expect(output).toContain(TIMESTAMP);
      expect(output).toContain('not re-run just now');
    });

    it('should still show status, tree hash, and step counts', () => {
      const output = renderCachedResult(false);

      expect(output).toContain('Validation failed for this code');
      expect(output).toContain('e9cc190d18d6');
      expect(output).toContain('feat/stray-files');
      expect(output).toContain('Phases: 1, Steps: 1');
    });
  });

  describe('cached pass', () => {
    it('should not add replay disclosure noise to the happy path', () => {
      const output = renderCachedResult(true);

      expect(output).toContain('Validation passed for this code');
      expect(output).not.toContain('not re-run just now');
      expect(output).not.toContain('Replayed from');
    });

    it('should still report when the cached pass was validated', () => {
      const output = renderCachedResult(true);

      expect(output).toContain(TIMESTAMP);
      expect(output).toContain('feat/stray-files');
    });
  });
});

describe('displayCachedFailureHint', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should state what the cache key covers and that gitignored paths are excluded', () => {
    const output = renderFailureHint();

    expect(output).toContain('tracked + untracked');
    expect(output).toContain('.gitignore');
    expect(output).toContain('excluded');
  });

  it('should name the narrow precondition rather than casting doubt on the cache', () => {
    const output = renderFailureHint();

    // Must scope the advice to state the key genuinely cannot see...
    expect(output).toContain('ignored path');
    // ...and must NOT imply caching is generally unreliable (issue #169 review note)
    expect(output).not.toMatch(/cache (may|might|could) be (stale|wrong|bad)/i);
  });

  it('should give the escape hatch command', () => {
    const output = renderFailureHint();

    expect(output).toContain('validate --force');
  });
});

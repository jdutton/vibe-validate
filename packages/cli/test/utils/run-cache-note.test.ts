/**
 * Tests for reading a `vv run` cache note back as a result
 */

import { describe, it, expect } from 'vitest';
import { stringify } from 'yaml';

import { parseRunCacheNote } from '../../src/utils/run-cache-note.js';

const NOTE = {
  treeHash: 'abc123',
  command: 'npm test',
  workdir: '',
  timestamp: '2026-11-01T00:00:00Z',
  durationSecs: 2,
  extraction: { errors: [], summary: 'ok', totalErrors: 0 },
};

describe('parseRunCacheNote', () => {
  it('a passing note is a cache hit, marked as cached', () => {
    const result = parseRunCacheNote(stringify({ ...NOTE, exitCode: 0 }));

    expect(result).toMatchObject({ command: 'npm test', exitCode: 0, durationSecs: 2, isCachedResult: true });
  });

  it('never replays a failure, whoever wrote the note', () => {
    expect(parseRunCacheNote(stringify({ ...NOTE, exitCode: 1 }))).toBeNull();
  });

  it('reads a pre-0.15 note that recorded duration in milliseconds', () => {
    const legacy: Record<string, unknown> = { ...NOTE, exitCode: 0, duration: 3000 };
    delete legacy.durationSecs;
    const result = parseRunCacheNote(stringify(legacy));

    expect(result?.durationSecs).toBe(3);
  });
});

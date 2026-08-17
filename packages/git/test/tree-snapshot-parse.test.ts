/**
 * Unit tests for the `ls-files -s -z` record parser.
 *
 * These are the properties a real-git integration test cannot demonstrate,
 * because git will not produce the hostile inputs: a path containing the record
 * separator's neighbours (tab, newline), a truncated record, a mode that is not
 * six digits. What a wrong answer costs here is specific — a mis-parsed path
 * becomes a cache key pointing at the wrong file — so the parser skips what it
 * cannot read rather than guessing.
 */

import { describe, it, expect } from 'vitest';

import { GIT_MODE_GITLINK, GIT_MODE_SYMLINK, parseStagedEntries } from '../src/tree-snapshot.js';

const OID_A = 'a'.repeat(40);
const OID_B = 'b'.repeat(40);
const OID_SHA256 = 'c'.repeat(64);

/**
 * Build one `ls-files -s` record.
 *
 * @param mode - Six-digit file mode
 * @param oid - Object id
 * @param path - Root-relative path
 * @param stage - Merge stage digit
 * @returns The record, without its NUL terminator
 */
function record(mode: string, oid: string, path: string, stage = '0'): string {
  return `${mode} ${oid} ${stage}\t${path}`;
}

describe('parseStagedEntries', () => {
  it('parses a NUL-separated run of records', () => {
    const out = `${record('100644', OID_A, 'a.md')}\0${record('100755', OID_B, 'dir/b.sh')}\0`;
    expect(parseStagedEntries(out)).toEqual([
      { path: 'a.md', oid: OID_A, mode: '100644' },
      { path: 'dir/b.sh', oid: OID_B, mode: '100755' },
    ]);
  });

  it('returns an empty list for empty output', () => {
    // A repository with nothing in it is a real answer. The caller distinguishes
    // it from "could not ask" by the snapshot being null, not by this.
    expect(parseStagedEntries('')).toEqual([]);
    expect(parseStagedEntries('\0')).toEqual([]);
  });

  it('keeps symlink and gitlink modes so a caller can exclude them', () => {
    const out = [
      record(GIT_MODE_SYMLINK, OID_A, 'link.md'),
      record(GIT_MODE_GITLINK, OID_B, 'vendor/sub'),
    ].join('\0');
    expect(parseStagedEntries(out).map(e => e.mode)).toEqual([GIT_MODE_SYMLINK, GIT_MODE_GITLINK]);
  });

  it('accepts a 64-character SHA-256 object id', () => {
    // Repositories initialised with `--object-format=sha256` produce these.
    const parsed = parseStagedEntries(record('100644', OID_SHA256, 'a.md'));
    expect(parsed[0]?.oid).toBe(OID_SHA256);
  });

  it('keeps a path containing a tab, splitting only on the FIRST one', () => {
    // `-z` is what makes this safe: without it git would quote and escape the
    // path, and the parser would have to unescape. The record's own separator is
    // the first tab, so anything after it — tabs included — is the path.
    const parsed = parseStagedEntries(record('100644', OID_A, 'weird\tname.md'));
    expect(parsed[0]?.path).toBe('weird\tname.md');
  });

  it('keeps a path containing a newline', () => {
    // Legal in a POSIX filename, and the reason the pattern is dot-all: without
    // the `s` flag `.*` stops at the newline and the path silently truncates.
    const parsed = parseStagedEntries(record('100644', OID_A, 'two\nlines.md'));
    expect(parsed[0]?.path).toBe('two\nlines.md');
  });

  it('keeps a non-ASCII path as its own bytes', () => {
    const parsed = parseStagedEntries(record('100644', OID_A, 'docs/naïve—ünïcode.md'));
    expect(parsed[0]?.path).toBe('docs/naïve—ünïcode.md');
  });

  it('parses a merge-conflict stage digit other than 0', () => {
    const parsed = parseStagedEntries(record('100644', OID_A, 'conflict.md', '2'));
    expect(parsed[0]).toEqual({ path: 'conflict.md', oid: OID_A, mode: '100644' });
  });

  it('skips a malformed record instead of guessing at its path', () => {
    // Each of these fails a different part of the pattern. None may become an
    // entry: a wrong path here becomes a cache key naming the wrong file, which
    // is worse than a missing one because nothing downstream can detect it.
    const malformed = [
      'not a record at all',
      `10064 ${OID_A} 0\tshort-mode.md`,          // five-digit mode
      `100644 ${'z'.repeat(40)} 0\tbad-oid.md`,   // non-hex oid
      `100644 ${'a'.repeat(39)} 0\tshort-oid.md`, // 39-character oid
      `100644 ${OID_A} 0 space-not-tab.md`,       // separator is a space
      `100644 ${OID_A}\t0\tno-stage.md`,          // tab where a space belongs
    ].join('\0');
    expect(parseStagedEntries(malformed)).toEqual([]);
  });

  it('keeps the good records around a malformed one', () => {
    // The failure mode being avoided is an early return that drops the tail:
    // one unreadable record must not take the rest of the tree with it.
    const out = [
      record('100644', OID_A, 'before.md'),
      'garbage',
      record('100644', OID_B, 'after.md'),
    ].join('\0');
    expect(parseStagedEntries(out).map(e => e.path)).toEqual(['before.md', 'after.md']);
  });
});

/**
 * Find the index entries whose flags make `git add` trust the index over the
 * working tree.
 *
 * Two flags tell git not to look at a file at all: **assume-unchanged** (set by
 * `update-index --assume-unchanged`, or by `core.ignoreStat`) and
 * **skip-worktree** (set by sparse checkout, or by
 * `update-index --skip-worktree`). `git add --all` skips such an entry, so an
 * edited file keeps its committed object ID in the throwaway index. The caller
 * re-adds these entries unflagged before staging; this module only finds them.
 *
 * Reading the index here, instead of asking `git ls-files -v`, is what keeps
 * the common case free: a repository with no flagged entries costs no extra
 * process at all. The parser follows git's documented on-disk format
 * (`gitformat-index`) and refuses -- returns `null` -- whenever the bytes do
 * not walk cleanly to the trailing checksum, so a layout it does not
 * understand sends the caller to git rather than to a guess.
 *
 * @packageDocumentation
 */

/** `DIRC`, the index file signature. */
const INDEX_SIGNATURE = 0x44_49_52_43;

/** Per-entry stat data before the object ID: ten 32-bit fields. */
const STAT_BYTES = 40;
/** Offset of the 32-bit mode within the stat data. */
const MODE_OFFSET = 24;

/** Entry flags: the assume-unchanged ("assume valid") bit. */
const FLAG_ASSUME_VALID = 0x80_00;
/** Entry flags: a second, extended flags word follows (version 3 and later). */
const FLAG_EXTENDED = 0x40_00;
/** Entry flags: merge stage. Only stage 0 is a plain entry. */
const FLAG_STAGE = 0x30_00;
/** Entry flags: name length, saturating at this value for longer names. */
const FLAG_NAME_LENGTH = 0x0f_ff;
/** Extended flags: the skip-worktree bit. */
const EXTENDED_SKIP_WORKTREE = 0x40_00;

/** Object-type bits of a mode. */
const MODE_TYPE = 0o170_000;
/** A sparse-index directory entry, which stands for a whole subtree. */
const MODE_TYPE_DIRECTORY = 0o040_000;
const KNOWN_MODE_TYPES = new Set([0o100_000, 0o120_000, 0o160_000, MODE_TYPE_DIRECTORY]);

/** SHA-1 and SHA-256 object ID sizes. Which one applies is not in the header. */
const HASH_SIZES = [20, 32] as const;

/** Split-index extension: entries live partly in a shared index file. */
const EXTENSION_LINK = 'link';

/** One entry `git add` would trust instead of reading the file. */
export interface TrustFlaggedEntry {
  /** Root-relative path, as the raw bytes git stored. */
  path: Buffer;
  /** Git file mode, e.g. `0o100644`. */
  mode: number;
  /** Object ID recorded in the index, lowercase hex. */
  oid: string;
  /** Marked assume-unchanged. */
  assumeUnchanged: boolean;
  /** Marked skip-worktree. */
  skipWorktree: boolean;
}

/**
 * Decode git's index varint (version 4 path compression).
 *
 * @param bytes - The index
 * @param start - Offset of the first varint byte
 * @returns The value and the offset after it, or null if it runs off the end
 */
function readVarint(bytes: Buffer, start: number): { value: number; next: number } | null {
  let cursor = start;
  if (cursor >= bytes.length) return null;
  let byte = bytes[cursor++] ?? 0;
  let value = byte & 0x7f;
  while (byte & 0x80) {
    if (cursor >= bytes.length) return null;
    byte = bytes[cursor++] ?? 0;
    value = ((value + 1) * 128) + (byte & 0x7f);
  }
  return { value, next: cursor };
}

/**
 * Walk the extensions after the last entry. They must end exactly where the
 * trailing checksum begins; anything else means the hash size or the entry walk
 * was wrong.
 *
 * @param bytes - The index
 * @param start - Offset just past the last entry
 * @param hashSize - Object ID size being tried
 * @returns The extension signatures, or null if they do not fit
 */
function readExtensionSignatures(bytes: Buffer, start: number, hashSize: number): string[] | null {
  const end = bytes.length - hashSize;
  const signatures: string[] = [];
  let cursor = start;
  while (cursor < end) {
    if (cursor + 8 > end) return null;
    signatures.push(bytes.toString('latin1', cursor, cursor + 4));
    cursor += 8 + bytes.readUInt32BE(cursor + 4);
  }
  return cursor === end ? signatures : null;
}

/** Where one entry ends and what it holds. */
interface ParsedEntry {
  next: number;
  path: Buffer;
  mode: number;
  flags: number;
  extended: number;
  oidStart: number;
}

/**
 * Read one entry at `offset`.
 *
 * @param bytes - The index
 * @param offset - Start of the entry
 * @param version - Index format version (2, 3 or 4)
 * @param hashSize - Object ID size being tried
 * @param previous - The previous entry's path (version 4 compresses against it)
 * @returns The entry, or null if it is malformed under these assumptions
 */
function readEntry(
  bytes: Buffer,
  offset: number,
  version: number,
  hashSize: number,
  previous: Buffer,
): ParsedEntry | null {
  const flagsAt = offset + STAT_BYTES + hashSize;
  if (flagsAt + 2 > bytes.length) return null;
  const mode = bytes.readUInt32BE(offset + MODE_OFFSET);
  const flags = bytes.readUInt16BE(flagsAt);
  let cursor = flagsAt + 2;
  let extended = 0;
  if (flags & FLAG_EXTENDED) {
    if (version < 3 || cursor + 2 > bytes.length) return null;
    extended = bytes.readUInt16BE(cursor);
    cursor += 2;
  }

  const name = version === 4 ? readCompressedPath(bytes, cursor, previous) : readPaddedPath(bytes, offset, cursor);
  if (name === null) return null;
  if ((flags & FLAG_NAME_LENGTH) !== Math.min(name.path.length, FLAG_NAME_LENGTH)) return null;
  if (!KNOWN_MODE_TYPES.has(mode & MODE_TYPE)) return null;
  return { next: name.next, path: name.path, mode, flags, extended, oidStart: offset + STAT_BYTES };
}

/** A decoded entry path and the offset after the entry. */
interface EntryPath {
  path: Buffer;
  next: number;
}

/**
 * Version 4: a varint count of bytes to drop from the previous path, then the
 * NUL-terminated suffix to append. No padding.
 *
 * @param bytes - The index
 * @param cursor - Offset of the varint
 * @param previous - The previous entry's full path
 * @returns The path and the next entry's offset, or null if malformed
 */
function readCompressedPath(bytes: Buffer, cursor: number, previous: Buffer): EntryPath | null {
  const strip = readVarint(bytes, cursor);
  if (strip === null || strip.value > previous.length) return null;
  const nul = bytes.indexOf(0, strip.next);
  if (nul < 0) return null;
  const path = Buffer.concat([previous.subarray(0, previous.length - strip.value), bytes.subarray(strip.next, nul)]);
  return { path, next: nul + 1 };
}

/**
 * Versions 2 and 3: the full path, then 1-8 NULs padding the entry to a
 * multiple of 8 bytes. The padding is checked, which is what makes a wrong
 * object ID size fail fast.
 *
 * @param bytes - The index
 * @param offset - Start of the entry
 * @param cursor - Offset of the path
 * @returns The path and the next entry's offset, or null if malformed
 */
function readPaddedPath(bytes: Buffer, offset: number, cursor: number): EntryPath | null {
  const nul = bytes.indexOf(0, cursor);
  if (nul < 0) return null;
  const path = bytes.subarray(cursor, nul);
  const next = offset + ((cursor - offset + path.length + 8) & ~7);
  if (next > bytes.length || bytes.subarray(nul, next).some(b => b !== 0)) return null;
  return { path, next };
}

/**
 * Walk every entry assuming one object ID size.
 *
 * @param bytes - The index
 * @param version - Index format version
 * @param count - Entry count from the header
 * @param hashSize - Object ID size being tried
 * @returns The flagged entries, or null if the walk does not fit
 */
function walkIndex(bytes: Buffer, version: number, count: number, hashSize: number): TrustFlaggedEntry[] | null {
  const flagged: TrustFlaggedEntry[] = [];
  let offset = 12;
  let previous: Buffer = Buffer.alloc(0);
  for (let i = 0; i < count; i++) {
    const entry = readEntry(bytes, offset, version, hashSize, previous);
    if (entry === null) return null;
    const assumeUnchanged = (entry.flags & FLAG_ASSUME_VALID) !== 0;
    const skipWorktree = (entry.extended & EXTENDED_SKIP_WORKTREE) !== 0;
    // A sparse-index directory entry stands for a whole subtree and must stay
    // collapsed; a conflicted (non-zero stage) entry is resolved by `add`.
    const plainFile = (entry.mode & MODE_TYPE) !== MODE_TYPE_DIRECTORY && (entry.flags & FLAG_STAGE) === 0;
    if ((assumeUnchanged || skipWorktree) && plainFile) {
      flagged.push({
        path: Buffer.from(entry.path),
        mode: entry.mode,
        oid: bytes.toString('hex', entry.oidStart, entry.oidStart + hashSize),
        assumeUnchanged,
        skipWorktree,
      });
    }
    previous = entry.path;
    offset = entry.next;
  }

  const extensions = readExtensionSignatures(bytes, offset, hashSize);
  // A split index keeps most entries in a separate shared file, which this
  // walk never saw: report "cannot tell" rather than "nothing flagged".
  if (extensions === null || extensions.includes(EXTENSION_LINK)) return null;
  return flagged;
}

/**
 * List the entries `git add` would trust instead of reading the file.
 *
 * @param index - The bytes of an index file
 * @returns The flagged entries (empty when there are none), or `null` when the
 *   bytes are not an index this parser can read completely -- the caller must
 *   then ask git
 */
export function findTrustFlaggedEntries(index: Buffer): TrustFlaggedEntry[] | null {
  if (index.length < 12 || index.readUInt32BE(0) !== INDEX_SIGNATURE) return null;
  const version = index.readUInt32BE(4);
  if (version < 2 || version > 4) return null;
  const count = index.readUInt32BE(8);
  for (const hashSize of HASH_SIZES) {
    const flagged = walkIndex(index, version, count, hashSize);
    if (flagged !== null) return flagged;
  }
  return null;
}

# @vibe-validate/git

Git utilities for vibe-validate - deterministic tree hash calculation, branch synchronization, and post-merge cleanup.

## Features

- **Deterministic Git Tree Hash with Automatic Work Protection**: Content-based hashing using `git write-tree` (no timestamps) - automatically creates recoverable snapshots of all files
- **Branch Sync Checking**: Safe branch synchronization verification without auto-merging
- **Post-Merge Cleanup**: Automated cleanup of merged branches after PR completion

## Installation

```bash
npm install @vibe-validate/git
```

## Usage

### Git Tree Hash (Deterministic)

Calculate a content-based hash of the working tree including staged, unstaged, and untracked files:

```typescript
import { getGitTreeHash } from '@vibe-validate/git';

const treeHash = await getGitTreeHash();
console.log(`Tree hash: ${treeHash}`);
// Deterministic - same content = same hash (no timestamp variance)
```

### Branch Sync Checking

Check if the current branch is behind origin/main without auto-merging:

```typescript
import { BranchSyncChecker } from '@vibe-validate/git';

const checker = new BranchSyncChecker();
const result = await checker.checkSync();

if (!result.isUpToDate) {
  console.log(`Branch is ${result.behindBy} commits behind origin/main`);
  console.log('Manual merge required');
}
```

### Post-Merge Cleanup

Clean up local branches after PR merge:

```typescript
import { PostPRMergeCleanup } from '@vibe-validate/git';

const cleanup = new PostPRMergeCleanup();
const result = await cleanup.runCleanup();

console.log(`Deleted ${result.branchesDeleted.length} merged branches`);
```

## API Reference

### `getGitTreeHash()`

Returns a deterministic content-based hash of the working tree.

**Implementation Details:**
- Runs `git add --all` against a temporary copy of the index, so your real
  `.git/index` is never modified and nothing needs restoring afterwards
- Uses `git write-tree` for content-based hashing (no timestamps)
- Covers tracked and untracked files, but **not ignored paths** (`.gitignore`,
  `.git/info/exclude`, or your global excludes file)

**Returns:** `TreeHashResult` — the tree hash plus `submoduleHashes`, synchronously.

### `getGitTreeSnapshot({ cwd })`

The same tree hash, plus the per-path detail behind it, for a repository you
name rather than the one the process happens to be standing in. Use it to key
work off individual files.

```typescript
import { getGitTreeSnapshot, GIT_MODE_SYMLINK } from '@vibe-validate/git';

const snapshot = getGitTreeSnapshot({ cwd: projectRoot });
// { hash, entries: [{ path: 'src/a.ts', oid: '…', mode: '100644' }, …] }
```

- Returns `null` when git could not answer. That is **not** the same as an empty
  `entries`, which is a real answer for an initialized repository with no files.
- Paths are spelled from the **repository root**, and cover the whole
  repository — not just the subtree you named.
- `oid` is the blob OID of the bytes on disk *as git would store them*: under
  line-ending normalization or a clean filter (git-lfs) it will not match a hash
  you compute yourself from the file.
- `hash` does **not** cover submodule content. Editing a file inside a submodule
  leaves it unchanged.
- Skip `mode === GIT_MODE_SYMLINK` if you resolve entries to file contents — a
  symlink's blob is its target string.

⚠️ **It writes to the repository you point it at.** See "Storage and side
effects" below. Point it only at repositories you would `git add` in by hand.

**Returns:** `GitTreeSnapshot | null`

### `BranchSyncChecker`

Class for checking branch synchronization status.

**Methods:**
- `checkSync()`: Check if current branch is behind origin/main
- `printStatus(result)`: Display formatted status information
- `getExitCode(result)`: Get appropriate exit code (0=ok, 1=needs merge, 2=error)

### `PostPRMergeCleanup`

Class for post-merge cleanup operations.

**Methods:**
- `runCleanup()`: Execute complete cleanup workflow
  1. Switch to main branch
  2. Sync main with origin/main
  3. Delete merged branches
  4. Prune remote references

## Design Decisions

### Deterministic Git Tree Hash

**Problem**: `git stash create` includes timestamps, making hashes non-deterministic.

**Solution**: Use `git write-tree` against a temporary index:

```bash
# Old approach (non-deterministic - includes timestamps)
git stash create            # Different hash on each run even with same content

# New approach (deterministic - content-based only)
cp .git/index "$GIT_DIR/vibe-validate-temp-index-$$"
export GIT_INDEX_FILE="$GIT_DIR/vibe-validate-temp-index-$$"
git add --all               # Tracked edits + untracked files
git write-tree              # Content-based hash (no timestamps)
```

`--all` is deliberate: `--intent-to-add` records empty placeholders that
`git write-tree` skips, which would drop unstaged modifications from the hash.

**Benefits:**
- Same content always produces same hash
- Enables reliable validation state caching
- Covers tracked and untracked files (ignored paths are excluded by design)
- Your real `.git/index`, HEAD, refs and working tree are never written
- Automatic work protection (hashed files stored as git objects)
- Recoverable snapshots of uncommitted work

### Safe Branch Sync

**Philosophy**: Never auto-merge. Always require manual conflict resolution.

**Why:**
- Preserves visibility of conflicts
- Prevents accidental code overwrites
- Explicit developer control over merges

### Post-Merge Cleanup

**Safety Features:**
- Only deletes branches confirmed merged into main
- Never deletes main branch
- Provides clear feedback on all operations

## Automatic Work Protection

A valuable side benefit of the deterministic tree hash calculation is automatic work protection.

### Technical Implementation

When `getGitTreeHash()` runs, it:
1. Creates temporary index: `.git/vibe-validate-temp-index-<pid>`
2. Copies current index to temp index
3. Runs `git add --all` in temp index (stages everything)
4. Runs `git write-tree` (creates git objects for all files)
5. Deletes temp index (your real index remains untouched)

**Critical insight**: Step 4 creates permanent git objects in `.git/objects/` for every file, even though the temp index is deleted. These objects remain accessible via the tree hash.

### What Gets Protected

Every file in your working directory (respecting .gitignore):
- ✅ Staged changes (in git index)
- ✅ Unstaged modifications (tracked files)
- ✅ Untracked files (new files not yet added)

**Not protected** (by design):
- ❌ Files in .gitignore (secrets, credentials, build artifacts)

### Storage and side effects

Git's content-addressable storage deduplicates identical content, so a file that
has not changed between validations costs nothing to re-hash. **New or modified
content does cost something**: each `write-tree` pass writes loose objects into
`.git/objects` for content git has not already stored. They are unreferenced and
`git gc` reclaims them, but the directory grows until it runs. That is the same
trade that makes the recovery examples above possible — the objects are the
snapshot.

Two further effects worth knowing before pointing `getGitTreeSnapshot` at a
repository you did not create:

- `git add --all` runs that repository's configured `filter.*.clean` filters and
  its `post-index-change` hook, as the calling user, honouring `core.hooksPath`.
- Under `core.splitIndex` it writes a `.git/sharedindex.<sha>` into the real git
  directory, which `gc` does not reclaim on the object path.

### Recovery Examples

```bash
# Scenario: Accidentally deleted file that was never committed
$ echo "Important work" > new-feature.ts
$ vv validate  # Tree hash: abc123...
$ rm new-feature.ts  # Oops!

# Recovery:
$ git cat-file -p abc123def:new-feature.ts > new-feature.ts

# Scenario: Want to see file content from 2 hours ago
$ vv history list
2025-12-02 14:30:15  abc123...  # 2 hours ago
2025-12-02 16:45:22  def456...  # Current

$ git cat-file -p abc123def:src/feature.ts  # View old version
```

See [Work Protection Guide](../../docs/work-protection.md) for more examples.

## License

MIT

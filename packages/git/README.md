# @vibe-validate/git

Git utilities for vibe-validate - deterministic tree hash calculation, branch synchronization, and post-merge cleanup.

## Features

- **Deterministic Git Tree Hash**: Content-based hashing using `git write-tree` (no timestamps)
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
- Uses `git add --intent-to-add .` to mark untracked files (without staging)
- Uses `git write-tree` for content-based hashing (no timestamps)
- Resets index after hash calculation
- Falls back to `HEAD^{tree}` if no changes exist

**Returns:** `Promise<string>` - Git tree SHA-1 hash

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

**Solution**: Use `git write-tree` with intent-to-add for untracked files:

```typescript
// Old approach (non-deterministic - includes timestamps)
git stash create  // Different hash on each run even with same content

// New approach (deterministic - content-based only)
git add --intent-to-add .  // Mark untracked files (no staging)
git write-tree              // Content-based hash (no timestamps)
git reset                   // Restore index to clean state
```

**Benefits:**
- Same content always produces same hash
- Enables reliable validation state caching
- Includes all files (staged, unstaged, untracked)
- No side effects (index restored after hash)

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

## License

MIT

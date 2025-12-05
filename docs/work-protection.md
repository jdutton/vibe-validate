# Automatic Work Protection

## Overview

Every time you run vibe-validate, you're automatically creating a recoverable snapshot of ALL your files - no user action required. This invisible safety net protects you from accidental file loss, bad refactoring decisions, and editor crashes.

**Key Benefits:**
- **Automatic**: No manual steps - protection happens during normal validation
- **Comprehensive**: Captures staged, unstaged, AND untracked files
- **Zero overhead**: Git deduplicates identical content automatically
- **Simple recovery**: Standard git commands - no proprietary tools
- **Historical timeline**: Every validation creates a timestamped snapshot
- **Complements git**: Safety net for uncommitted work alongside git commits

## How It Works

### Technical Explanation

When vibe-validate calculates the git tree hash for caching, it uses a temporary git index to create git objects for every file in your working directory:

```bash
# 1. Create temporary index
TEMP_INDEX=".git/vibe-validate-temp-index"

# 2. Copy current index to temp index
cp .git/index "$TEMP_INDEX"

# 3. Stage ALL files in temp index (respecting .gitignore)
GIT_INDEX_FILE="$TEMP_INDEX" git add --all

# 4. Calculate tree hash (CREATES GIT OBJECTS!)
TREE_HASH=$(GIT_INDEX_FILE="$TEMP_INDEX" git write-tree)

# 5. Clean up temp index
rm "$TEMP_INDEX"
```

**Critical insight**: Step 4 creates permanent git objects in `.git/objects/` for every file, even though the temp index is immediately deleted. These objects remain accessible via the tree hash.

### What Gets Protected

✅ **Protected** (captured in tree hash):
- Tracked files with staged changes
- Tracked files with unstaged modifications
- Untracked files (new files you just created)
- All file content in your working directory

❌ **Not protected** (security by design):
- Files in `.gitignore` (secrets, API keys, credentials, .env files)
- Build artifacts (dist/, node_modules/, target/)
- Temporary files (*.tmp, *.swp, *.bak)
- System files (.DS_Store)

### Storage Overhead

**Zero additional overhead**: Git's content-addressable storage automatically deduplicates identical file content. If a file hasn't changed between validations, no additional storage is used.

```bash
# First validation: 1000 files stored
$ vv validate

# Second validation with same content: 0 new files stored
$ vv validate

# Third validation with 3 changed files: Only 3 files stored
$ vv validate
```

Git's deduplication is at the file level - only modified files consume additional disk space.

## Real-World Recovery Scenarios

### Scenario 1: Accidental Git Restore

**Problem**: You accidentally reverted all your unstaged changes with `git restore .`

```bash
# You've been coding for 3 hours (unstaged changes)
$ cat src/feature.ts
"export function brilliantFeature() {
  // 3 hours of work...
}"

# You accidentally revert everything
$ git restore .

# Your unstaged work is gone from the file system!
$ cat src/feature.ts
"// Old placeholder function"
```

**Solution**: Recover from last validation

```bash
# Find your last validation
$ vv history list --limit 1
2025-12-02 14:30:15  abc123def456  feature-branch  ✓ PASSED

# View the file content from that validation
$ git cat-file -p abc123def456:src/feature.ts
"export function brilliantFeature() {
  // 3 hours of work...
}"

# Recover your work
$ git cat-file -p abc123def456:src/feature.ts > src/feature.ts

# Work restored!
$ cat src/feature.ts
"export function brilliantFeature() {
  // 3 hours of work...
}"
```

### Scenario 2: Bad Find/Replace Operation

**Problem**: You ran a project-wide find/replace that corrupted files, and didn't realize until after more editing

```bash
# You run a find/replace that goes wrong
# Continue editing for 30 minutes before noticing

# Check recent validation history
$ vv history list --limit 5
2025-12-02 15:45:10  xyz789abc123  feature-branch  ✓ PASSED  # After bad replace
2025-12-02 15:10:22  def456ghi789  feature-branch  ✓ PASSED  # Before bad replace
2025-12-02 14:50:10  jkl012mno345  feature-branch  ✓ PASSED
```

**Solution**: Compare and restore from before the bad replace

```bash
# Compare what changed between validations
$ git diff def456ghi789 xyz789abc123 -- src/

# View specific file from before bad replace
$ git cat-file -p def456ghi789:src/broken.ts

# Restore affected files
$ git cat-file -p def456ghi789:src/broken.ts > src/broken.ts

# Or restore entire directory
$ git checkout def456ghi789 -- src/components/
```

### Scenario 3: Editor Crash Before Save

**Problem**: Your editor crashes before you saved your work, and files revert to last saved state

```bash
# Your editor crashes
# Files revert to last saved state
# In-progress work is lost

# But if you ran validation during your work session:
$ vv history list --limit 3
2025-12-02 14:15:30  ghi789jkl012  feature-branch  ✓ PASSED  # 15 mins ago
2025-12-02 13:45:10  mno345pqr678  feature-branch  ✓ PASSED
```

**Solution**: Recover from most recent validation

```bash
# Your in-progress work is in that tree hash
$ git cat-file -p ghi789jkl012:src/new-feature.ts
"function newFeature() {
  // Work that wasn't saved
}"

# Recover the file
$ git cat-file -p ghi789jkl012:src/new-feature.ts > src/new-feature.ts
```

### Scenario 4: Accidental File Deletion

**Problem**: You deleted a file that wasn't committed yet

```bash
# You created a new file (untracked)
$ echo "export const config = { ... }" > src/config.ts

# You ran validation
$ vv validate
# Tree hash: pqr678stu901

# Later, you accidentally delete it
$ rm src/config.ts

# File is gone, and it was never committed!
```

**Solution**: Recover untracked file from validation

```bash
# Find validation that contains the file
$ vv history list
2025-12-02 16:20:30  pqr678stu901  feature-branch  ✓ PASSED

# Verify the file exists in that tree
$ git ls-tree pqr678stu901 | grep config.ts
100644 blob 7a3b9c2d  src/config.ts

# Recover the file
$ git cat-file -p pqr678stu901:src/config.ts > src/config.ts
```

### Scenario 5: Bad Merge or Rebase

**Problem**: A merge or rebase went wrong and you want to recover the pre-merge state

```bash
# Before merge, you had working code
$ vv validate
# Tree hash: abc123def456

# You attempt a merge
$ git merge feature-x

# Merge creates conflicts and breaks things
# You resolve conflicts but code no longer works

# You want to go back to pre-merge state
```

**Solution**: Restore from pre-merge validation

```bash
# Find pre-merge validation
$ vv history list --limit 10
2025-12-02 15:30:00  abc123def456  main  ✓ PASSED  # Before merge
2025-12-02 16:15:45  xyz789abc123  main  ✗ FAILED  # After merge

# Compare what changed
$ git diff abc123def456 xyz789abc123

# Restore specific broken files from before merge
$ git checkout abc123def456 -- src/module.ts

# Or restore entire codebase to pre-merge state
$ git checkout abc123def456 -- .
```

### Scenario 6: Experimental Refactoring Went Wrong

**Problem**: You tried a large refactoring and want to compare or revert

```bash
# Before refactoring
$ vv validate
# Tree hash: def456ghi789

# You spend 2 hours refactoring
# Tests start failing

# You want to see what you changed
```

**Solution**: Compare with pre-refactoring snapshot

```bash
# Current state vs pre-refactoring
$ git diff def456ghi789 HEAD

# View specific file before refactoring
$ git cat-file -p def456ghi789:src/refactored-module.ts

# Selectively restore parts that worked
$ git checkout def456ghi789 -- src/working-module.ts

# Or start over completely
$ git checkout def456ghi789 -- src/
```

### Scenario 7: Recovering Deleted Test File

**Problem**: You deleted a test file thinking it was obsolete, but it contained important test cases

```bash
# You delete what you think is an obsolete test
$ rm test/important-tests.test.ts

# Later realize it had critical test cases
# File was never committed
```

**Solution**: Find in validation history

```bash
# List recent validations
$ vv history list

# Search for the file in recent tree hashes
$ git ls-tree abc123def456 | grep important-tests
100644 blob 9f2e4d7a  test/important-tests.test.ts

# Recover the test file
$ git cat-file -p abc123def456:test/important-tests.test.ts > test/important-tests.test.ts
```

### Scenario 8: Recovering Work After Hard Reset

**Problem**: You ran `git reset --hard` and lost uncommitted work

```bash
# You have uncommitted changes
$ git status
modified: src/feature.ts
modified: src/utils.ts

# You accidentally run hard reset
$ git reset --hard HEAD

# All uncommitted work is gone
```

**Solution**: Recover from last validation

```bash
# Find most recent validation
$ vv history list --limit 1
2025-12-02 14:45:30  ghi789jkl012  feature-branch  ✓ PASSED

# Check what was uncommitted at that time
$ vv history show ghi789jkl012 --yaml | grep uncommittedChanges
uncommittedChanges: true

# Recover the lost files
$ git cat-file -p ghi789jkl012:src/feature.ts > src/feature.ts
$ git cat-file -p ghi789jkl012:src/utils.ts > src/utils.ts
```

### Scenario 9: Finding Code from Yesterday

**Problem**: You want to see what your code looked like yesterday afternoon

```bash
# Check validation history from yesterday
$ vv history list | grep "2025-12-01"
2025-12-01 14:30:15  abc123def456  feature-branch  ✓ PASSED
2025-12-01 16:45:22  def456ghi789  feature-branch  ✓ PASSED
```

**Solution**: View code from specific time

```bash
# View file from yesterday afternoon
$ git cat-file -p def456ghi789:src/module.ts

# Compare yesterday vs today
$ git diff def456ghi789:src/module.ts src/module.ts

# Export yesterday's version for reference
$ git cat-file -p def456ghi789:src/module.ts > /tmp/module-yesterday.ts
```

### Scenario 10: Team Member Sharing Code State

**Problem**: A team member asks "can you show me the exact code when that bug appeared?"

```bash
# Find validation when bug was introduced
$ vv history list
2025-12-02 10:30:00  jkl012mno345  bugfix-branch  ✓ PASSED  # Bug present
2025-12-02 09:15:00  mno345pqr678  bugfix-branch  ✓ PASSED  # Before bug
```

**Solution**: Share tree hash for exact reproduction

```bash
# Share tree hash with team member
"The bug appears in tree hash jkl012mno345"

# Team member can view exact code state
$ git cat-file -p jkl012mno345:src/buggy-file.ts

# Or create a branch from that exact state
$ git checkout -b investigate-bug jkl012mno345

# Now both have identical code for debugging
```

## Recovery Command Cookbook

### Viewing Available Snapshots

```bash
# List all validation snapshots
vv history list

# List with more details (YAML format)
vv history list --yaml

# Limit to recent snapshots
vv history list --limit 10

# Filter by branch
vv history list | grep "feature-branch"

# Filter by date
vv history list | grep "2025-12-01"
```

### Viewing Files in a Snapshot

```bash
# List all files in a tree hash
git ls-tree -r <tree-hash>

# List specific directory
git ls-tree -r <tree-hash> src/

# List with file sizes
git ls-tree -r -l <tree-hash>

# Search for specific file
git ls-tree -r <tree-hash> | grep "filename"
```

### Viewing File Content

```bash
# View specific file
git cat-file -p <tree-hash>:path/to/file.ts

# View with syntax highlighting (if bat installed)
git cat-file -p <tree-hash>:path/to/file.ts | bat -l typescript

# Save to temporary file for viewing
git cat-file -p <tree-hash>:path/to/file.ts > /tmp/old-version.ts

# View in default editor
git cat-file -p <tree-hash>:path/to/file.ts | code -
```

### Recovering Individual Files

```bash
# Recover single file (overwrites current)
git cat-file -p <tree-hash>:src/file.ts > src/file.ts

# Recover with backup of current
mv src/file.ts src/file.ts.backup
git cat-file -p <tree-hash>:src/file.ts > src/file.ts

# Recover to different location
git cat-file -p <tree-hash>:src/file.ts > /tmp/recovered-file.ts

# Recover multiple files
for file in src/a.ts src/b.ts src/c.ts; do
  git cat-file -p <tree-hash>:$file > $file
done
```

### Recovering Entire Directories

```bash
# Recover entire directory
git checkout <tree-hash> -- src/

# Recover multiple directories
git checkout <tree-hash> -- src/ test/ docs/

# Recover with confirmation
git checkout <tree-hash> -- src/
git status  # Review what changed
```

### Comparing Snapshots

```bash
# Compare two tree hashes
git diff <old-tree-hash> <new-tree-hash>

# Compare specific file between snapshots
git diff <old-tree-hash>:<file> <new-tree-hash>:<file>

# Show only changed files
git diff --name-status <old-tree-hash> <new-tree-hash>

# Compare tree vs working directory
git diff <tree-hash> HEAD

# Compare tree vs working directory (unstaged changes)
git diff <tree-hash>
```

### Advanced Recovery

```bash
# Create branch from tree hash (for exploration)
git checkout -b explore-old-code <tree-hash>

# Create patch from tree hash
git diff <tree-hash> HEAD > changes.patch

# Apply selective changes from old tree
git checkout <tree-hash> -- src/specific-file.ts

# Merge changes from old tree
git merge --no-commit <tree-hash>
```

## Comparison to Git Tools

### vs. git stash

| Feature | vibe-validate | git stash |
|---------|---------------|-----------|
| **User action required** | ❌ Automatic | ✅ Manual (`git stash`) |
| **When it runs** | Every validation | Only when you remember |
| **Captures unstaged changes** | ✅ Yes | ✅ Yes |
| **Captures untracked files** | ✅ Always | ⚠️ Only with `-u` flag |
| **Timestamp-indexed** | ✅ Via `vv history list` | ⚠️ Stash stack only |
| **Keeps working directory** | ✅ Yes (non-destructive) | ❌ Clears changes |
| **Tied to validation events** | ✅ Yes | ❌ No |
| **Multiple snapshots per code state** | ✅ Yes (multi-run support) | ❌ No |
| **Easy to find old snapshot** | ✅ Searchable timeline | ⚠️ Stack navigation |

**Summary**: vibe-validate is automatic and non-destructive, while git stash requires manual action and clears your working directory.

### vs. git reflog

| Feature | vibe-validate | git reflog |
|---------|---------------|------------|
| **Tracks uncommitted work** | ✅ Yes | ❌ No (commits only) |
| **Captures untracked files** | ✅ Yes | ❌ No |
| **Content-based lookup** | ✅ Tree hash | ❌ Time-based |
| **Validation-triggered** | ✅ Yes | ❌ No |
| **Requires commits** | ❌ No | ✅ Yes |
| **Shows validation results** | ✅ Yes | ❌ No |

**Summary**: reflog tracks git history, vibe-validate tracks validation history (including uncommitted work).

### vs. Manual Commits

| Feature | vibe-validate | Manual WIP Commits |
|---------|---------------|-------------------|
| **User action required** | ❌ Automatic | ✅ Manual commit |
| **Pollutes git history** | ❌ No | ✅ Yes (needs rebase) |
| **Tied to validation** | ✅ Yes | ❌ No |
| **Requires clean commit message** | ❌ No | ✅ Yes |
| **Can include untracked** | ✅ Yes | ⚠️ Must add first |
| **Easy to clean up** | ✅ Automatic pruning | ❌ Manual rebase |

**Summary**: vibe-validate doesn't pollute git history and requires no manual action.

## Best Practices

### 1. Run Validation Frequently for Safety

```bash
# Run before taking breaks
$ vv validate

# Run after significant changes
$ vv validate

# Run before risky operations
$ vv validate
```

**Why**: Creates automatic checkpoints of your work.

### 2. Check History Before Panic

```bash
# Before assuming work is lost
$ vv history list --limit 5

# Your work is probably in a recent tree hash
```

**Why**: Avoids unnecessary stress - work is often recoverable.

### 3. Use Descriptive Branch Names

```bash
# Good: Easy to find in history
feature/user-authentication
bugfix/memory-leak-in-parser

# Bad: Hard to find later
test
wip
my-branch
```

**Why**: Makes finding relevant snapshots easier in `vv history list`.

### 4. Prune Old History Periodically

```bash
# Check history size
$ vv history list | wc -l

# Prune old snapshots (older than 90 days)
$ vv history prune --older-than 90d
```

**Why**: Keeps .git directory size manageable.

### 5. Understand What's Protected

**Protected automatically**:
- All tracked files (staged or not)
- All untracked files (not in .gitignore)

**NOT protected**:
- Files in .gitignore
- Deleted files (unless captured in previous validation)

### 6. Validate Before Risky Git Operations

```bash
# Before merge/rebase
$ vv validate
$ git merge feature-branch

# Before hard reset
$ vv validate
$ git reset --hard HEAD~5

# Before checkout (if uncommitted changes)
$ vv validate
$ git checkout different-branch
```

**Why**: Creates recovery point before potentially destructive operations.

### 7. Use Tree Hashes for Team Communication

```bash
# Instead of: "Check my code from yesterday afternoon"
# Say: "Check tree hash abc123def456"

$ vv history list | grep "2025-12-01 16:"
2025-12-01 16:45:22  abc123def456  feature  ✓ PASSED
```

**Why**: Provides exact, reproducible code state.

### 8. Combine with Regular Git Commits

**vibe-validate work protection is NOT a replacement for git commits:**
- ✅ Use git commits for intentional snapshots
- ✅ Use vibe-validate for automatic safety net
- ✅ Use both together for maximum safety

## Limitations

### 1. Respects .gitignore

**Limitation**: Files in .gitignore are NOT protected.

**Reason**: Security by design - secrets, credentials, and API keys should never be captured.

**Workaround**: Commit important files that shouldn't be ignored, or remove them from .gitignore.

### 2. Requires Git Repository

**Limitation**: Only works in git repositories.

**Reason**: Relies on git objects for storage.

**Workaround**: Initialize git repo (`git init`) if not already present.

### 3. Limited to Files in Working Directory

**Limitation**: Doesn't protect files outside the repository.

**Reason**: Git tree hash only covers files in the repository.

**Workaround**: Ensure important files are in the repository, not in parent directories.

### 4. Validation Must Complete

**Limitation**: If validation is interrupted (Ctrl+C), tree hash may not be calculated.

**Reason**: Tree hash calculation happens during validation startup.

**Impact**: Run validation to completion for protection to work.

### 5. Pruning Removes Old Snapshots

**Limitation**: `vv history prune` permanently deletes old tree hashes.

**Reason**: Keeps .git directory size manageable.

**Workaround**: Don't prune if you need old snapshots, or export important ones first.

## FAQ

### Q: How much disk space does this use?

**A**: Zero extra space for unchanged files. Git automatically deduplicates identical content. Only modified files consume additional storage.

Example: 1000-file project with 10 validations where only 5 files changed = only 50 extra file copies stored (5 files × 10 validations).

### Q: Can I disable work protection?

**A**: No, it's an inherent side effect of deterministic tree hash calculation (which is required for caching). However, it doesn't cause any harm or overhead.

### Q: Does this push my uncommitted work to GitHub?

**A**: No. Tree hashes are stored locally in `.git/objects/`. They're only pushed if you explicitly push git notes (`git push origin refs/notes/*`).

### Q: What happens if I clone the repository?

**A**: Old validation history isn't cloned by default (git notes aren't auto-fetched). Your tree hash objects remain local unless explicitly shared.

### Q: Can I share snapshots with my team?

**A**: Yes, by sharing the tree hash:

```bash
# Share tree hash
"Check tree hash abc123def456 for the exact code state"

# Team member views code
$ git cat-file -p abc123def456:src/file.ts
```

However, the git objects must be pushed to a shared repository first (rarely needed).

### Q: How long are snapshots kept?

**A**: Forever, unless you explicitly prune them with `vv history prune`. Git objects persist until garbage collection.

### Q: Does this work with large files?

**A**: Yes, but git isn't optimized for large binaries. Consider using Git LFS for large files and keep them in .gitignore.

### Q: Can I recover a file deleted weeks ago?

**A**: Yes, if you ran validation while the file existed. Search history:

```bash
$ vv history list | grep "<date>"
```

Then recover from that tree hash.

### Q: What if I ran `git gc` (garbage collection)?

**A**: Tree hash objects are permanent and won't be garbage collected (they're referenced by git notes).

### Q: Does this slow down validation?

**A**: No. Tree hash calculation takes < 100ms on typical projects. The protection is a free side benefit.

### Q: Can I see what files were untracked at validation time?

**A**: Indirectly. Compare tree hash to HEAD commit:

```bash
$ git diff HEAD <tree-hash> --name-status
```

Files showing as "A" (added) were untracked.

### Q: Is there a UI for browsing snapshots?

**A**: Not currently (v0.17.1). Use `vv history list` and standard git commands. A TUI is planned for v0.18.0+.

### Q: Can I export validation history?

**A**: Yes, use YAML format:

```bash
$ vv history list --yaml > history-export.yaml
```

### Q: Does this work with worktrees?

**A**: Yes. Each worktree has its own validation history (stored in shared .git directory).

### Q: What if two team members have same tree hash?

**A**: That's expected and good! Same code = same tree hash (deterministic). Both can reference the same snapshot.

## Technical Deep Dive

### Git Internals: How Tree Hashes Work

Git stores files as **blobs** (binary large objects) identified by SHA-1 hashes of their content. A **tree object** contains:
- File names
- File modes (permissions)
- Blob SHA-1 hashes

The tree hash is the SHA-1 of the tree object itself.

**Example**:

```
Tree: abc123def456
├── src/
│   ├── index.ts (blob: 7a3b9c2d)
│   └── utils.ts (blob: 5f1e8d9a)
└── test/
    └── test.ts (blob: 9c3e7f2b)
```

When vibe-validate runs `git write-tree`, it creates:
1. Blob objects for each file
2. Tree objects for each directory
3. Root tree object containing everything

All these objects go in `.git/objects/` and are permanent.

### Why Temp Index is Necessary

**Problem**: We want to create tree hash including untracked files WITHOUT modifying the real git index.

**Solution**: Use temporary index:

```bash
GIT_INDEX_FILE=".git/temp-index" git add --all
GIT_INDEX_FILE=".git/temp-index" git write-tree
```

This stages files in temp index only, leaves real index untouched.

### Deduplication Deep Dive

Git uses content-addressable storage:
- File content → SHA-1 hash → Blob filename in .git/objects/
- Same content → Same SHA-1 → Same blob (stored once)

**Example**:

```bash
# First validation: README.md = "Hello World"
# Blob: 5e1c309dae7f45e0f39b1bf3ac3cd9db12e7d689

# Second validation: README.md unchanged
# Same blob: 5e1c309dae7f45e0f39b1bf3ac3cd9db12e7d689
# No additional storage!

# Third validation: README.md = "Hello World Updated"
# New blob: 9a4d7c3f8e2b1a5d6c7f8e9a0b1c2d3e4f5a6b7c
# Additional storage: ~20 bytes
```

### Storage Efficiency Analysis

**Worst case** (every file changes every validation):
- 1000 files × 1KB average × 100 validations = 100MB

**Typical case** (10% files change per validation):
- 1000 files × 1KB average × 100 validations × 10% = 10MB

**Best case** (no changes):
- 0 additional bytes

Real-world projects typically see 5-15% change rate, making overhead negligible.

## Related Documentation

- [Git Validation Tracking Architecture](git-validation-tracking.md) - Technical details of tree hash calculation
- [Getting Started Guide](getting-started.md) - First-time setup
- [History Package README](../packages/history/README.md) - Validation history API
- [Git Package README](../packages/git/README.md) - Tree hash implementation

## Changelog

- **v0.17.1** (2025-12-02): Initial documentation of work protection feature
- **v0.15.0** (2025-10-01): Work protection enabled for `vv run` command
- **v0.1.0** (2025-01-01): Work protection introduced as side effect of deterministic tree hash

## Support

**Questions or issues with work protection?**
- GitHub Issues: https://github.com/jdutton/vibe-validate/issues
- Documentation: https://github.com/jdutton/vibe-validate/tree/main/docs

**Feature requests for v0.18.0+:**
- Interactive TUI for browsing history
- `vv history recover` built-in command
- `vv history diff` for comparing snapshots
- Visual diff viewer in terminal

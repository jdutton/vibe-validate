# Work Recovery & Protection

## Overview

vibe-validate automatically creates **recoverable snapshots** of your work during validation. Every time you run `vv validate`, `vv pre-commit`, or `vv run`, a git tree hash is created that captures your complete working directory state - including untracked files.

## What Gets Protected

Automatic snapshots include:
- ✅ **Staged changes** (in git index)
- ✅ **Unstaged modifications** (tracked files)
- ✅ **Untracked files** (new files, not in .gitignore)

Not protected (by design):
- ❌ Files in .gitignore (secrets, build artifacts)

## When Snapshots Are Created

Automatic snapshots happen during:
- `vv validate` - Full validation pipeline
- `vv pre-commit` - Pre-commit workflow
- `vv run <command>` - Individual command execution (v0.15.0+)

Each creates a tree hash in git objects that captures complete working directory state at that moment.

## View Validation Snapshots

```bash
# List all validation points (timestamped tree hashes)
vv history list

# Show details of specific validation
vv history show <tree-hash>

# YAML output for programmatic access
vv history list --yaml

# Limit to recent validations
vv history list --limit 10
```

## Recover Lost Work

### Scenario: Accidentally deleted files or ran `git restore .`

```bash
# Step 1: Find recent validation point
vv history list --limit 5

# Step 2: View file content from that validation
git cat-file -p <tree-hash>:path/to/file.ts

# Step 3: Recover the file
git cat-file -p <tree-hash>:path/to/file.ts > path/to/file.ts

# Or recover entire directory
git checkout <tree-hash> -- src/
```

### Important Notes

- Tree hashes are permanent in git objects database
- Even if you delete branches, tree hashes remain
- Use `vv history list` to find the right snapshot
- Recovery works even days/weeks later

## Compare Code States

### See what changed between two validation points

```bash
# Compare two tree hashes
git diff <old-tree-hash> <new-tree-hash>

# Compare specific file between validations
git diff <old-tree-hash>:<file> <new-tree-hash>:<file>

# Show what files changed
git diff --name-status <old-tree-hash> <new-tree-hash>
```

## View Files in Snapshot

```bash
# List all files in a tree hash
git ls-tree -r <tree-hash>

# List specific directory
git ls-tree -r <tree-hash> src/

# View specific file
git cat-file -p <tree-hash>:src/feature.ts
```

## Common Recovery Patterns

### Pattern 1: Undo Recent Changes

**Use case**: Made changes that broke everything, want to go back to last working state

```bash
# List recent validations
vv history list --limit 10

# Pick validation from before bad changes
# Recover all affected files
git checkout <good-tree-hash> -- src/
```

### Pattern 2: Cherry-pick Deleted File

**Use case**: Accidentally deleted a file, need just that one file back

```bash
# Find validation when file existed
vv history list

# Look for validation timestamp before deletion
# Recover just that file
git cat-file -p <tree-hash>:path/to/deleted.ts > path/to/deleted.ts
```

### Pattern 3: Compare Before/After Refactoring

**Use case**: Did major refactoring, want to see all changes or partially revert

```bash
# Before refactoring validation: abc123
# After refactoring validation: def456

# See all changes
git diff abc123 def456

# See just filenames that changed
git diff --name-status abc123 def456

# If refactoring went wrong, revert specific files
git checkout abc123 -- src/refactored-file.ts
```

### Pattern 4: Recover After Branch Switch

**Use case**: Switched branches and lost uncommitted work

```bash
# Find validation from before branch switch
vv history list --limit 20

# Look for validation on old branch
# Recover entire working directory state
git checkout <tree-hash> -- .

# Or just specific directory
git checkout <tree-hash> -- src/
```

## Troubleshooting Recovery

### "I can't find my validation"

**Check:**
1. Did you run `vv validate`, `vv pre-commit`, or `vv run` before losing the work?
2. Look further back: `vv history list --limit 50`
3. Check if in different git repository

**If validation wasn't run**: Work might not be recoverable via vibe-validate. Try:
- `git reflog` - Shows git history including deleted commits
- File recovery tools (OS-level)
- IDE local history (VS Code, IntelliJ, etc.)

### "Tree hash doesn't exist"

**Error**: `fatal: Not a valid object name`

**Solutions:**
1. Verify tree hash is correct (copy-paste from `vv history list`)
2. Check if in correct git repository
3. Try `git fsck --full` to verify git objects database

### "How long are snapshots kept?"

**Answer**: Indefinitely in git objects database until you run `git gc` (garbage collection).

**To manually prune old snapshots**:
```bash
# Clear all validation history (CAREFUL!)
vv history prune --all

# Clear only run cache
vv history prune --run --all
```

## Best Practices

1. **Run validation frequently** - More snapshots = more recovery points
2. **Check history before panic** - `vv history list` shows what's recoverable
3. **Recover incrementally** - Cherry-pick files rather than recovering everything
4. **Test recovery on scratch branch** - Don't overwrite current work
5. **Keep validation habit** - Treat validation as "save point" in your workflow

## Advanced: Direct Git Object Access

### Understanding tree hashes

Tree hashes are git's way of storing directory snapshots. They're content-addressable - same content always produces same hash.

```bash
# View tree structure
git cat-file -p <tree-hash>

# Output shows:
# 100644 blob abc123  README.md
# 040000 tree def456  src
# (permissions) (type) (hash) (name)
```

### Recovering from bare tree hash

```bash
# Create temporary index from tree
GIT_INDEX_FILE=.git/index.tmp git read-tree <tree-hash>

# Checkout files from temporary index
GIT_INDEX_FILE=.git/index.tmp git checkout-index -a -f

# Clean up
rm .git/index.tmp
```

## See Also

- [CLI Reference](cli-reference.md) - `history` command options
- [Troubleshooting Guide](troubleshooting.md) - General recovery issues

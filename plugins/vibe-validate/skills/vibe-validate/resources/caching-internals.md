# Caching Internals: Performance & How It Works

## Overview

vibe-validate achieves **dramatic speedup** through git-aware caching using content-based hashing. This document explains how the caching system works internally and how to leverage it for maximum performance.

## Core Concept: Git Tree Hashing

### What is a tree hash?

A **tree hash** is git's way of creating a deterministic fingerprint of your working directory:
- Content-based (same files = same hash)
- No timestamps (purely about file contents)
- Includes untracked files (not just committed code)
- Deterministic (same state always produces same hash)

### How vibe-validate uses tree hashes

```bash
# Behind the scenes on every validation:
git add --intent-to-add .        # Stage untracked files
git write-tree                    # Generate tree hash
# Returns: abc123def456... (40-character SHA-1)
```

This tree hash becomes the **cache key** for validation results.

## Performance Numbers

Real-world measurements from vibe-validate development:

| Scenario | Time | Speedup |
|----------|------|---------|
| **Cache miss** (first run) | ~90 seconds | 1x (baseline) |
| **Cache hit** (no changes) | < 1 second | **Dramatically faster** |
| **Partial cache** (1 file changed) | ~5-10 seconds | Faster re-validation |

## Cache Key: What Invalidates Cache?

### Cache invalidates when:
- ✅ Any file content changes
- ✅ New files added (even untracked)
- ✅ Files deleted
- ✅ File renamed
- ✅ Working tree modifications

### Cache persists when:
- ✅ Switching branches (if same code state)
- ✅ Git operations (commits, merges) that result in same tree
- ✅ Time passing (content-based, not time-based)
- ✅ .gitignore changes (ignored files not in tree hash)

## How Caching Works: Step by Step

### First Run (Cache Miss)

```bash
$ vv validate
```

1. **Calculate tree hash**: `git write-tree` → `abc123`
2. **Check cache**: Look for `refs/notes/vibe-validate/validation/abc123`
3. **Cache miss**: No notes found
4. **Execute validation**: Run all phases (90 seconds)
5. **Store result**: Save to `refs/notes/vibe-validate/validation/abc123`

### Second Run (Cache Hit)

```bash
$ vv validate
```

1. **Calculate tree hash**: `git write-tree` → `abc123` (same!)
2. **Check cache**: Look for `refs/notes/vibe-validate/validation/abc123`
3. **Cache hit!**: Found notes with previous result
4. **Return cached result**: No execution needed (288ms)

### After Code Change (Partial Cache)

```bash
# Edit one file
$ vv validate
```

1. **Calculate tree hash**: `git write-tree` → `def456` (different!)
2. **Check cache**: Look for `refs/notes/vibe-validate/validation/def456`
3. **Cache miss**: No notes found for new tree hash
4. **Execute validation**: Run all phases again
5. **Store result**: Save to `refs/notes/vibe-validate/validation/def456`

## Cache Storage: Git Notes

vibe-validate uses **git notes** for cache storage:

```bash
# View validation cache
git notes --ref=refs/notes/vibe-validate/validation list

# View specific cached result
git notes --ref=refs/notes/vibe-validate/validation show <tree-hash>
```

### Why git notes?

- ✅ Built into git (no external dependencies)
- ✅ Survives branch switches
- ✅ Works across clones (can be pushed/pulled)
- ✅ Content-addressable (perfect for caching)
- ✅ Garbage collected automatically by git

## Run Command Caching (v0.15.0+)

The `vv run` command has its own cache layer:

```bash
# First run - cache miss
vv run "npm test"  # Executes (~30s)

# Repeat run - cache hit
vv run "npm test"  # Instant (<200ms)
```

### Cache key for run command

Tree hash + command string:
```
cache_key = hash(tree_hash + "npm test")
```

Stored in: `refs/notes/vibe-validate/run/<tree-hash>/<command-hash>`

## Leveraging Caching for Speed

### Pattern 1: Incremental Fixes

```bash
# First run: Full validation (~90s)
vv validate

# Fix 1-2 errors in one file
# Second run: New tree hash, re-validate
vv validate  # (~90s again, but working toward green)

# Fix is correct, no more changes
# Third run: Cache hit!
vv validate  # (288ms - instant!)
```

### Pattern 2: Fast Feedback Loop

```bash
# Use `run` for tight feedback during development
vv run "npm test -- src/feature.test.ts"  # First run (~5s)

# Make change
vv run "npm test -- src/feature.test.ts"  # Re-runs (~5s)

# No changes, verify still passes
vv run "npm test -- src/feature.test.ts"  # Cache hit! (200ms)
```

### Pattern 3: Branch Switching

```bash
# On feature branch
vv validate  # Cache result for feature code

# Switch to main
git checkout main
vv validate  # Cache result for main code

# Switch back to feature
git checkout feature
vv validate  # Cache hit! (same tree hash as before)
```

## Cache Control

### Check cache without running

```bash
# Check if validation is cached
vv validate --check
# Exit 0: cached (green)
# Exit 1: not cached (need to run)

# Check if run command is cached
vv run --check "npm test"
```

### Force cache refresh

```bash
# Force re-validation (ignore cache)
vv validate --force

# Force re-run (ignore cache)
vv run --force "npm test"
```

### View cache state

```bash
# Show current validation state
vv state

# List all cached validations
vv history list

# List cached run commands
vv history list --run
```

### Prune old cache

```bash
# Clear all validation history
vv history prune --all

# Clear only run cache
vv history prune --run --all

# Clear run cache for specific tree hash
vv history prune --run --tree <tree-hash>
```

## Cache Misses: Common Causes

### 1. Timestamp-based files

**Problem**: Build artifacts with timestamps always change tree hash

```bash
# dist/bundle.js includes timestamp
# Tree hash changes every build even if source unchanged
```

**Solution**: Add to .gitignore
```bash
echo "dist/" >> .gitignore
```

### 2. Lock file changes

**Problem**: `package-lock.json` or `pnpm-lock.yaml` updates cause cache invalidation

**Solution**: This is intentional! Dependencies changed = new validation needed.

### 3. Untracked generated files

**Problem**: Test coverage files, .tsbuildinfo, etc.

**Solution**: Add to .gitignore
```bash
.tsbuildinfo
coverage/
.vitest/
```

## Debugging Cache Issues

### Validation always runs (never cached)

```bash
# Check if in git repository
git status

# Check current tree hash
git write-tree

# Check if validation cached for current tree
vv validate --check
echo $?  # 0 = cached, 1 = not cached

# See what's changing
git status --short
git diff
```

### Cache seems stale

```bash
# Check current tree hash
current=$(git write-tree)

# Check cached tree hash
vv state | grep treeHash

# Compare
if [ "$current" != "$cached" ]; then
  echo "Tree changed - cache correctly invalidated"
fi

# Force refresh if needed
vv validate --force
```

### Performance slower than expected

```bash
# Run with timing
time vv validate

# If > 1 second on cache hit:
# 1. Check git objects size: du -sh .git/objects
# 2. Run git gc: git gc --aggressive
# 3. Check disk I/O: iostat

# If still slow, check:
vv doctor
```

## Advanced: Cache Implementation Details

### Tree hash calculation

```typescript
// Simplified implementation
function getTreeHash(): string {
  // Stage untracked files (intent-to-add, doesn't change index)
  execSync('git add --intent-to-add .');

  // Generate tree hash from current index
  const treeHash = execSync('git write-tree').toString().trim();

  // Unstage (cleanup)
  execSync('git reset');

  return treeHash;
}
```

### Cache lookup

```typescript
function getCachedValidation(treeHash: string): ValidationResult | null {
  const notesRef = `refs/notes/vibe-validate/validation`;

  try {
    const cached = execSync(
      `git notes --ref=${notesRef} show ${treeHash}`
    ).toString();

    return JSON.parse(cached);
  } catch {
    return null; // Cache miss
  }
}
```

### Cache storage

```typescript
function cacheValidation(treeHash: string, result: ValidationResult): void {
  const notesRef = `refs/notes/vibe-validate/validation`;
  const data = JSON.stringify(result);

  execSync(`git notes --ref=${notesRef} add -f -m '${data}' ${treeHash}`);
}
```

## See Also

- [Run Capability Guide](run-capability.md) - Deep dive on `vv run` caching
- [CLI Reference](cli-reference.md) - Cache control flags
- [Troubleshooting Guide](troubleshooting.md) - Cache issues

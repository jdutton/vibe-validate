# Git-Based Validation Tracking: A Reusable Pattern

**Status**: Definitive Architecture
**Scope**: Local user validation state caching
**Applicability**: Any language/toolchain using git

---

## Problem: Content-Based Validation Caching

Validation tools (linters, type checkers, tests) are expensive to run. Developers need:

1. **Skip validation when code unchanged**: "I just switched branches but code is identical"
2. **Cache across development timeline**: "I reverted to yesterday's state - don't re-validate"
3. **Track validation history**: "When did this test start failing?"
4. **LLM-friendly context**: AI agents need temporal validation data

**Key insight**: Validation results should be keyed by **code content**, not branch/commit/time.

---

## Solution: Git Tree Hashes + Git Notes

### Architecture Overview

```
Code State → Git Tree Hash → Git Note → Validation Results
```

**Flow**:
1. Calculate deterministic tree hash (includes staged + unstaged + untracked files)
2. Check if git note exists for that tree hash
3. If note exists → **cache hit** (skip validation)
4. If note missing → run validation, store result in git note

---

## Core Components

### 1. Deterministic Tree Hash Calculation

**Challenge**: `git stash create` includes timestamps → non-deterministic hashes

**Solution**: Use `git write-tree` with temporary index

```bash
# Step 1: Create temporary index file
GIT_DIR=$(git rev-parse --git-dir)
TEMP_INDEX="$GIT_DIR/temp-validation-index"

# Step 2: Copy current index
cp "$GIT_DIR/index" "$TEMP_INDEX"

# Step 3: Stage all changes in temp index (doesn't affect real index)
# CRITICAL: Use `git add --all` WITHOUT --intent-to-add or --force
# --intent-to-add only adds empty placeholders (git write-tree skips them)
# --force includes .gitignore'd files (secrets, non-deterministic hashing)
GIT_INDEX_FILE="$TEMP_INDEX" git add --all

# Step 4: Calculate tree hash (deterministic, content-based only)
TREE_HASH=$(GIT_INDEX_FILE="$TEMP_INDEX" git write-tree)

# Step 5: Cleanup
rm -f "$TEMP_INDEX"

echo "Tree hash: $TREE_HASH"
```

**Why this works**:
- `git write-tree`: Content-based hashing (no timestamps)
- Temporary index: No side effects on real index (uses GIT_INDEX_FILE)
- `git add --all`: Stages tracked + untracked files (respects .gitignore)
- Deterministic: Same content = same hash, always

**Benefits**:
- ✅ Includes all relevant files (tracked changes + untracked non-ignored files)
- ✅ Excludes ignored files (respects .gitignore for security and determinism)
- ✅ Safe during git hooks (temp index doesn't corrupt real index)
- ✅ Deterministic across developers and worktrees (same code = same hash)
- ✅ No timestamps (pure content hash)
- ✅ No secrets leaked (API keys, passwords in .gitignore stay out)

---

### 1.5. Submodule Tree Hash Tracking

**Challenge**: Git submodule changes in working tree don't invalidate parent repo tree hash

**Problem scenario**:
```bash
# Parent repo has submodule at libs/auth
tree_hash = "abc123..."  # Parent repo working tree hash

# Modify file in submodule (working tree change, not committed)
echo "modified" >> libs/auth/src/file.ts

tree_hash = "abc123..."  # SAME HASH! (Bug - should invalidate cache)
```

**Root cause**: `git write-tree` only hashes the parent repo's tracked files. It sees submodules as a single commit reference, not the working tree content inside them.

**Solution**: Track parent and submodule hashes separately (Issue #120)

**Implementation**:
1. Calculate tree hash for main repository (as before)
2. Detect git submodules via `git submodule status`
3. Recursively calculate tree hash for each submodule
4. Store all hashes in structured TreeHashResult object

```typescript
// Example: Repository with submodule
result = {
  hash: "abc123...",        // Parent repo hash (40 hex chars)
  submoduleHashes: {
    "libs/auth": "def456..."  // Submodule hash (40 hex chars)
  }
};
```

**Cache invalidation behavior**:
```bash
# Initial state
result = {
  hash: "abc123...",
  submoduleHashes: { "libs/auth": "def456..." }
}
✓ Validation cached with this result

# Modify submodule working tree
echo "change" >> libs/auth/file.ts

result = {
  hash: "abc123...",  # Unchanged
  submoduleHashes: { "libs/auth": "999aaa..." }  # CHANGED!
}
✗ Cache miss → re-run validation
```

**Benefits**:
- ✅ Submodule working tree changes invalidate cache (fixes Issue #120)
- ✅ Deterministic (same content = same hashes)
- ✅ Recursive (nested submodules supported)
- ✅ No false positives (changing submodule always triggers re-run)
- ✅ Backward compatible (single-repo projects work as before)
- ✅ Standard Git hashes (40 hex chars, not composite SHA-256)

**Implementation details** (vibe-validate):
- `getSubmodules()`: Parses `git submodule status` output
- `getSubmoduleTreeHash(path)`: Recursively calculates submodule tree hash
- `TreeHashResult`: Returns `{ hash, submoduleHashes? }` structure

**Storage format**:
```yaml
# Git note format (v0.19.0+)
treeHash: "abc123..."  # Parent repo hash (always present)
submoduleHashes:       # Optional - only present with submodules
  "libs/auth": "def456..."
runs:
  - id: "run-1"
    timestamp: "2025-10-21T14:30:15Z"
    # ...
```

The structured result enables:
- Debugging (which component changed?)
- State reconstruction (full context available)
- Future optimizations (partial re-validation)

---

### 2. Validation Result Storage

**Storage mechanism**: Git notes (native git metadata)

```bash
# Store validation result
git notes --ref=validation/runs add -F result.yaml <tree-hash>

# Retrieve validation result
git notes --ref=validation/runs show <tree-hash>

# List all validation results
git notes --ref=validation/runs list
```

**Note structure** (YAML example):

```yaml
# Git note: refs/notes/validation/runs → tree hash abc123def456...

treeHash: "abc123def456..."
runs:
  - id: "run-1729522215123"
    timestamp: "2025-10-21T14:30:15.123Z"
    duration: 2300
    passed: true
    branch: "feature/foo"
    headCommit: "9abc3c4"
    uncommittedChanges: false

    result:
      # Tool-specific validation results
      # Example: test results, lint errors, type errors
      phases:
        - name: "typecheck"
          status: "passed"
          duration: 1200
          exitCode: 0
          output: "[truncated to 10KB]"
```

**Why git notes?**
- ✅ Keyed by tree hash (perfect match)
- ✅ Git-native (no external dependencies)
- ✅ Persistent (survives branch switches, reverts)
- ✅ Optional sharing (push/pull notes separately)
- ✅ Inspectable (`git notes show <hash>`)

---

### 3. Multi-Run Support

**Challenge**: Same tree hash can be validated multiple times:
- Flaky tests (different results for same code)
- Different branches at same tree hash
- Re-runs after environment fixes

**Solution**: Store array of runs per tree hash

```yaml
treeHash: "abc123..."
runs:
  - id: "run-1"  # First run: passed
    timestamp: "2025-10-21T14:30:15Z"
    passed: true

  - id: "run-2"  # Re-run: failed (flaky test)
    timestamp: "2025-10-21T14:32:00Z"
    passed: false

  - id: "run-3"  # Re-run: passed
    timestamp: "2025-10-21T14:35:00Z"
    passed: true
```

**Implementation**:
1. Read existing note (if any)
2. Append new run to `runs` array
3. Prune old runs (keep last N, e.g., 10)
4. Write note back with `git notes add -f` (force overwrite)

---

### 4. Run Command Caching (v0.15.0+)

**Purpose**: Cache individual command execution results to avoid re-running expensive operations

**Storage mechanism**: Git notes with compound keys (tree hash + command hash)

```bash
# Git notes ref structure
refs/notes/vibe-validate/run/{treeHash}/{cacheKey}

# Example
refs/notes/vibe-validate/run/8199e455b81cfb7a050d92c7dc8f7a3422578bfc/2370514eb8a22112
                                      └──────── tree hash (40 chars) ─────────┘ └─ cache key (16 chars) ─┘
```

**Cache key generation**:

1. **Input**: `command__workdir`
   - Command: Normalized command string (collapsed spaces for simple commands, preserved for complex)
   - Workdir: Working directory relative to git root (empty string for root)
   - Separator: Double underscore `__`

2. **Hashing**: SHA256 hash of input, first 16 characters
   ```typescript
   cacheKey = SHA256(normalizedCommand + '__' + workdir).substring(0, 16)
   ```

3. **Examples**:
   ```bash
   # Simple command at root
   command: "npm test"
   workdir: ""
   input: "npm test__"
   cacheKey: "a7d32686b0f7c36e" (SHA256 first 16 chars)

   # Command with workdir
   command: "npx vitest"
   workdir: "packages/cli"
   input: "npx vitest__packages/cli"
   cacheKey: "3f8b9c1d4e2a5f7c"

   # Complex command (spaces preserved in quotes)
   command: 'echo "hello  world"'
   workdir: ""
   input: 'echo "hello  world"__'
   cacheKey: "9e7d5c3a1b4f6e8d"
   ```

**Why hash instead of URL encoding?**

Git refuses ref names containing `%` characters. URL encoding produces `%20`, `%3A`, etc., causing:
```
fatal: refusing to update ref with bad name 'refs/notes/.../npm%20test'
```

SHA256 hash avoids this limitation while remaining deterministic.

**Cache note structure** (YAML):

```yaml
# Git note: refs/notes/vibe-validate/run/{treeHash}/{cacheKey}

treeHash: "8199e455b81cfb7a050d92c7dc8f7a3422578bfc"
command: "npx eslint --max-warnings=0 \"packages/**/*.ts\""
workdir: ""
timestamp: "2025-11-04T01:40:13.274Z"
exitCode: 0
duration: 0  # Milliseconds (0 for cached results)
fullOutputFile: "/tmp/vibe-validate-run-.../run-2025-11-04T01-40-13-240Z.log"

# Optional: Only included when exitCode !== 0 OR errors detected
extraction:
  errors:
    - file: "packages/cli/src/run.ts"
      line: 42
      message: "Type 'string' is not assignable to type 'number'"
  summary: "1 type error"
  totalErrors: 1
```

**Cache invalidation**: Automatic when tree hash changes (different code → different cache key path)

**Collision probability**: 2^64 possible keys per tree hash (negligible collision risk in practice)

**Storage optimization** (v0.15.0+):
- Omit `extraction` field when `exitCode === 0` AND `totalErrors === 0`
- Token savings: ~90% reduction for successful runs (500 tokens → 50 tokens)

**Benefits**:
- ✅ Fast cache hits: Sub-millisecond retrieval vs. seconds of re-execution
- ✅ Workdir-aware: Different directories can have different cached results for same command
- ✅ Git-native: No external database or state files
- ✅ Automatic cleanup: Stale caches naturally pruned when tree hash changes

---

### 5. Worktree Stability Check

**Challenge**: Code can change during validation (user edits, git operations)

**Solution**: Calculate tree hash before AND after validation

```python
# Pseudocode
tree_hash_before = calculate_tree_hash()

# Run validation (potentially long-running)
result = run_validation()

# Check if code changed during validation
tree_hash_after = calculate_tree_hash()

if tree_hash_before != tree_hash_after:
    print("⚠️  Worktree changed during validation")
    print("   Results valid but not cached (unstable state)")
    return result  # Don't record to git notes

# Safe to cache
record_git_note(tree_hash_before, result)
```

**Why this matters**:
- Prevents caching results that don't match code state
- User can continue working (validation doesn't block)
- Clear feedback when results aren't cached

---

## Implementation Guide

### Language-Agnostic Pseudocode

```python
def validate_with_caching(config):
    # 1. Calculate tree hash (pre-validation)
    tree_hash_before = calculate_deterministic_tree_hash()

    # 2. Check cache (git note lookup)
    cached_result = read_git_note(tree_hash_before)
    if cached_result and is_recent(cached_result):
        print("✓ Cache hit - skipping validation")
        return cached_result

    # 3. Run validation
    print("Running validation...")
    result = run_validation(config)

    # 4. Stability check (post-validation)
    tree_hash_after = calculate_deterministic_tree_hash()

    if tree_hash_before != tree_hash_after:
        print("⚠️  Worktree changed during validation - not caching")
        return result

    # 5. Cache result (git note)
    record_git_note(tree_hash_before, result)
    print("📝 Validation cached")

    return result

def calculate_deterministic_tree_hash():
    git_dir = run_command("git rev-parse --git-dir")
    temp_index = f"{git_dir}/temp-validation-index"

    try:
        # Copy current index
        run_command(f"cp {git_dir}/index {temp_index}")

        # Stage all changes (in temp index only)
        # CRITICAL: Do NOT use --intent-to-add (only adds empty placeholders)
        # CRITICAL: Do NOT use --force (includes .gitignore'd secrets)
        env = {"GIT_INDEX_FILE": temp_index}
        run_command("git add --all", env=env)

        # Calculate tree hash
        tree_hash = run_command("git write-tree", env=env).strip()

        return tree_hash
    finally:
        # Cleanup temp index
        run_command(f"rm -f {temp_index}")

def read_git_note(tree_hash):
    try:
        yaml_content = run_command(
            f"git notes --ref=validation/runs show {tree_hash}"
        )
        return parse_yaml(yaml_content)
    except CommandError:
        return None  # No note exists

def record_git_note(tree_hash, result):
    # Read existing note (if any)
    existing_note = read_git_note(tree_hash)

    # Create new run entry
    new_run = {
        "id": f"run-{current_timestamp()}",
        "timestamp": current_iso_time(),
        "duration": result.duration,
        "passed": result.passed,
        "branch": get_current_branch(),
        "headCommit": get_head_commit(),
        "uncommittedChanges": has_uncommitted_changes(),
        "result": truncate_output(result, max_bytes=10000)
    }

    # Append or create
    if existing_note:
        existing_note["runs"].append(new_run)
        # Prune: keep last 10 runs
        existing_note["runs"] = existing_note["runs"][-10:]
        note = existing_note
    else:
        note = {"treeHash": tree_hash, "runs": [new_run]}

    # Write note
    temp_file = f"/tmp/validation-note.{tree_hash[:12]}.{process_id}.yaml"
    write_file(temp_file, to_yaml(note))

    try:
        run_command(
            f"git notes --ref=validation/runs add -f -F {temp_file} {tree_hash}"
        )
    finally:
        delete_file(temp_file)
```

---

## Cache Effectiveness Analysis

### Scenarios

| Scenario | Traditional (state file) | Git Notes (this pattern) |
|----------|--------------------------|--------------------------|
| Switch branch A→B (same code) | ❌ Cache miss | ✅ Cache hit |
| Revert to yesterday's state | ❌ Cache miss | ✅ Cache hit |
| Work on multiple branches | ❌ Cache miss | ✅ Cache hit (per branch) |
| Unstaged changes then revert | ❌ Cache miss | ✅ Cache hit |
| Flaky test re-run | ❌ Cache miss | ✅ Cache hit (multi-run) |

**Result**: Improved cache effectiveness with git notes pattern

---

## Storage Management

### Output Truncation

Validation output can be large (MB of logs). Truncate to keep notes small:

```python
def truncate_output(result, max_bytes=10000):
    for phase in result.phases:
        for step in phase.steps:
            if len(step.output) > max_bytes:
                truncated_length = len(step.output)
                step.output = (
                    step.output[:max_bytes] +
                    f"\n\n[... truncated {truncated_length - max_bytes} bytes]"
                )
    return result
```

**Recommendation**: 10KB max per step output (balance usefulness vs bloat)

### Pruning Strategy

**Per-tree pruning**: Keep last N runs per tree hash

```python
# When recording
note["runs"] = note["runs"][-10:]  # Keep last 10 runs
```

**Age-based pruning**: Delete old notes

```bash
# Find notes older than 90 days
git notes --ref=validation/runs list | while read note_ref tree_hash; do
    yaml=$(git notes --ref=validation/runs show $tree_hash)
    oldest_run=$(echo "$yaml" | extract_oldest_timestamp)

    if age_in_days($oldest_run) > 90; then
        git notes --ref=validation/runs remove $tree_hash
    fi
done
```

**Proactive notifications**:
```
ℹ️  Validation history has grown large (127 tree hashes)
   Consider pruning: validate-tool prune --older-than "90 days"
```

---

## Privacy & Sharing

### Local-First Design

**Default**: Notes are local-only

```bash
# Regular git push does NOT include notes
git push origin main
```

**Explicit sharing** (opt-in):

```bash
# Share validation history
git push origin refs/notes/validation/runs

# Fetch team's validation history
git fetch origin refs/notes/validation/runs:refs/notes/validation/runs
```

### Privacy Considerations

**What NOT to record** (privacy-first):
- ❌ Author name/email (already in git commit history)
- ❌ Machine hostname
- ❌ File paths with usernames
- ❌ Environment variables (may contain secrets)

**What to record**:
- ✅ Tree hash (content-based, no PII)
- ✅ Timestamp (when validation ran)
- ✅ Branch name (git metadata)
- ✅ HEAD commit (git metadata)
- ✅ Validation results (exit codes, truncated output)

---

## Scope & Future Extensions

### Current Scope: Local User Caching

**Design goals** (v1.0):
- ✅ Local validation caching (skip redundant work)
- ✅ Temporal tracking (validation timeline)
- ✅ Privacy-first (local only, no auto-sharing)
- ✅ No environmental factors (Node version, OS, etc.)

**Why no environment tracking (yet)?**
- Simpler design (fewer variables)
- Local caching doesn't need it (same machine)
- Future extension point (see below)

### Future Extensions

#### Team Sharing (v2.0)

```yaml
# Note with team sharing
runs:
  - author:
      name: "Jeff Dutton"        # Opt-in
      email: "jeff@example.com"  # Opt-in
    environment: "local"
```

**Workflow**:
```bash
validate-tool history push   # Push notes to remote
validate-tool history pull   # Fetch team's notes
```

#### Environment Tracking (v3.0)

```yaml
# Note with environment metadata
runs:
  - environment:
      os: "darwin"
      arch: "arm64"
      nodeVersion: "20.11.0"
      ciProvider: "github-actions"
```

**Use case**: CI matrix testing (same code, different environments)

#### Analytics Export (v4.0)

```bash
# Export to JSONL
validate-tool history export --format jsonl > history.jsonl

# Import to SQLite/DuckDB for analysis
duckdb analysis.db "COPY validation_runs FROM 'history.jsonl'"
```

**Use case**: Long-term trend analysis, dashboards

---

## Design Rationale

### Why Git Tree Hashes?

| Requirement | Git Tree Hash | Commit SHA | Timestamp |
|-------------|---------------|------------|-----------|
| **Content-based** | ✅ Yes | ❌ Includes metadata | ❌ Time-based |
| **Deterministic** | ✅ Same code = same hash | ❌ Different per commit | ❌ Always unique |
| **Includes uncommitted** | ✅ With git write-tree | ❌ Only committed | N/A |
| **Cache effectiveness** | ✅ Maximum hits | ❌ Few hits | ❌ No hits |

**Result**: Git tree hash is the only option for content-based caching.

### Why Git Notes?

| Requirement | Git Notes | State File | SQLite |
|-------------|-----------|------------|--------|
| **Git-native** | ✅ Built-in | ⚠️ Custom | ❌ External DB |
| **Keyed by hash** | ✅ Perfect match | ⚠️ Manual indexing | ⚠️ Manual indexing |
| **No dependencies** | ✅ Just git | ✅ Just filesystem | ❌ Needs library |
| **Persistent** | ✅ In `.git/objects/` | ⚠️ Single file | ⚠️ Single file |
| **Optional sharing** | ✅ `git push/pull` | ❌ Manual export | ❌ Manual export |
| **Multiple results** | ✅ Append to note | ❌ Overwrite file | ✅ SQL queries |

**Result**: Git notes provide best balance of simplicity and features.

### Why NOT State File?

**Problems with single state file**:
1. ❌ Only remembers ONE tree hash (poor cache effectiveness)
2. ❌ Version control noise (frequent file changes)
3. ❌ Often gitignored (lost on clone)
4. ❌ No history (can't track timeline)
5. ❌ Conflicts in git (merge conflicts on automated file)

**Conclusion**: State file is fundamentally limited - git notes superior.

## Automatic Work Protection Benefit

The deterministic tree hash calculation provides an invaluable safety feature: automatic work protection.

### How It Works

The process described above (Step 3 in "Core Components") creates git objects for ALL files:

```bash
# Step 3: Stage all changes in temp index
GIT_INDEX_FILE="$TEMP_INDEX" git add --all

# Step 4: Calculate tree hash (CREATES GIT OBJECTS!)
TREE_HASH=$(GIT_INDEX_FILE="$TEMP_INDEX" git write-tree)
```

**Critical insight**: `git write-tree` creates persistent git objects in `.git/objects/` for every file. These objects remain even after the temp index is deleted.

### Accidental Protection

This means every validation run creates a recoverable snapshot of:
- All staged changes
- All unstaged modifications
- All untracked files (respecting .gitignore)

**User benefit**: If you accidentally delete or modify files, you can recover them from any validation point using the tree hash.

### Recovery Example

```bash
# Developer has unstaged changes
$ cat src/feature.ts
"3 hours of brilliant work"

# Validation runs (tree hash: abc123...)
$ validate-tool validate

# Developer accidentally reverts
$ git restore .

# Work is gone from file system!
$ cat src/feature.ts
"Old committed version"

# BUT the tree hash saved it!
$ validate-tool history list
2025-12-02 14:30:15  abc123...  feature-branch  ✓ PASSED

# Recover the work
$ git cat-file -p abc123...:src/feature.ts > src/feature.ts
# Work restored!
```

### Why This Matters

Unlike git stash (requires manual action), vibe-validate provides automatic protection:
- No user action required
- Happens every validation run
- Creates historical timeline of code states
- Zero additional disk space (git deduplicates)

### Marketing Value

This is a unique differentiator:
- ✅ **No other validation tool provides automatic work protection**
- ✅ **Combines caching performance with safety net**
- ✅ **Zero overhead (free benefit of deterministic hashing)**
- ✅ **Simple recovery (standard git commands)**

See [Work Protection Guide](work-protection.md) for comprehensive recovery examples.

---

## Real-World Example: TypeScript Project

### Setup

```bash
# Initialize git repository
git init my-project
cd my-project

# Create validation config
cat > validate.config.yaml <<EOF
phases:
  - name: "Type Check"
    steps:
      - command: "tsc --noEmit"
  - name: "Lint"
    steps:
      - command: "eslint ."
  - name: "Test"
    steps:
      - command: "npm test"
EOF

# Install validation tool (example)
npm install -D my-validation-tool
```

### First Run (No Cache)

```bash
$ validate
🔍 Validation starting (tree: a1b2c3d4e5f6...)

Running validation...
✓ Type Check (1.2s)
✓ Lint (0.8s)
✓ Test (2.1s)

✅ Validation PASSED (4.1s)
📝 Validation cached (tree: a1b2c3d4e5f6)
```

**Behind the scenes**:
```bash
# Tree hash calculated
tree_hash = "a1b2c3d4e5f6..."

# No git note exists → run validation
# (4.1 seconds)

# Store result in git note
git notes --ref=validation/runs add -F result.yaml a1b2c3d4e5f6
```

### Second Run (Cache Hit)

```bash
$ validate
🔍 Validation starting (tree: a1b2c3d4e5f6...)

✓ Cache hit - validation passed previously (4.1s ago)
✅ Validation PASSED (0.1s)
```

**Behind the scenes**:
```bash
# Same tree hash (code unchanged)
tree_hash = "a1b2c3d4e5f6..."

# Git note exists → cache hit
git notes --ref=validation/runs show a1b2c3d4e5f6
# Returns cached result (instant)
```

**Speedup**: 4.1s → 0.1s (41x faster)

### Branch Switch (Cache Hit)

```bash
# Switch to feature branch
$ git checkout -b feature/new-ui

# Make changes
$ echo "export const foo = 'bar'" > src/utils.ts

# Validate
$ validate
🔍 Validation starting (tree: x9y8z7w6v5u4...)

Running validation...
✓ Type Check (1.3s)
✗ Lint (0.9s) - "Unexpected var, use const or let"

❌ Validation FAILED (2.2s)
📝 Validation cached (tree: x9y8z7w6v5u4)

# Fix lint error
$ sed -i 's/var/const/g' src/utils.ts

# Validate again
$ validate
🔍 Validation starting (tree: b3c4d5e6f7g8...)

Running validation...
✓ Type Check (1.2s)
✓ Lint (0.8s)
✓ Test (2.0s)

✅ Validation PASSED (4.0s)
📝 Validation cached (tree: b3c4d5e6f7g8)

# Switch back to main
$ git checkout main

# Validate (CACHE HIT!)
$ validate
🔍 Validation starting (tree: a1b2c3d4e5f6...)

✓ Cache hit - validation passed previously (1 hour ago)
✅ Validation PASSED (0.1s)
```

**Key insight**: Validation remembered across branches!

---

## Tooling Examples

### Query Commands

```bash
# List recent validations
$ validate history list
2025-10-21 14:30:15  a1b2c3  main         ✓ PASSED  (4.1s)
2025-10-21 14:25:10  x9y8z7  feature/ui   ✗ FAILED  (2.2s) [lint]
2025-10-21 14:20:05  b3c4d5  feature/ui   ✓ PASSED  (4.0s)

# Show specific validation
$ validate history show a1b2c3
Tree Hash: a1b2c3d4e5f6...
Runs: 1

Run #1 (run-1729522215123):
  Timestamp: 2025-10-21 14:30:15
  Duration: 4.1s
  Status: PASSED
  Branch: main
  Commit: 9abc3c4

  Results:
    ✓ Type Check (1.2s)
    ✓ Lint (0.8s)
    ✓ Test (2.1s)

# Prune old validations
$ validate history prune --older-than "90 days" --dry-run
Pruning validation history (DRY RUN)...

Found 15 tree hashes with notes older than 90 days:
- a1b2c3: 3 runs (oldest: 2025-07-15)
- x9y8z7: 1 run  (oldest: 2025-07-20)
...

Total: 15 notes to prune, 47 notes to retain
Run without --dry-run to execute
```

---

## Adoption Checklist

Implementing this pattern in your validation tool:

**Core Implementation**:
- [ ] Deterministic tree hash calculation (git write-tree with temp index)
- [ ] Git notes storage (custom ref namespace)
- [ ] Cache lookup (read note before validation)
- [ ] Cache recording (write note after validation)
- [ ] Worktree stability check (before/after tree hash comparison)

**Multi-Run Support**:
- [ ] Append runs to existing notes
- [ ] Per-tree pruning (keep last N runs)
- [ ] Age-based pruning (delete old notes)

**Output Management**:
- [ ] Truncate command output (10KB max per step)
- [ ] Store exit codes (always)
- [ ] Proactive health notifications (prune recommendations)

**Commands**:
- [ ] `history list` - Show recent validations
- [ ] `history show <hash>` - Display full note
- [ ] `history prune` - Manual cleanup

**Documentation**:
- [ ] Explain tree hash caching (why it works)
- [ ] Migration guide (if replacing state file)
- [ ] Privacy implications (local vs shared)

---

## References

**Git Commands**:
- [`git write-tree`](https://git-scm.com/docs/git-write-tree) - Write tree object from index
- [`git notes`](https://git-scm.com/docs/git-notes) - Attach metadata to objects
- [`git add --all`](https://git-scm.com/docs/git-add) - Stage all changes (respects .gitignore)

**Related Patterns**:
- Content-addressable storage (CAS)
- Merkle trees (git's object model)
- Deterministic hashing

**Real-World Implementations**:
- vibe-validate (TypeScript) - First implementation of this pattern
- (Future: Other tools adopting this approach)

---

## Conclusion

Git tree hashes + git notes provide a **git-native, dependency-free, highly effective** validation caching mechanism.

**Key advantages**:
- ✅ Content-based caching (not time/branch dependent)
- ✅ Improved cache hit rate across development workflows
- ✅ No external dependencies (pure git)
- ✅ Temporal tracking (validation timeline)
- ✅ Privacy-first (local by default)
- ✅ Future-proof (easy to extend)

**Applicability**: Any language/toolchain using git can adopt this pattern.

---

**Document Version**: 1.0
**Last Updated**: 2025-10-21
**Maintainer**: vibe-validate project
**License**: MIT (reusable pattern)

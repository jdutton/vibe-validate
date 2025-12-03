# @vibe-validate/history

Validation history tracking via git notes for vibe-validate.

## Features

- **Automatic Work Protection**: Every validation creates recoverable snapshots of all files
- **Git Notes Storage**: Store validation results keyed by git tree hash
- **Distributed Cache**: Remember validation for EVERY tree hash
- **Worktree Stability Check**: Verify tree unchanged during validation
- **Multi-Run Support**: Handle flaky tests, multiple branches at same tree
- **Output Truncation**: Efficient storage (10KB max per step)
- **Proactive Health**: Warn when pruning recommended
- **Privacy-First**: Local by default, no auto-sharing

## Installation

```bash
npm install @vibe-validate/history
```

## Usage

### Record Validation History

```typescript
import { recordValidationHistory, checkWorktreeStability } from '@vibe-validate/history';
import { getGitTreeHash } from '@vibe-validate/git';

// Get tree hash before validation
const treeHashBefore = await getGitTreeHash();

// Run validation
const result = await runValidation(config);

// Check stability (did tree change during validation?)
const stability = await checkWorktreeStability(treeHashBefore);

if (!stability.stable) {
  console.warn('⚠️  Worktree changed during validation - not caching');
} else {
  // Record to git notes
  const recordResult = await recordValidationHistory(treeHashBefore, result);

  if (recordResult.recorded) {
    console.log('📝 History recorded');
  }
}
```

### Read Validation History

```typescript
import { readHistoryNote, listHistoryTreeHashes } from '@vibe-validate/history';

// Read specific tree hash
const note = await readHistoryNote('abc123def456...');

if (note) {
  console.log(`Found ${note.runs.length} validation runs for this tree`);

  for (const run of note.runs) {
    console.log(`- ${run.timestamp}: ${run.passed ? 'PASSED' : 'FAILED'}`);
  }
}

// List all tree hashes with history
const treeHashes = await listHistoryTreeHashes();
console.log(`Total history: ${treeHashes.length} tree hashes`);
```

### Health Check

```typescript
import { checkHistoryHealth } from '@vibe-validate/history';

const health = await checkHistoryHealth();

if (health.shouldWarn) {
  console.log(health.warningMessage);
  // Example output:
  // ℹ️  Validation history has grown large (127 tree hashes)
  //    Found 15 notes older than 90 days
  //    Consider pruning: vibe-validate history prune --older-than "90 days"
}
```

### Prune Old History

```typescript
import { pruneHistoryByAge } from '@vibe-validate/history';

// Prune notes older than 90 days (dry run)
const dryRunResult = await pruneHistoryByAge(90, {}, true);
console.log(`Would prune ${dryRunResult.notesPruned} notes`);

// Actually prune
const pruneResult = await pruneHistoryByAge(90);
console.log(`Pruned ${pruneResult.notesPruned} notes`);
console.log(`${pruneResult.notesRemaining} notes remaining`);
```

## Configuration

```typescript
import type { HistoryConfig } from '@vibe-validate/history';

const config: HistoryConfig = {
  enabled: true,

  gitNotes: {
    ref: 'vibe-validate/validate',  // Git notes ref namespace (v0.15.0: changed from 'runs')
    maxRunsPerTree: 10,             // Keep last 10 runs per tree
    maxOutputBytes: 10000,          // 10KB max per step output
  },

  retention: {
    warnAfterDays: 30,              // Warn about notes >30 days old (v0.15.0: was 90)
    warnAfterCount: 1000,           // Warn when >1000 tree hashes (v0.15.0: was 100, adjusted for run caching)
  },
};
```

## API Reference

### Types

- **ValidationRun**: Single validation run entry
- **HistoryNote**: Git note structure (array of runs per tree)
- **RecordResult**: Result of recording validation
- **StabilityCheck**: Worktree stability check result
- **HealthCheckResult**: History health check result
- **PruneResult**: Result of pruning operation

### Functions

#### Recording
- `recordValidationHistory(treeHash, result, config?)`: Record validation to git notes
- `checkWorktreeStability(treeHashBefore)`: Check if tree changed during validation

#### Reading
- `readHistoryNote(treeHash, notesRef?)`: Read note for specific tree hash
- `listHistoryTreeHashes(notesRef?)`: List all tree hashes with notes
- `getAllHistoryNotes(notesRef?)`: Get all history notes
- `hasHistoryForTree(treeHash, notesRef?)`: Check if history exists

#### Pruning
- `pruneHistoryByAge(olderThanDays, config?, dryRun?)`: Prune by age
- `pruneAllHistory(config?, dryRun?)`: Prune all history

#### Health
- `checkHistoryHealth(config?)`: Check history health

#### Utilities
- `truncateValidationOutput(result, maxBytes?)`: Truncate validation output

## Design

### Git Tree Hash Caching

Traditional validation caching (single state file):
- Only remembers ONE tree hash
- Switch branches → cache miss
- Revert changes → cache miss

Git notes caching (this package):
- Remembers EVERY tree hash
- Switch branches → cache hit (if tree unchanged)
- Revert changes → cache hit
- **Result**: Improved cache effectiveness

### Note Structure

```yaml
# Git note: refs/notes/vibe-validate/runs → tree hash abc123
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
      # Full validation result (output truncated to 10KB/step)
```

### Worktree Stability

Critical safety feature: Verify tree unchanged during validation.

```typescript
// Before validation
const treeHashBefore = await getGitTreeHash();

// Run validation (potentially long-running)
const result = await runValidation();

// After validation - check stability
const stability = await checkWorktreeStability(treeHashBefore);

if (!stability.stable) {
  // Tree changed during validation - don't cache
  console.warn('⚠️  Worktree changed during validation');
  return result; // Skip recording
}

// Safe to cache
await recordValidationHistory(treeHashBefore, result);
```

## Privacy & Scope

**Current Scope**: Local user validation caching only

**What's recorded**:
- ✅ Tree hash (content-based, no PII)
- ✅ Timestamp
- ✅ Branch name
- ✅ HEAD commit
- ✅ Validation results (truncated output)

**What's NOT recorded** (privacy-first):
- ❌ Author name/email (already in git history)
- ❌ Machine hostname
- ❌ Environment variables
- ❌ File paths with usernames

**Sharing**: Local by default (no auto-push to remote)

## Work Protection

Every validation run that records history also provides automatic work protection.

### How Validation History Enables Recovery

Each history entry stores:
- `treeHash`: The git tree hash for that validation
- `timestamp`: When validation occurred
- `branch`: Which branch you were on
- `headCommit`: Last commit at validation time
- `uncommittedChanges`: Whether you had uncommitted work

The `treeHash` is the key to recovery - it references a git tree object containing all your files as they existed during that validation.

### Recovery Workflow

1. **Find the validation** you want to recover from:
```bash
vv history list
```

2. **Examine the tree hash** to see what files existed:
```bash
git ls-tree <tree-hash>
```

3. **View specific file content**:
```bash
git cat-file -p <tree-hash>:path/to/file.ts
```

4. **Recover files**:
```bash
# Single file
git cat-file -p <tree-hash>:src/feature.ts > src/feature.ts

# Entire directory
git checkout <tree-hash> -- src/
```

### Example: Recovering from Accidental Loss

```typescript
// You were working on new features (unstaged)
// Accidentally ran `git restore .`
// Work is gone from file system!

// But history remembers:
const notes = await readHistoryNote(currentTreeHash);
console.log(`Last validation: ${notes.runs[0].timestamp}`);
console.log(`Tree hash: ${notes.treeHash}`);

// Recover via git:
// git cat-file -p <tree-hash>:src/lost-work.ts
```

### Privacy Implications

Work protection does NOT increase privacy risks:
- Git objects are local (not pushed unless you explicitly push git notes)
- Only files already tracked or trackable are protected
- .gitignore is respected (secrets stay ignored)
- Tree hashes are content-based (no PII)

See [Work Protection Guide](../../docs/work-protection.md) for comprehensive examples.

## Future Extensions

- Team sharing (opt-in)
- Environment tracking (OS, Node version, CI matrix)
- Analytics export (JSONL for SQLite/DuckDB analysis)

## License

MIT

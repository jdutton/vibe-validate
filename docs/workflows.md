# Workflows & Decision Trees

## Overview

This guide provides decision trees and workflow patterns for common vibe-validate scenarios. Use these when you're unsure about command sequencing or which workflow to follow.

## Decision Tree: When User Requests a Commit

```
User: "Commit these changes"
  ↓
Run: npx vibe-validate pre-commit
  ↓
  ├─ Pass (exitCode 0)
  │    ↓
  │    Proceed with commit
  │    ↓
  │    git add -A && git commit -m "..."
  │
  └─ Fail (exitCode 1)
       ↓
       Query: npx vibe-validate state
       ↓
       Analyze failedStepOutput
       ↓
       Show user:
       - Which step failed
       - File/line errors
       - Suggested fix
       ↓
       User fixes errors
       ↓
       Re-run: npx vibe-validate pre-commit (fast with cache!)
       ↓
       Repeat until pass
```

### Example Flow

```bash
# User requests commit
User: "Commit my changes"

# Step 1: Pre-commit validation
$ vv pre-commit
✗ Failed: TypeScript (2 errors)

# Step 2: Query state (don't re-run!)
$ vv state
passed: false
failedStep: TypeScript
errors:
  - file: src/feature.ts
    line: 42
    message: Type 'string' is not assignable to type 'number'

# Step 3: Fix and iterate
# (Fix the error)
$ vv pre-commit  # Fast re-run with cache
✓ All validations passed

# Step 4: Proceed with commit
$ git add -A && git commit -m "feat: add feature"
```

## Decision Tree: When User Requests Running Tests

```
User: "Run the tests in path/to/test.ts"
  ↓
Run: npx vibe-validate run "npx vitest path/to/test.ts"
  ↓
Parse YAML output
  ↓
  ├─ exitCode: 0
  │    ↓
  │    Report success to user
  │    Show summary (X tests passed)
  │
  └─ exitCode: 1
       ↓
       Show errors[] from YAML
       ↓
       Provide file:line context
       ↓
       User fixes or asks for help
       ↓
       Re-run (wrapped with vv run)
       ↓
       Repeat until pass
```

### Example Flow

```bash
# User requests test run
User: "Run the feature tests"

# Step 1: Wrap with vv run
$ vv run "npm test -- feature.test.ts"

# Step 2: Parse output
exitCode: 1
errors:
  - file: tests/feature.test.ts
    line: 25
    message: "Expected 5 to equal 6"
summary: "1 test failure"

# Step 3: Show user
"Test failed at tests/feature.test.ts:25
Expected 5 to equal 6"

# User fixes
# Step 4: Re-run
$ vv run "npm test -- feature.test.ts"
exitCode: 0
summary: "All tests passed"
```

## Decision Tree: When Validation Behaves Unexpectedly

```
Issue: Validation slow/flaky/failing unexpectedly
  ↓
Run: npx vibe-validate doctor
  ↓
  ├─ Issues found
  │    ↓
  │    Follow guidance to fix:
  │    - Node.js version
  │    - Git repository
  │    - Config validity
  │    - Deprecated files
  │    - Hook installation
  │    ↓
  │    Re-run: vv doctor
  │    ↓
  │    Verify fixed
  │
  └─ No issues found
       ↓
       Check cache behavior:
       vv validate --check
       ↓
       ├─ Exit 0: Cached (working correctly)
       └─ Exit 1: Not cached
            ↓
            Force refresh: vv validate --force
            ↓
            Check if passes
```

## Decision Tree: When User Lost Work

```
User: "I accidentally deleted my files"
  ↓
Query: Did you run vv validate, pre-commit, or run recently?
  ↓
  ├─ YES
  │    ↓
  │    Run: vv history list --limit 10
  │    ↓
  │    Find recent validation before deletion
  │    ↓
  │    Run: git checkout <tree-hash> -- <path>
  │    ↓
  │    Files recovered!
  │
  └─ NO
       ↓
       Try: git reflog
       ↓
       Try: IDE local history
       ↓
       Try: OS file recovery tools
       ↓
       Educate: Use vv validate frequently for snapshots
```

**See**: [Work Recovery Guide](work-recovery.md) for detailed recovery patterns

## Workflow Pattern: Pre-Commit Validation

### Standard Flow

```bash
# 1. Make changes
git status  # See what changed

# 2. Run pre-commit validation
vv pre-commit

# 3a. If pass: Commit
git add -A
git commit -m "feat: implement feature"

# 3b. If fail: Fix and iterate
vv state  # See what failed (instant, no re-run)
# Fix errors
vv pre-commit  # Fast with cache
```

### With Branch Sync Issues

```bash
# Pre-commit fails: "branch behind origin/main"
vv pre-commit
✗ Branch sync: Behind 3 commits

# Fix: Merge or rebase
git fetch origin
git merge origin/main  # or git rebase origin/main

# Re-validate
vv pre-commit
✓ All validations passed
```

## Workflow Pattern: Context-Optimized Testing

### Development Loop

```bash
# 1. Make change to feature code
# 2. Run tests with extraction
vv run "npm test -- feature.test.ts"

# 3. If fail: See extracted errors
exitCode: 1
errors: [...]

# 4. Fix and iterate (fast with cache)
vv run "npm test -- feature.test.ts"
```

### Multi-Package Testing

```bash
# Test specific package
vv run "pnpm --filter @myapp/core test"

# Test all packages
vv run "pnpm -r test"

# Cache works across runs
vv run "pnpm -r test"  # Instant if no changes!
```

## Workflow Pattern: Full Validation Pipeline

### Standard Flow

```bash
# Run all validation phases
vv validate

# If pass: Ready to push
git push origin feature

# If fail: Query state (don't re-run!)
vv state

# Fix errors incrementally
# Re-validate (fast with cache)
vv validate
```

### With Force Refresh

```bash
# Suspect stale cache
vv validate --force

# Or just check cache state
vv validate --check
if [ $? -eq 0 ]; then
  echo "Cached (validation passed)"
else
  echo "Not cached (need to run)"
fi
```

## Workflow Pattern: PR Validation Monitoring

### Watch CI Status

```bash
# Auto-detect PR from branch
vv watch-pr

# Specific PR number
vv watch-pr 123

# YAML output for parsing
vv watch-pr --yaml
```

### On CI Failure

```bash
# Get detailed state from CI
vv watch-pr 123

# Output shows:
# - Which validation step failed
# - Extracted errors from CI logs
# - Recovery commands

# Fix locally
vv validate --force

# Push fix
git push
```

## Workflow Pattern: Initial Project Setup

### New Project Onboarding

```bash
# 1. Install
npm install -D vibe-validate

# 2. Initialize with template
vv init --template typescript-library

# 3. Run diagnostics
vv doctor

# 4. Fix any issues shown by doctor

# 5. Test validation
vv validate

# 6. Commit config
git add vibe-validate.config.yaml
git commit -m "chore: add vibe-validate"
```

### Existing Project Adoption

```bash
# 1. Install
npm install -D vibe-validate

# 2. Initialize (pick closest template)
vv init

# 3. Customize config for your setup
# Edit vibe-validate.config.yaml

# 4. Test on clean state
vv validate

# 5. Fix any issues
vv state  # See what failed

# 6. Iterate until green
vv validate

# 7. Commit
git add vibe-validate.config.yaml
git commit -m "chore: add vibe-validate"
```

## Command Sequencing Rules

### Always This Order

```bash
# CORRECT: Query state before re-running
vv validate  # (fails)
vv state     # Check what failed
# fix errors
vv validate  # Re-run

# WRONG: Re-run immediately
vv validate  # (fails)
vv validate  # Wastes time, doesn't show errors efficiently
```

### Never Skip Pre-Commit

```bash
# CORRECT: Validate before commit
vv pre-commit
git add -A && git commit -m "..."

# WRONG: Skip validation
git add -A && git commit -m "..."  # Might break CI!
```

### Use run for Ad-Hoc Commands

```bash
# CORRECT: Wrap for extraction
vv run "npm test"

# WRONG: Run raw (verbose output)
npm test  # Wastes context window
```

## Edge Cases

### Cache Invalidation After .gitignore Change

```bash
# Add build artifacts to .gitignore
echo "dist/" >> .gitignore

# Cache persists! (ignored files not in tree hash)
vv validate  # Still cached

# Tree hash unchanged, validation result still valid
```

### Branch Switch with Same Code

```bash
# On feature-a
vv validate  # Cache result

# Create feature-b from same commit
git checkout -b feature-b

# No changes yet
vv validate  # Cache hit! (same tree hash)
```

### Validation After Stash

```bash
# Stash changes
git stash

# Tree hash changes (clean tree)
vv validate  # Re-validates clean state

# Pop stash
git stash pop

# Tree hash changes (dirty tree)
vv validate  # Re-validates with changes
```

## Troubleshooting Workflows

### "Validation always runs (never cached)"

```bash
# Diagnosis workflow
git status  # Any uncommitted changes?
git write-tree  # Current tree hash
vv state | grep treeHash  # Cached tree hash
# If different: Something is changing

# Common causes:
ls -la | grep -E "coverage|dist|.tsbuildinfo"
# Add these to .gitignore

# Force refresh
vv validate --force
```

### "Errors not being extracted"

```bash
# Diagnosis workflow
vv run "your-command"
# Look for: metadata.detection.extractor

# If "generic":
# Need custom extractor
# See: resources/extending-extraction.md

# If specific extractor but no errors:
# Extractor may need tuning
# File issue with example output
```

### "Pre-commit always fails on branch sync"

```bash
# Diagnosis workflow
git fetch origin
git branch -vv  # Check tracking
git log origin/main..HEAD  # Commits ahead
git log HEAD..origin/main  # Commits behind

# If behind:
git merge origin/main  # or rebase

# If tracking broken:
git branch --set-upstream-to=origin/main
```

## See Also

- [CLI Reference](cli-reference.md) - All command options
- [Work Recovery Guide](work-recovery.md) - Recovery workflows
- [Troubleshooting Guide](troubleshooting.md) - Diagnostic workflows
- [Run Capability Guide](run-capability.md) - `vv run` workflow details

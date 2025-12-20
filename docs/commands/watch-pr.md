# watch-pr Command Reference

> Watch CI checks for pull requests with LLM-friendly YAML output

## Overview

The `watch-pr` command fetches complete PR check status from GitHub, including GitHub Actions results with error extraction, external check summaries (codecov, SonarCloud), PR metadata, file changes, and validation history. **YAML output is auto-enabled on failure** for seamless AI agent integration.

## How It Works

1. **Fetches PR metadata** (title, branch, labels, linked issues, mergeable state)
2. **Retrieves all checks** from GitHub (Actions + external checks like codecov/SonarCloud)
3. **Classifies checks** into GitHub Actions vs external providers
4. **Extracts errors** from failed GitHub Actions logs (matrix + non-matrix modes)
5. **Extracts summaries** from external checks (coverage %, quality gates)
6. **Builds history summary** (last 10 runs, success rate, recent pattern)
7. **Generates guidance** with severity-based next steps
8. **Outputs YAML on failure**, text on success (unless `--yaml` forced)

## Use Cases

### Standard PR Review Workflow
```bash
# Check PR status (auto-detects from current branch)
vv watch-pr

# Check specific PR
vv watch-pr 90

# Force YAML output (for parsing)
vv watch-pr 90 --yaml

# Check PR in different repo
vv watch-pr 42 --repo jdutton/vibe-validate
```

### AI Agent Workflow
```bash
# AI agent checks PR (always use --yaml for parsing)
vv watch-pr 90 --yaml

# Parse result and make decisions
# - If passed: proceed with merge
# - If failed: extract errors from checks.github_actions[].extraction
```

### Debugging Failed Runs
```bash
# List all runs for PR with pass/fail summary
vv watch-pr 90 --history

# Watch specific failed run (useful for testing extraction)
vv watch-pr 90 --run-id 20275187200 --yaml
```

### Cross-Repository Monitoring
```bash
# Monitor PR in another repository
vv watch-pr 104 --repo jdutton/mcp-typescript-simple

# Watch specific run in another repo
vv watch-pr 104 --run-id 19754182675 --repo jdutton/mcp-typescript-simple --yaml
```

## Options

### `--yaml`
Force YAML output (auto-enabled on failure).

**Default behavior:**
- Failed PR: YAML output (for AI agent parsing)
- Passed PR: Human-friendly text output

**Example:**
```bash
# Force YAML even on success
vv watch-pr 90 --yaml
```

### `--repo <owner/repo>`
Specify repository (default: auto-detect from git remote).

**When to use:**
- Monitoring PRs in repositories other than current directory
- CI/CD pipelines watching multiple repositories
- Cross-repository validation workflows

**Format:** `owner/repo` (e.g., `jdutton/vibe-validate`)

**Example:**
```bash
vv watch-pr 42 --repo jdutton/vibe-validate
```

### `--history`
Show historical runs for the PR with pass/fail summary table.

**Output:**
- Run ID, conclusion, duration, workflow name, started time
- Useful for identifying patterns (flaky tests, recent regressions)
- Includes tip showing how to drill into specific run

**Example:**
```bash
vv watch-pr 90 --history

📋 Workflow Runs for PR #90

   RUN ID       CONCLUSION  DURATION  WORKFLOW                      STARTED
   ────────────────────────────────────────────────────────────────────────────────────────────────
✅  20275187200 success     2m 14s    Validate                      12/18/2025, 10:45:23 AM
❌  20275050123 failure     2m 8s     Validate                      12/18/2025, 10:30:15 AM
✅  20274230704 success     2m 10s    Validate                      12/18/2025, 9:12:45 AM

💡 Tip: Use --run-id <id> to drill into a specific run for extraction testing
   Example: vv watch-pr 90 --run-id 20275187200
```

### `--run-id <id>`
Watch specific run ID instead of latest checks.

**Use cases:**
- Testing error extraction with historical failed runs
- Investigating specific failures without re-running checks
- Debugging extraction logic with known failures
- Comparing extraction across different runs

**Example:**
```bash
# Watch specific failed run
vv watch-pr 90 --run-id 20275187200 --yaml

# Use with --history to find run IDs
vv watch-pr 90 --history
vv watch-pr 90 --run-id <id-from-history>
```

## Output Formats

### YAML Output (Auto on Failure, or with --yaml)

Complete structured output for AI agent parsing:

```yaml
---
pr:
  number: 90
  title: "Enhancement: Add watch-pr improvements"
  url: "https://github.com/jdutton/vibe-validate/pull/90"
  branch: "feature/watch-pr"
  base_branch: "main"
  author: "jdutton"
  draft: false
  mergeable: true
  merge_state_status: "CLEAN"
  labels: ["enhancement"]
  linked_issues:
    - number: 42
      title: "Improve watch-pr output"
      url: "https://github.com/jdutton/vibe-validate/issues/42"

status: failed

checks:
  total: 3
  passed: 2
  failed: 1
  pending: 0
  history_summary:
    total_runs: 10
    recent_pattern: "Failed last 2 runs"
    success_rate: "80%"

  github_actions:
    - name: "Test / Node 20 / ubuntu-latest"
      status: completed
      conclusion: failure
      run_id: 20275187200
      workflow: "Validate"
      started_at: "2025-12-18T10:45:23Z"
      duration: "2m 14s"
      extraction:
        errors:
          - file: "packages/cli/test/commands/watch-pr.test.ts"
            line: 42
            column: 5
            message: "Expected 5 to equal 3"
        summary: "1 test failure"
        totalErrors: 1
        guidance: "Review test assertion at line 42"

    - name: "Lint"
      status: completed
      conclusion: success
      run_id: 20275187201
      workflow: "Validate"
      started_at: "2025-12-18T10:45:25Z"
      duration: "1m 8s"

  external_checks:
    - name: "codecov/patch"
      status: completed
      conclusion: success
      url: "https://codecov.io/gh/jdutton/vibe-validate/pull/90"
      provider: "codecov"
      extracted:
        summary: "Coverage: 96.15% (+0.12%)"
        severity: info

changes:
  files_changed: 15
  insertions: 450
  deletions: 120
  commits: 8
  top_files:
    - path: "packages/cli/src/services/watch-pr-orchestrator.ts"
      additions: 120
      deletions: 0
      change_type: "added"

guidance:
  status: failed
  blocking: false
  severity: error
  summary: "1 check(s) failed"
  next_steps:
    - action: "Fix Test / Node 20 / ubuntu-latest failure"
      url: "https://github.com/jdutton/vibe-validate/actions/runs/20275187200"
      severity: error
      reason: "1 error(s) detected"

cache:
  location: "/tmp/vibe-validate/watch-pr-cache/jdutton_vibe-validate/90"
  cached_at: "2025-12-18T10:50:15Z"
  expires_at: "2025-12-18T10:55:15Z"
```

### Text Output (On Success, unless --yaml)

Human-friendly summary for terminal use:

```
🔍 PR #90: Enhancement: Add watch-pr improvements
   https://github.com/jdutton/vibe-validate/pull/90

✅ Test / Node 20 / ubuntu-latest           success
✅ Lint                                      success
✅ codecov/patch                             success

3/3 checks passed

All checks passed

Next steps:
ℹ️ Ready to merge
```

## Extraction Modes

The `watch-pr` command supports two extraction modes for GitHub Actions logs:

### Matrix Mode (vibe-validate Repositories)

**When:** Check uses `vv run` or `vv validate` (outputs YAML with extraction field)

**How it works:**
1. Detects YAML markers (`---...---`) in logs
2. Parses YAML structure
3. Extracts `extraction` field from failed steps
4. **Passes through extraction unchanged** (faithful pass-through)

**Example YAML in logs:**
```yaml
---
passed: false
phases:
  - name: Testing
    steps:
      - name: vitest
        passed: false
        extraction:
          errors:
            - file: "test.ts"
              line: 42
              message: "Expected success"
          summary: "1 test failure"
          totalErrors: 1
---
```

**Resulting extraction:**
```yaml
extraction:
  errors:
    - file: "test.ts"
      line: 42
      message: "Expected success"
  summary: "1 test failure"
  totalErrors: 1
```

### Non-Matrix Mode (Other Repositories)

**When:** Check outputs raw test/lint output (no vibe-validate)

**How it works:**
1. Detects test framework from logs (vitest, jest, eslint, etc.)
2. Runs appropriate extractor on raw output
3. Builds `ErrorExtractorResult` with errors + summary
4. Includes `metadata.detection.extractor` field

**Example raw logs:**
```
FAIL test/integration.test.ts:42:5
  ● Connection Tests › should connect

    Error: Connection refused
        at connect (src/client.ts:10:12)
```

**Resulting extraction:**
```yaml
extraction:
  errors:
    - file: "test/integration.test.ts"
      line: 42
      message: "Connection refused"
  summary: "1 test failure"
  totalErrors: 1
  metadata:
    detection:
      extractor: vitest
```

## External Check Extraction

External checks (codecov, SonarCloud, etc.) are automatically detected and summarized:

### Codecov
```yaml
- name: "codecov/patch"
  conclusion: success
  url: "https://codecov.io/..."
  provider: "codecov"
  extracted:
    summary: "Coverage: 96.15% (+0.12%)"
    severity: info
```

### SonarCloud
```yaml
- name: "SonarCloud Code Analysis"
  conclusion: failure
  url: "https://sonarcloud.io/..."
  provider: "sonarcloud"
  extracted:
    summary: "Quality Gate: Failed (3 issues)"
    severity: error
```

## Caching

Results are cached locally with 5-minute TTL for fast iteration:

### Cache Directory Structure
```
/tmp/vibe-validate/watch-pr-cache/<owner>_<repo>/<pr-number>/
├── metadata.json              # Complete WatchPRResult
├── logs/
│   ├── 20275187200.log       # Raw logs from run 20275187200
│   └── 20275187201.log       # Raw logs from run 20275187201
└── extractions/
    ├── 20275187200.json      # Extracted errors (for re-extraction)
    └── 20275187201.json
```

### Cache Benefits
- **Fast iteration**: 24x speedup (2.6s → 0.1s with cache)
- **Offline debugging**: Logs cached for offline extraction testing
- **Re-extraction**: Test new extractors on cached logs without re-fetching

### Cache Info in Output
```yaml
cache:
  location: "/tmp/vibe-validate/watch-pr-cache/jdutton_vibe-validate/90"
  cached_at: "2025-12-18T10:50:15Z"
  expires_at: "2025-12-18T10:55:15Z"  # 5 minute TTL
```

## Common Workflows

### Standard PR Review
```bash
# 1. Check PR status
vv watch-pr 90

# 2. If failed, view extraction details
vv watch-pr 90 --yaml | yq '.checks.github_actions[0].extraction'

# 3. View specific error file
vv watch-pr 90 --yaml | yq '.checks.github_actions[0].extraction.errors[0]'

# 4. Re-run failed check
gh run rerun <run-id> --failed
```

### AI Agent Workflow
```bash
# 1. AI agent checks PR (always YAML for parsing)
vv watch-pr 90 --yaml

# 2. Parse status
# status: failed → extract errors and fix
# status: passed → proceed with merge
# status: pending → wait and re-check

# 3. If failed, extract actionable errors
# checks.github_actions[].extraction.errors[] → file:line:message

# 4. Fix errors and push

# 5. Re-check
vv watch-pr 90 --yaml
```

### Debugging Extraction with Historical Runs
```bash
# 1. List historical runs
vv watch-pr 90 --history

# 2. Find failed run ID
# Example: 20275050123 (failure)

# 3. Watch specific run
vv watch-pr 90 --run-id 20275050123 --yaml

# 4. Inspect extraction
vv watch-pr 90 --run-id 20275050123 --yaml | yq '.checks.github_actions[0].extraction'

# 5. Test extraction improvements
# (Logs cached locally, so no re-fetching needed)
```

### Cross-Repository Monitoring
```bash
# Monitor PR in multiple repos
vv watch-pr 42 --repo company/frontend --yaml
vv watch-pr 15 --repo company/backend --yaml
vv watch-pr 8 --repo company/api --yaml

# Aggregate results for dashboard
for pr in frontend:42 backend:15 api:8; do
  repo=${pr%:*}
  num=${pr#*:}
  vv watch-pr $num --repo company/$repo --yaml | yq '.status'
done
```

## Exit Codes

- `0` - All checks passed (or --history flag used)
- `1` - One or more checks failed, pending, or usage error

## Integration with AI Agents

This command is specifically designed for AI coding assistants:

### Context Window Savings
**Without watch-pr:**
- Open GitHub PR page in browser
- Read full check logs (200+ lines per check)
- Parse HTML/markdown manually
- Extract file:line:message by hand

**With watch-pr:**
```bash
vv watch-pr 90 --yaml
# → Structured YAML with errors extracted
# → 95% reduction in tokens
# → All info in one command
```

### Structured Guidance
```yaml
guidance:
  status: failed
  blocking: false
  severity: error
  summary: "1 check(s) failed"
  next_steps:
    - action: "Fix Test failure"
      url: "https://github.com/.../runs/123"
      severity: error
      reason: "3 error(s) detected"
```

AI agents can:
1. Parse `status` field for quick decision
2. Read `summary` for context
3. Follow `next_steps` with priority (severity)
4. Extract errors from `checks.github_actions[].extraction.errors[]`

### History Context
```yaml
checks:
  history_summary:
    total_runs: 10
    recent_pattern: "Failed last 2 runs"
    success_rate: "80%"
```

Helps agents:
- Identify flaky tests ("Flaky (alternating)")
- Detect regressions ("Failed last N runs")
- Understand stability ("Passed last N runs")

## Supported Extractors

### GitHub Actions Logs (Matrix Mode)
- **vibe-validate validate**: Pass-through extraction from YAML
- **vibe-validate run**: Pass-through extraction from YAML

### GitHub Actions Logs (Non-Matrix Mode)
- **vitest**: Test failures with file/line/message
- **jest**: Test failures with stack traces
- **eslint**: Lint errors with rules
- **tsc**: TypeScript errors
- **mocha**: Test failures
- **jasmine**: Spec failures
- **junit**: XML test results
- **generic**: Fallback for unknown formats

### External Checks
- **codecov**: Coverage percentages and changes
- **SonarCloud**: Quality gate status and issue counts

## Comparison

### Before v0.18.0 (Old Schema)
```yaml
pr:
  id: 90
  title: "Enhancement"
  url: "https://..."

status: "in_progress"
result: "failure"
duration: "2m 14s"
summary: "Tests failed"

checks:
  - name: "Test"
    status: "completed"
    conclusion: "failure"
    duration: "2m 14s"
    url: "unknown"  # ❌ External checks broken

# ❌ No extraction support
# ❌ No history context
# ❌ No file changes
# ❌ No guidance
# ❌ No separation of GitHub Actions vs external
```

### After v0.18.0 (New Schema)
```yaml
pr:
  number: 90
  title: "Enhancement: Add watch-pr improvements"
  url: "https://github.com/jdutton/vibe-validate/pull/90"
  branch: "feature/watch-pr"
  base_branch: "main"
  author: "jdutton"
  draft: false
  mergeable: true
  merge_state_status: "CLEAN"
  labels: ["enhancement"]
  linked_issues: [...]

status: failed

checks:
  total: 3
  passed: 2
  failed: 1
  history_summary:          # ✅ NEW: Pattern context
    total_runs: 10
    recent_pattern: "Failed last 2 runs"
    success_rate: "80%"

  github_actions:           # ✅ NEW: Separate type
    - name: "Test"
      conclusion: failure
      run_id: 123
      extraction:           # ✅ NEW: Error extraction
        errors: [...]
        summary: "1 test failure"

  external_checks:          # ✅ NEW: Separate type
    - name: "codecov/patch"
      url: "https://..."    # ✅ FIXED: Real URLs
      extracted:            # ✅ NEW: Summaries
        summary: "Coverage: 96.15%"

changes:                    # ✅ NEW: File context
  files_changed: 15
  insertions: 450
  deletions: 120

guidance:                   # ✅ NEW: Next steps
  summary: "1 check(s) failed"
  next_steps: [...]

cache:                      # ✅ NEW: Cache info
  location: "/tmp/..."
```

**Key improvements:**
- ✅ **Error extraction** (matrix + non-matrix modes)
- ✅ **Separate check types** (GitHub Actions vs external)
- ✅ **History summary** (success rate, patterns)
- ✅ **File changes** (insertions/deletions, top files)
- ✅ **Intelligent guidance** (severity-based next steps)
- ✅ **Cache transparency** (location, TTL)
- ✅ **Fixed external check URLs** (no more "unknown")
- ✅ **Auto-YAML on failure** (consistent with validate)
- ✅ **Newspaper ordering** (most important info first)

## Requirements

- **gh CLI**: GitHub CLI must be installed and authenticated
- **Git repository**: Must be run in or reference a GitHub repository
- **Internet connection**: Fetches data from GitHub API

## Limitations

- **GitHub only**: Does not support GitLab, Bitbucket, or other platforms
- **Public/accessible repos**: Must have permission to access repository via gh CLI
- **Rate limits**: GitHub API rate limits apply (60 requests/hour unauthenticated, 5000/hour authenticated)

## Troubleshooting

### "Could not detect repository from git remote"
**Solution:** Use `--repo` flag explicitly:
```bash
vv watch-pr 90 --repo owner/repo
```

### "Could not auto-detect PR from current branch"
**Solution:** Provide PR number explicitly:
```bash
vv watch-pr 90
```

### External check extraction failed
**Solution:** Check if extractor is supported. Currently supported:
- codecov
- SonarCloud

Unsupported external checks will show basic status without extraction.

### No extraction in failed GitHub Actions check
**Possible causes:**
1. Logs don't match any extractor pattern (falls back to generic)
2. Logs are empty or truncated
3. Check succeeded (extraction only runs on failures)

**Solution:** View raw logs to debug:
```bash
gh run view <run-id> --log
```

## See Also

- [run command](./run.md) - Run commands with LLM-friendly error extraction
- [validate command](../skill/resources/cli-reference.md#validate) - Run validation phases
- [history command](../skill/resources/cli-reference.md#history) - View validation timeline
- [Git-Based Validation Tracking](../git-validation-tracking.md) - Architecture details

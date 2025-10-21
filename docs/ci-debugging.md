# CI Debugging Guide

Comprehensive guide for debugging validation failures in CI environments.

## Table of Contents

- [Common CI Failure Patterns](#common-ci-failure-patterns)
- [Debugging with Verbose Output](#debugging-with-verbose-output)
- [Testing CI Locally with act](#testing-ci-locally-with-act)
- [Environment Differences](#environment-differences)
- [Reading CI Logs Effectively](#reading-ci-logs-effectively)
- [Best Practices](#best-practices)

## Common CI Failure Patterns

### Pattern 1: Tests Pass Locally But Fail in CI

**Symptom**: All tests pass on your machine, but fail in GitHub Actions/GitLab CI

**Common Causes**:

#### 1. Missing Git Branches

**Problem**: GitHub Actions only checks out the PR branch by default, not the full repository.

**Manifestation**:
```
❌ Git main branch
   Configured main branch 'main' does not exist locally
```

**Solution**: Add `fetch-depth: 0` to your workflow checkout step:

```yaml
# .github/workflows/validate.yml
steps:
  - uses: actions/checkout@v4
    with:
      fetch-depth: 0  # Fetch all branches and history
```

**Why this matters**:
- Commands like `git diff origin/main` require the main branch to exist
- Some validation checks compare current branch against main
- Doctor command validates git configuration

#### 2. Environment Differences

**Different Node.js versions**:
```yaml
# Test multiple Node versions
strategy:
  matrix:
    node: ['20', '22', '24']
```

**Different operating systems**:
```yaml
# Test multiple OS
strategy:
  matrix:
    os: [ubuntu-latest, macos-latest, windows-latest]
```

**Different timezone or locale**:
- Date parsing might behave differently
- File path separators (Windows uses `\`, Unix uses `/`)
- Line endings (CRLF vs LF)

#### 3. Missing Environment Variables

**Problem**: Tests rely on secrets not configured in CI

**Solution**: Check required environment variables in your workflow:

```yaml
env:
  NODE_ENV: test
  DATABASE_URL: ${{ secrets.DATABASE_URL }}
```

### Pattern 2: No Error Details in CI Logs

**Symptom**: CI says "tests failed" but shows no details about which tests or why

**Root Cause**: Test output not visible in CI logs

**Solution**: vibe-validate automatically streams command output in real-time (as of v0.9.8). Combined with verbose test reporting in CI:

```yaml
# vibe-validate.config.yaml
validation:
  phases:
    - name: Testing
      steps:
        - name: Unit Tests
          # Verbose in CI via environment variable expansion
          command: npm test ${CI:+-- --reporter=verbose}
```

### Pattern 3: Validation State Not Recorded

**Symptom**: Validation fails but `vibe-validate state` shows no results

**Cause**: Command crashed before runner could write state to git notes

**Solution**: Check for:
- Out of memory errors
- Segmentation faults
- Process killed by timeout
- Configuration syntax errors
- Git notes write failures (rare)

## Debugging with Verbose Output

### Real-Time Output Streaming

vibe-validate (v0.9.8+) streams all command output in real-time, so you see:

```
🔍 Running Testing (1 steps in parallel)...
   ⏳ Unit Tests with Coverage  →  npm test -- --reporter=verbose

 RUN  v3.2.4 /path/to/project

 ✓ packages/cli/test/commands/validate.test.ts
   ✓ should validate successfully
   ✗ should handle errors

 FAIL  packages/cli/test/commands/validate.test.ts > should handle errors
 AssertionError: expected 'PASSED' to be 'FAILED'
   at /path/to/test.ts:42:20

      ❌ Unit Tests with Coverage - FAILED (15.3s)
```

### Enable Verbose Reporting

#### For vitest:
```javascript
command: process.env.CI
  ? 'vitest run --reporter=verbose'
  : 'vitest run'
```

#### For jest:
```javascript
command: process.env.CI
  ? 'jest --verbose --no-coverage'
  : 'jest'
```

#### For mocha:
```javascript
command: process.env.CI
  ? 'mocha --reporter spec'
  : 'mocha --reporter dot'
```

### Accessing State File in CI

If validation fails, the state file is uploaded as an artifact:

```yaml
# In your workflow
- name: Extract validation state on failure
  if: failure()
  run: |
    echo "## Validation State" >> $GITHUB_STEP_SUMMARY
    vibe-validate state >> $GITHUB_STEP_SUMMARY || echo "No state available" >> $GITHUB_STEP_SUMMARY
```

View it from the GitHub Actions UI:
1. Go to failed workflow run
2. Click on the job summary
3. View the "Validation State" section
4. Inspect the YAML output for error details

**Alternative**: Use `vibe-validate watch-pr <PR>` locally to extract state from failed CI runs

## Testing CI Locally with act

[nektos/act](https://github.com/nektos/act) runs GitHub Actions workflows locally using Docker.

### Installation

```bash
# macOS
brew install act

# Windows
choco install act-cli

# Linux
curl https://raw.githubusercontent.com/nektos/act/master/install.sh | sudo bash
```

### Usage

```bash
# Run pull request workflow
act pull_request

# Run specific job
act -j validate

# Run with specific matrix combination
act -j validate --matrix os:ubuntu-latest --matrix node:20

# List available workflows
act -l

# Dry run (show what would execute)
act -n
```

### Benefits

- **Fast feedback**: Test CI changes locally before pushing
- **No commit pollution**: Avoid "fix CI" commits
- **Reproducible**: Same environment as GitHub Actions
- **Cost-effective**: No CI minutes consumed

### Limitations

- **Linux only**: Only supports `ubuntu-latest` runners
  - Cannot test macOS or Windows-specific issues
- **Not identical**: Some GitHub-specific features won't work
  - GitHub tokens, secrets may behave differently
  - Some actions might not work exactly the same
- **Resource intensive**: Runs in Docker containers

### Best Practice Workflow

```bash
# 1. Make changes to workflow
vim .github/workflows/validate.yml

# 2. Test locally with act
act pull_request

# 3. If it passes, push
git add .github/workflows/validate.yml
git commit -m "chore: update CI workflow"
git push

# 4. Verify in real GitHub Actions
# (act can't catch OS-specific or Windows/macOS issues)
```

## Environment Differences

### Node.js Version Differences

Different Node versions may have:
- Different default behaviors
- Different available APIs
- Different module resolution

**Solution**: Test matrix with multiple Node versions:

```yaml
strategy:
  matrix:
    node: ['20', '22', '24']
```

### Operating System Differences

**File paths**:
```javascript
// ❌ Breaks on Windows
const path = 'src/components/Button.tsx';

// ✅ Cross-platform
const path = require('path').join('src', 'components', 'Button.tsx');
```

**Line endings**:
```bash
# Configure git to normalize line endings
git config core.autocrlf true  # Windows
git config core.autocrlf input # Unix/macOS
```

**Shell commands**:
```yaml
# ❌ Unix-specific
run: ls -la && grep "foo" file.txt

# ✅ Cross-platform (use Node.js)
run: node scripts/check-file.js
```

### CI-Specific Environment Variables

Detect CI environment:

```javascript
const isCI = process.env.CI === 'true';
const isGitHubActions = process.env.GITHUB_ACTIONS === 'true';
const isGitLabCI = process.env.GITLAB_CI === 'true';
```

## Reading CI Logs Effectively

### Finding the Actual Error

CI logs can be verbose. Look for these markers:

**GitHub Actions**:
```
##[error]Process completed with exit code 1
```

**vitest verbose output**:
```
 FAIL  packages/cli/test/commands/validate.test.ts
```

**TypeScript errors**:
```
error TS2322: Type 'string' is not assignable to type 'number'
```

### Using GitHub Actions Log Search

1. Open failed workflow run
2. Click on failed job
3. Use browser search (Ctrl/Cmd+F)
4. Search for keywords:
   - `FAIL`
   - `Error`
   - `✗`
   - `AssertionError`
   - `exit code 1`

### Downloading Full Logs

```bash
# Using GitHub CLI
gh run view <run-id> --log > ci-logs.txt

# Search in downloaded logs
grep -A 10 "FAIL" ci-logs.txt
```

## Best Practices

### 1. Always Use Verbose Output in CI

```javascript
export default {
  validation: {
    phases: [{
      steps: [{
        name: 'Tests',
        command: process.env.CI
          ? 'npm test -- --reporter=verbose --no-coverage'
          : 'npm test',
      }]
    }]
  }
}
```

**Why**: When CI fails, you need maximum information immediately.

### 2. Enable Artifact Upload

```yaml
- name: Extract validation state to job summary
  if: failure()
  run: |
    echo "## Validation State" >> $GITHUB_STEP_SUMMARY
    vibe-validate state >> $GITHUB_STEP_SUMMARY
```

**Why**: Provides structured error details even when logs are unclear.

**Tip**: Use `vibe-validate watch-pr <PR>` to retrieve state from failed CI runs.

### 3. Test Locally with act Before Pushing

```bash
act pull_request  # Test before pushing
```

**Why**: Catches CI configuration errors without polluting commit history.

### 4. Use Matrix Testing Strategically

```yaml
strategy:
  matrix:
    os: [ubuntu-latest]  # Start with one OS
    node: ['20', '22']    # Test LTS versions
```

**Why**: Balance coverage vs CI time. Add more combinations only if needed.

### 5. Set Appropriate Timeouts

```yaml
- name: Run validation
  run: pnpm validate
  timeout-minutes: 15  # Prevent hanging forever
```

**Why**: Prevents jobs from hanging indefinitely, wasting CI minutes.

### 6. Add Fetch Depth for Git Operations

```yaml
- uses: actions/checkout@v4
  with:
    fetch-depth: 0  # Required for git-based checks
```

**Why**: Many git commands require branch history.

### 7. Cache Dependencies

```yaml
- uses: actions/setup-node@v4
  with:
    node-version: 20
    cache: 'pnpm'  # Cache pnpm dependencies
```

**Why**: Speeds up CI runs significantly (2-3x faster).

## Troubleshooting Checklist

When CI fails but tests pass locally:

- [ ] Check Node.js version matches between local and CI
- [ ] Verify all environment variables are set in CI
- [ ] Confirm git branches are fetched (`fetch-depth: 0`)
- [ ] Look for OS-specific code (file paths, shell commands)
- [ ] Check for timezone/locale-dependent tests
- [ ] Verify dependencies are installed correctly
- [ ] Look for race conditions in parallel tests
- [ ] Check if verbose output is enabled in CI
- [ ] Download and inspect state file artifact
- [ ] Test locally with `act` to reproduce

## See Also

- [Configuration Reference](./configuration-reference.md) - Environment-specific commands
- [Local Development Guide](./local-development.md) - Testing changes locally
- [Agent Integration Guide](./agent-integration-guide.md) - LLM-friendly output

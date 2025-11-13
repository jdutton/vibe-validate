# Claude Code Plugin Testing Guide

Comprehensive testing checklist for the vibe-validate Claude Code plugin.

## Prerequisites

1. **Install vibe-validate globally**:
   ```bash
   npm install -g vibe-validate@latest
   ```

2. **Verify Claude CLI is installed**:
   ```bash
   claude --version
   ```

## Part 1: Plugin Installation Testing

### 1.1 Validate Plugin Manifest

```bash
cd /path/to/vibe-validate
claude plugin validate ./plugins/claude-code
```

**Expected**: `✔ Validation passed`

### 1.2 Install Plugin from Local Repository

```bash
# Add marketplace (if not already added)
claude plugin marketplace add /path/to/vibe-validate

# List marketplaces to verify
claude plugin marketplace list

# Install plugin
claude plugin install vibe-validate@<marketplace-name>
```

**Expected**: `✔ Successfully installed plugin: vibe-validate@<marketplace-name>`

### 1.3 Verify Plugin Files

Check that plugin files are correctly structured:

```bash
ls -R /path/to/vibe-validate/plugins/claude-code/
```

**Expected structure**:
```
.claude-plugin/plugin.json
agents/vibe-validate.md
skills/vibe-validate-run.md
README.md
```

## Part 2: Non-Node.js Project Testing (Python)

### 2.1 Create Test Python Project

```bash
mkdir -p /tmp/test-python-vv
cd /tmp/test-python-vv

# Create test file with intentional failure
cat > test_sample.py << 'EOF'
def add(a, b):
    return a + b

def test_add():
    assert add(2, 2) == 4

def test_add_fails():
    assert add(2, 2) == 5  # Intentional failure
EOF

# Initialize git (required for tree hash)
git init
git add test_sample.py
git commit -m "Initial commit"
```

### 2.2 Test vibe-validate run Command

```bash
# Run pytest through vibe-validate
vibe-validate run "python3 -m pytest test_sample.py -v"
```

**Expected output**:
```yaml
---
command: python3 -m pytest test_sample.py -v
exitCode: 1
durationSecs: 0.xxx
timestamp: 2025-xx-xxTxx:xx:xx.xxxZ
treeHash: <hash>
extraction:
  errors: []
  summary: Command failed - see output
  totalErrors: 0
  guidance: Review the output above and fix the errors
  errorSummary: |-
    test_sample.py::test_add_fails FAILED [100%]
    ...
    FAILED test_sample.py::test_add_fails - assert 4 == 5
outputFiles:
  stdout: /var/folders/.../vibe-validate/runs/.../stdout.log
  combined: /var/folders/.../vibe-validate/runs/.../combined.jsonl
---
```

**Verify**:
- ✅ Both opening and closing `---` separators present
- ✅ exitCode: 1 (test failed)
- ✅ errorSummary contains failure details
- ✅ outputFiles paths are valid
- ✅ treeHash is a valid git hash

### 2.3 Test Caching

```bash
# Run again immediately (should hit cache)
time vibe-validate run "python3 -m pytest test_sample.py -v"
```

**Expected**:
- Same YAML output
- Execution time < 500ms (cache hit)
- No actual pytest execution

### 2.4 Test Cache Invalidation

```bash
# Modify test file
echo "# comment" >> test_sample.py
git add test_sample.py
git commit -m "Update test"

# Run again (should miss cache and re-execute)
vibe-validate run "python3 -m pytest test_sample.py -v"
```

**Expected**:
- Cache miss
- New treeHash value
- Pytest executes again

### 2.5 Test --check Flag

```bash
# Check if cached result exists (without executing)
vibe-validate run --check "python3 -m pytest test_sample.py -v"
```

**Expected**:
- Exit code 0 (cache hit)
- YAML output with cached result
- No pytest execution

### 2.6 Test --force Flag

```bash
# Force re-execution (bypass cache)
vibe-validate run --force "python3 -m pytest test_sample.py -v"
```

**Expected**:
- Cache bypassed
- Pytest executes
- Cache updated with new result

## Part 3: Node.js Project Testing

### 3.1 Create Test Node.js Project

```bash
mkdir -p /tmp/test-node-vv
cd /tmp/test-node-vv

# Initialize package.json
npm init -y
npm install -D vitest

# Create test file
cat > test.js << 'EOF'
import { test, expect } from 'vitest';

test('should pass', () => {
  expect(1 + 1).toBe(2);
});

test('should fail', () => {
  expect(1 + 1).toBe(3);  // Intentional failure
});
EOF

# Initialize git
git init
git add .
git commit -m "Initial commit"
```

### 3.2 Test with npx

```bash
vibe-validate run "npx vitest run test.js"
```

**Expected**:
- Vitest executes
- YAML output with error extraction
- exitCode: 1
- errors array populated with failure details

### 3.3 Test with Package Script

```bash
# Add vibe-validate script to package.json
npm pkg set scripts.vv="vibe-validate"

# Run using package script
npm run vv run "npx vitest run test.js"
```

**Expected**: Same as npx test above

## Part 4: Skill Testing (Claude Code Session)

These tests require an active Claude Code session.

### 4.1 Test Autonomous Command Wrapping

**In Claude Code session**, ask:

```
User: "Run the tests in test.js"
```

**Expected Claude behavior** (from vibe-validate-run skill):
1. Detects this is a test command
2. Automatically wraps with `vibe-validate run`
3. Executes: `vibe-validate run "npx vitest run test.js"`
4. Presents concise error output

### 4.2 Test Agent Guidance

**In Claude Code session**, ask:

```
User: "How do I use vibe-validate for pre-commit validation?"
```

**Expected Claude behavior** (from vibe-validate agent):
1. Provides pre-commit workflow guidance
2. Shows `npx vibe-validate pre-commit` command
3. Explains caching benefits
4. Shows state query command

### 4.3 Test Context Detection

**Test 1 - Node.js project with script**:
```
User: "Run npm test"
```

**Expected**: `npm run vv run "npm test"` or `pnpm vv run "npm test"`

**Test 2 - Node.js project without script**:
```
User: "Run the linter"
```

**Expected**: `npx vibe-validate run "npm run lint"`

**Test 3 - Non-Node.js project**:
```
User: "Run pytest"
```

**Expected**: `npx vibe-validate run "pytest"`

## Part 5: Plugin Update Testing

### 5.1 Update Plugin Version

```bash
# In vibe-validate repo, update version
cd /path/to/vibe-validate
# (ensure version in plugin.json is updated)

# Uninstall and reinstall
claude plugin uninstall vibe-validate
claude plugin install vibe-validate@<marketplace-name>
```

**Expected**: New version installed

### 5.2 Verify Version

Check `plugins/claude-code/.claude-plugin/plugin.json`:

```bash
jq .version plugins/claude-code/.claude-plugin/plugin.json
```

**Expected**: Current version number (e.g., `"0.15.0"`)

## Part 6: Error Scenarios

### 6.1 Test Invalid Command

```bash
vibe-validate run "nonexistent-command"
```

**Expected**:
- exitCode: 127 (command not found)
- errorSummary: "command not found"
- Graceful handling

### 6.2 Test Non-Git Directory

```bash
mkdir -p /tmp/no-git-test
cd /tmp/no-git-test
echo "test" > file.txt

vibe-validate run "echo test"
```

**Expected**:
- Falls back to timestamp-based directory
- Warning about git tree hash unavailable
- Command still executes

### 6.3 Test Empty Output

```bash
vibe-validate run "true"
```

**Expected**:
- exitCode: 0
- No stdout/stderr files created (empty output)
- combined.jsonl created (even if empty)

## Part 7: Integration Testing

### 7.1 Test Full Validation Workflow

```bash
# In a real project with vibe-validate.config.yaml
cd /path/to/vibe-validate
vibe-validate validate
```

**Expected**:
- Multiple phases execute in parallel
- Results cached
- State stored in git notes
- Summary output

### 7.2 Test State Query

```bash
vibe-validate state
```

**Expected**:
- Current validation state displayed
- File paths to error details
- No re-execution

### 7.3 Test History

```bash
vibe-validate history list
```

**Expected**:
- Timeline of validation runs
- Tree hashes and timestamps
- Pass/fail status

## Troubleshooting

### Plugin Not Loading

```bash
# Check marketplace list
claude plugin marketplace list

# Re-add if needed
claude plugin marketplace add /path/to/vibe-validate

# Reinstall
claude plugin uninstall vibe-validate
claude plugin install vibe-validate@<marketplace-name>
```

### Skill Not Triggering

The skill triggers automatically on test/validation commands. If not working:

1. Verify plugin is installed
2. Check agent/skill files exist
3. Try explicitly mentioning vibe-validate in prompt

### Cache Issues

```bash
# Clear run cache
vibe-validate history prune --run --all

# Force fresh execution
vibe-validate run --force "<command>"
```

## Success Criteria

All tests pass if:

- ✅ Plugin validates and installs successfully
- ✅ `vibe-validate run` works in Python project (non-Node.js)
- ✅ `vibe-validate run` works in Node.js project
- ✅ YAML output has both opening and closing `---` separators
- ✅ Caching works (instant cache hits)
- ✅ Cache invalidates on code changes
- ✅ Skills trigger autonomously in Claude Code sessions
- ✅ Agent provides accurate guidance
- ✅ Error extraction produces concise output
- ✅ Tree hash calculated correctly
- ✅ Output files created in correct locations

## Cleanup

```bash
# Remove test directories
rm -rf /tmp/test-python-vv
rm -rf /tmp/test-node-vv
rm -rf /tmp/no-git-test

# (Optional) Uninstall plugin
claude plugin uninstall vibe-validate
```

## Next Steps

After successful testing:

1. **Document any issues found** in GitHub issues
2. **Update plugin README** with testing results
3. **Prepare for npm marketplace publication**
4. **Create release notes** highlighting plugin capabilities

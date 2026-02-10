# Dependency Lock Check

Prevent cache poisoning from stale dependencies by verifying lock files are in sync before validation runs.

## Overview

Dependency lock check verifies that your lock file (`package-lock.json`, `pnpm-lock.yaml`, etc.) is in sync with `package.json` **before validation runs**. This prevents cache poisoning where tests pass locally with stale dependencies but fail in CI with fresh installs.

**Prevention happens at validation time**, not at commit time. The check only runs when validation is about to execute (cache miss), saving time when code hasn't changed.

## The Cache Poisoning Problem

**Scenario without dependency lock check:**
1. Developer updates `package.json` (adds new dependency or changes version)
2. Developer forgets to run `npm install`
3. Tests run with **stale node_modules** (old dependency versions)
4. Tests pass incorrectly and result gets cached by vibe-validate
5. CI fails because it does fresh install with correct dependencies
6. Developer confused: "It worked locally!"

**With dependency lock check:**
- Step 3 is prevented - lock file verification catches the mismatch
- Validation is blocked until `npm install` is run
- Cache is only populated with validated results from correct dependencies

## Quick Start

### 1. Configure Dependency Lock Check

Add to your `vibe-validate.config.yaml`:

```yaml
ci:
  packageManager: pnpm  # Optional: auto-detected from lock files

  dependencyLockCheck:
    runOn: pre-commit  # Run before commits (recommended)
```

### 2. Test It

Try making a change to `package.json` without running install:

```bash
# Add a dependency to package.json
npm pkg set dependencies.lodash="4.17.21"

# Try to commit (validation will run)
git add package.json
vv pre-commit  # This will fail!
```

**Expected output:**
```
🔍 Checking dependency lock file sync...
❌ Dependency lock check failed
Lock file verification failed: lockfile not updated

💡 To fix:
   1. Run: npm install
   2. Stage lock file: git add package-lock.json
   3. Try again: vv pre-commit
```

### 3. Fix and Retry

```bash
npm install
git add package-lock.json
vv pre-commit  # Now it passes!
```

## Configuration

### Basic Configuration

```yaml
ci:
  dependencyLockCheck:
    runOn: pre-commit  # When to run (validate, pre-commit, or disabled)
```

**`runOn` options:**
- `validate` - Run before every validation (recommended for strict projects)
- `pre-commit` - Run only during pre-commit workflow (recommended for most projects)
- `disabled` - Explicitly disable the check

**Default behavior:** If not configured, behaves as `pre-commit` but `vv doctor` will warn.

### Package Manager Override

Auto-detection is usually sufficient, but you can override:

```yaml
ci:
  packageManager: npm  # Used for all CI operations

  dependencyLockCheck:
    runOn: validate
    packageManager: pnpm  # Override detection for this check only
```

### Custom Install Command

For projects with special requirements:

```yaml
ci:
  dependencyLockCheck:
    runOn: validate
    command: "npm ci --legacy-peer-deps"
```

**Use cases:**
- Legacy peer dependency conflicts (`--legacy-peer-deps`)
- Custom registry configuration
- Projects with complex install requirements

### Complete Example

```yaml
ci:
  nodeVersions: ['20', '22']
  packageManager: pnpm

  dependencyLockCheck:
    runOn: pre-commit
    # packageManager: auto-detected (pnpm)
    # command: default (pnpm install --frozen-lockfile)
```

## Package Manager Support

### Supported Managers

| Package Manager | Lock File | Default Command | Auto-Detected |
|----------------|-----------|-----------------|---------------|
| npm | `package-lock.json` | `npm ci` | ✅ |
| pnpm | `pnpm-lock.yaml` | `pnpm install --frozen-lockfile` | ✅ |
| yarn | `yarn.lock` | `yarn install --immutable` | ✅ |
| bun | `bun.lockb` | `bun install --frozen-lockfile` | ✅ |

### Auto-Detection Priority

vibe-validate detects your package manager in this order:

1. **Config override**: `ci.dependencyLockCheck.packageManager`
2. **Fallback**: `ci.packageManager` (existing field)
3. **package.json field**: `"packageManager": "pnpm@9.0.0"`
4. **Lock file detection**: Checks for lock files in priority order (bun → yarn → pnpm → npm)

**Example: pnpm detection**

```json
{
  "packageManager": "pnpm@9.0.0"
}
```

vibe-validate reads this field and uses `pnpm install --frozen-lockfile`.

### Why These Commands?

**npm ci**:
- Deletes `node_modules` and does clean install
- Fails if lock file doesn't match `package.json`
- Faster than `npm install` (optimized for CI)

**pnpm/yarn/bun frozen-lockfile**:
- Installs exactly what's in lock file
- Fails if lock file is out of sync
- Preserves existing `node_modules`

## npm link Detection

### The npm link Problem

Running `npm ci` or frozen lockfile installs **removes symlinks** created by `npm link`. Developers use `npm link` for local package development - the check must not break this workflow.

### Auto-Skip Behavior

When symlinks are detected in `node_modules`, the check automatically skips:

```
🔍 Checking dependency lock file sync...
⚠️  Dependency lock check skipped (npm link detected)
   Linked packages:
   - @vibe-validate/core
   - @vibe-validate/utils
   To restore normal mode: npm unlink <package> && npm install
```

**Detection strategy:**
- Scans `node_modules` for symlinks using `fs.lstatSync()` (cross-platform)
- Checks top-level entries (`node_modules/lodash`)
- Recursively checks scoped packages (`node_modules/@org/package`)
- Works on Windows and Unix systems

### Manual Override

If you need to force the check even with `npm link`:

```bash
VV_SKIP_DEPENDENCY_CHECK=1 vv validate
```

This environment variable completely bypasses the check (useful for testing).

## When the Check Runs

### Cache Hit (No Check)

When code hasn't changed and validation result is cached:

```bash
$ vv validate
✅ Validation cached (< 1s)
# No dependency check - using cached result
```

**Rationale**: If validation already passed for this tree hash, dependencies were correct. Checking again wastes time.

### Cache Miss (Check Runs)

When code has changed or cache doesn't exist:

```bash
$ vv validate
🔍 Checking dependency lock file sync...
✅ Lock file verification passed
Phase 1: Pre-Qualification ━━━━━━━━━━━━━━━ 15s
Phase 2: Testing ━━━━━━━━━━━━━━━━━━━━━━━━ 75s
✅ Validation passed (90s)
```

### Context-Aware Execution

**`runOn: validate`** - Always runs (strict mode):
```bash
vv validate       # ✅ Runs dependency check
vv pre-commit     # ✅ Runs dependency check
```

**`runOn: pre-commit`** - Only in pre-commit workflow (recommended):
```bash
vv validate       # ❌ Skips dependency check
vv pre-commit     # ✅ Runs dependency check
```

**`runOn: disabled`** - Never runs:
```bash
vv validate       # ❌ Skips dependency check
vv pre-commit     # ❌ Skips dependency check
```

## Troubleshooting

### "Lock file verification failed"

**Problem**: Lock file doesn't match `package.json`

**Solutions**:
1. Run your package manager's install command:
   ```bash
   npm install    # or pnpm install, yarn install, bun install
   ```
2. Stage the updated lock file:
   ```bash
   git add package-lock.json  # or pnpm-lock.yaml, yarn.lock, bun.lockb
   ```
3. Try validation again:
   ```bash
   vv pre-commit
   ```

### "No package manager detected"

**Problem**: No lock file found in project root

**Causes**:
- Lock file not committed (check `.gitignore`)
- Wrong directory (not in project root)
- Lock file has non-standard name

**Solutions**:
1. Verify lock file exists:
   ```bash
   ls -la package-lock.json  # or your package manager's lock file
   ```
2. Generate lock file if missing:
   ```bash
   npm install  # Creates package-lock.json
   ```
3. Remove lock file from `.gitignore` if present
4. Explicitly configure package manager:
   ```yaml
   ci:
     dependencyLockCheck:
       packageManager: npm
   ```

### "Command not found: npm"

**Problem**: Package manager not installed or not in PATH

**Solutions**:
1. Install the package manager:
   ```bash
   # npm comes with Node.js
   # pnpm
   npm install -g pnpm
   # yarn
   npm install -g yarn
   # bun
   curl -fsSL https://bun.sh/install | bash
   ```
2. Verify installation:
   ```bash
   npm --version
   ```
3. Temporarily disable the check:
   ```yaml
   ci:
     dependencyLockCheck:
       runOn: disabled
   ```

### "Check is too slow"

**Problem**: Dependency check takes too long

**Analysis**: Modern package managers are fast:
- npm ci: 5-30 seconds (clean install)
- pnpm/yarn/bun frozen-lockfile: 2-10 seconds (incremental)

If it's slower:
1. Check if you're using custom command with extra operations
2. Verify network is not bottleneck (local cache should work)
3. Consider `runOn: pre-commit` instead of `validate` (runs less often)

**Workaround**: Use custom command to skip slow operations:
```yaml
ci:
  dependencyLockCheck:
    command: "npm ci --prefer-offline"  # Use local cache
```

### "npm link detected but I don't have linked packages"

**Problem**: False positive - check thinks packages are linked when they're not

**Diagnosis**:
```bash
# Check for symlinks in node_modules
find node_modules -maxdepth 2 -type l
```

**Solutions**:
1. If symlinks are old/invalid:
   ```bash
   rm -rf node_modules
   npm install
   ```
2. If symlinks are from non-npm sources (build tools, etc.):
   ```bash
   VV_SKIP_DEPENDENCY_CHECK=1 vv validate
   ```

### "I want to disable temporarily"

**Use cases:**
- Debugging validation issues
- Working around false positives
- Testing with experimental dependencies

**Solution**: Use environment variable:
```bash
VV_SKIP_DEPENDENCY_CHECK=1 vv validate
```

Or disable in config (affects all runs):
```yaml
ci:
  dependencyLockCheck:
    runOn: disabled
```

### "How do I restore from npm link?"

**Problem**: Need to go back to normal dependencies after `npm link`

**Steps**:
1. Unlink packages:
   ```bash
   npm unlink @vibe-validate/core @vibe-validate/utils
   ```
2. Reinstall from registry:
   ```bash
   npm install
   ```
3. Verify no symlinks remain:
   ```bash
   find node_modules -maxdepth 2 -type l
   ```

## Examples

### Example 1: Run Before Every Commit (Recommended)

**Use case**: Ensure dependencies are always correct before committing

```yaml
ci:
  dependencyLockCheck:
    runOn: pre-commit
```

**Behavior**:
- ✅ Runs when you commit (`vv pre-commit`)
- ❌ Skips during ad-hoc validation (`vv validate`)
- ⚡ Fast (only runs on cache miss)

### Example 2: Strict Mode (Always Validate)

**Use case**: Critical projects where dependency correctness is paramount

```yaml
ci:
  dependencyLockCheck:
    runOn: validate
```

**Behavior**:
- ✅ Runs for every validation (strict)
- ✅ Runs during pre-commit
- 🐌 Slightly slower (runs more often)

### Example 3: Explicitly Disabled

**Use case**: Projects with non-standard dependency management

```yaml
ci:
  dependencyLockCheck:
    runOn: disabled
```

**Behavior**:
- ❌ Never runs
- ⚠️ No protection against cache poisoning
- ⚡ Fastest (no check overhead)

### Example 4: Custom Command for Legacy Project

**Use case**: Project requires `--legacy-peer-deps` for npm 7+

```yaml
ci:
  dependencyLockCheck:
    runOn: validate
    command: "npm ci --legacy-peer-deps"
```

**Behavior**:
- ✅ Uses custom command instead of default
- ✅ Works around peer dependency conflicts
- ⚠️ May mask real dependency issues

### Example 5: Monorepo with Multiple Package Managers

**Use case**: Monorepo where root uses npm but subprojects use pnpm

```yaml
# Root vibe-validate.config.yaml
ci:
  packageManager: npm
  dependencyLockCheck:
    runOn: pre-commit
    packageManager: npm  # Check root with npm

# Subproject vibe-validate.config.yaml
ci:
  packageManager: pnpm
  dependencyLockCheck:
    runOn: pre-commit
    packageManager: pnpm  # Check subproject with pnpm
```

### Example 6: Development Workflow with npm link

**Use case**: Developing linked package locally

```bash
# Link local package
cd ~/projects/my-lib
npm link
cd ~/projects/my-app
npm link my-lib

# Validation automatically skips check
vv validate
# Output:
# ⚠️  Dependency lock check skipped (npm link detected)
#    Linked packages:
#    - my-lib

# When ready to test with published version
npm unlink my-lib
npm install
vv validate  # Now checks lock file
```

## Doctor Warnings

vibe-validate doctor checks if dependency lock check is configured:

```bash
vv doctor
```

### Warning: Not Configured

**Trigger**: `dependencyLockCheck` missing OR `runOn` undefined

**Output**:
```
⚠️  Dependency lock check not configured
   💡 Set ci.dependencyLockCheck.runOn in vibe-validate.config.yaml

   This check prevents cache poisoning from stale dependencies.
   Recommended: runOn: pre-commit (checks before commit)
   Alternative: runOn: validate (checks before every validation)
   To disable: runOn: disabled
```

### Success: Configured

**Output**:
```
✅ Dependency lock check configured (runOn: pre-commit)
```

**Note**: Doctor doesn't verify the package manager is installed. That check happens at validation time.

## Best Practices

### ✅ DO

- **Enable for all projects**: Prevents subtle bugs from dependency mismatches
- **Use `runOn: pre-commit`**: Good balance of safety and performance
- **Commit lock files**: Lock files should always be in version control
- **Let auto-detection work**: Manual overrides rarely needed
- **Trust npm link detection**: Auto-skip is safe and correct

### ❌ DON'T

- **Don't disable to "speed up"**: Check only runs on cache miss (already fast)
- **Don't override without reason**: Auto-detection works for 99% of projects
- **Don't ignore failures**: Always means real dependency mismatch
- **Don't use custom commands without understanding**: May break validation
- **Don't bypass with `VV_SKIP_DEPENDENCY_CHECK` in CI**: Only for local debugging

## Integration with CI/CD

### GitHub Actions

The dependency lock check runs automatically in CI when using `vv generate-workflow`:

```yaml
# .github/workflows/validate.yml (generated)
jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: npm ci  # Fresh install (always correct)
      - run: npx vibe-validate validate  # Check runs on cache miss
```

**CI behavior:**
- Lock file is correct by definition (fresh install)
- Check still runs but will always pass
- Validates that local and CI have same dependency resolution

### Why Check in CI?

Even though CI always does fresh install, the check provides value:

1. **Consistency verification**: Ensures local and CI resolve dependencies identically
2. **Lock file validation**: Catches corrupted or manually edited lock files
3. **Monorepo validation**: Verifies subproject dependencies are correct

## Performance Impact

### Benchmarks

**Small project (50 dependencies):**
- npm ci: 8 seconds
- pnpm frozen-lockfile: 2 seconds
- yarn frozen-lockfile: 3 seconds
- bun frozen-lockfile: 1 second

**Large project (500 dependencies):**
- npm ci: 45 seconds
- pnpm frozen-lockfile: 12 seconds
- yarn frozen-lockfile: 18 seconds
- bun frozen-lockfile: 8 seconds

**When it runs:**
- Cache hit: 0 seconds (skipped)
- Cache miss + code change: Runs before validation
- Cache miss + dependency change: Would have run install anyway

**Net impact**: Minimal - the check only runs when you need to verify dependencies, and validation would fail anyway if dependencies are wrong.

## Learn More

- **Configuration Reference**: [configuration-reference.md](./skill/resources/configuration-reference.md)
- **Pre-commit Workflow**: [pre-commit command](./skill/resources/cli-reference.md#pre-commit)
- **Doctor Command**: [doctor command](./skill/resources/cli-reference.md#doctor)
- **Getting Started**: [getting-started.md](./getting-started.md)

## Related

- [Getting Started](./getting-started.md)
- [Pre-commit Workflow](./getting-started.md#pre-commit-validation)
- [Configuration Reference](./skill/resources/configuration-reference.md)
- [Doctor Command](./skill/resources/cli-reference.md#doctor)

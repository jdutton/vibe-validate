# Claude Code: Adding vibe-validate to a Project

**For**: AI Assistants (Claude Code, Cursor, Aider, Continue)
**Purpose**: Step-by-step guide to add vibe-validate to any project
**Version**: v0.9.6+

---

## Quick Reference

When a user asks you to "add vibe-validate" or "set up validation", follow this workflow:

```bash
# 1. Install
npm install -D vibe-validate

# 2. Initialize configuration
npx vibe-validate init

# 3. Run health check
npx vibe-validate doctor

# 4. Generate CI/CD workflow
npx vibe-validate generate-workflow

# 5. Run first validation
npx vibe-validate validate

# 6. Set up pre-commit hook (optional)
npx vibe-validate install-hook  # Coming in v0.9.7
```

---

## Step-by-Step Workflow

### Step 1: Installation

**User request**: "Add vibe-validate to this project"

**Your action**:
```bash
npm install -D vibe-validate
```

**Expected output**:
```
added 5 packages, and audited X packages in Ys

@vibe-validate/cli@0.9.6
```

**Next step**: Proceed to initialization

---

### Step 2: Initialize Configuration

**Your action**:
```bash
npx vibe-validate init
```

**The `init` command**:
- Detects project type (TypeScript, JavaScript, monorepo)
- Offers templates (minimal, typescript-library, typescript-nodejs, typescript-react)
- Creates `vibe-validate.config.yaml`
- Auto-detects existing validation scripts (npm run test, npm run lint, etc.)

**Expected interaction**:
```
🔧 vibe-validate Configuration Setup

Project type detected: TypeScript Node.js application

Select a template:
  1) minimal (bare-bones starting point)
  2) typescript-library (libraries, no runtime)
  3) typescript-nodejs (Node.js applications)  ← [Recommended]
  4) typescript-react (React applications)

Choice: 3

✅ Created vibe-validate.config.yaml

Next steps:
  1. Review configuration: cat vibe-validate.config.yaml
  2. Run validation: npx vibe-validate validate
  3. Generate workflow: npx vibe-validate generate-workflow
```

**Common issue**: If `init` fails, manually create config:
<!-- config:example -->
```yaml
# vibe-validate.config.yaml
# Reference: https://github.com/jdutton/vibe-validate/tree/main/packages/cli/config-templates
git:
  mainBranch: main
validation:
  phases:
    - name: Testing
      steps:
        - name: Unit Tests
          command: npm test
```

**Next step**: Run doctor to verify setup

---

### Step 3: Health Check with Doctor

**Your action**:
```bash
npx vibe-validate doctor
```

**Purpose**: Verify environment is ready for validation

**Expected output** (all passing):
```
🩺 vibe-validate Doctor

Running diagnostic checks...

✅ All checks passed! Your vibe-validate setup looks healthy.
   (Use --verbose to see all checks)
```

**Expected output** (with issues):
```
🩺 vibe-validate Doctor

Running diagnostic checks...

❌ Node.js version
   v18.0.0 is too old. Node.js 20+ required.
   💡 Upgrade Node.js: https://nodejs.org/ or use nvm

❌ Configuration valid
   Invalid configuration: Module not found '@vibe-validate/config'
   💡 Fix syntax errors in vibe-validate.config.*

⚠️  Some checks failed. See suggestions above to fix.
   (Use --verbose to see all checks including passing ones)
```

**If doctor fails**:
1. Read the error messages carefully
2. Follow the suggested fixes (💡 lines)
3. Re-run doctor after each fix
4. Use `--verbose` to see all checks:
   ```bash
   npx vibe-validate doctor --verbose
   ```

**Common fixes**:
- Node.js too old → Upgrade to 20+
- Git not installed → Install git
- Config invalid → Check syntax in vibe-validate.config.*
- Package manager missing → Install pnpm/npm

**Next step**: Generate CI/CD workflow

---

### Step 4: Generate CI/CD Workflow

**Your action** (basic):
```bash
npx vibe-validate generate-workflow
```

**Your action** (with matrix):
```bash
npx vibe-validate generate-workflow \
  --node-versions "20,22,24" \
  --os "ubuntu-latest,macos-latest" \
  --coverage
```

**What it does**:
- Generates `.github/workflows/validate.yml`
- Uses validation config as source of truth
- Creates matrix strategy for multi-OS/Node testing
- Adds coverage reporting (if `--coverage`)

**Expected output**:
```
✅ Generated workflow file:
   .github/workflows/validate.yml

📝 Commit this file to version control
```

**Preview first** (recommended):
```bash
npx vibe-validate generate-workflow --dry-run
```

**Check if workflow is in sync**:
```bash
npx vibe-validate generate-workflow --check
```

**Common patterns**:

1. **Simple project** (single OS, single Node):
   ```bash
   npx vibe-validate generate-workflow
   ```

2. **Multi-Node testing**:
   ```bash
   npx vibe-validate generate-workflow --node-versions "20,22,24"
   ```

3. **Cross-platform**:
   ```bash
   npx vibe-validate generate-workflow \
     --os "ubuntu-latest,macos-latest,windows-latest"
   ```

4. **With coverage**:
   ```bash
   npx vibe-validate generate-workflow --coverage
   ```

**Next step**: Run first validation

---

### Step 5: Run First Validation

**Your action**:
```bash
npx vibe-validate validate
```

**Expected output** (first run):
```
🔄 Running phase: Pre-Qualification

🔍 Running Pre-Qualification (2 steps in parallel)...
   ⏳ TypeScript  →  npm run typecheck
   ⏳ ESLint     →  npm run lint
      ✅ TypeScript - PASSED (1.2s)
      ✅ ESLint    - PASSED (0.8s)
✅ Phase Pre-Qualification completed successfully

🔄 Running phase: Testing

🔍 Running Testing (1 steps in parallel)...
   ⏳ Unit Tests  →  npm test
      ✅ Unit Tests - PASSED (5.3s)
✅ Phase Testing completed successfully

✅ Validation passed (7.5s)
```

**Expected output** (cached run):
```
✅ Validation cached (< 1s)
```

**If validation fails**:
```
❌ Phase Pre-Qualification failed

📋 View errors: npx vibe-validate state
🔄 To retry: npm run typecheck
📄 Full log: /tmp/validation-2025-10-17-*.log
```

**Check validation state**:
```bash
npx vibe-validate state
```

**Force re-run** (bypass cache):
```bash
npx vibe-validate validate --force
```

**Next step**: Set up pre-commit hook (optional)

---

### Step 6: Pre-commit Hook (Optional)

**User request**: "Set up automatic validation before commits"

**Your action** (manual setup):
```bash
# Install Husky
npm install -D husky
npx husky install

# Add prepare script (auto-installs hooks)
npm set-script prepare "husky install"

# Create pre-commit hook
echo '#!/bin/sh\nnpx vibe-validate pre-commit' > .husky/pre-commit
chmod +x .husky/pre-commit
```

**Alternative** (coming in v0.9.7):
```bash
npx vibe-validate install-hook
```

**Test the hook**:
```bash
# Make a change
echo "// test" >> src/index.ts

# Commit (hook should run)
git add .
git commit -m "test commit"

# Expected: Validation runs before commit
```

**Hook workflow**:
1. Check if branch is behind origin/main
2. Run validation (uses cache if code unchanged)
3. Allow commit if validation passes
4. Block commit if validation fails

---

## Complete Example Session

```bash
# User: "Add vibe-validate to this project"

# 1. Install
npm install -D vibe-validate

# 2. Initialize
npx vibe-validate init
# → Choose template (typescript-nodejs)
# → Choose format (vibe-validate.config.yaml)

# 3. Health check
npx vibe-validate doctor
# → All checks passed ✅

# 4. Generate workflow
npx vibe-validate generate-workflow --node-versions "20,22"
# → Created .github/workflows/validate.yml

# 5. Validate
npx vibe-validate validate
# → First run: 45s (all steps run)
npx vibe-validate validate
# → Second run: < 1s (cached!)

# 6. Pre-commit hook
npm install -D husky
npx husky install
npm set-script prepare "husky install"
echo '#!/bin/sh\nnpx vibe-validate pre-commit' > .husky/pre-commit
chmod +x .husky/pre-commit

# 7. Commit workflow + config
git add vibe-validate.config.yaml .github/workflows/validate.yml .husky/
git commit -m "feat: Add vibe-validate for validation orchestration"
```

---

## Troubleshooting

### Issue: `init` command hangs

**Cause**: Waiting for user input (interactive prompts)

**Solution**: Press Enter to accept defaults, or use non-interactive mode (coming in v0.9.7)

### Issue: Doctor reports "Configuration valid" but validation fails

**Cause**: Commands in config don't exist or fail

**Solution**:
1. Check npm scripts: `npm run lint`, `npm run test`, etc.
2. Verify commands work independently
3. Update config with correct commands

### Issue: Workflow generation fails with "No configuration file found"

**Cause**: Config file not in project root or wrong format

**Solution**:
1. Check config exists: `ls vibe-validate.config.yaml`
2. Move config to project root
3. Verify format is `.yaml` (only YAML configs are supported)

### Issue: Validation passes locally but fails in CI

**Cause**: Environment differences (paths, env vars, dependencies)

**Solution**:
1. Run with `--force` locally: `npx vibe-validate validate --force`
2. Check CI logs for missing dependencies
3. Verify Node.js versions match
4. Check for hardcoded paths

### Issue: Cache never hits (validation runs full every time)

**Cause**: Working tree not clean or state file issues

**Solution**:
1. Check git status: `git status`
2. Check validation status: `npx vibe-validate validate --check`
3. View validation state: `npx vibe-validate state`
4. Try force re-validation: `npx vibe-validate validate --force`

---

## Agent-Specific Tips

### For Claude Code

1. **Always run `doctor` after `init`** - Catches environment issues early
2. **Use `--dry-run` first** - Preview workflow before writing
3. **Check state file** - Use `npx vibe-validate state` to diagnose failures
4. **Concise output** - vibe-validate is designed for agent consumption (minimal tokens)

### For Cursor/Aider/Continue

1. **Non-interactive setup** - Prepare to handle interactive prompts
2. **Validation state** - Use `npx vibe-validate state` for error details
3. **YAML output** - Use `--yaml` flag for machine-readable output:
   ```bash
   npx vibe-validate doctor --yaml
   npx vibe-validate state --verbose
   ```

---

## What to Tell Users

After successful setup, inform the user:

```
✅ vibe-validate is now set up!

Commands:
  npm run validate        # Run validation
  npx vibe-validate state # Check validation status
  npx vibe-validate doctor # Health check

Next steps:
  1. Review config: cat vibe-validate.config.yaml
  2. Commit changes: git add . && git commit -m "feat: Add vibe-validate"
  3. Push to GitHub to trigger CI workflow

Benefits:
  • Dramatically faster validation (with caching)
  • Parallel step execution
  • Agent-friendly error output
  • Automatic pre-commit validation
```

---

## Common User Requests

### "Make validation faster"

**Solution**: vibe-validate caches by default!

```bash
# First run (cache miss)
npx vibe-validate validate
# → 45s (runs all steps)

# Second run (cache hit)
npx vibe-validate validate
# → < 1s (skips validation, returns cached result)
```

**Force re-run**:
```bash
npx vibe-validate validate --force
```

### "Add pre-commit validation"

**Solution**: Set up pre-commit hook

```bash
npm install -D husky
npx husky install
npm set-script prepare "husky install"
echo '#!/bin/sh\nnpx vibe-validate pre-commit' > .husky/pre-commit
chmod +x .husky/pre-commit
```

### "Set up CI/CD"

**Solution**: Generate workflow

```bash
npx vibe-validate generate-workflow
```

### "Check if validation is working"

**Solution**: Run doctor

```bash
npx vibe-validate doctor --verbose
```

---

## Version Compatibility

**Minimum Node.js**: 20.0.0
**Minimum Git**: 2.0.0
**Package Managers**: npm, pnpm, yarn

**Check compatibility**:
```bash
npx vibe-validate doctor
```

---

## Additional Resources

- **Getting Started**: `docs/getting-started.md`
- **CLI Reference**: `packages/cli/README.md`
- **Configuration**: `docs/configuration-reference.md`
- **Troubleshooting**: `docs/troubleshooting.md`

---

## Feedback Loop

After setup, collect user feedback:

1. **Was setup easy?** - Note friction points
2. **Are error messages clear?** - Note confusion
3. **What features are missing?** - Note feature requests

Report feedback to: https://github.com/jdutton/vibe-validate/issues

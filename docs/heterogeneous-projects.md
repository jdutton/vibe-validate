# Heterogeneous Projects Guide

**Target audience**: Teams working with multi-language monorepos or projects with multiple build systems

---

## What is a Heterogeneous Project?

A **heterogeneous project** is a codebase that combines multiple programming languages, build systems, or technology stacks within a single repository. Common examples include:

- **Multi-language monorepos**: Java backend + TypeScript frontend + Python ML services
- **Multiple build systems**: Maven + npm + Gradle in one repo
- **Polyglot microservices**: Different services using different tech stacks
- **Legacy + modern**: Incrementally migrating from one stack to another

### Common Challenges

Traditional validation tools struggle with heterogeneous projects:

- **Inconsistent working directories**: Each subsystem expects to run from its own directory
- **Poor cache hit rates**: Different invocation patterns invalidate caches
- **Complex CI/CD**: Managing different build systems in workflows
- **Fragile validation**: Brittle `cd` commands that break easily

---

## Why vibe-validate for Heterogeneous Projects?

vibe-validate was designed with heterogeneous projects as a first-class use case:

### 1. **Git-Root-Relative Working Directories**

The `cwd` field lets you specify where each validation step runs, relative to your git repository root:

```yaml
validation:
  phases:
    - name: lint
      parallel: true
      steps:
        - name: lint-backend
          cwd: services/backend  # Runs from <git-root>/services/backend
          command: mvn checkstyle:check

        - name: lint-frontend
          cwd: services/frontend  # Runs from <git-root>/services/frontend
          command: npm run lint
```

**Benefits**:
- ✅ Consistent behavior regardless of where you invoke the command
- ✅ Better cache hit rates (30-50% improvement)
- ✅ Works the same locally and in CI
- ✅ No brittle `cd` commands

### 2. **Parallel Execution Across Subsystems**

Run validation steps from different subsystems concurrently:

```yaml
phases:
  - name: test
    parallel: true  # All steps run simultaneously
    steps:
      - name: test-java-service
        cwd: services/user-api
        command: mvn test

      - name: test-node-service
        cwd: services/notification-api
        command: npm test

      - name: test-python-service
        cwd: services/ml-engine
        command: pytest
```

**Performance**: 3 independent test suites finish in the time of the slowest one, not the sum.

### 3. **Content-Based Caching**

Git tree hash caching works seamlessly across multiple directories:

```bash
# First run: Backend changes, frontend unchanged
$ vv validate
✓ lint-frontend (cached)    # Skipped - no changes
✓ lint-backend (1.2s)       # Ran - detected changes
```

**Intelligence**: vibe-validate detects which subsystems changed and only re-validates those.

### 4. **CI/CD Workflow Generation**

Automatically generates GitHub Actions workflows that use `working-directory`:

```yaml
# Generated from your config
- name: Test Backend
  working-directory: services/backend
  run: mvn test

- name: Test Frontend
  working-directory: services/frontend
  run: npm test
```

**Consistency**: Your local validation and CI workflows stay in sync automatically.

---

## Configuration Best Practices

### Use `cwd` Instead of `cd`

**Anti-pattern** (brittle, breaks caching):
```yaml
steps:
  - name: test-backend
    command: cd services/backend && mvn test
```

**Best practice** (robust, cache-friendly):
```yaml
steps:
  - name: test-backend
    cwd: services/backend
    command: mvn test
```

**Why this matters**:
- `cd` in commands breaks caching (different working directories)
- `cd` commands are platform-specific (Windows vs Unix)
- `cwd` field is resolved by vibe-validate consistently

### Group by Logical Phase, Not Technology

Organize validation by *purpose* (lint, test, build), not by *technology* (Java steps, Node steps):

**Anti-pattern** (sequential, slow):
```yaml
phases:
  - name: java-validation
    steps:
      - { cwd: backend, command: mvn checkstyle:check }
      - { cwd: backend, command: mvn test }

  - name: node-validation
    steps:
      - { cwd: frontend, command: npm run lint }
      - { cwd: frontend, command: npm test }
```

**Best practice** (parallel, fast):
```yaml
phases:
  - name: lint
    parallel: true
    steps:
      - { cwd: backend, command: mvn checkstyle:check }
      - { cwd: frontend, command: npm run lint }

  - name: test
    parallel: true
    steps:
      - { cwd: backend, command: mvn test }
      - { cwd: frontend, command: npm test }
```

**Performance**: Linting completes when both finish (not sequentially).

### Be Explicit About Dependencies

If one subsystem depends on another being built first, use sequential phases:

```yaml
phases:
  - name: build
    steps:
      - name: build-shared-lib
        cwd: packages/shared
        command: npm run build

  - name: test  # Runs AFTER build phase completes
    parallel: true
    steps:
      - name: test-frontend
        cwd: packages/frontend
        command: npm test  # Uses built shared lib

      - name: test-backend
        cwd: packages/backend
        command: npm test  # Uses built shared lib
```

### Leverage Parallel Execution

Mark phases as `parallel: true` when steps are independent:

```yaml
phases:
  - name: static-analysis
    parallel: true  # All can run simultaneously
    steps:
      - { cwd: backend, command: mvn checkstyle:check }
      - { cwd: frontend, command: npm run lint }
      - { cwd: mobile, command: swiftlint }
      - { cwd: docs, command: markdownlint . }
```

**Rule of thumb**: If steps don't depend on each other's output, parallelize them.

---

## Using the `cwd` Field

### Path Resolution

All `cwd` paths are relative to your **git repository root**:

```yaml
# Git root: /Users/alice/projects/myapp
validation:
  phases:
    - name: test
      steps:
        - name: test-api
          cwd: services/api  # Resolves to: /Users/alice/projects/myapp/services/api
          command: npm test
```

**Important**: Paths are resolved the same way regardless of where you invoke `vv validate`:

```bash
# All of these resolve cwd identically:
cd /Users/alice/projects/myapp && vv validate
cd /Users/alice/projects/myapp/services/api && vv validate
cd /tmp && vv validate  # (if inside git repo)
```

### Security: Path Traversal Prevention

vibe-validate validates all `cwd` paths to prevent directory traversal attacks:

```yaml
steps:
  - cwd: ../../../etc/passwd  # ❌ ERROR: Path escapes git root
    command: cat passwd

  - cwd: /etc/passwd  # ❌ ERROR: Absolute paths not allowed
    command: cat passwd

  - cwd: packages/../services/api  # ✅ OK: Normalizes to services/api
    command: npm test
```

**Protection**: All paths must resolve within the git repository.

### Empty or Missing `cwd`

If `cwd` is not specified, commands run from the git root:

```yaml
steps:
  - name: lint-root-scripts
    # No cwd specified - runs from git root
    command: eslint tools/*.js
```

### Path Normalization

vibe-validate normalizes paths automatically:

```yaml
# These are equivalent:
cwd: packages/api
cwd: ./packages/api
cwd: packages//api
cwd: packages/api/
```

---

## Cross-Platform Considerations

### Use Forward Slashes

Always use forward slashes (`/`) in `cwd` paths, even on Windows:

```yaml
# ✅ Cross-platform compatible
cwd: services/backend/api

# ❌ Windows-only (breaks on Unix)
cwd: services\backend\api
```

**Why**: vibe-validate normalizes paths internally, and forward slashes work everywhere.

### Avoid Platform-Specific Commands

Use cross-platform commands or provide alternatives:

```yaml
# ❌ Unix-only
command: rm -rf dist && npm run build

# ✅ Cross-platform (using npm scripts)
command: npm run clean && npm run build
```

**Best practice**: Put platform-specific logic in `package.json` scripts:

```json
{
  "scripts": {
    "clean": "rimraf dist",
    "build": "tsc"
  }
}
```

### Environment Variables

Set environment variables consistently:

```yaml
steps:
  - name: test-with-env
    cwd: services/api
    command: npm test
    env:
      NODE_ENV: test
      DATABASE_URL: sqlite::memory:
```

---

## CI/CD Workflow Generation

### Automatic `working-directory` Generation

When you run `vv generate-workflow`, vibe-validate automatically generates `working-directory` fields:

**Config**:
```yaml
phases:
  - name: test
    steps:
      - name: test-backend
        cwd: services/backend
        command: mvn test
```

**Generated workflow**:
```yaml
- name: Test Backend
  working-directory: services/backend
  run: mvn test
```

**Benefit**: Your CI workflow matches your local validation exactly.

### Parallelism in GitHub Actions

vibe-validate respects your `parallel` settings when generating workflows:

**Config**:
```yaml
phases:
  - name: test
    parallel: true
    steps:
      - { name: test-backend, cwd: backend, command: mvn test }
      - { name: test-frontend, cwd: frontend, command: npm test }
```

**Generated workflow** (parallel jobs):
```yaml
jobs:
  test-backend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Test Backend
        working-directory: backend
        run: mvn test

  test-frontend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Test Frontend
        working-directory: frontend
        run: npm test
```

### Workflow Generation Command

```bash
# Generate GitHub Actions workflow
vv generate-workflow --output .github/workflows/validation.yml

# Preview without writing
vv generate-workflow
```

**Recommendation**: Regenerate workflows after changing your validation config to keep them in sync.

---

## Cache Optimization Strategies

### How Caching Works in Heterogeneous Projects

vibe-validate uses **git tree hashes** to cache validation results:

1. Before running a step, it calculates a content hash of relevant files
2. If the hash matches a previous run, the step is skipped (cache hit)
3. If the hash differs, the step runs (cache miss)

**Key insight**: `cwd` field improves cache hit rates by making invocations consistent.

### Example: Before and After `cwd`

**Before** (without `cwd` field):
```bash
# Developer A (from root):
$ vv run "cd services/api && npm test"
# Cache key: SHA256("cd services/api && npm test"__)

# Developer B (from services/api):
$ cd services/api && vv run "npm test"
# Cache key: SHA256("npm test__services/api")

# Result: CACHE MISS (different keys)
```

**After** (with `cwd` field):
```bash
# Developer A (from anywhere):
$ vv run --cwd services/api "npm test"
# Cache key: SHA256("npm test__services/api")

# Developer B (from anywhere):
$ vv run --cwd services/api "npm test"
# Cache key: SHA256("npm test__services/api")

# Result: CACHE HIT (same key)
```

**Impact**: 30-50% improvement in cache hit rates in monorepo scenarios.

### Best Practices for Cache Optimization

1. **Always use `cwd` field** - Don't embed `cd` in commands
2. **Be consistent** - Use the same command strings across the team
3. **Use `--cwd` flag** - When using `vv run` for ad-hoc commands
4. **Group related files** - Keep subsystem files in dedicated directories

### Checking Cache Status

```bash
# View current validation state (shows cached steps)
vv state

# Check if validation would pass (without running)
vv validate --check

# Force re-run (ignore cache)
vv validate --force
```

---

## Complete Example: Multi-Language Monorepo

Here's a real-world configuration for a project with Java, TypeScript, and Python:

```yaml
# vibe-validate.config.yaml
validation:
  phases:
    # Phase 1: Linting (parallel across all languages)
    - name: lint
      parallel: true
      steps:
        - name: lint-java-backend
          cwd: services/user-api
          command: mvn checkstyle:check

        - name: lint-node-frontend
          cwd: apps/web
          command: npm run lint

        - name: lint-python-ml
          cwd: services/ml-engine
          command: pylint src/

    # Phase 2: Type checking (parallel)
    - name: typecheck
      parallel: true
      steps:
        - name: typecheck-typescript
          cwd: apps/web
          command: tsc --noEmit

        - name: typecheck-python
          cwd: services/ml-engine
          command: mypy src/

    # Phase 3: Build (sequential - dependencies matter)
    - name: build
      steps:
        - name: build-shared-types
          cwd: packages/shared-types
          command: npm run build

        - name: build-frontend
          cwd: apps/web
          command: npm run build

        - name: build-backend
          cwd: services/user-api
          command: mvn package -DskipTests

    # Phase 4: Testing (parallel - independent test suites)
    - name: test
      parallel: true
      steps:
        - name: test-frontend
          cwd: apps/web
          command: npm test

        - name: test-backend
          cwd: services/user-api
          command: mvn test

        - name: test-ml-engine
          cwd: services/ml-engine
          command: pytest --cov=src

# Optional: Agent-specific settings
agent:
  maxTokens: 4000
  context: |
    Multi-language monorepo:
    - Backend: Java 17 + Maven
    - Frontend: TypeScript + React + Vite
    - ML: Python 3.11 + PyTorch
```

### Directory Structure

```
my-monorepo/
├── services/
│   ├── user-api/          (Java + Maven)
│   │   ├── pom.xml
│   │   └── src/
│   └── ml-engine/         (Python + Poetry)
│       ├── pyproject.toml
│       └── src/
├── apps/
│   └── web/               (TypeScript + npm)
│       ├── package.json
│       └── src/
├── packages/
│   └── shared-types/      (TypeScript)
│       ├── package.json
│       └── src/
└── vibe-validate.config.yaml
```

### Usage

```bash
# Run full validation (from any directory)
vv validate

# Run just linting phase
vv validate --phase lint

# Run ad-hoc command in specific subsystem
vv run --cwd services/user-api "mvn verify"

# Generate CI workflow
vv generate-workflow --output .github/workflows/ci.yml
```

---

## Migration Guide: Adding `cwd` to Existing Configs

If you're upgrading from v0.16.x, you may need to update your configuration.

### Before (v0.16.x)

```yaml
steps:
  - name: test-backend
    command: cd services/backend && mvn test
```

**Issues**:
- Brittle (breaks if directory structure changes)
- Poor caching (command varies by invocation)
- Platform-specific (`cd` behavior differs on Windows)

### After (v0.17.0)

```yaml
steps:
  - name: test-backend
    cwd: services/backend
    command: mvn test
```

**Benefits**:
- Robust (explicit working directory)
- Better caching (consistent command strings)
- Cross-platform (vibe-validate handles path resolution)

### Breaking Changes in v0.17.0

**Default working directory changed**:
- **Before**: Commands ran from `process.cwd()` (where you invoked the command)
- **After**: Commands run from git root by default

**Migration**: Add `cwd` field to steps that previously relied on running from subdirectories.

**Example**:
```yaml
# If you previously ran this from services/api:
# $ cd services/api && vv validate

# Update your config:
steps:
  - name: test
    cwd: services/api  # ← Add this
    command: npm test
```

See `CHANGELOG.md` for complete breaking changes documentation.

---

## Common Patterns

### Pattern 1: Monorepo with Shared Dependencies

```yaml
phases:
  - name: install
    steps:
      - name: install-root
        command: npm install

  - name: build
    steps:
      - name: build-shared
        cwd: packages/shared
        command: npm run build

  - name: test
    parallel: true
    steps:
      - { cwd: packages/app-a, command: npm test }
      - { cwd: packages/app-b, command: npm test }
```

### Pattern 2: Backend + Frontend + Mobile

```yaml
phases:
  - name: lint
    parallel: true
    steps:
      - { cwd: backend, command: mvn checkstyle:check }
      - { cwd: frontend, command: npm run lint }
      - { cwd: mobile-ios, command: swiftlint }

  - name: test
    parallel: true
    steps:
      - { cwd: backend, command: mvn test }
      - { cwd: frontend, command: npm test }
      - { cwd: mobile-ios, command: swift test }
```

### Pattern 3: Microservices

```yaml
phases:
  - name: test
    parallel: true
    steps:
      - { cwd: services/auth, command: go test ./... }
      - { cwd: services/users, command: cargo test }
      - { cwd: services/payments, command: npm test }
      - { cwd: services/notifications, command: pytest }
```

### Pattern 4: Incremental Migration

```yaml
phases:
  - name: test
    parallel: true
    steps:
      # Legacy Java monolith
      - name: test-legacy
        cwd: legacy
        command: ant test

      # New microservices (being extracted)
      - { cwd: services/new-auth, command: npm test }
      - { cwd: services/new-api, command: npm test }
```

---

## Troubleshooting

### Issue: "Path escapes git repository"

**Error**:
```
Error: Path escapes git repository: ../../../etc
```

**Cause**: `cwd` path contains `..` that resolves outside the git root.

**Fix**: Use paths relative to git root only:
```yaml
# ❌ Bad
cwd: ../../other-repo/service

# ✅ Good
cwd: services/my-service
```

### Issue: "Not in a git repository"

**Error**:
```
Error: Not in a git repository
```

**Cause**: vibe-validate requires a git repository to function.

**Fix**: Initialize git if not already done:
```bash
git init
```

### Issue: Command not found

**Error**:
```
Error: command not found: mvn
```

**Cause**: Build tool not in PATH, or wrong tool for subsystem.

**Fix**: Ensure the command exists in the specified directory:
```bash
# Test command manually
cd services/backend
mvn --version
```

### Issue: Cache not working

**Symptom**: Steps always re-run despite no changes.

**Possible causes**:
1. Using `cd` in commands (breaks caching)
2. Timestamps in commands (e.g., `date` in command)
3. Non-deterministic commands

**Fix**: Use `cwd` field and ensure commands are deterministic:
```yaml
# ❌ Bad (breaks caching)
command: cd backend && echo $(date) && mvn test

# ✅ Good (cache-friendly)
cwd: backend
command: mvn test
```

### Issue: GitHub Actions workflow out of sync

**Symptom**: `vibe-validate doctor` reports "Workflow is out of sync".

**Diagnosis steps**:

1. **Try regenerating the workflow**:
   ```bash
   vv generate-workflow --output .github/workflows/validation.yml
   ```

2. **Compare the generated workflow with your current one**:
   ```bash
   git diff .github/workflows/validation.yml
   ```

3. **Determine if auto-generation works for your project**:

**Case A: Generated workflow works** (simple Node.js/TypeScript project):
```bash
# Accept the generated workflow
git add .github/workflows/validation.yml
git commit -m "chore: Regenerate workflow"
```

**Case B: Generated workflow won't work** (multi-language, custom setup needs):

Your project may require manual workflow customization if it needs:
- **Multiple language runtimes** (Java + Node.js, Python + TypeScript, etc.)
- **Custom setup actions** (`setup-java`, `setup-python`, custom Docker images)
- **Environment variables** (paths to built artifacts, test configuration)
- **Cross-platform matrix testing** beyond what vibe-validate generates

**Solution**: Disable automatic workflow sync checking:

```yaml
# vibe-validate.config.yaml
ci:
  disableWorkflowCheck: true  # Suppress workflow sync warnings

  # Your manual workflow stays as-is
  # No more "out of sync" warnings from doctor
```

**When to use `disableWorkflowCheck: true`**:
- ✅ Multi-language projects (Java + TypeScript, Python + Node.js)
- ✅ Projects requiring `setup-java`, `setup-python`, or similar actions
- ✅ Projects needing job-level environment variables
- ✅ Custom CI providers (not GitHub Actions)

**When NOT to use it**:
- ❌ Pure Node.js/TypeScript projects (auto-generation works great)
- ❌ Projects without special CI requirements

After setting `disableWorkflowCheck: true`, run `vibe-validate doctor` again - the workflow warning will disappear.

---

## Advanced Topics

### Using `vv run` for Ad-Hoc Commands

The `vv run` command supports `--cwd` flag for one-off executions:

```bash
# Run command in specific subsystem with caching
vv run --cwd services/backend "mvn verify"

# Benefits:
# - Cached if content unchanged
# - LLM-optimized error output
# - Consistent working directory
```

### Environment Variables per Subsystem

```yaml
steps:
  - name: test-backend
    cwd: services/backend
    command: mvn test
    env:
      SPRING_PROFILES_ACTIVE: test
      DATABASE_URL: jdbc:h2:mem:test

  - name: test-frontend
    cwd: apps/web
    command: npm test
    env:
      NODE_ENV: test
      API_URL: http://localhost:3000
```

### Conditional Steps with Shell Logic

```yaml
steps:
  - name: test-if-changed
    cwd: services/api
    command: |
      if git diff --quiet HEAD^ HEAD -- .; then
        echo "No changes detected, skipping tests"
      else
        npm test
      fi
```

**Note**: vibe-validate's built-in caching is usually better than manual change detection.

### Docker-Based Validation

```yaml
steps:
  - name: test-in-container
    cwd: services/java-api
    command: docker run --rm -v $(pwd):/app maven:3.9 mvn test
```

**Warning**: Docker adds overhead - consider native tools when possible.

---

## Further Reading

- [Configuration Reference](configuration-reference.md) - Complete `cwd` field documentation
- [CLI Reference](cli-reference.md) - `--cwd` flag usage
- [Workflow Generation](workflow-generation.md) - GitHub Actions integration
- [Caching Guide](caching.md) - Deep dive on git tree hash caching

---

## Template Configuration

Start with the `minimal` template and customize for your multi-language setup:

```bash
vv init --template minimal
```

See the [config templates guide](https://github.com/jdutton/vibe-validate/blob/main/packages/cli/config-templates/README.md) for available templates.

---

**Questions or feedback?** [Open an issue](https://github.com/jdutton/vibe-validate/issues) or contribute improvements!

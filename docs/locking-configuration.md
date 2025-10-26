# Locking Configuration

> Smart concurrency control for validation runs

## Overview

vibe-validate includes a smart locking system that prevents concurrent validation runs while allowing flexible configuration for different project needs.

**Key features:**
- Prevents duplicate validation runs by default
- Wait-for-completion mode for pre-commit hooks
- Project-scoped locking for shared resources (ports, databases)
- Directory-scoped locking for parallel worktrees
- Automatic project ID detection

## Default Behavior

By default, validation runs with:
- **Locking enabled** - Only one validation runs at a time
- **Wait mode enabled** - New runs wait for existing validation to complete
- **Directory scope** - Each working directory has its own lock (allows parallel worktrees)

```bash
# First terminal - starts validation
vibe-validate validate

# Second terminal - waits for first to complete
vibe-validate validate  # Waits up to 5 minutes, then proceeds
```

## Configuration

Add locking configuration to your `vibe-validate.config.yaml`:

```yaml
locking:
  enabled: true  # Default: true
  concurrencyScope: directory  # Options: "directory" (default) or "project"
  projectId: my-app  # Optional: auto-detected from git/package.json
```

### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `enabled` | boolean | `true` | Enable/disable locking entirely |
| `concurrencyScope` | `'directory'` \| `'project'` | `'directory'` | Lock scope strategy |
| `projectId` | string | auto-detected | Project identifier for project-scoped locks |

## Concurrency Scopes

### Directory Scope (Default)

Each working directory gets its own lock file. Best for projects without shared resources.

**Use when:**
- Tests don't use fixed ports or shared databases
- Multiple git worktrees should validate independently
- No global state conflicts

**Lock file:** `/tmp/vibe-validate-{encoded-directory-path}.lock`

**Example:**
```yaml
locking:
  concurrencyScope: directory  # Default
```

**Behavior:**
```bash
cd ~/project/worktree-1
vibe-validate validate &  # Runs immediately

cd ~/project/worktree-2
vibe-validate validate &  # Runs in parallel (different lock)
```

### Project Scope

All directories for the same project share one lock. Best for projects with shared resources.

**Use when:**
- Tests use fixed ports (e.g., `localhost:3000`)
- Integration tests use shared test databases
- Global state prevents concurrent runs

**Lock file:** `/tmp/vibe-validate-project-{project-id}.lock`

**Example:**
```yaml
locking:
  concurrencyScope: project
  # projectId auto-detected from git remote or package.json
```

**Behavior:**
```bash
cd ~/project/worktree-1
vibe-validate validate &  # Runs immediately

cd ~/project/worktree-2
vibe-validate validate    # Waits for worktree-1 to finish (same project)
```

## Project ID Detection

When using `concurrencyScope: project`, vibe-validate auto-detects the project ID:

### Detection Priority

1. **Git remote URL** (most reliable for worktrees/clones)
   - `https://github.com/user/my-app.git` → `my-app`
   - `git@github.com:user/my-app.git` → `my-app`
   - Supports GitHub, GitLab, Bitbucket

2. **package.json name field** (fallback)
   - `"name": "my-app"` → `my-app`
   - `"name": "@scope/my-app"` → `my-app` (scope removed)

3. **Error** if neither is available

### Manual Override

Explicitly set `projectId` to skip auto-detection:

```yaml
locking:
  concurrencyScope: project
  projectId: my-custom-id
```

### Troubleshooting Detection

If you see: `ERROR: concurrencyScope=project but projectId cannot be detected`

**Solutions:**
1. Add `locking.projectId` to your config
2. Ensure git remote is configured: `git remote -v`
3. Ensure package.json has `name` field

## CLI Flags

Override locking behavior via command-line flags:

### `--no-lock`

Disable locking for this run only (allows concurrent validations).

```bash
vibe-validate validate --no-lock &
vibe-validate validate --no-lock &  # Both run concurrently
```

**Use cases:**
- Testing/debugging
- CI environments with isolated containers
- Temporary override

### `--no-wait`

Exit immediately if validation is already running (don't wait).

```bash
# Terminal 1
vibe-validate validate  # Runs for 60 seconds

# Terminal 2
vibe-validate validate --no-wait  # Exits immediately with code 0
```

**Use cases:**
- Background hooks that shouldn't block
- Claude Code user-prompt-submit hooks
- Scripts that need fast failure

### `--wait-timeout <seconds>`

Maximum time to wait for running validation (default: 300 seconds = 5 minutes).

```bash
vibe-validate validate --wait-timeout 60  # Wait max 60 seconds
```

**Use cases:**
- Shorter timeouts for CI
- Longer timeouts for slow test suites

## Flag Interactions

- `--check` → automatically disables `--lock` (no validation runs)
- `--no-lock` → ignores wait settings (no lock to wait for)
- `locking.enabled: false` in config → overrides `--lock` flag

## Use Cases & Examples

### Use Case 1: Default Setup (No Shared Resources)

**Scenario:** JavaScript library with unit tests, no ports or databases.

**Config:** None needed (defaults work)

**Behavior:**
- Each directory has its own lock
- Multiple worktrees can validate in parallel
- No port/resource conflicts

```bash
# Multiple directories work independently
cd ~/my-lib/worktree-1 && vibe-validate validate &
cd ~/my-lib/worktree-2 && vibe-validate validate &  # Runs in parallel
```

### Use Case 2: Express App with Port 3000

**Scenario:** Node.js API server, tests use `localhost:3000`.

**Config:**
```yaml
locking:
  concurrencyScope: project
  # projectId auto-detected from git remote
```

**Behavior:**
- All directories share one lock
- Second validation waits for first
- No port conflicts

```bash
cd ~/my-api/worktree-1
vibe-validate validate &  # Uses port 3000

cd ~/my-api/worktree-2
vibe-validate validate    # Waits (port 3000 in use)
```

### Use Case 3: Monorepo with Shared Test Database

**Scenario:** Integration tests use PostgreSQL test database.

**Config:**
```yaml
locking:
  concurrencyScope: project
  projectId: my-monorepo  # Explicit ID
```

**Behavior:**
- Project-wide lock ensures sequential tests
- Database consistency maintained

### Use Case 4: CI Environment (Isolated Containers)

**Scenario:** GitHub Actions, each job in separate container.

**Config:**
```yaml
locking:
  enabled: false  # No need for locking in CI
```

Or use CLI flag:
```bash
vibe-validate validate --no-lock
```

**Behavior:**
- No locking overhead
- Each CI job validates independently

### Use Case 5: Claude Code Hook (Non-Blocking)

**Scenario:** Background validation on user prompt, shouldn't block.

**Hook config (`~/.claude/settings.json`):**
```json
{
  "hooks": {
    "userPromptSubmit": {
      "command": "vibe-validate validate --no-wait --yaml",
      "description": "Run validation in background"
    }
  }
}
```

**Behavior:**
- If validation running → exits immediately (code 0)
- If no validation → starts new validation
- Never blocks user

## Lock File Management

### Lock File Locations

**Directory-scoped:**
```
/tmp/vibe-validate-_Users_jeff_project.lock
```

**Project-scoped:**
```
/tmp/vibe-validate-project-my-app.lock
```

### Lock File Contents

```json
{
  "pid": 12345,
  "directory": "/Users/jeff/project",
  "treeHash": "abc123def456",
  "startTime": "2025-10-25T12:00:00Z"
}
```

### Automatic Cleanup

- Stale locks (dead processes) are auto-removed
- Locks released when validation completes
- Crashes/kills cleaned up on next run

### Manual Cleanup

```bash
# List all locks
ls -la /tmp/vibe-validate*.lock

# View lock contents
cat /tmp/vibe-validate-project-my-app.lock

# Remove stale lock (if needed)
rm /tmp/vibe-validate*.lock
```

## Troubleshooting

### "Validation already running" (Persistent)

**Symptom:** Always shows validation running, even when nothing is active.

**Cause:** Stale lock from crashed process.

**Solution:**
1. Check if process actually running: `ps aux | grep vibe-validate`
2. If not running: `rm /tmp/vibe-validate*.lock`
3. Retry validation

### "ERROR: projectId cannot be detected"

**Symptom:** Error when using `concurrencyScope: project`.

**Cause:** No git remote or package.json name field.

**Solution:**
```yaml
locking:
  concurrencyScope: project
  projectId: my-app  # Explicit ID
```

Or configure git remote:
```bash
git remote add origin https://github.com/user/my-app.git
```

### Wait Timeout Too Short

**Symptom:** Validation starts before previous run finishes.

**Cause:** Test suite takes longer than 5 minutes.

**Solution:**
```bash
vibe-validate validate --wait-timeout 600  # 10 minutes
```

Or in config (future enhancement):
```yaml
locking:
  waitTimeout: 600
```

## Performance Impact

| Scenario | Overhead | Notes |
|----------|----------|-------|
| Lock acquisition | ~1-5ms | Negligible |
| Wait mode (lock exists) | 0-300s | Depends on validation duration |
| No lock | 0ms | No overhead |
| Stale lock cleanup | ~10ms | Automatic |

## Design Philosophy

### Fail-Safe Approach

vibe-validate never blocks on locking failures:
- Lock creation fails → proceed without lock
- Wait timeout reached → proceed with validation
- Stale lock detected → auto-cleanup and proceed

### User Experience

**Developer workflow:**
- Default behavior "just works"
- No configuration needed for common cases
- Explicit opt-out when needed

**AI agent workflow:**
- `--no-wait` prevents blocking
- Exit code 0 even when locked (no error noise)
- YAML output supports programmatic checks

## Migration Guide

### Upgrading from Pre-Locking Versions

No action needed - locking is enabled by default but won't change behavior unless you have:
- Multiple worktrees validating concurrently (now sequential by default)
- Tests using fixed ports (project scope recommended)

### Disable Locking (Keep Old Behavior)

```yaml
locking:
  enabled: false
```

Or use `--no-lock` flag.

## Best Practices

### When to Use Directory Scope

✅ **Use directory scope when:**
- Tests use random ports or no ports
- No shared databases or global state
- Multiple worktrees should validate independently

### When to Use Project Scope

✅ **Use project scope when:**
- Tests use fixed ports (e.g., 3000, 8080)
- Integration tests use shared test database
- Global state prevents concurrent runs
- Worktrees should validate sequentially

### When to Disable Locking

✅ **Disable locking when:**
- CI environment with isolated containers
- Testing/debugging (temporary override)
- Absolutely sure no conflicts exist

### Wait Timeout Guidelines

- **Short test suite (<60s):** Keep default (300s)
- **Medium test suite (60-300s):** Keep default (300s)
- **Long test suite (>300s):** Increase timeout to 2x test duration

## Related Documentation

- [CLI Reference](cli-reference.md) - All CLI flags and commands
- [Configuration Schema](configuration.md) - Full config options
- [Pre-Commit Workflow](pre-commit.md) - Using locks in hooks

## Future Enhancements

Planned improvements:
- Configurable wait timeout in YAML
- Lock status command (`vibe-validate lock-status`)
- Lock history/analytics
- Distributed locking (networked systems)

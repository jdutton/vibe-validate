# Claude Code Plugin for vibe-validate

## Overview

This document describes the Claude Code plugin for vibe-validate, covering both the current implementation and future roadmap. The plugin focuses on two core component types: Agents and Skills.

**Out of Scope**: Commands, Hooks, and MCP Servers are intentionally excluded. The agent can guide users through workflows conversationally, and recommend project-specific hooks and commands when needed, rather than shipping them in the plugin.

## Two Integration Modes

vibe-validate supports two distinct usage modes:

### 1. Deep Integration (TypeScript-focused)
- Requires `vibe-validate.config.yaml`
- Full validation orchestration (phases, steps, parallel execution)
- Pre-commit workflows, state management, history tracking
- **Agent**: Comprehensive TypeScript/JavaScript project guidance

### 2. Lightweight Mode (Language-agnostic)
- No config file required
- Just use `vibe-validate run "<command>"` for error extraction
- Works with ANY language/tooling (Python, Rust, Go, Ruby, etc.)
- 90-95% context window reduction for any test/lint/build command
- **Skill**: Universal command wrapper for LLM-optimized output

## Current Implementation Status

**Implemented**: Agent (comprehensive expert for deep integration)
**Planned**: Skills (universal command wrapper for lightweight mode) + enhanced `run` command caching

### What We've Built

**Agent: `vibe-validate`** (v0.14.3)
- Location: `plugins/claude-code/agents/vibe-validate.md`
- 456 lines of comprehensive guidance
- Covers all workflows: pre-commit, validation, testing, diagnostics, PR monitoring
- Progressive disclosure pattern (references project docs on-demand)
- Version synced with npm packages via `bump-version.js`

## Plugin Components

### 1. Agents (Implemented)

**What They Are**: Specialized AI assistants with custom system prompts and tool access

**Current Agent: `vibe-validate`**
- Triggers when user works with vibe-validate commands, validation workflows, or TypeScript testing
- Uses `claude-sonnet-4-5` for high-quality reasoning
- Has access to Bash, Read, Write, Edit tools
- Pre-configured allow list for vibe-validate commands
- Provides comprehensive workflow coverage with decision trees
- Uses progressive disclosure to minimize context
- Includes dogfooding guidance (uses vibe-validate while developing it)

---

### 2. Skills (Planned)

**What They Are**: Autonomous capabilities Claude invokes when contextually relevant (no explicit trigger needed)

**Primary Skill**: Universal Command Wrapper (Language-agnostic)

#### Skill: `vibe-validate-run`
```yaml
name: vibe-validate-run
description: Wrap test, lint, and build commands with vibe-validate for LLM-optimized error extraction. Triggers when running commands that produce verbose output (pytest, cargo test, go test, npm test, eslint, mypy, etc.) in ANY language.
allowed-tools: [Bash]
```

**What it does**:
- Detects when user runs test/lint/build commands
- Automatically wraps with `vibe-validate run "<command>"`
- Extracts errors with file:line context (90-95% context reduction)
- Works across languages: Python, Rust, Go, Ruby, TypeScript, etc.

**Use cases**:
```bash
# Python
User: "Run pytest tests/"
Skill: vibe-validate run "pytest tests/"
Output: YAML with only failures (not 100s of passing tests)

# Rust
User: "Run cargo test"
Skill: vibe-validate run "cargo test"
Output: Structured errors with file:line references

# Go
User: "Run go test ./..."
Skill: vibe-validate run "go test ./..."
Output: LLM-friendly failure summary
```

**Capabilities**:
- Works in ANY project (no config needed)
- Language-agnostic (Python, Rust, Go, Ruby, etc.)
- Autonomous invocation (user just runs normal commands)
- Massive context savings (90-95% reduction)
- Complements TypeScript-focused agent

**Enhancement (v0.15.0)**: Tree hash caching for `run` command
- Caches command results by git tree hash
- Default behavior: returns cached result if code unchanged
- `--force` flag to bypass cache and re-run
- No config file required

---

**Additional Skills** (Lower priority):

#### Skill: `vibe-validate-deep-integration`
```yaml
name: vibe-validate-deep-integration
description: Guide TypeScript/JavaScript projects through deep vibe-validate integration. Triggers when user asks about pre-commit workflows, validation orchestration, or project setup in TS/JS projects.
allowed-tools: [Bash, Read, Write, Edit]
```

**What it does**:
- Helps create `vibe-validate.config.yaml`
- Sets up pre-commit hooks
- Configures validation phases
- Analyzes validation history

**Note**: This overlaps with the comprehensive agent, so may not be needed as a separate skill.

---

## Implementation Roadmap

### Phase 1: Complete
- Comprehensive agent with progressive disclosure
- Version syncing with bump-version script
- Marketplace configuration

### Phase 2: Universal Command Wrapper Skill (🎯 High Priority)
**Estimated Effort**: 2-3 hours for skill, 4-6 hours for caching enhancement

**2a. Create `vibe-validate-run` Skill**
- Language-agnostic skill for ANY project type
- Automatically wraps test/lint/build commands with `vibe-validate run`
- Triggers on: pytest, cargo test, go test, npm test, vitest, jest, mypy, black, eslint, etc.
- Works without config file
- 90-95% context reduction for non-TypeScript projects

**2b. Add Caching to `run` Command** (Future enhancement)
- Extend `run` command to cache results by git tree hash
- Add `vibe-validate run --check "<command>"` flag
- Add `vibe-validate run --skip-if-cached "<command>"` flag
- Store results in git notes (like validation history)
- Works without config file
- Brings dramatic speedup to ANY project type

**Impact**:
- Makes vibe-validate useful for Python, Rust, Go, Ruby, etc.
- No configuration required
- Autonomous context optimization for all languages
- Expands user base beyond TypeScript
- Demonstrates vibe-validate's universal value

**Success Metrics**:
- Skill triggers correctly on non-TypeScript commands
- Context reduction matches TypeScript usage (90-95%)
- User feedback from Python/Rust/Go developers

---

## Lightweight Mode: Future Enhancements

### Git Notes Structure for Run Commands vs Validation

**Current Validation Structure** (v0.15.0+):
```yaml
# Git notes ref: refs/notes/vibe-validate/validate/{treeHash}
# One note per tree hash

treeHash: abc123def456
runs:
  - id: run-1730574000000
    timestamp: 2025-11-02T02:00:00Z
    duration: 45000
    passed: true
    branch: main
    headCommit: def456
    uncommittedChanges: false
    result:
      phases: [...]
      errors: []
```

**⚠️ Breaking Change from v0.14.x**:
- Pre-0.15.0 versions used `refs/notes/vibe-validate/runs/{treeHash}`
- v0.15.0+ uses `refs/notes/vibe-validate/validate/{treeHash}`
- Old history notes remain in git but won't be displayed
- Use `vibe-validate history prune --all` to clean up legacy notes

**Future Run Cache Structure** (Separate Namespace):

**Option 1: Single Note Per Tree Hash (All Commands Together)**
```yaml
# Validation: refs/notes/vibe-validate/validate/{treeHash}
treeHash: abc123def456
runs:
  - id: run-1730574000000
    timestamp: ...
    passed: true
    result: { ... }

# Run cache: refs/notes/vibe-validate/run/{treeHash}
# ALL run commands for this tree hash in one note
treeHash: abc123def456
runs:
  - id: run-1730574200000
    command: "pytest tests/"
    workdir: ""  # Empty = root
    exitCode: 0
    errors: []

  - id: run-1730574300000
    command: "pytest tests/"
    workdir: "packages/cli"  # Subdirectory
    exitCode: 1
    errors: [...]

  - id: run-1730574400000
    command: "cargo test"
    workdir: "packages/backend"
    exitCode: 0
    errors: []
```

**Drawbacks of Option 1**:
- Must parse entire note to find specific command+workdir
- Note grows large with many different commands
- Inefficient lookup: load all runs to find one

**Option 2: Encode Command+Workdir in Ref Path** (Selected)
```yaml
# Validation:
refs/notes/vibe-validate/validate/{treeHash}

# Run cache - one note per unique command+workdir:
refs/notes/vibe-validate/run/{treeHash}/{encoded-key}

# Where {encoded-key} = URL-encode(workdir + ":" + command)
# Examples:
refs/notes/vibe-validate/run/abc123/pytest%20tests%2F
  # workdir="" (root), command="pytest tests/"

refs/notes/vibe-validate/run/abc123/packages%2Fcli:pytest%20tests%2F
  # workdir="packages/cli", command="pytest tests/"

refs/notes/vibe-validate/run/abc123/packages%2Fbackend:cargo%20test
  # workdir="packages/backend", command="cargo test"
```

**Note content** (simple, no array):
```yaml
treeHash: abc123def456
command: "pytest tests/"
workdir: ""  # Empty or omitted = root
timestamp: 2025-11-02T02:03:20Z
exitCode: 0
duration: 5000
errors: []
summary: "All tests passed"
```

**Why Option 2**:
- **Direct lookup**: Construct ref path from tree hash + command + workdir
- **O(1) cache hit check**: No parsing, just query the specific ref
- **Scales independently**: Each command is isolated
- **Simple note structure**: No arrays, just single run data
- **Easy to prune**: Delete refs matching pattern
- **Clear separation**: Validation and run cache are completely separate

**Encoding Strategy**:
```javascript
// Construct git notes ref for cache lookup
function getRunCacheRef(treeHash, command, workdir) {
  // workdir: "" for root, "packages/cli" for subdirectory
  const key = workdir ? `${workdir}:${command}` : command;
  const encoded = encodeURIComponent(key);
  return `refs/notes/vibe-validate/run/${treeHash}/${encoded}`;
}

// Examples:
getRunCacheRef("abc123", "pytest tests/", "")
// → refs/notes/vibe-validate/run/abc123/pytest%20tests%2F

getRunCacheRef("abc123", "pytest tests/", "packages/cli")
// → refs/notes/vibe-validate/run/abc123/packages%2Fcli:pytest%20tests%2F

getRunCacheRef("abc123", "npm test -- --coverage", "")
// → refs/notes/vibe-validate/run/abc123/npm%20test%20--%20--coverage
```

**Workdir Representation**:
- Empty string `""` or omitted field = git root
- Never store `"."`
- Always relative path from git root: `"packages/cli"`, `"apps/backend"`, etc.

### Tree Hash Caching for `run` Command

**Vision**: Bring dramatic speedup to ANY project, not just TypeScript with deep integration.

**Current State**:
- `vibe-validate run "<command>"` executes every time
- No caching - always re-runs the command
- Works great for context optimization, but slow on re-runs

**Proposed Enhancement**:
```bash
# Run command (uses cache by default, like 'validate')
vibe-validate run "pytest tests/"
# First run: executes command, caches result
# Subsequent runs (same tree hash): instant cached result (dramatic speedup)

# Force re-run (bypass cache)
vibe-validate run --force "pytest tests/"
# Always executes, updates cache
```

**Design follows `validate` convention**:
- Default behavior = use cache (like `validate`)
- `--force` flag = bypass cache (like `validate --force`)
- Minimal flags on `run` command (just `--force`)
- Use generic `history` command for management (see below)

**Implementation Approach**:
1. Determine current working directory relative to git root
2. Calculate git tree hash (existing logic from validation)
3. Query git notes for cached result (treeHash + command + workdir)
4. If cache hit: return cached result instantly
5. If cache miss OR `--force`: execute command from same workdir, cache result
6. Store in git notes with metadata (type: 'run' vs 'validation')

**Run Cache Note Format** (Option 2):
```yaml
# Stored at: refs/notes/vibe-validate/run/{treeHash}/{encoded-key}
treeHash: abc123def456
command: "pytest tests/"
workdir: ""  # Empty = root, or "packages/cli" for subdirectory
timestamp: 2025-11-02T02:03:20Z
exitCode: 1
duration: 5000
errors:
  - file: tests/test_foo.py
    line: 42
    message: "Expected 5, got 6"
summary: "1 test failure"
rawOutput: "..." # Truncated (optional, for debugging)
```

**Cache lookup**: Direct ref construction, no parsing needed
```javascript
// Calculate tree hash
const treeHash = getGitTreeHash();

// Construct ref from command + workdir
const ref = getRunCacheRef(treeHash, command, workdir);

// Query git notes (O(1) lookup)
const cached = await readGitNote(ref);
if (cached) {
  return cached; // Cache hit!
}
```

**Impact**:
- Works in Python, Rust, Go, Ruby projects (no config needed)
- Same dramatic speedup as TypeScript validation
- No config file required
- Language-agnostic caching
- Integrates with existing git notes infrastructure

**Use Cases**:
```python
# Python project - no vibe-validate.config.yaml needed
cd /project                                # At git root
vibe-validate run "pytest tests/"          # First run: slow, caches (workdir=".")
# ... code unchanged ...
vibe-validate run "pytest tests/"          # Instant (cache hit) ✨

cd /project/packages/backend               # Different workdir
vibe-validate run "pytest tests/"          # Different cache (workdir="packages/backend")

# Force re-run after investigating
vibe-validate run --force "pytest tests/"  # Bypasses cache
```

```rust
// Rust project - no config file needed
vibe-validate run "cargo test"             // First run: slow, caches
// ... code unchanged ...
vibe-validate run "cargo test"             // Instant (cache hit) ✨
```

**Working Directory Examples**:
```bash
# From git root
cd /project
vibe-validate run "npm test"
# Cached at: refs/notes/.../run/{hash}/npm%20test
# workdir="" (empty = root)

# From subdirectory
cd /project/packages/cli
vibe-validate run "npm test"
# Cached at: refs/notes/.../run/{hash}/packages%2Fcli:npm%20test
# workdir="packages/cli"

# These are DIFFERENT git notes (different refs)
```

### History Management via Generic `history` Command

Make `history` command generic to handle BOTH validation and run cache:

```bash
# Default: shows validation history (if vibe-validate.config.yaml exists)
vibe-validate history list

# Show cached runs for specific command
vibe-validate history list --run="pytest tests/"
# Shows all runs of this specific command (any workdir)

# Show cached runs for specific command + workdir
vibe-validate history list --run="pytest tests/" --workdir="packages/cli"
# Shows runs from specific directory only

# Show specific tree hash (validation)
vibe-validate history show abc123def

# Prune old validation entries
vibe-validate history prune --older-than 30d

# Prune specific run command (all workdirs)
vibe-validate history prune --run="pytest tests/"

# Prune specific run command + workdir
vibe-validate history prune --run="pytest tests/" --workdir="packages/cli"
# Removes cached runs from specific directory only
```

**Design**:
- Default shows validation history (most common use case)
- `--run` flag implicitly switches to run cache (no `--type` needed)
- `--workdir` only applies with `--run` (filters by directory in monorepos)
- Simple mental model: presence of `--run` determines namespace
- Keeps `run` command simple (just `--force` flag)
- Consistent with existing `history prune` pattern

**Skill Integration**:
The `vibe-validate-run` skill would automatically use caching:
```
User: "Run pytest tests/"
Skill: vibe-validate run "pytest tests/"
# Skill checks cache first, only runs if needed
# User sees instant results when code unchanged
```

---

## Architectural Decisions

### Agent vs Skills: When to Use Each

**Use Agent when**:
- ✅ Comprehensive workflow guidance needed
- ✅ Progressive disclosure (load docs on-demand)
- ✅ Decision trees and conditional logic
- ✅ User needs conversational interaction

**Use Skills when**:
- ✅ Focused, single-responsibility task
- ✅ Autonomous invocation desired
- ✅ Minimal context needed
- ✅ Quick, actionable result

**Current Recommendation**: Keep single comprehensive agent for now, add skills later if specific sub-tasks emerge as autonomous use cases.

### Commands & Hooks: Deferred to Project-Specific Creation

**Philosophy**: Don't ship commands or hooks in the plugin. Instead:
- Agent guides users through workflows conversationally
- Agent can recommend project-specific hooks based on team needs
- Agent helps create `.claude/hooks/hooks.json` tailored to local goals
- Agent can suggest custom slash commands for frequently-used workflows
- Teams decide enforcement level (blocking vs informational)
- Workflows evolve with project requirements

**Benefits**:
- ✅ No one-size-fits-all enforcement
- ✅ Adapts to team culture
- ✅ Reduces plugin maintenance burden
- ✅ Empowers teams to own their workflows

---

## Plugin Distribution Strategy

### Current: Local Development
- ✅ Marketplace: `.claude-plugin/marketplace.json`
- ✅ Source: `./plugins/claude-code`
- ✅ Installation: `claude plugin marketplace add /path/to/vibe-validate`

### Future: Public Marketplace
- 📦 Publish to official Claude Code marketplace (when available)
- 📦 GitHub-based marketplace: `claude plugin marketplace add jdutton/vibe-validate`
- 📦 npm-style distribution: `claude plugin install vibe-validate`

### Team Distribution
- ✅ Include plugin in repo (`.claude-plugin/`, `plugins/`)
- ✅ Auto-install on folder trust (`.claude/settings.json`)
- ✅ Version controlled with project

---

## Implementation Decisions

1. **Versioning Strategy**: Plugin version always matches npm package version (automated via `bump-version.js`)

2. **Agent Architecture**: Single comprehensive agent covers all workflows (simpler than multiple specialized agents)

3. **Storage Structure**: Encode command+workdir in ref path for O(1) lookup
   - Path: `refs/notes/vibe-validate/run/{treeHash}/{encoded-key}`
   - Direct lookup without parsing
   - Independent scaling per command
   - Clear separation from validation cache

4. **History Command Design**: Unified interface with implicit type switching
   - Default: shows validation history
   - `--run="command"`: switches to run cache
   - `--workdir`: filters by directory (only with `--run`)
   - No `--type` flag needed

5. **History List Output**: Separate displays (no mixed types)
   - Default: validation history only
   - With `--run`: run cache entries only (adds 'command' and 'workdir' columns)

6. **Working Directory Representation**:
   - Empty string `""` for git root (never `"."`)
   - Relative path from git root for subdirectories: `"packages/cli"`

7. **Encoding Strategy**: URL encoding (encodeURIComponent)
   - Standard, reversible, widely understood
   - Handles all command characters safely

8. **History Query Strategy**: Direct ref queries
   - Query pattern: `refs/notes/vibe-validate/run/{treeHash}/*`
   - Decode ref to extract command+workdir
   - Sort by timestamp from note content

---

## Metrics for Success

### Usage Metrics (Dogfooding)
- Agent invocation frequency
- Universal skill trigger rate (non-TypeScript projects)
- Workflow completion success rate
- Error resolution time
- Context window savings (track by language: Python, Rust, Go, etc.)

### Quality Metrics
- User satisfaction (GitHub feedback)
- Agent accuracy (correct guidance)
- Skill accuracy (correct command wrapping)
- Validation success rate improvement
- Time-to-fix reduction
- Cross-language effectiveness

### Adoption Metrics
- Plugin installations (when public)
- GitHub stars/forks
- Community contributions
- **Language diversity**: % of users with non-TypeScript projects
- **Lightweight mode adoption**: % using `run` without config file

---

## Next Steps

### Immediate (This PR)
1. **Document Current Work**: Create GitHub issue for plugin development
2. **Finalize exploration document**: Capture universal skill vision
3. **Test Agent**: Validate comprehensive agent works in TypeScript projects
4. **Commit to branch**: Preserve plugin work on `feature/claude-code-plugin`

### Short-term (Next Phase)
1. **Create Universal Skill**: Implement `vibe-validate-run` for language-agnostic support
   - Test with Python (pytest, mypy, black)
   - Test with Rust (cargo test, clippy)
   - Test with Go (go test, golangci-lint)
   - Measure context reduction across languages

2. **Gather Feedback**: Dogfood skill with non-TypeScript projects
   - Try Python codebases
   - Try Rust codebases
   - Document user experience

### Long-term (Future)
1. **Add Caching to `run`**: Implement tree hash caching for lightweight mode
   - Design storage format (git notes)
   - Implement `--check` and `--skip-if-cached` flags
   - Add history integration
   - Test speedup with real projects across languages

2. **Publish Plugin**: Create public marketplace entry (when available)
3. **Expand Extractors**: Add support for more languages/tools based on feedback

---

## References

- [Claude Code: Plugins](https://docs.claude.com/en/docs/claude-code/plugins.md)
- [Claude Code: Subagents](https://docs.claude.com/en/docs/claude-code/sub-agents.md)
- [Claude Code: Skills](https://docs.claude.com/en/docs/claude-code/skills.md)
- [Claude Code: Plugin Reference](https://docs.claude.com/en/docs/claude-code/plugins-reference.md)

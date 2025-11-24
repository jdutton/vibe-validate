---
name: vibe-validate
version: 1.0.0
description: Git-aware validation orchestration for agentic development. Provides caching, error extraction, and validation guardrails for any project type (especially Node.js/TypeScript). Use when validating code changes, running tests with context-efficient output, or extending error extraction for unsupported tools.
---

# vibe-validate

## Purpose

Agentic validation orchestration with git-based caching and LLM-optimized error extraction.

**Why this matters for AI assistants:**
- **312x speedup** via git tree hash caching (skip validation if code unchanged)
- **95% token reduction** via smart error extraction (1500 tokens → 75 tokens)
- **Validation guardrails** prevent committing broken code
- **Works with any project type** (not just Node.js)

## When to Use This Skill

### Scenario 1: Try benefits immediately (no configuration needed)
**User signals:**
- "These test runs are slow and verbose"
- "Can you make this test output more concise?"
- "I want caching for this command"
- User is running repetitive commands (tests, lint, build)

**What to do:** Use `npx vibe-validate run <command>` to get caching + extraction benefits immediately.

→ See **resources/run-capability.md**

### Scenario 2: Configure project to use vibe-validate
**User signals:**
- "Set up validation before commits"
- "Prevent broken code from being committed"
- "Add validation guardrails to my project"
- "Configure vibe-validate for this project"
- "How do I adopt vibe-validate?"

**What to do:** Help configure project with `vv init` and set up validation phases.

→ See **resources/configure-project.md**

### Scenario 3: Extraction not working for a tool
**User signals:**
- "Errors aren't being captured from my build tool"
- "Generic extractor is being used"
- "`exitCode !== 0` but `totalErrors === 0`"
- "How do I add support for [tool-name]?"

**Prerequisites:** User is already using `vv run` OR has configured project to use vibe-validate.

**What to do:** Create custom extractor plugin.

→ See **resources/extending-extraction.md**

### Scenario 4: General troubleshooting
**User signals:**
- "vibe-validate isn't working"
- "Why is validation always running?"
- "How do I debug this?"
- "Cache isn't working"

→ See **resources/troubleshooting.md**

## Core Capabilities

### 1. Run (Try Benefits - No Configuration)
Wrap any command to get caching and error extraction immediately.

**Commands:**
```bash
# No installation needed - works immediately
npx vibe-validate run <command>

# If installed in project or globally, can use shorthand
vv run <command>
vibe-validate run <command>

# Skip cache, always run
vv run --force <command>
```

**Benefits:**
- ✅ Instant caching (312x speedup on unchanged code)
- ✅ Error extraction (95% token reduction)
- ✅ No project configuration needed
- ✅ Works with ANY command

**When to use:** User wants immediate benefits without project setup.

**Learn more:** resources/run-capability.md

### 2. Configure Project (Validation Guardrails)
Add validation to a project with git-aware caching and pre-commit hooks.

**Commands:**
```bash
# Initialize configuration for project type
vv init

# Run full validation suite
vv validate

# Check cached state (no re-run)
vv validate --check

# View current validation state
vv state
```

**Benefits:**
- ✅ Pre-commit validation guardrails
- ✅ Git-aware caching (312x speedup)
- ✅ Project-specific validation phases
- ✅ Team-wide consistency

**When to use:** User wants to adopt vibe-validate for their project.

**Learn more:** resources/configure-project.md

### 3. Extending Extraction (Custom Extractors)
Create custom error extractors for unsupported tools.

**Prerequisites:** Already using `vv run` OR configured project to use vibe-validate.

**Commands:**
```bash
# Generate plugin scaffold
vv create-extractor <name> \
  --description "..." \
  --author "..." \
  --detection-pattern "ERROR:"

# Auto-discovery from vibe-validate-local-plugins/
```

**When to use:** Built-in extractors don't handle user's tool output (generic extractor used, or no errors extracted despite failure).

**Learn more:** resources/extending-extraction.md

## Quick Decision Tree

```
User wants to...

Try caching + extraction without setup?
└─ Use `npx vibe-validate run <command>` → resources/run-capability.md

Configure project for validation guardrails?
└─ Run `vv init` and configure → resources/configure-project.md

Errors not being extracted?
├─ Already using vibe-validate (run or validate)?
│  └─ YES: Create custom extractor → resources/extending-extraction.md
└─ NO: First use `vv run` to try extraction → resources/run-capability.md

Something not working?
└─ Troubleshoot → resources/troubleshooting.md
```

## Command Syntax Notes

**No installation needed:**
```bash
npx vibe-validate run <any-command>
```

**After installing in project** (`npm install vibe-validate`):
```bash
vv run <command>                # Shorthand
vibe-validate run <command>     # Full name
```

**After installing globally** (`npm install -g vibe-validate`):
```bash
vv run <command>                # Available system-wide (shorthand)
vibe-validate run <command>     # Available system-wide (full name)
```

Both `vv` and `vibe-validate` work the same way - the difference is just whether the command is available locally (project) or system-wide (global).

## Resources Available

Load these progressively as needed:

- **resources/run-capability.md** - Using `vv run` for immediate caching + extraction (no config)
- **resources/configure-project.md** - Configuring a project to use vibe-validate
- **resources/extending-extraction.md** - Creating custom extractors (requires prior vibe-validate usage)
- **resources/troubleshooting.md** - Common issues and solutions

# Agent Integration Guide

Learn how to integrate vibe-validate with AI coding assistants like Claude Code, Cursor, Aider, and Continue.

## Table of Contents

- [Why Agent Integration?](#why-agent-integration)
- [Supported Agents](#supported-agents)
- [Integration Patterns](#integration-patterns)
- [Claude Code Integration](#claude-code-integration)
- [Cursor Integration](#cursor-integration)
- [Aider Integration](#aider-integration)
- [Continue Integration](#continue-integration)
- [Custom Agent Integration](#custom-agent-integration)
- [Best Practices](#best-practices)

## Why Agent Integration?

AI coding assistants benefit from structured validation output:

**Benefits:**
- 🤖 **Actionable Prompts** - Ready-to-use error descriptions
- 📊 **Structured Data** - YAML/JSON format for parsing
- 🎯 **Focused Context** - Only relevant error information
- 🔄 **Iterative Fixing** - Fast feedback loop with caching
- 📝 **File:Line Context** - Jump directly to error locations

**Traditional Output (Not Agent-Friendly):**
```
[32m✔[0m Building... (1234ms)
[31m✖[0m TypeScript compilation failed
src/index.ts(42,5): error TS2322: Type 'string' is not assignable to type 'number'.

    42     count: "five",
           ~~~~~

Found 1 error.
```

**Agent-Friendly Output (Structured):**
<!-- validation-result:partial -->
```yaml
passed: false
failedStep: TypeScript
failedStepOutput: |
  src/index.ts:42:5 - error TS2322
  Type 'string' is not assignable to type 'number'
```

## Supported Agents

vibe-validate officially supports these AI coding assistants:

| Agent | Detection | Output Format | Status |
|-------|-----------|---------------|--------|
| **Claude Code** | `CLAUDE_CODE=1` | YAML | ✅ Official |
| **Cursor** | `CURSOR=1` | YAML | ✅ Official |
| **Aider** | `AIDER=1` | YAML | ✅ Official |
| **Continue** | `CONTINUE=1` | YAML | ✅ Official |
| **CI/CD** | `CI=true` | YAML | ✅ Standard |
| **Custom** | Manual flag | YAML/JSON | ✅ Supported |

## Integration Patterns

### Pattern 1: Pre-Commit Workflow

**Agent ensures code quality before committing:**

```typescript
// Agent workflow (pseudo-code):
1. User: "Commit these changes"
2. Agent: Run `vibe-validate pre-commit`
3. If validation fails:
   - Run `vibe-validate state` to get error details
   - Analyze errors and suggest fixes
   - Apply fixes
   - Re-run validation (cached, fast!)
4. If validation passes:
   - Commit changes
```

**Benefits:**
- ✅ Never commit broken code
- ✅ Fast feedback loop (caching)
- ✅ Automated error fixing

### Pattern 2: Error Resolution Loop

**Agent iteratively fixes errors:**

```typescript
// Iterative fixing workflow:
do {
  result = run `vibe-validate validate`
  if (result.passed) break;

  errors = parse result.failedStepOutput
  fixes = suggest_fixes(errors)
  apply_fixes(fixes)
} while (max_iterations)
```

**Benefits:**
- ✅ Systematic error resolution
- ✅ Learning from patterns
- ✅ Comprehensive fixes

### Pattern 3: Development Assistant

**Agent monitors validation state during development:**

```typescript
// Real-time feedback workflow:
1. User: "Add login feature"
2. Agent: Implement feature
3. Agent: Run `vibe-validate validate --force`
4. Agent: Read validation state
5. If errors exist:
   - Fix errors proactively
   - Re-validate
6. Report completion to user
```

**Benefits:**
- ✅ Proactive error fixing
- ✅ User never sees errors
- ✅ Higher code quality

## Claude Code Integration

**Claude Code** is Anthropic's official AI coding assistant with terminal integration.

### Setup

**1. Configure vibe-validate:**
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

**2. Add npm scripts:**
```json
{
  "scripts": {
    "validate": "vibe-validate validate",
    "pre-commit": "vibe-validate pre-commit"
  }
}
```

**3. Configure Claude Code project:**
```markdown
<!-- CLAUDE.md (project instructions) -->
# Validation Workflow

**MANDATORY Steps for ANY Code Change:**
1. Make your changes
2. Run `npm run pre-commit` (MUST pass)
3. Only commit if validation passes

## Validation State

Validation results cached via git notes (content-based):
- Check current state: `vibe-validate state`
- Force re-validation: `vibe-validate validate --force`
- View timeline (advanced): `vibe-validate history list`

## Error Fixing

When validation fails:
1. View error details: `vibe-validate state`
2. Fix the issue
3. Re-run validation (fast with caching!)
```

### Usage in Claude Code

**User request:**
```
User: Fix any validation errors and commit
```

**Claude Code workflow:**
```bash
# 1. Check validation state
$ vibe-validate state

# Output (YAML format):
# passed: false
# failedStep: TypeScript
# 
```

### Claude Code Features

**Automatic detection:**
- Claude Code sets `CLAUDE_CODE=1` environment variable
- vibe-validate automatically uses YAML output
- No manual configuration needed

**State integration:**
- Claude Code can run `vibe-validate state` for validation results
- Structured YAML data for programmatic parsing

**Performance:**
- Validation caching = fast iteration
- Claude Code can validate frequently without slowdown
- Cached validation: < 1s vs. seconds/minutes full validation

---

## Cursor Integration

**Cursor** is an AI-powered code editor built on VSCode.

### Setup

**1. Configure vibe-validate:**
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

**2. Add VSCode tasks:**
```json
// .vscode/tasks.json
{
  "version": "2.0.0",
  "tasks": [
    {
      "label": "Validate",
      "type": "shell",
      "command": "npm run validate",
      "problemMatcher": [],
      "presentation": {
        "reveal": "always",
        "panel": "new"
      }
    },
    {
      "label": "Pre-Commit",
      "type": "shell",
      "command": "npm run pre-commit",
      "problemMatcher": []
    }
  ]
}
```

**3. Add keyboard shortcuts:**
```json
// .vscode/keybindings.json
[
  {
    "key": "ctrl+shift+v",
    "command": "workbench.action.tasks.runTask",
    "args": "Validate"
  }
]
```

### Usage in Cursor

**Cursor AI chat:**
```
User: Run validation and fix any errors

Cursor: Running validation...
[Runs: vibe-validate validate]

Cursor: Found 2 TypeScript errors. Fixing...
[Runs: vibe-validate state]
[Applies fixes]

Cursor: Validation now passes. Ready to commit.
```

### Cursor Features

**Terminal integration:**
```bash
# Set environment variable for Cursor
export CURSOR=1

# Run validation
npm run validate
```

**AI chat integration:**
- Cursor can run shell commands
- Reads YAML output automatically
- Suggests fixes based on errors

**Editor integration:**
- Jump to errors with Cmd+Click
- Inline error display
- Fix suggestions in editor

---

## Aider Integration

**Aider** is a terminal-based AI pair programmer.

### Setup

**1. Configure vibe-validate:**
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

**2. Create Aider configuration:**
```yaml
# .aider.conf.yml
edit-format: whole
auto-commits: false
dirty-commits: false

# Add validation to workflow
pre-commit-hook: |
  vibe-validate pre-commit
```

**3. Add shell alias:**
```bash
# ~/.bashrc or ~/.zshrc
alias validate="AIDER=1 vibe-validate validate"
alias pre-commit="AIDER=1 vibe-validate pre-commit"
```

### Usage in Aider

**Aider session:**
```
You: Run validation and fix errors

Aider: Running validation...
> vibe-validate validate

Aider: Found TypeScript errors:
- src/index.ts:42:5 - error TS2322

Aider: Fixing src/index.ts...
[Applies fix]

Aider: Re-running validation...
> vibe-validate validate
✅ Validation passed

You: Great! Commit the changes.
```

### Aider Features

**Command execution:**
- Aider runs shell commands directly
- Reads YAML output from state file
- Parses errors for fixing

**File editing:**
- Aider edits files based on errors
- Uses file:line context from extractors
- Applies fixes systematically

**Git integration:**
- Aider commits changes automatically
- Pre-commit hook runs validation
- Prevents bad commits

---

## Continue Integration

**Continue** is an open-source AI code assistant for VSCode.

### Setup

**1. Configure vibe-validate:**
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

**2. Add Continue configuration:**
```json
// .continue/config.json
{
  "customCommands": [
    {
      "name": "validate",
      "description": "Run vibe-validate validation",
      "prompt": "Run validation and report results:\n\n```\nvibe-validate validate\n```\n\nIf validation fails, run `vibe-validate state` to view errors and fix them."
    },
    {
      "name": "fix-errors",
      "description": "Fix validation errors",
    }
  ]
}
```

**3. Add npm scripts:**
```json
{
  "scripts": {
    "validate": "CONTINUE=1 vibe-validate validate",
    "pre-commit": "CONTINUE=1 vibe-validate pre-commit"
  }
}
```

### Usage in Continue

**Continue chat:**
```
User: /validate

Continue: Running validation...
[Executes: npm run validate]

Continue: Validation failed with 2 errors:
1. src/index.ts:42:5 - TypeScript error
2. src/auth.ts:128:10 - ESLint warning

User: /fix-errors

Continue: Reading validation state...
[Runs: vibe-validate state]

Continue: Fixing errors...
[Applies fixes to src/index.ts and src/auth.ts]

Continue: Re-validating...
✅ All errors fixed! Validation passes.
```

### Continue Features

**Custom commands:**
- `/validate` - Run validation
- `/fix-errors` - Fix validation errors
- `/pre-commit` - Pre-commit workflow

**File context:**
- Continue understands file:line references
- Opens files automatically
- Applies fixes in context

**Terminal integration:**
- Runs npm scripts
- Reads YAML output
- Parses error messages

---

## Custom Agent Integration

Integrate vibe-validate with your own AI tools or scripts.

### Step 1: Set Environment Variable

```bash
# Set custom agent detection (optional)
export MY_AGENT=1
```

### Step 2: Run Validation

```bash
vibe-validate validate
```

### Step 3: Read Validation State

```bash
# View validation state (YAML output)
vibe-validate state
```

**State output structure:**
<!-- validation-result:example -->
```yaml
passed: false
timestamp: 2025-10-16T15:30:00.000Z
treeHash: a1b2c3d4e5f6789abc123def456
failedStep: TypeScript
rerunCommand: pnpm typecheck
failedStepOutput: |
  src/index.ts:42:5 - error TS2322
  Type 'string' is not assignable to type 'number'
```

**Note**: Validation state is stored in git notes (not files). Always use `vibe-validate state` to query.

### Step 4: Parse and Act

**Python example:**
```python
import yaml
import subprocess

# Run validation
result = subprocess.run(
    ['vibe-validate', 'validate'],
    capture_output=True,
    env={'MY_AGENT': '1'}
)

# Read state via command (YAML output)
state_output = subprocess.run(
    ['vibe-validate', 'state'],
    capture_output=True,
    text=True
).stdout

state = yaml.safe_load(state_output)

if not state['passed']:
    print(f"Validation failed: {state['failedStep']}")
    print(f"Errors:\n{state['failedStepOutput']}")

    # AI agent fixes errors here
    # ...

    # Re-validate (fast with caching!)
    subprocess.run(['vibe-validate', 'validate'])
```

**Node.js example:**
```typescript
import { execSync } from 'child_process';
import yaml from 'yaml';

// Run validation
try {
  execSync('vibe-validate validate', {
    env: { ...process.env, MY_AGENT: '1' },
  });
} catch (error) {
  // Validation failed
}

// Read state via command (YAML output)
const stateOutput = execSync('vibe-validate state', { encoding: 'utf-8' });
const state = yaml.parse(stateOutput);

if (!state.passed) {
  console.log(`Failed: ${state.failedStep}`);
  console.log(`Errors:\n${state.failedStepOutput}`);

  // AI agent processes errors
  const fixes = await aiAgent.fixErrors(state.failedStepOutput);

  // Apply fixes
  await applyFixes(fixes);

  // Re-validate (fast with caching!)
  execSync('vibe-validate validate');
}
```

### Step 5: Handle Exit Codes

```bash
# Check exit code
vibe-validate validate
EXIT_CODE=$?

if [ $EXIT_CODE -eq 0 ]; then
  echo "Validation passed"
elif [ $EXIT_CODE -eq 1 ]; then
  echo "Validation failed - fix errors"
  vibe-validate state
elif [ $EXIT_CODE -eq 2 ]; then
  echo "Configuration error"
fi
```

---

## Best Practices


### 2. Leverage Caching for Iteration

Validation caching enables fast iteration:

```typescript
// First run: ~90 seconds (full validation)
await validate();

// Fix errors
await fixErrors();

// Second run: ~300ms (cached, only changed files)
await validate();
```

**Typical workflow:**
- 1st run: Full validation (slow)
- Fix 1-2 errors
- 2nd run: Cached validation (fast!)
- Repeat until all errors fixed

### 3. Implement Pre-Commit Workflow

Prevent bad commits with pre-commit validation:

```bash
# .git/hooks/pre-commit
#!/bin/sh
vibe-validate pre-commit

if [ $? -ne 0 ]; then
  echo "❌ Pre-commit validation failed"
  echo "Fix errors before committing"
  exit 1
fi
```

**Agent workflow:**
```typescript
async function commitChanges(message: string) {
  // Run pre-commit validation
  const result = await preCommit();

  if (!result.passed) {
    // Fix errors automatically
    await fixErrors(result.errors);

    // Re-validate
    await preCommit();
  }

  // Commit if validation passes
  await git.commit(message);
}
```

### 4. Use Structured Output

Always use YAML or JSON for agent parsing:

```bash
# Good: Structured output
vibe-validate validate --yaml

# Less good: Human-readable output
vibe-validate validate --human
```

**Why structured output:**
- ✅ Easy to parse programmatically
- ✅ No ambiguity (no color codes)
- ✅ Complete error context
- ✅ Ready-to-use prompts

### 5. Monitor Validation Performance

Track validation performance for optimization:

```typescript
const start = Date.now();
await validate();
const duration = Date.now() - start;

if (duration > 10000) {
  console.warn('Validation slow - consider optimizing');
}
```

**Optimization strategies:**
- Enable parallel execution
- Use fail-fast ordering
- Cache validation state
- Incremental validation (future)

### 6. Handle Edge Cases

**Network failures:**
```typescript
try {
  await validate();
} catch (error) {
  if (error.code === 'ECONNREFUSED') {
    console.error('Network error - skip validation');
    return { passed: true }; // Allow commit
  }
  throw error;
}
```

**Git repository issues:**
```typescript
const state = await validate();

if (state.error === 'Not a git repository') {
  console.warn('Git not available - skip tree hash caching');
  // Fall back to timestamp-based caching
}
```

---

## Advanced Integration Patterns

### Pattern: Progressive Error Fixing

Fix errors progressively based on priority:

```typescript
async function fixErrorsProgressively() {
  let iteration = 0;
  const maxIterations = 10;

  while (iteration < maxIterations) {
    const state = await validate();

    if (state.passed) {
      console.log(`✅ All errors fixed in ${iteration} iterations`);
      break;
    }

    // Extract errors
    const errors = parseErrors(state.failedStepOutput);

    // Sort by priority (TypeScript errors first)
    const sortedErrors = sortByPriority(errors);

    // Fix top 3 errors only
    const topErrors = sortedErrors.slice(0, 3);
    await fixErrors(topErrors);

    iteration++;
  }
}
```

### Pattern: Multi-Agent Collaboration

Multiple agents collaborate on fixing errors:

```typescript
async function multiAgentFix() {
  const state = await validate();

  if (state.passed) return;

  // Route errors to specialized agents
  const typescriptErrors = filterByType(state.errors, 'typescript');
  const eslintErrors = filterByType(state.errors, 'eslint');
  const testErrors = filterByType(state.errors, 'test');

  // Parallel fixing
  await Promise.all([
    typescriptAgent.fix(typescriptErrors),
    eslintAgent.fix(eslintErrors),
    testAgent.fix(testErrors),
  ]);

  // Re-validate
  await validate();
}
```

### Pattern: Learning from Fixes

Track fixes for pattern recognition:

```typescript
interface FixRecord {
  error: string;
  fix: string;
  timestamp: Date;
}

const fixHistory: FixRecord[] = [];

async function learnFromFixes() {
  const state = await validate();

  if (!state.passed) {
    const fixes = await suggestFixes(state.errors);

    for (const fix of fixes) {
      // Apply fix
      await applyFix(fix);

      // Record for learning
      fixHistory.push({
        error: fix.error,
        fix: fix.solution,
        timestamp: new Date(),
      });
    }
  }

  // Use history for better suggestions
  const patterns = analyzePatterns(fixHistory);
  await updateSuggestionModel(patterns);
}
```

---

## Troubleshooting

### "State file not found"

**Solution**: Run validation first to create state file:
```bash
vibe-validate validate
vibe-validate validate --check
```

### "Agent fixes don't work"

**Solution**: Check error format in state output:
```bash
vibe-validate state | grep -A 10 "Failed step"
```

Ensure error extractors are working correctly (see [Error Extractors Guide](./error-extractors-guide.md)).

---

## Related Documentation

- [Getting Started Guide](./getting-started.md)
- [Configuration Reference](./configuration-reference.md)
- [CLI Reference](./cli-reference.md)
- [Config Templates Guide](./../config-templates/README.md)
- [Error Extractors Guide](./error-extractors-guide.md)

---

## See Also

- [Claude Code Documentation](https://claude.ai/code)
- [Cursor Documentation](https://cursor.sh)
- [Aider Documentation](https://aider.chat)
- [Continue Documentation](https://continue.dev)
- [vibe-validate GitHub](https://github.com/yourusername/vibe-validate)

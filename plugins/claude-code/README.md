# vibe-validate Plugin for Claude Code

Comprehensive expert agent for vibe-validate validation orchestration in TypeScript projects.

## What This Plugin Provides

**vibe-validate Expert Agent** - Complete guidance for using vibe-validate effectively:

### Core Capabilities

1. **Pre-Commit Validation** - Enforce validation before every commit
   - Prevents broken code from entering git history
   - Leverages caching for fast iteration (312x speedup when code unchanged)
   - Guides you through fixing errors incrementally

2. **Context-Optimized Testing** - Wrap commands for 90-95% context reduction
   - Transforms verbose test output into structured YAML
   - Extracts only errors with file:line context
   - Works with vitest, jest, tsc, eslint, and more

3. **Validation Orchestration** - Full pipeline management
   - Parallel execution of validation phases
   - Git tree hash caching (content-based, deterministic)
   - Smart state querying (don't re-run tests to see errors)

4. **Setup Diagnostics** - Health checks and troubleshooting
   - Detects configuration issues
   - Validates environment (Node.js, git, package manager)
   - Identifies deprecated files after upgrades

5. **PR Monitoring** - GitHub Actions integration
   - Real-time CI status updates
   - Extracts validation state from failed runs
   - Provides recovery commands

6. **Project Initialization** - Quick setup with templates
   - Interactive configuration wizard
   - TypeScript-specific templates (library, Node.js, React)
   - Generates validated config files

## Installation

### Prerequisites

1. **vibe-validate must be installed** in your project:
   ```bash
   npm install -D vibe-validate
   # or
   pnpm add -D vibe-validate
   ```

2. **TypeScript project** - vibe-validate is designed for TypeScript/JavaScript projects

### Option 1: Install from Local Clone

```bash
# Clone the repository
git clone https://github.com/jdutton/vibe-validate.git
cd vibe-validate

# Add as marketplace
claude plugin marketplace add /Users/your-username/path/to/vibe-validate

# Install the plugin
claude plugin install vibe-validate
```

### Option 2: Install from GitHub (when published)

```bash
# Add vibe-validate marketplace
claude plugin marketplace add jdutton/vibe-validate

# Install the plugin
claude plugin install vibe-validate
```

## Usage

The expert agent activates automatically when you work with vibe-validate in TypeScript projects.

### Primary Workflows

#### 1. Pre-Commit Validation (Most Important)

**You**: "Commit these changes"

**Claude** (using the agent):
```bash
npx vibe-validate pre-commit
```

If validation fails:
```bash
# Query cached state (instant, no re-run)
npx vibe-validate state --yaml
```

Then fixes errors and re-validates (fast with caching!).

#### 2. Context-Optimized Test Running

**You**: "Run the tests in packages/cli/test/run.test.ts"

**Claude**:
```bash
npx vibe-validate run "npx vitest packages/cli/test/run.test.ts"
```

**Output** (90-95% smaller):
```yaml
exitCode: 1
errors:
  - file: packages/cli/test/run.test.ts
    line: 42
    message: "Expected 5 to equal 6"
summary: "1 test failure"
guidance: "Fix assertion at line 42"
```

#### 3. Full Validation Pipeline

**You**: "Validate the project before pushing"

**Claude**:
```bash
npx vibe-validate validate
```

Uses cached results if code unchanged (~288ms vs ~90s).

#### 4. Setup Diagnostics

**You**: "Check if vibe-validate is configured correctly"

**Claude**:
```bash
npx vibe-validate doctor
```

Diagnoses issues and provides guidance.

#### 5. PR Monitoring

**You**: "Watch the PR validation status"

**Claude**:
```bash
npx vibe-validate watch-pr
```

Monitors GitHub Actions until completion, extracts errors if failed.

## Key Benefits

### For Claude (The AI Agent)

- **90-95% context savings** - More room for code and reasoning
- **Structured YAML output** - Easy to parse instead of verbose terminal output
- **File:line precision** - Jump directly to errors
- **Instant state queries** - Don't re-run tests to see what failed
- **Workflow guidance** - Clear decision trees for every scenario

### For Users

- **Faster responses** - Claude processes validation output efficiently
- **Better fixes** - Claude focuses on actual errors, not framework noise
- **Validated tool** - See Claude using vibe-validate successfully
- **Comprehensive coverage** - All vibe-validate workflows in one agent

## What the Agent Knows

The agent provides complete coverage of vibe-validate capabilities:

### Commands
- `init` - Project initialization
- `validate` - Full validation pipeline
- `pre-commit` - Pre-commit workflow
- `state` - View validation state
- `doctor` - Setup diagnostics
- `watch-pr` - PR monitoring
- `run` - Command wrapper for context optimization
- `config` - Configuration display
- `cleanup` - Post-merge cleanup
- `history` - Validation history
- `sync-check` - Branch synchronization

### Concepts
- Git tree hash caching (312x speedup)
- Error extractors (90-95% context reduction)
- Pre-commit workflows
- Parallel execution
- Fail-fast ordering
- LLM-optimized output formats

### Configuration
- YAML configuration format
- Template selection
- Phase and step definition
- Parallel vs sequential execution
- Git settings (mainBranch, remoteOrigin)

### Troubleshooting
- Common issues and solutions
- Doctor diagnostics interpretation
- Cache invalidation scenarios
- CI/local validation sync

## Progressive Disclosure

The agent keeps initial instructions focused (~350 lines) and references comprehensive documentation on-demand:

**Referenced Documentation** (loaded when needed):
- [CLI Reference](../../docs/skill/resources/cli-reference.md) - Complete command syntax
- [Configuration Reference](../../docs/skill/resources/configuration-reference.md) - Schema details
- [Error Extractors Guide](../../docs/error-extractors-guide.md) - Extractor internals
- [Agent Integration Guide](../../docs/agent-integration-guide.md) - Other AI assistants
- [Claude Code Plugin](../../docs/claude-code-plugin.md) - Plugin architecture and roadmap
- [CLAUDE.md](../../CLAUDE.md) - Development context (for dogfooding)

This approach avoids duplication while providing access to comprehensive details when required.

## Token Savings Examples

Real examples from vibe-validate development:

| Command | Raw Tokens | With vibe-validate | Savings |
|---------|-----------|-------------------|---------|
| `vitest tests/` | 1,547 | 82 | 94.7% |
| `tsc --noEmit` | 892 | 67 | 92.5% |
| `eslint src/` | 1,203 | 54 | 95.5% |

**Average: 90-95% reduction**

## Updating the Plugin

When new vibe-validate versions are released:

```bash
# Refresh marketplace
claude plugin marketplace update vibe-validate-local
# or for published version:
claude plugin marketplace update jdutton/vibe-validate

# Reinstall plugin
claude plugin uninstall vibe-validate
claude plugin install vibe-validate
```

## Version

Current version: **0.14.3**
- Plugin version synced with vibe-validate npm package
- Initial comprehensive agent covering all vibe-validate workflows
- Progressive disclosure with references to project documentation

## Troubleshooting

### Plugin Not Loading

Verify installation:
```bash
claude plugin list
# Should show "vibe-validate"
```

### Agent Not Triggering

The agent triggers when you work with vibe-validate commands or TypeScript validation workflows.

Try explicitly mentioning vibe-validate:
```
User: "Use vibe-validate to check if my code is valid"
```

### vibe-validate Not Found

Install vibe-validate in your project first:
```bash
npm install -D vibe-validate
npx vibe-validate init
npx vibe-validate doctor
```

### Outdated Agent Content

The agent references project documentation dynamically. When vibe-validate updates, the agent will load updated docs automatically (no plugin update needed for doc changes).

For agent instruction updates, update the plugin (see "Updating the Plugin" above).

## For vibe-validate Development

If you're working on the vibe-validate codebase itself, the agent includes dogfooding guidance:

**You (Claude) should use vibe-validate tools while developing vibe-validate** - this validates the tool works AND saves your context window.

The agent reminds you to wrap commands during development:
```bash
# Instead of:
npx vitest packages/cli/test/run.test.ts

# Use:
npx vibe-validate run "npx vitest packages/cli/test/run.test.ts"
```

## Documentation Architecture

This plugin follows the progressive disclosure pattern:

**Agent file** (`vibe-validate.md`):
- ~350 lines
- Focused workflows and decision trees
- References to comprehensive docs

**Project documentation** (`docs/`, `CLAUDE.md`):
- Loaded on-demand when agent needs detailed information
- No duplication - single source of truth
- Dynamically updated without plugin changes

This approach:
- ✅ Keeps agent context minimal
- ✅ Avoids documentation duplication
- ✅ References canonical documentation
- ✅ Adapts to documentation updates automatically

## License

MIT © Jeff Dutton

## Links

- [vibe-validate Repository](https://github.com/jdutton/vibe-validate)
- [Documentation](https://github.com/jdutton/vibe-validate#readme)
- [Issues](https://github.com/jdutton/vibe-validate/issues)
- [CLI Reference](https://github.com/jdutton/vibe-validate/blob/main/docs/skill/resources/cli-reference.md)
- [Plugin Architecture](https://github.com/jdutton/vibe-validate/blob/main/docs/claude-code-plugin.md)

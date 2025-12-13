# vibe-validate

[![CI](https://github.com/jdutton/vibe-validate/actions/workflows/validate.yml/badge.svg)](https://github.com/jdutton/vibe-validate/actions) [![npm version](https://img.shields.io/npm/v/vibe-validate.svg)](https://www.npmjs.com/package/vibe-validate) [![npm downloads](https://img.shields.io/npm/dm/vibe-validate.svg)](https://www.npmjs.com/package/vibe-validate) [![Node](https://img.shields.io/node/v/vibe-validate.svg)](https://www.npmjs.com/package/vibe-validate) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> **Faster Agentic Coding with confidence in every commit**

**Built by AI, for AI and Developers** - supports all major AI coding assistants (Claude Code, Cursor, Aider, Continue, Windsurf, and more).

## Why vibe-validate?

### 1. **Shift Left: Never Commit Broken Code**
Never commit or push code with test failures, lint violations, or leaked secrets. Pre-commit validation ensures agents and humans **never forget**.

**How it works:**
- ✅ Pre-commit hooks ensure validation has run before every commit (with smart caching)
- 🔐 Secret scanning detects credentials before they're pushed (Gitleaks integration)
- 🔄 Branch sync enforcement keeps you current with main
- 🎯 CI passes because local validation is identical

**Impact:** Stop the "push → wait for CI → fix → repeat" cycle. Catch problems in seconds, not minutes.

---

### 2. **Fast Validation With Smart Caching**
Test validation completes in under 1 second when code hasn't changed. Git worktree checksums provide deterministic caching - same code = same hash = instant results.

**How it works:**
- ⚡ **Instant** pass on unchanged code (< 1s vs 90s)
- 🔐 Content-based caching using git tree hashes
- 📊 Parallel phase execution runs checks simultaneously
- 📜 Validation history tracked against git worktree checksums

**Impact:** Validate constantly without waiting. Fast feedback = faster iteration.

---

### 3. **AI-Optimized Output Saves 95% of Context Window**
Extract actionable failures from verbose test logs. AI agents get structured YAML with file:line:message - not 200 lines of test runner boilerplate.

**How it works:**
- 🤖 Auto-detects Claude Code, Cursor, Aider, Continue
- 📋 Structured extraction: file, line number, error message, guidance
- 💰 **95% reduction** in context window usage (1500 tokens → 75 tokens)
- 🎯 Strips ANSI codes, progress bars, and noise

**Impact:** AI agents stay focused on fixing actual problems instead of parsing logs.

---

### 4. **Tools Optimized for Agents Speed Debugging and Development**
Built-in tools for AI agents and developers: health diagnostics, PR monitoring, branch sync enforcement, and actionable error guidance.

**How it works:**
- 🩺 `vv doctor` - diagnose setup issues before they block you
- 👀 `vv watch-pr` - monitor CI without opening browser
- 🔄 Automatic branch sync enforcement during pre-commit
- 🎯 `vv history` - view validation timeline and debug trends

**Impact:** Spend less time on tooling and environment issues. More time shipping features.

---

### 5. **Automatic Git Snapshots Protect Your Work**
Every validation creates git snapshots of your worktree (staged, unstaged, untracked files). Retrieve lost work or compare history when tests passed vs. failed.

**How it works:**
- 🛡️ Automatic - no user action required
- ⏱️ Timestamped snapshots with every validation
- 🔄 Recovery with standard git commands (`git cat-file`, `vv history`)
- 📜 Compare worktree state when tests passed vs. failed

**Impact:** Recover from bad refactoring, accidental reverts, or editor crashes. Your last validation is your safety net.

---

**For AI Assistants**: Get all command help at once with `vv --help --verbose` (or `npx vibe-validate --help --verbose` before install) or see the [Complete CLI Reference](docs/skill/resources/cli-reference.md)

## Quick Start

### Installation

**Recommended: Install globally** (works for all projects):
```bash
npm install -g vibe-validate
```

**Node.js projects: ALSO add as dev dependency** (for version locking + CI):
```bash
npm install -D vibe-validate
```

**Why global?**
- ✅ `vibe-validate` command (and `vv` shortcut) available everywhere immediately
- ✅ Works across all projects (Node.js, Python, Rust, Go, etc.)
- ✅ One installation for your entire machine
- ✅ Claude Code skill installed at user level

**Why ALSO add as dev dependency for Node.js?**
- ✅ Locks version in package.json (entire team uses same version)
- ✅ CI installs automatically (`npm ci` - no global install needed)
- ✅ npm scripts work without global install: `"validate": "vibe-validate validate"`
- ✅ `npx vibe-validate` and npm scripts prefer local version over global

**Command aliases:** `vibe-validate` (full name) and `vv` (shortcut) are interchangeable. Both work globally and locally.

### Usage (3 commands)

```bash
# 1. Initialize (creates config, detects your project type)
vv init

# 2. Check setup health (ALWAYS run after install/upgrade!)
vv doctor

# 3. Validate (run before every commit - uses cache when code unchanged)
vv validate
```

**Performance:**
- **When code changes**: seconds to minutes (runs all checks)
- **When code unchanged**: under a second (content-based caching!)

**💡 Tip for AI Agents**: Always run `vv doctor` after upgrading to detect deprecated files and get migration guidance.

## Integration with package.json

Make vibe-validate part of your existing workflow:

```json
{
  "scripts": {
    "validate": "vibe-validate validate",
    "pre-commit": "vibe-validate pre-commit",
    "test:all": "vibe-validate validate"
  }
}
```

**Benefits:**
- Shorter commands: `npm run validate` vs `npx vibe-validate validate`
- Familiar pattern for TypeScript developers (like `npm run typecheck`)
- Works with any package manager (npm, pnpm, yarn)
- Easier to document in team workflows

**Usage:**
```bash
npm run validate      # Run validation (cached if code unchanged)
npm run pre-commit    # Pre-commit workflow (branch sync + validation)
```

## Try It Out (No Installation)

Test vibe-validate in any project (Node.js, Python, Rust, Go, etc.) without installing:

```bash
# Check if your project meets prerequisites
npx vibe-validate@latest doctor
```

**Prerequisites checked:**
- ✅ Node.js 20+ installed (required for vibe-validate CLI)
- ✅ Git repository initialized
- ✅ Package manager available (npm/pnpm) if Node.js project

**Note:** vibe-validate requires Node.js 20+ to run the CLI, but it can validate projects in ANY language. The validation commands you configure can be Python pytest, Rust cargo test, Go go test, etc.

---

## Essential Commands

```bash
# Initialize configuration
vv init

# Run validation (cached when code unchanged)
vv validate

# Pre-commit workflow (branch sync + validation)
vv pre-commit

# Health check and diagnostics
vv doctor

# View validation state
vv state

# View validation history
vv history list

# Monitor PR CI status
vv watch-pr

# Generate GitHub Actions workflow
vv generate-workflow
```

**📖 Full command reference:** Run `vv --help --verbose` or see [Complete CLI Reference](docs/skill/resources/cli-reference.md)

---

## Configuration

Run `vv init` to create `vibe-validate.config.yaml`:

```yaml
# vibe-validate.config.yaml
$schema: https://unpkg.com/@vibe-validate/config/config.schema.json

validation:
  phases:
    - name: Pre-Qualification
      parallel: true
      steps:
        - name: TypeScript
          command: pnpm typecheck
        - name: ESLint
          command: pnpm lint

    - name: Testing
      steps:
        - name: Unit Tests
          command: pnpm test
```

**📖 Templates & customization:** [config-templates directory](https://github.com/jdutton/vibe-validate/tree/main/packages/cli/config-templates)

---

## Requirements

- Node.js 20+
- Git
- npm/pnpm/yarn

## Troubleshooting

**Cache not working?** Run `vv doctor` to diagnose issues.

**Validation passes locally but fails in CI?** Run `vv validate --force` locally to reproduce CI environment.

**Branch sync issues?** Run `git fetch origin` and verify with `git branch -vv`.

**Config not found?** Run `vv init` to create `vibe-validate.config.yaml` in project root.

**📖 Full troubleshooting guide:** [docs/](docs/)

---

## Learn More

**📖 Documentation:**
- [Getting Started Guide](docs/getting-started.md)
- [Secret Scanning](docs/secret-scanning.md)
- [Work Protection & Recovery](docs/work-protection.md)
- [Agent Integration Guide](docs/agent-integration-guide.md)
- [CI Debugging](docs/ci-debugging.md)
- [Complete CLI Reference](docs/skill/resources/cli-reference.md)

**🔧 Monorepo Packages:** `vibe-validate` (umbrella) • `@vibe-validate/cli` • `@vibe-validate/core` • `@vibe-validate/config` • `@vibe-validate/extractors` • `@vibe-validate/git`

---

## Extending vibe-validate: Custom Extractors

vibe-validate ships with 14+ built-in extractors for popular tools (TypeScript, ESLint, Vitest, Jest, Playwright, Maven, and more). But you can add support for ANY tool by creating custom extractors.

### What Are Extractors?

Extractors parse verbose test/lint output and extract **only the failures** in LLM-friendly YAML format:

**Before (1500 tokens):**
```
> vitest run
 FAIL  src/utils.test.ts > calculateTotal
   AssertionError: expected 42 to equal 43
   [verbose stack trace...]
   [progress bars, timing info, module loading...]
```

**After (75 tokens - 95% reduction):**
```yaml
errors:
  - file: src/utils.test.ts
    line: 15
    message: "AssertionError: expected 42 to equal 43"
summary: "1 test failure"
guidance: "Fix assertion in calculateTotal test"
```

### Built-in Extractors

- **Testing**: Vitest, Jest, Mocha, Playwright, Jasmine, AVA, TAP, JUnit XML
- **Linting**: ESLint, TypeScript compiler
- **Build Tools**: Maven (compiler, Surefire, Checkstyle)
- **Fallback**: Generic extractor (regex-based line:column:message parsing)

### Adding Extractors for Your Tools

**Three ways to extend:**

1. **Create a custom extractor locally** (JavaScript/TypeScript file)
2. **Install community extractors** from npm (coming in v0.18.0)
3. **Contribute extractors back** to vibe-validate (helps everyone!)

### How to Contribute Extractors

We welcome extractor contributions for any language, framework, or tool! Here's how:

**1. Check if an extractor exists:**
```bash
# View current extractors
ls packages/extractors/src/extractors/
```

**2. Create a new extractor:**
- Follow the pattern in existing extractors (e.g., `packages/extractors/src/extractors/vitest/`)
- Implement `detect()` (identifies your tool's output) and `extract()` (parses errors)
- Add comprehensive tests (see `packages/extractors/test/`)

**3. Test your extractor:**
```bash
# Run extractor tests
pnpm --filter @vibe-validate/extractors test

# Test with real output
vv run <your-tool-command>
```

**4. Submit a PR:**
- See [CONTRIBUTING.md](.github/CONTRIBUTING.md) for development workflow
- Include: extractor code, tests, example output
- Benefits: faster review, helps the community, your tool gets first-class support

**Why contribute back?**
- **Maintenance**: We handle updates as tools evolve
- **Quality**: Community testing across projects
- **Distribution**: Available to all vibe-validate users immediately
- **Recognition**: You're credited as the extractor author

**Need help?** Open an issue describing your tool/framework. We'll guide you through the extractor creation process.

**📖 Extractor architecture details:** [docs/extractor-plugin-architecture.md](docs/extractor-plugin-architecture.md)

---

## Contributing

See [.github/CONTRIBUTING.md](.github/CONTRIBUTING.md) for development setup and guidelines.

## License

MIT © Jeff Dutton

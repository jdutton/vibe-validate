# vibe-validate vs Turborepo

This document compares vibe-validate with Turborepo to help you understand their different value propositions and how they can work together.

## TL;DR

**They solve different problems and work great together:**

- **Turborepo**: Optimizes *execution speed* through intelligent caching and task orchestration
- **vibe-validate**: Optimizes *output format* for AI agents through error extraction and structured YAML

**Use both**: Turbo handles fast builds/tests, vibe-validate makes validation output AI-consumable.

---

## Core Problem Space

### Turborepo - Build System Optimization

**Problem**: Monorepos struggle to scale - thousands of tasks (build, test, lint) run redundantly, wasting CI time and developer productivity.

**Solution**: High-performance task orchestration with intelligent caching (local + remote).

**Key Features**:
- Parallel task execution across available CPU cores
- Content-based caching (local and remote)
- Dependency-aware build graph
- Incremental builds (only rebuild changed packages)
- Remote cache sharing across team and CI

**Target Users**: Development teams building JavaScript/TypeScript monorepos

### vibe-validate - LLM-Friendly Validation

**Problem**: AI agents (Claude Code, Cursor, etc.) get overwhelmed by verbose validation output - 1500 tokens of test failures becomes unusable noise that consumes context windows.

**Solution**: Git-aware validation orchestration with LLM-optimized error extraction.

**Key Features**:
- Git tree hash caching (content-based, deterministic)
- Error extraction from verbose tool output (95% token reduction)
- Structured YAML output with actionable guidance
- Language-agnostic (Python, Rust, Go, TypeScript, etc.)
- Fail-safe philosophy (never blocks the user)
- Phase-based validation workflow

**Target Users**: Developers using AI coding assistants for development

---

## Feature Comparison

| Feature | Turborepo | vibe-validate |
|---------|-----------|---------------|
| **Primary Goal** | Speed up builds/tests | Make validation AI-consumable |
| **Caching Strategy** | Task output (local + remote) | Git tree hash (content-based) |
| **Language Support** | JavaScript/TypeScript focused | Language-agnostic |
| **Output Format** | Standard terminal | YAML + extracted errors |
| **Task Orchestration** | Parallel with dependency graph | Sequential phases + parallel steps |
| **Remote Collaboration** | Remote cache (Vercel) | Git notes for state tracking |
| **Error Handling** | Standard build errors | LLM-optimized extraction + guidance |
| **Integration** | Replaces script orchestration | Wraps existing commands |
| **Platform** | Any (Rust-based) | Any (Node.js-based) |

---

## Performance Benchmarks (vibe-validate project)

**Environment**: 9-package monorepo on macOS

### Turborepo Results
- **Cold build**: 5.3 seconds
- **Full cache (no changes)**: 67ms
- **Speedup**: **79x faster** for cached builds

### vibe-validate Results
- **First validation**: ~8 seconds (includes build + tests)
- **Cached validation**: 312ms
- **Speedup**: **25x faster** for unchanged code

### Combined (Turbo + vibe-validate)
```yaml
# vibe-validate.config.yaml
validation:
  phases:
    - name: Build
      steps:
        - name: turbo-build
          command: turbo run build  # ← Turbo handles fast parallel builds
```

**Result**:
- Turbo caches build outputs → faster execution
- vibe-validate extracts errors → AI-friendly output
- **Best of both worlds**

---

## Key Differentiators

### Turborepo Strengths

1. **Build Speed** - Incremental builds save "years of engineering time" (per Vercel)
2. **Monorepo-Native** - Understands package dependencies automatically
3. **Remote Caching** - CI/CD pipelines never repeat work across team
4. **Ecosystem** - Backed by Vercel, Rust-powered performance
5. **Parallel Execution** - Maximum CPU utilization across cores
6. **Language Focus** - Deeply integrated with npm/pnpm/yarn

### vibe-validate Strengths

1. **AI Agent Focus** - Designed for LLM context windows (95% token savings)
2. **Git-Aware** - Uses tree hashes for deterministic caching (no timestamps)
3. **Error Extraction** - Strips ANSI codes, extracts file/line/message
4. **Language-Agnostic** - Works with ANY language/toolchain
5. **Fail-Safe Philosophy** - Always proceeds, never blocks the user
6. **Structured Output** - YAML format with actionable guidance
7. **Pre-Commit Integration** - Built-in Git hooks for validation workflow
8. **Validation State Tracking** - Git notes for persistent state across branches

---

## When to Use Each

### Use Turborepo when:

✅ Managing a JavaScript/TypeScript monorepo
✅ CI/CD pipelines are slow due to redundant builds
✅ You need remote cache sharing across team/CI
✅ You want automatic dependency graph management
✅ Build speed is the primary bottleneck
✅ Working primarily with npm ecosystem

### Use vibe-validate when:

✅ Working with AI coding assistants (Claude, Cursor, etc.)
✅ Validation output is too verbose for AI consumption
✅ You need git-aware caching for validation state
✅ Working with polyglot projects (Python + Rust + TypeScript)
✅ You want structured error extraction for LLM parsing
✅ Context window efficiency is critical
✅ You need pre-commit workflow integration

---

## Working Together

**Turborepo and vibe-validate are complementary tools** that solve orthogonal problems.

### Integration Example

```yaml
# vibe-validate.config.yaml
validation:
  phases:
    - name: Build
      steps:
        - name: turbo-build
          command: turbo run build

    - name: Testing
      steps:
        - name: turbo-test
          command: turbo run test
          extractor: vitest

    - name: Quality
      steps:
        - name: turbo-typecheck
          command: turbo run typecheck
          extractor: typescript
```

**Benefits of integration**:
1. **Turbo handles execution** - Parallel builds, incremental caching, dependency management
2. **vibe-validate handles output** - Error extraction, YAML formatting, AI optimization
3. **Speed + Consumability** - Fast execution with AI-friendly results

### vibe-validate Project Uses Both

This project (vibe-validate) now uses Turborepo for build orchestration:

```json
// package.json
{
  "scripts": {
    "build": "turbo run build",
    "typecheck": "turbo run typecheck"
  }
}
```

**Results**:
- Turbo caches TypeScript builds → faster development
- vibe-validate validates with LLM-friendly output → AI agents can parse errors efficiently

---

## Architecture Comparison

### Turborepo Architecture

```
┌─────────────────────────────────────┐
│         Turborepo Engine            │
│  (Rust-based task orchestration)    │
└─────────────────────────────────────┘
              ↓
┌─────────────────────────────────────┐
│      Dependency Graph Parser         │
│   (Analyzes package.json deps)      │
└─────────────────────────────────────┘
              ↓
┌─────────────────────────────────────┐
│       Task Scheduler                 │
│  (Parallel execution + caching)     │
└─────────────────────────────────────┘
              ↓
┌─────────────────────────────────────┐
│   Cache Layer (Local + Remote)      │
│    (Content-based hashing)          │
└─────────────────────────────────────┘
```

**Focus**: Fast, correct task execution with minimal redundancy

### vibe-validate Architecture

```
┌─────────────────────────────────────┐
│       Validation Orchestrator        │
│   (Phase-based sequential/parallel)  │
└─────────────────────────────────────┘
              ↓
┌─────────────────────────────────────┐
│      Git Tree Hash Cache             │
│  (Content-based via git write-tree)  │
└─────────────────────────────────────┘
              ↓
┌─────────────────────────────────────┐
│       Command Executor               │
│   (Runs validation commands)         │
└─────────────────────────────────────┘
              ↓
┌─────────────────────────────────────┐
│      Error Extractor                 │
│  (Parses output → structured YAML)   │
└─────────────────────────────────────┘
              ↓
┌─────────────────────────────────────┐
│     LLM-Optimized Output             │
│   (File/line/message + guidance)     │
└─────────────────────────────────────┘
```

**Focus**: Consumable, actionable validation results for AI agents

---

## Use Case Matrix

| Scenario | Turborepo | vibe-validate | Both |
|----------|-----------|---------------|------|
| Large TypeScript monorepo | ✅ Primary | ⚠️ Optional | ✅ Best |
| Polyglot project (Python + Rust + TS) | ⚠️ Limited | ✅ Primary | ✅ Good |
| AI-assisted development | ❌ No benefit | ✅ Primary | ✅ Best |
| CI/CD optimization | ✅ Primary | ⚠️ Optional | ✅ Good |
| Local development speed | ✅ Primary | ⚠️ Optional | ✅ Best |
| Context window efficiency | ❌ No benefit | ✅ Primary | ✅ Best |
| Pre-commit validation | ⚠️ Manual | ✅ Built-in | ✅ Best |
| Remote cache sharing | ✅ Built-in | ❌ Git only | ⚠️ Mixed |

**Legend**:
- ✅ Excellent fit
- ⚠️ Partial fit or requires configuration
- ❌ Not designed for this

---

## Migration Paths

### From pnpm scripts to Turbo

**Before**:
```json
{
  "scripts": {
    "build": "pnpm -r build",
    "test": "pnpm -r test"
  }
}
```

**After**:
```json
{
  "scripts": {
    "build": "turbo run build",
    "test": "turbo run test"
  }
}
```

Add `turbo.json`:
```json
{
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    }
  }
}
```

### From verbose validation to vibe-validate

**Before**:
```bash
$ pnpm test
# 1500 tokens of verbose vitest output
```

**After**:
```bash
$ vibe-validate run "pnpm test"
exitCode: 1
errors:
  - file: src/auth.ts
    line: 42
    message: Expected 'admin' but got 'user'
summary: 1 test failure
```

### Combining Both

**Step 1**: Add Turbo for speed
```bash
pnpm add -Dw turbo
# Create turbo.json
```

**Step 2**: Add vibe-validate for AI optimization
```bash
pnpm add -D vibe-validate
vibe-validate init
```

**Step 3**: Configure integration
```yaml
# vibe-validate.config.yaml
validation:
  phases:
    - name: Build
      steps:
        - name: turbo-build
          command: turbo run build
```

---

## FAQ

### Can I use Turborepo without vibe-validate?

**Yes.** Turbo is a general-purpose build system that works standalone. You don't need vibe-validate for Turbo to be valuable.

### Can I use vibe-validate without Turborepo?

**Yes.** vibe-validate works with any commands (`npm`, `pnpm`, `pytest`, `cargo test`, etc.). It doesn't require Turbo.

### Why use both?

**Speed + Consumability.** Turbo makes your builds fast. vibe-validate makes your validation output AI-friendly. Together, you get fast *and* consumable results.

### Does vibe-validate cache like Turbo?

**Similar but different:**
- **Turbo**: Caches task outputs (build artifacts, test results)
- **vibe-validate**: Caches validation *state* (pass/fail per tree hash)

Both use content-based hashing, but vibe-validate's caching is git-aware and tracks state via git notes.

### Which should I adopt first?

**Depends on your bottleneck:**
- **Slow builds?** → Start with Turbo
- **AI agent struggles with output?** → Start with vibe-validate
- **Both?** → Add Turbo first (infrastructure), then vibe-validate (AI optimization)

### Does Turbo work with vibe-validate's pre-commit hooks?

**Yes.** vibe-validate's pre-commit hooks can run Turbo commands:

```yaml
# vibe-validate.config.yaml
validation:
  phases:
    - name: Pre-Qualification
      steps:
        - name: turbo-build
          command: turbo run build
```

The hook runs validation, which executes Turbo commands, which use caching. All layers work together.

---

## Conclusion

**Turborepo and vibe-validate solve orthogonal problems:**

- **Turborepo**: "Make my monorepo builds FAST"
- **vibe-validate**: "Make my validation output AI-FRIENDLY"

For **polyglot projects** or **LLM-assisted development**, vibe-validate provides unique value that Turborepo doesn't address.

For **large JavaScript monorepos**, Turborepo provides build optimization that vibe-validate doesn't focus on.

**Together**, they provide the best of both worlds: fast execution with AI-consumable results.

---

## Further Reading

### Turborepo
- [Turborepo Documentation](https://turbo.build/)
- [Why Turborepo Is Winning the JavaScript Build Race](https://www.gocodeo.com/post/why-turborepo-is-winning-the-javascript-build-race)
- [Complete Guide to Turborepo](https://dev.to/araldhafeeri/complete-guide-to-turborepo-from-zero-to-production-3ehb)

### vibe-validate
- [Getting Started Guide](../getting-started.md)
- [Git Validation Tracking](../git-validation-tracking.md)
- [Agent Integration Guide](../agent-integration-guide.md)

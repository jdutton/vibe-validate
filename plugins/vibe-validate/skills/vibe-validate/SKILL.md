---
name: vibe-validate
description: Use when starting vibe-validate work or picking a sub-skill. Router for the validate/fix loop, project setup, cache and locking, work recovery, extractor authoring, PR/CI monitoring, and non-Claude agent integration.
---

# vibe-validate

**vibe-validate** is a git-aware validation orchestration tool for LLM-assisted development. It runs your existing build/lint/test/typecheck commands, caches results by git tree hash for near-instant re-runs on unchanged trees, and reformats failures as structured YAML with stripped ANSI codes so an agent can read them cheaply.

This is a router skill. Load the sibling sub-skill that matches the work at hand — each sub-skill owns one slice of vibe-validate's surface and is designed to be pulled in on demand.

## When to use vibe-validate

Good fits:

- TypeScript/JavaScript monorepos where an AI agent iterates tight on build/lint/test cycles
- Projects that want one cached entry point in front of many validators (eslint, vitest, tsc, etc.)
- Heterogeneous repos (TS plus Python/Rust/Go) where a shared orchestrator beats per-language glue
- Teams adopting confidence checkpoints (pre-commit, pre-push, ad-hoc, or agent-driven) without mandating one shape
- Workflows that need snapshots of worktree state for safe recovery after agent edits

Poor fits:

- Single-script one-offs where a raw `npm test` is sufficient
- Projects with no CI-style validation surface to orchestrate
- Teams unwilling to express their validation as structured steps in a YAML config

## Picking a sub-skill

| If you're working on... | Load |
|---|---|
| The day-to-day validate/fix/revalidate loop — `vv validate`, `vv pre-commit`, `vv state`, `vv run` | `vibe-validate:vv-validate-dev-loop` |
| Setting up vibe-validate in a repo — `vv init`, `vv doctor`, config schema, heterogeneous languages, dep-lock checks | `vibe-validate:setting-up-projects` |
| Debugging cache misses, cache hits that should've missed, or concurrency lock conflicts | `vibe-validate:caching-and-locking` |
| Recovering lost work from validation snapshots | `vibe-validate:recovering-work` |
| Validation fails but produces no extracted errors — custom extractor authoring | `vibe-validate:authoring-extractors` |
| Monitoring PR/CI status, debugging CI failures | `vibe-validate:vv-watch-pr` |
| Configuring vibe-validate for non-Claude tools (Cursor, Aider, Continue) | `vibe-validate:integrating-agents` |

## CLI surface at a glance

```bash
vv --help                 # top-level help
vv validate               # run validation, cached by tree hash
vv pre-commit             # branch-synced validation (one checkpoint option)
vv state                  # query cached state (instant, no re-run)
vv run <cmd>              # wrap any command for LLM error extraction
vv init                   # initialize vibe-validate.config.yaml
vv doctor                 # setup diagnostics
vv watch-pr               # monitor PR/CI
vv history                # validation history
vv snapshot               # show current worktree snapshot
vv create-extractor       # scaffold a custom extractor
```

Each sub-skill covers its slice of the CLI in depth — don't memorize this table, load the sub-skill when you need detail.

## Getting started

For a first-time adoption walkthrough, see `adoption-guide.md` in this directory. For full CLI syntax with every flag and exit code, see `cli-reference.md` in this directory.

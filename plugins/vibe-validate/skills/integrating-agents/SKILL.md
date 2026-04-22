---
name: integrating-agents
description: Use when wiring vibe-validate into a non-Claude AI coding assistant (Cursor, Aider, Continue, or any other tool). Covers system-prompt additions, command wrappers, and output routing for agentic workflows.
---

# integrating-agents

## When to use

Setting up vibe-validate so a **non-Claude AI tool** — Cursor, Aider, Continue, or any other coding assistant — can run validations, read extracted errors, and iterate on fixes. This skill describes the generic integration surface and the tool-specific patterns that sit on top of it.

**If you are using Claude Code**, stop here. The vibe-validate Claude Code plugin **is** your integration — installing it loads this family of skills directly, and your daily workflow lives in `vibe-validate:vv-validate-dev-loop`. There is nothing to wire up separately.

## Integration mental model

Any AI-assisted dev tool needs three things from a validator to be useful in an agentic loop:

1. **A trigger** — the agent needs to know when to invoke `vv` (on demand, before commit, after edits, etc.).
2. **Intelligible output** — the agent needs to parse what failed without being swamped by ANSI codes, test-runner banners, and compiler noise.
3. **Actionable errors** — the agent needs file/line/message tuples it can turn into edits.

vibe-validate supplies #2 and #3 by default. Its `state` and `run` commands emit YAML with extracted errors stripped of formatting — most modern AI tools parse YAML natively, and even those that don't can grep file:line references out of plain text. What varies across tools is #1 — how you attach the trigger — which is what this skill is about.

## What every integration needs

Regardless of tool, three moving parts end up in the adopter's repo:

**A config file** — `vibe-validate.config.yaml` at the repo root defines the phases/steps. See `vibe-validate:setting-up-projects` for authoring this.

**A way to invoke `vv`** — either the installed CLI, `npx vibe-validate`, `pnpm dlx vibe-validate`, or `bunx vibe-validate`. Package-manager choice belongs to the adopter; don't hardcode it in agent instructions.

**Guidance that reaches the agent** — a system prompt addition, a custom command, or a rule file that tells the agent when/how to call `vv`. This is the piece that differs per tool.

## Iteration pattern the agent should follow

Regardless of which tool hosts the agent, the same loop is what produces clean commits:

1. Make edits.
2. Run `vv validate`. If exit 0, done.
3. On non-zero exit, run `vv state` and read the YAML. Each failed step under `phases[].steps[]` carries an `extraction.errors` array of `{file, line, column, message}` entries.
4. Fix the top few errors (ordering by phase first, then file, keeps related fixes batched).
5. Re-run `vv validate`. Cache hits make iterations 2+ near-instant when only a few files changed.
6. Repeat until passing; cap at a sensible iteration count (8–10) to avoid thrash.

Teaching this loop to the host tool is what turns vv from "a linter wrapper" into a real agentic checkpoint. The richer version of this workflow — including when to force re-validation, when to consult `vv history`, and how to handle cache-suspicious results — lives in `vibe-validate:vv-validate-dev-loop`; for a non-Claude integration, distill it into whatever fits in your tool's prompt slot.

## Generic patterns (tool-agnostic)

### System-prompt / rules addition

Drop this (or a variant) into the tool's custom-rules / system-prompt / AGENT.md slot:

> When the user asks to commit, or after you make substantive code changes, run `vv validate`. If it exits non-zero, run `vv state` to see the YAML breakdown of failed steps. For each failed step, read the `extraction.errors` list — each entry has `file`, `line`, and `message`. Fix the files, then re-run `vv validate` (caching makes the re-run fast). Do not commit until validation passes. If the tool supports it, `vv run <command>` is useful for ad-hoc test invocations because it extracts errors the same way.

This is a distilled version of what the Claude Code plugin's `vv-validate-dev-loop` skill covers in depth — see that skill for the extended decision tree.

Keep the snippet short. Long rules files get truncated, ignored, or bloat the agent's context. The goal is a single paragraph the model can internalize, not a spec.

### Custom commands / slash-commands

Most agent tools support named shortcuts. Wire at minimum:

- `validate` → `vv validate`
- `state` → `vv state`
- `pre-commit` → `vv pre-commit` (if the adopter uses vv's pre-commit wrapper)

A `fix-errors` or `validate-and-fix` command that chains "run `vv validate` → read `vv state` → apply fixes → re-validate" is a strong accelerant when the tool allows multi-step prompts.

### Output routing

The `state` command writes to stdout in YAML. There are three reasonable shapes for piping it back to the agent:

1. **Let the agent run the command itself** (Cursor, Aider, Continue) — simplest, captures stdout directly.
2. **Generate a file the tool watches** — some tools read workspace files into context. Redirect `vv state > .vv-state.yaml` and add it to the tool's context allowlist.
3. **Pre-commit hook as the gate** — install a git `pre-commit` hook that runs `vv pre-commit`. This works even when the agent itself cannot run shell commands, because the block happens at `git commit` time.

## Tool-specific wiring

### Cursor

Cursor exposes two useful slots: custom rules (project-level `.cursorrules` or equivalent) and VSCode tasks.

- **Rules file** — add the system-prompt snippet above.
- **Tasks** — define `Validate` and `Pre-Commit` tasks in `.vscode/tasks.json` that invoke `vv validate` and `vv pre-commit`. Bind to keyboard shortcuts in `.vscode/keybindings.json` if desired.
- **Output** — Cursor's AI panel reads terminal output; the YAML from `vv state` lands there directly.

### Aider

Aider is terminal-native and runs shell commands freely.

- **`.aider.conf.yml`** — set `auto-commits: false` and add a pre-commit invocation that runs `vv pre-commit`. This makes Aider's commit step gate on validation.
- **Chat instruction** — tell Aider "run `vv validate` after edits; on failure, `vv state` tells you what to fix." Aider parses the file:line references in YAML naturally.
- **Shell alias** — a `validate` alias pointing at `vv validate` is the lightest-touch option if you don't want a config file.

### Continue

Continue's extension point is `.continue/config.json`, specifically the `customCommands` array.

- Add a `validate` command whose prompt is "Run `vibe-validate validate` and report results. If it fails, read `vibe-validate state` and fix the errors."
- Add a `fix-errors` command that chains state-reading, edits, and re-validation.
- Continue's file-context awareness means file:line references in YAML output open the right files automatically.

### Other tools (generic shell-capable)

For any tool that can run shell commands and read their stdout — Codeium, Windsurf, Zed's assistant, custom orchestration scripts — the pattern is the same: put the system-prompt snippet in front of the model, expose `vv validate` / `vv state` / `vv run` as commands, and let the model iterate. The YAML output is intentionally stable and parseable; no tool-specific adapter is required.

For adopters building their own orchestration (scripts, CI glue, bespoke agents), the raw contract is:

- `vv validate` — exit 0 = pass, non-zero = fail.
- `vv state` — YAML to stdout, parseable as the `ValidationState` schema (passed, phases, steps, extraction.errors).
- `vv run <cmd>` — runs the wrapped command and emits the same extraction envelope.

Wrap those three in whatever language the orchestrator speaks (Python's `yaml.safe_load`, Node's `yaml` package, Go's `gopkg.in/yaml.v3`, etc.).

### Output format expectations

An adopter's agent can rely on this shape from `vv state`:

- Top-level `passed` boolean and `summary` string.
- `phases[]` array, each with `name`, `passed`, and a `steps[]` array.
- Each step has `name`, `command`, `exitCode`, `passed`, and (on failure) an `extraction` object with an `errors` array of `{file, line, column, message}` tuples plus a `summary` and `totalErrors`.

Agents that parse this tree can route errors by step (e.g., send type errors to one sub-prompt and lint errors to another), prioritize by phase, or simply flatten `extraction.errors` and iterate. All three approaches work; pick whichever fits the host tool's prompt budget.

### Environment variables

vibe-validate looks at a handful of env vars adopters may want to set in their tool's shell-env slot:

- `CI=true` — enables non-interactive output suited for pipelines; useful when the agent cannot respond to prompts.
- `CURSOR=1`, `AIDER=1`, `CONTINUE=1` — legacy hints that a particular agent host is active. These do not change the extraction format today (everything is YAML), but setting them is harmless and future-proofs the integration.

Never rely on environment detection to *change agent behaviour* — have the agent choose its commands explicitly based on the prompt.

## Tools with limited shell access

Web-only IDEs and sandboxed assistants can't always invoke arbitrary shell commands. Two workarounds:

1. **Run `vv` alongside, in a real terminal.** Redirect `vv state` to a file the tool has read access to (e.g., `.vv-state.yaml` in the workspace). Tell the agent to read that file before proposing commits.
2. **Gate at git instead of at the agent.** Install a git `pre-commit` hook that runs `vv pre-commit`. The tool can attempt to commit; the hook blocks on failure regardless of whether the agent knew to validate first. This is the lowest-trust, highest-assurance option and is a good default even when other integration is in place.

## Keeping the agent honest

The main failure mode across tools is the agent *claiming* validation passed without running it. Two mitigations:

- **Require evidence in the commit flow.** Tell the agent to paste the tail of `vv state` output (or its exit code) before proposing a commit.
- **Use the pre-commit hook.** Even if the agent lies, `git commit` will fail and surface the real state.

## See also

- For exhaustive per-tool walkthroughs including full config file examples, shell aliases, and worked chat transcripts, see `docs/agent-integration-guide.md` at the repository root.
- `vibe-validate:vv-validate-dev-loop` — the daily workflow once integration is wired up; most of what you'd tell the agent to do reduces to following this loop.
- `vibe-validate:setting-up-projects` — authoring `vibe-validate.config.yaml`; this is the adopter's job regardless of which AI tool they use.
- `vibe-validate:authoring-extractors` — if the adopter's toolchain emits errors in a format vv doesn't already extract, they'll want a custom extractor so the YAML stays useful to the agent.

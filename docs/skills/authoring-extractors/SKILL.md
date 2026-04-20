---
name: authoring-extractors
description: Use when validation fails but no errors are extracted, or when writing a custom error extractor for a tool vibe-validate does not recognize. Covers built-in extractors, vv create-extractor, and the plugin system.
---

# authoring-extractors

## When to use

Reach for this skill when extraction — not validation itself — is the problem:

- `vv state` reports `exitCode: 1` but `extraction.totalErrors: 0`
- Metadata shows `extractor: generic` after an extractor-specific tool failed
- The raw command output contains obvious errors that never make it into the structured result
- You are adopting a build tool vibe-validate does not yet know about (Gradle, Maven, Bazel, a proprietary in-house tool, a new linter)
- The errors appear but are garbled, truncated, or missing file/line information

If validation is producing a clean, useful error list, this skill does not apply. The normal workflow is covered by vibe-validate:vv-validate-dev-loop. If the problem is where to wire an `extractor:` field into a step, that is configuration and lives in vibe-validate:setting-up-projects.

## How extraction works

Every validation step runs a command and captures stdout and stderr. That raw output is handed to an extractor — a small pattern-matcher — whose job is to turn "8 KB of noisy log" into a short YAML list of structured errors (file, line, column, code, message, optional fix hint). The structured list is what gets written into git notes, surfaced by `vv state`, and consumed by an AI assistant.

Three key properties:

- **Automatic selection.** When you do not specify an extractor, vibe-validate inspects the step name and command, runs each candidate's `detect()` function against the output, and picks the highest-confidence match. Failing that, it falls back to the `generic` extractor.
- **Context reduction.** A well-written extractor typically turns thousands of tokens of raw output into tens of tokens of actionable errors — roughly 90–95 percent reduction. This is the mechanism behind vibe-validate's "LLM-friendly" claim; everything else is plumbing.
- **Cacheability.** Extraction runs once per step execution, and the structured result is cached alongside the tree-hash-keyed validation state. Subsequent cache hits return the extracted errors directly without re-running the tool — see vibe-validate:caching-and-locking for the caching mechanism.

Extraction is a pure string-to-structured-data transform. An extractor does not execute commands, read files, or touch the network. That constraint is what allows extractors to be distributed as sandboxed plugins.

### Raw vs. extracted — what it looks like

A typical TypeScript failure produces several hundred lines of output — source context, carets, related-location snippets, footer counts. The `typescript` extractor reduces that to a handful of YAML rows:

```yaml
extraction:
  errors:
    - file: src/index.ts
      line: 42
      column: 5
      message: "error TS2322: Type 'string' is not assignable to type 'number'"
    - file: src/auth.ts
      line: 128
      column: 10
      message: "error TS2345: Argument of type 'null' is not assignable to parameter of type 'User'"
  summary: "2 type errors"
  totalErrors: 2
```

That block is what an AI assistant sees via `vv state`. The extractor's job is to make sure every error the user cares about lands in that list with enough location information to act on.

## Built-in extractors

Shipped with vibe-validate and auto-detected when the step name or command matches:

- **typescript** — parses `tsc --noEmit` output (`file:line:col - error TSxxxx: message`). Triggered by step names containing "TypeScript" or "tsc". Preserves related-location context when present.
- **eslint** — parses ESLint stylish-format output (`line:col error message rule-name`). Captures the rule name as the error code so suppression or autofix can key off it. Triggered by step names containing "ESLint".
- **vitest** — parses Vitest and Jest failure output (`❯ file > suite > test`, assertion errors, `❯ file:line:col`). Includes expected-vs-received detail when the reporter emits it. Triggered by "Vitest", "Jest", "test", or "Test" in the step name.
- **openapi** — parses OpenAPI/Swagger validation output (`validation error in <schema path>`). Triggered by "OpenAPI" in the step name or `swagger` in the command.
- **generic** — final fallback. Strips ANSI codes and progress indicators, keeps lines that look like errors or contain file:line references. Useful but coarse; it is the signal that a better extractor should exist.

There are a handful of additional built-ins (build-tool and framework specific) registered internally. The full list with patterns and output shapes lives in the reference doc at `docs/error-extractors-guide.md`. When a built-in is wrong, you can override it by declaring `extractor: <name>` on the step — see vibe-validate:setting-up-projects for the config surface.

Naming conventions that unlock auto-detection: keep the step name close to the tool's public name ("TypeScript", "ESLint", "Vitest Unit Tests") rather than generic labels ("Types", "Lint", "Tests"). If a step runs multiple tools (rare, usually a smell), split it — one extractor per step is an invariant the system assumes.

## Diagnosing extraction failures

### Step 1 — confirm the symptom

Run validation (or the failing command via `vv run`), then inspect state:

```
vv state
```

The red flags to look for:

```yaml
exitCode: 1
extraction:
  totalErrors: 0
  metadata:
    detection:
      extractor: generic
      confidence: 50
```

`exitCode: 1` plus `totalErrors: 0` is the definitive signature of an extraction gap. If a specific extractor was selected but still produced zero errors, the extractor's regex no longer matches the tool's output (often after a tool version bump). If `extractor: generic` was selected, nothing in the registry recognized the output at all.

Do not trust `summary` or a human-readable report at this stage — only the structured `extraction` block. A summary that says "build failed" with an empty `errors` array is still a zero-extraction result.

### Step 2 — inspect the raw output

Before concluding the extractor is broken, look at what the tool actually emitted. The raw captured output is available in `vv state --verbose`, or you can re-run the command directly to see it in your terminal. Two common surprises:

- **The tool emitted no error lines at all.** Some build tools return a non-zero exit code without writing anything parseable — especially when they fail in a pre-build phase (dependency resolution, lockfile mismatch, missing env var). No extractor can pull errors from empty output. Fix the tool invocation, not the extractor.
- **The error lines are there but wrapped in ANSI or unicode decoration.** A plugin that does not strip escape codes before matching will miss them. The scaffold handles this; hand-rolled plugins sometimes do not.

### Step 3 — is a better built-in available?

Before writing code, check whether the step name or command is steering auto-detection to the wrong extractor. Renaming a step from "Check Types" to "TypeScript" is sometimes the whole fix. Explicitly setting `extractor: typescript` on the step is the deterministic version of the same idea. This is a configuration change, not an authoring task — cross-reference vibe-validate:setting-up-projects for where that field lives.

If no built-in fits, proceed to Step 4.

### Step 4 — write a custom extractor

Only once you have confirmed that (a) the exit code is non-zero, (b) the raw output contains extractable errors a human could read, and (c) no built-in extractor understands that format.

## `vv create-extractor` — scaffolding a new extractor

vibe-validate ships a scaffolding command. **Use it first.** Manually hand-rolling a plugin before seeing the template is a waste of time, and the template already wires up the type imports, sandbox-safe boilerplate, and the test harness conventions.

```
vv create-extractor <tool-name> \
  --description "Short description of what this extracts" \
  --author "Your Name <you@example.com>" \
  --detection-pattern "DISTINCTIVE_ERROR_STRING"
```

The `--detection-pattern` is the single most distinctive substring you can find in the failing output — `FAILURE: Build failed`, `COMPILATION ERROR`, `[FAIL]`, etc. Capture a real failure log first (redirect a failing command to a file), grep through it, and pick a pattern that (1) always appears on failure and (2) rarely appears on success. A pattern that also fires on warnings will cause false positives — tighten it.

The command writes a sibling directory:

```
vibe-validate-plugin-<tool-name>/
├── package.json
├── tsconfig.json
├── index.ts          # your detect() and extract() — edit this
└── README.md
```

Typical workflow after scaffolding:

1. Open `index.ts`, refine the `detect()` confidence logic, and rewrite `extract()` around the actual error lines in your captured failure log. Prefer explicit line-oriented regexes with named capture groups for file, line, column, and message.
2. Build the plugin: inside the plugin directory, `npm install` and `npm run build`.
3. Move it to an auto-discovery location at the project root: create `vibe-validate-local-plugins/` and move the plugin directory inside it. Plugins there load automatically; plugins named `vibe-validate-plugin-*` at the project root also load automatically.
4. Re-run the failing command through `vv run` and inspect `vv state`. Look for `detection.extractor: <tool-name>` and a non-zero `totalErrors`.
5. Iterate on regexes until the error list is accurate. Keep a fixture of the raw failure output so you can replay it.

For explicit registration (instead of relying on auto-discovery), add an entry under `extractors:` in the config file — the schema and options are covered in vibe-validate:setting-up-projects.

### Common extraction patterns

Three shapes cover most real-world tool output:

- **`file:line:col - message`** (TypeScript, many compilers). A single regex with four capture groups, applied per line, handles every error.
- **`file(line,col): severity code: message`** (MSBuild, older Windows toolchains). Same idea, different punctuation — do not copy the TypeScript regex verbatim.
- **Multi-line error blocks** (stack traces, build-tool failures). Track state across lines: a header line starts an error, subsequent indented lines accumulate into `details`, a blank line or dedent closes it. The scaffold's `extract()` includes a comment showing the state-machine pattern.

Always parse by lines and always anchor regexes with `^` and `$` where possible. Matching in the middle of a line eventually bites you when a filename contains the pattern you keyed on.

### Testing the plugin

The `@vibe-validate/extractors/testing` package exports a small set of assertion helpers: `expectPluginMetadata`, `expectDetection`, `expectExtractionResult`, `expectEmptyExtraction`, and `expectErrorObject`. A minimum-viable test suite covers (1) detection fires on a real failure fixture with confidence above the threshold, (2) detection returns zero confidence on unrelated output, (3) extraction produces the expected error count and fields from the fixture, (4) empty input returns zero errors without throwing. This is the same harness the built-in extractors use; following the pattern makes the plugin contributable upstream later.

## Plugin architecture in brief

An extractor plugin is an ES module that default-exports an object with two functions:

- **`detect(output: string)`** returns a confidence score (0–100), the patterns that matched, and a short reason. A score of 95+ means "I am certain this is my tool"; 60–79 is "probably but not definitely"; below that, yield to another extractor. The registry picks the highest confidence above a minimum threshold.
- **`extract(output: string)`** returns a structured result: an `errors` array (each entry typically has `file`, `line`, `column`, `message`, optional `code` and `severity`), `totalErrors`, a one-line `summary`, optional `guidance`, and an `errorSummary` string for display.

Plugins run in a sandbox by default — string operations, regex, and plain data manipulation are allowed; filesystem, network, child processes, and `eval()` are not. This is enforced, not advisory. Adopters can opt into `trust: trusted` in config for full access, but only do so for plugins you own and trust.

A test-helper package (`@vibe-validate/extractors/testing`) provides assertions for plugin metadata, detection confidence, extraction results, error objects, and empty-output handling. Writing a few fixture-based tests alongside the plugin catches regressions when the target tool changes its output format.

### Confidence, priority, and tie-breaking

Several plugins can match the same output. Selection works in two passes. First, every registered extractor (built-in plus custom) is asked to `detect()` the output. Every response above the configured minimum confidence becomes a candidate. Second, the candidate with the highest confidence wins; ties are broken by the plugin's static `priority` metadata (higher first), and further ties by registration order.

Practical implications when authoring:

- **Do not inflate confidence.** If you return 99 for any output containing "error", you will hijack steps that belong to a more specific built-in. Reserve 95+ for distinctively-shaped output unique to your tool.
- **Use priority for tool families, not confidence.** If you are authoring a plugin for a tool whose output can overlap with another (e.g., a wrapper around `tsc`), declare a higher `priority` so you win when confidences tie, rather than cranking confidence to 100.
- **Return zero confidence for unrelated output.** Plugins that always return a non-zero score add noise to selection and can starve the right extractor on edge cases.

### YAML-based extractors for simple cases

For tools whose entire extraction fits in a single regex, the plugin system supports a declarative YAML form — no JavaScript required. The config declares a detection pattern, a minimum confidence, and a single named-capture-group regex for errors. The `docs/extractor-plugin-architecture.md` reference shows the full schema. Start with this form when the tool emits one error per line in a uniform shape; drop into the TypeScript form when you need state across lines.

The full technical architecture — priority ordering, confidence tie-breaking, the normalizer pipeline, how detection hints feed the registry, sandbox internals, YAML-based extractor authoring for simple cases — is documented at `docs/extractor-plugin-architecture.md` at the repository root. Read it when you hit a question this skill does not answer; it is the canonical reference.

For the full reference of built-in extractor behaviors, line patterns, and YAML output shapes, see `docs/error-extractors-guide.md` at the repository root.

## Publishing a custom extractor

If a plugin is useful beyond one project, publish it as an npm package so other adopters can install it. Convention:

- **Package name**: `vibe-validate-plugin-<tool>` (matches the auto-discovery pattern) or a scoped variant like `@yourorg/vibe-validate-plugin-<tool>`.
- **Entry point**: compiled `index.js` (or `dist/index.js`) exporting the same default plugin object.
- **Peer dependency**: declare `@vibe-validate/extractors` as a peer so adopters bring their own version.
- **Adopter install**: `npm install <package>` plus a config entry registering the package name under `extractors:`.

Published plugins share the same sandbox constraints as local ones. Adopters who grant `trust: trusted` are explicitly opting in — do not design a plugin that needs trusted access unless there is no alternative.

When versioning a published extractor, bump the patch version when you tighten regexes without changing the output shape, a minor version when you add fields to the extracted error objects, and a major version when you change existing field names or semantics. Adopters pin these in their project's `package.json`, so surprise breakage is real.

## Troubleshooting

**Plugin was moved to `vibe-validate-local-plugins/` but is not being used.** Confirm you ran the build step (`npm run build` inside the plugin directory) and that the compiled output (`dist/index.js` or equivalent declared in `package.json` `main`) actually exists. Unbuilt TypeScript sources are ignored.

**Detection fires on success cases, not just failures.** The `--detection-pattern` is too loose. Tighten it, or combine multiple required substrings in `detect()` (e.g., require both `BUILD FAILED` and the tool's specific task marker). Raise the confidence floor so your plugin loses ties against a more specific one when the output is ambiguous.

**Extraction returns an empty array even though detection fired.** The regex in `extract()` does not match the actual error lines. Log a few sample lines (during development only), confirm the format character-for-character (beware of tabs vs. spaces, Windows CR/LF, ANSI residue), and rewrite the regex around what you see. The test helpers make this iteration quick.

**Multi-error output only returns the first error.** The extraction loop is consuming the whole string instead of iterating per line, or a regex is using a non-global match on a buffer. Split on `\n` and match per line, or use a global regex with `matchAll`.

## When NOT to write a custom extractor

Some situations look like extraction bugs but are not:

- **The extractor runs correctly; the tool's output is the problem.** If the tool emits warnings mixed with errors, or colors everything regardless of TTY, fix the command flags (`--no-color`, `--reporter=basic`, `--format=stylish`) before editing extractor code. A well-shaped output stream is almost always easier to get than a bespoke extractor.
- **The validation is genuinely clean.** If `exitCode: 0` and `totalErrors: 0`, there is nothing to extract. Do not "improve" an extractor that has nothing to do.
- **The built-in is close but stale.** If a minor output format change broke a built-in extractor, file an issue upstream with a before/after sample. Do not fork unless you need the fix today. A patched built-in helps every adopter; a private plugin helps only you.
- **The tool is niche but the project is shared.** An adopter-local plugin is fine, but for a tool other teams also use, upstreaming a built-in extractor is a better long-term investment than maintaining a private plugin.
- **The tool is wrong.** Sometimes a tool reports an error via stderr but exits zero, or exits non-zero without writing an error line at all. No extractor can fix a broken exit-code contract. Work around it with a wrapper script that normalizes the exit code before you reach for a plugin.

## Example: what a detect() and extract() pair looks like

This is the shape of a real plugin, minus boilerplate. Treat it as a mental reference, not a copy-paste target (the scaffold generates the full file):

```typescript
import type { ExtractorPlugin } from '@vibe-validate/extractors';

const plugin: ExtractorPlugin = {
  name: 'gradle',
  priority: 90,

  detect(output) {
    const hasTaskMarker = output.includes('> Task :');
    const hasFailure = /FAILURE: Build failed/.test(output);
    if (hasTaskMarker && hasFailure) {
      return { confidence: 95, patterns: ['> Task :', 'FAILURE: Build failed'], reason: 'Gradle failure' };
    }
    return { confidence: 0, patterns: [], reason: '' };
  },

  extract(output) {
    const errors: Array<{ file: string; line?: number; message: string }> = [];
    for (const line of output.split('\n')) {
      const m = line.match(/^(.+?):(\d+): error: (.+)$/);
      if (m) errors.push({ file: m[1], line: Number(m[2]), message: m[3] });
    }
    return {
      errors,
      totalErrors: errors.length,
      summary: `${errors.length} Gradle error(s)`,
      guidance: 'Run the Gradle task with --stacktrace for full context',
      errorSummary: errors.map(e => `${e.file}:${e.line ?? '?'} ${e.message}`).join('\n'),
    };
  },
};

export default plugin;
```

The shape is always the same: `detect` returns confidence, `extract` returns structured errors. Everything else is tool-specific string wrangling.

## Iteration tips

Writing an extractor is a tight loop: capture real failure output, edit the plugin, rebuild, re-run the failing command, inspect `vv state`. A few habits keep the loop fast:

- **Keep a fixture file.** Redirect the failing command to `fixture.txt` once, then write tests that feed that file into the plugin. Rebuilding and re-running the tool on every iteration is slow; testing against the captured fixture is instant.
- **Start with over-matching, then tighten.** Get `extract()` to produce *any* errors first, even if it double-counts or captures junk. Then narrow the regex. Starting with a perfect regex often produces zero errors and no feedback signal.
- **Test the empty case from day one.** An extractor that crashes on empty input is a regression waiting to happen — the scaffold's test for empty output exists for a reason.
- **Version your fixtures when the tool changes.** If the vendor bumps major versions, save the new output alongside the old. A plugin that handles multiple tool versions is more valuable than one that only works on the version you tested.

## Interaction with caching

Because validation state is keyed by git tree hash and cached in git notes, the *first* run of a step that fails executes the extractor and writes the extracted errors into the notes entry. Subsequent runs on the same tree hash return the cached entry — the extractor does not run again, and any improvements to the plugin are not reflected until either the tree changes or the cache is invalidated. If you are iterating on an extractor, use `vv validate --force` (or re-run the failing command through `vv run --force`) to bypass the cache while you tune the regexes. Once the plugin is stable, normal cached behavior resumes and the up-to-date extractor is the one that runs on the next cache miss. The caching mechanism itself is covered in vibe-validate:caching-and-locking.

## See also

- vibe-validate:setting-up-projects — wiring an `extractor:` field into a step, registering plugins in config, and controlling trust level
- vibe-validate:vv-validate-dev-loop — the daily validation loop and how `vv state` surfaces extracted errors
- `docs/extractor-plugin-architecture.md` at the repository root — full plugin architecture, sandbox internals, YAML-based extractors, and confidence-tie internals
- `docs/error-extractors-guide.md` at the repository root — complete reference of built-in extractors, their regex patterns, and YAML output shapes

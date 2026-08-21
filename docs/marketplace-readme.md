# vibe-validate Skills Marketplace

LLM-optimized validation orchestration for vibe coding. [vibe-validate](https://github.com/jdutton/vibe-validate) caches validation state using git tree hashes, runs steps in parallel, and formats errors for LLM consumption.

**What you get:** A skill that teaches Claude Code how to configure and use vibe-validate for pre-commit workflows, CI validation, and error extraction in TypeScript projects.

## Install

### From the terminal

```bash
claude plugin marketplace add jdutton/vibe-validate#claude-marketplace
claude plugin install vibe-validate@vibe-validate
```

### From within Claude Code

```
/plugin marketplace add jdutton/vibe-validate#claude-marketplace
/plugin install vibe-validate@vibe-validate
```

### For your project (shared with team)

Add `--scope project` to write to `.claude/settings.json` (committed to git). Team members who clone the repo will be prompted to install the marketplace automatically.

```bash
claude plugin marketplace add jdutton/vibe-validate#claude-marketplace --scope project
claude plugin install vibe-validate@vibe-validate
```

### Update

```bash
claude plugin marketplace update vibe-validate
```

Then start a new Claude Code session. The skill appears as `/vibe-validate:vibe-validate`.

### Pre-release channel

To track the latest pre-release builds, use the `-next` branch instead:

```bash
claude plugin marketplace add jdutton/vibe-validate#claude-marketplace-next
```

## How it works

This branch is a **Claude plugin marketplace** — a structured directory that Claude Code can install directly from GitHub. No npm account or registry needed.

The marketplace is built from the [main branch](https://github.com/jdutton/vibe-validate) source using `vat build` and published with `vat claude marketplace publish`.

## Also available via npm

```bash
npm install -g vibe-validate
```

The npm package includes a postinstall hook that automatically registers the plugin in Claude Code.

## License

MIT

# docs/skills/ authoring rules

Skills here are packaged and distributed via VAT (`vibe-agent-toolkit`). They must satisfy both Claude Code's skill contract and VAT's audit rules.

## Naming

- **`vv-X` ONLY when `X` is a `vv` CLI subcommand or subcommand root** (e.g., `vv-watch-pr` ↔ `vv watch-pr`, `vv-validate-dev-loop` ↔ `vv validate` + related).
- **Otherwise descriptive gerund**, no `vv-` prefix (`setting-up-projects`, `caching-and-locking`, `recovering-work`, `authoring-extractors`, `integrating-agents`).
- Kebab-case, lowercase, matches `^[a-z][a-z0-9-]*$`.
- No reserved words (`claude`, `anthropic`) — Claude Code rejects these unless officially certified.
- Skill directory name MUST match the frontmatter `name` field.

## Router skill (`vibe-validate/SKILL.md`) — strict

1. **≤ 150 lines total.**
2. **Prose references to sub-skills only** — write `vibe-validate:vv-validate-dev-loop`, NEVER `[vv-validate-dev-loop](../vv-validate-dev-loop/SKILL.md)`. Markdown links trigger VAT packager transclusion and re-bloat the bundle.
3. **No code examples beyond a 5-line CLI overview.** Depth lives in sub-skills.
4. **Description triggers entry questions** ("what is vibe-validate", "how do I get started"), not specific tasks.
5. Verify post-edit: `vat skill review docs/skills/vibe-validate/SKILL.md` reports `fileCount: 1`.

## Sub-skill conventions

- **Description** ≤ 250 chars. Opens with "Use when…" or action verb. Third-person voice. 2–4 trigger keywords a user would actually type.
- **Body size** 150–400 lines. Audit warns at 2000.
- **Frontmatter `name`** matches directory name. No reserved words.
- **Single-responsibility test:** if the description must list two unrelated subjects to trigger correctly, split the skill.

## Cross-references

**Prose only**, never markdown links — both for sibling skills AND files inside your own skill directory. VAT's packager transcludes linked markdown and bloats the bundle; prose references are free.

Examples:
- Sibling: "See vibe-validate:setting-up-projects for configuration depth"
- Own dir: "See `configuration-reference.md` in this directory for the complete schema"

## Framing

Skills describe vibe-validate as providing **confidence checkpoints** adaptable to the adopter's workflow (pre-commit gate, pre-push gate, ad-hoc, agentic). Do NOT prescribe "validate before commit" as policy — it's one valid choice among several.

## Package-manager-agnostic invocations

Agent-facing operational reminders must describe validation workflows abstractly and show generic invocations:
- `vv validate` (installed CLI)
- `npx vibe-validate`, `pnpm dlx vibe-validate`, `bunx vibe-validate` (one-off)

Do NOT hardcode `pnpm validate` or any project-specific wrapper script — that's an adopter choice.

## Contributor content does NOT belong here

If the content is about how vibe-validate is built, released, or contributed to, it belongs in `docs/contributing/`, not a skill.

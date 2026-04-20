# docs/ contributor guidance

This repository separates **user/adopter-facing documentation** from **project-internal documentation**:

- **User/adopter content → `docs/skills/`**. Skills are the canonical distribution channel for everything adopters need to use or adopt vibe-validate. Each skill lives in its own directory with a `SKILL.md` plus any colocated reference material. See `docs/skills/CLAUDE.md` for authoring rules.
- **Contributor / project-internal content → `docs/contributing/`** (release workflow, testing patterns, sandbox research, implementation plans, YAML authoring conventions).
- **Plugin meta** (e.g., `docs/marketplace-readme.md`) stays at the top level.

**If you are adding documentation, decide first:** will an adopter using vibe-validate need this? If yes, it belongs as skill content. If it's for people *contributing to* vibe-validate itself, it belongs in `docs/contributing/`.

README files (`packages/*/README.md`, `docs/marketplace-readme.md`) are human/GitHub-browsing surface — they are NOT canonical skill content and are stripped when skills are packaged.

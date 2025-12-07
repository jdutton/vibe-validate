# Publishing Guide

## Overview

vibe-validate is a monorepo with 7 interdependent packages. They MUST be published together in dependency order.

## Standard Publishing

```bash
node tools/publish-all.js
```

Auto-determines npm tag from version:
- `X.Y.Z` → `latest`
- `X.Y.Z-rc.N` → `rc`
- `X.Y.Z-beta.N` → `beta`
- `X.Y.Z-alpha.N` → `alpha`

## Dependency Order

1. extractors (no deps)
2. git (no deps)
3. config (no deps)
4. history (depends on: git)
5. core (depends on: config, extractors, git)
6. cli (depends on: core, config, extractors, git, history)
7. vibe-validate (depends on: cli)

## Manual Recovery

If `publish-all.js` fails partway through:

```bash
# Check what's published:
npm view @vibe-validate/extractors@X.Y.Z
npm view @vibe-validate/git@X.Y.Z
npm view @vibe-validate/config@X.Y.Z
npm view @vibe-validate/history@X.Y.Z
npm view @vibe-validate/core@X.Y.Z
npm view @vibe-validate/cli@X.Y.Z
npm view vibe-validate@X.Y.Z

# Publish missing packages in dependency order:
cd packages/extractors && pnpm publish --tag <tag> --no-git-checks
cd packages/git && pnpm publish --tag <tag> --no-git-checks
cd packages/config && pnpm publish --tag <tag> --no-git-checks
cd packages/history && pnpm publish --tag <tag> --no-git-checks
cd packages/core && pnpm publish --tag <tag> --no-git-checks
cd packages/cli && pnpm publish --tag <tag> --no-git-checks
cd packages/vibe-validate && pnpm publish --tag <tag> --no-git-checks
```

Use matching `--tag` (rc/beta/alpha/latest) for all packages.

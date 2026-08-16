/**
 * Git environment hazard knowledge — which `GIT_*` variables redirect a child
 * `git` away from the repository it was handed, and how to remove them.
 *
 * This lives in `@vibe-validate/git` rather than in `core` or `utils` because it
 * is git-specific knowledge, not generic process plumbing: knowing that
 * `GIT_PREFIX` re-scopes a pathspec, that `GIT_SHALLOW_FILE` alters the history
 * git believes exists, or that `GIT_CONFIG_PARAMETERS` is set by git while its
 * `GIT_CONFIG_*` siblings are set only by you, is exactly the sort of thing this
 * package exists to own. `@vibe-validate/core` depends on this
 * package and re-exports {@link stripGitEnv}, so existing callers are unchanged.
 *
 * @packageDocumentation
 */

/**
 * Blacklist of `GIT_*` env vars that are DANGEROUS to inherit into a child
 * process because they can redirect git operations to a different repository,
 * override repository discovery, alter loaded config, or change the history
 * view git sees.
 *
 * Everything else (identity, editor, SSH/credentials, tracing, pager,
 * cosmetic) is safe to inherit — none of those can redirect operations to a
 * different repo, and stripping them would break legitimate configuration.
 *
 * **Why a blacklist and not a whitelist:** an unknown `GIT_*` var is far more
 * likely to be a user's tracing or credential setting than a new redirection
 * primitive, and silently dropping the former breaks real setups.
 *
 * **The membership rule, which is what keeps this from being a list of
 * accidents:** a variable belongs here when **git sets it for you**. Those cost
 * nothing to remove, because nobody chose them — git exports `GIT_DIR`,
 * `GIT_INDEX_FILE`, `GIT_PREFIX`, `GIT_AUTHOR_*` and `GIT_CONFIG_PARAMETERS`
 * into every hook and every hook's children. A variable an *operator* exported
 * does not belong here, however capable of redirection it looks: removing it
 * overrides a deliberate instruction, and does so silently.
 *
 * That rule is also the answer to "how do we know this list is complete?" — it
 * is not a judgement about which variables are dangerous, which can only ever
 * be patched reactively, but an empirical question with a repeatable
 * experiment: install a hook, dump `env | grep '^GIT_'`, and compare. Re-run it
 * against new git releases; `packages/git/test/git-env.test.ts` records the
 * answer for git 2.50.1.
 */
const DANGEROUS_GIT_ENV_KEYS: ReadonlySet<string> = new Set([
  // Repository / index / worktree redirection
  'GIT_DIR',
  'GIT_INDEX_FILE',
  'GIT_WORK_TREE',
  'GIT_COMMON_DIR',
  'GIT_OBJECT_DIRECTORY',
  'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  // Ref namespace redirection
  'GIT_NAMESPACE',
  // Repository discovery behavior
  'GIT_CEILING_DIRECTORIES',
  'GIT_DISCOVERY_ACROSS_FILESYSTEM',
  // The `-c key=value` flags of the CURRENT git invocation, which git exports to
  // every child. This is the one config-redirection variable git sets by itself
  // rather than a user having to: a pre-commit hook is launched with the outer
  // `git commit`'s `-c` flags already in the environment. Left in place, an
  // injected `core.excludesFile` silently changes which paths a child's
  // `ls-files --exclude-standard` reports — a different population, reported as
  // the whole one.
  //
  // Its siblings — GIT_CONFIG, GIT_CONFIG_GLOBAL, GIT_CONFIG_SYSTEM,
  // GIT_CONFIG_NOSYSTEM, GIT_CONFIG_COUNT and the numbered KEY_/VALUE_ groups —
  // are deliberately absent. Measured on git 2.50.1 against real pre-commit
  // hooks, in a plain repository and a linked worktree, with and without `-c`
  // flags: git never sets any of them, and never folds `-c` into the numbered
  // channel. They appear only because an operator exported them, and they are
  // git's documented env-only configuration channel (git >= 2.31) — how CI
  // points github.com at an internal mirror, or supplies credentials without
  // writing a file. Stripping them defends against nothing git does, and makes
  // this the one tool on the machine that ignores the operator's git
  // configuration. Measured casualty: a clone that should have reached a
  // mirror went to the network instead, silently.
  'GIT_CONFIG_PARAMETERS',
  // Would steer vv's own notes-based cache to a different ref
  'GIT_NOTES_REF',
  // Alter history view
  'GIT_SHALLOW_FILE',
  'GIT_GRAFT_FILE',
  // Hook-set: the subdirectory `git commit` was invoked from. Git prepends it
  // when interpreting a pathspec, so an inherited value silently re-scopes
  // `git add --all` / `git ls-files` in a child that runs at the repo root.
  'GIT_PREFIX',
  // Forces the on-disk format of any index git writes. Harmless to read, but a
  // child that writes a throwaway index should use the repository's own
  // default rather than whatever the outer process was configured with.
  'GIT_INDEX_VERSION',
]);

/**
 * Whether one env var name can redirect or reconfigure a child `git`.
 *
 * @param key - Environment variable name
 * @returns true if the variable must not be inherited by a git child
 */
function isDangerousGitEnvKey(key: string): boolean {
  return DANGEROUS_GIT_ENV_KEYS.has(key);
}

/**
 * Strip dangerous `GIT_*` environment variables from an env object.
 *
 * When vv runs as a git pre-commit hook, git sets `GIT_DIR`, `GIT_INDEX_FILE`,
 * `GIT_WORK_TREE`, `GIT_PREFIX` and related vars on the hook process. Those vars
 * override `cwd` for any `git` command in a child process — so a step that
 * creates a temp repo via `mkdtempSync` and runs `git init` / `git commit`
 * against it can silently operate on the parent repository instead. The failure
 * is not an error: git answers confidently about the wrong repository.
 *
 * Under `git worktree` the two disagree *by construction* — `GIT_DIR` names the
 * outer worktree's `.git/worktrees/<name>` while the path under measurement is a
 * different checkout entirely — so this is not a rare edge case for anyone who
 * develops in worktrees.
 *
 * Uses the focused blacklist above: only the `GIT_*` vars that can redirect git
 * operations, override repository discovery, load alternate config, or alter the
 * history view are stripped. Everything else (identity, editor, SSH/credentials,
 * tracing, pager) is inherited normally.
 *
 * Removal is by *omission* — the returned object simply lacks the key. Callers
 * that spread this over `process.env` would silently re-inject the variables;
 * pass the result as the spawn `env` directly, or use
 * {@link "./git-executor".GitExecutionOptions.scrubGitEnv}.
 *
 * Does not mutate the input. Drops entries whose value is undefined so the
 * return type is `Record<string, string>` (suitable for use as spawn `env`).
 *
 * @param env - Environment to filter, usually `process.env`
 * @returns A new environment with every redirection variable absent
 * @public
 */
export function stripGitEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) continue;
    if (isDangerousGitEnvKey(key)) continue;
    result[key] = value;
  }
  return result;
}

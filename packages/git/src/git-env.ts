/**
 * Git environment hazard knowledge — which `GIT_*` variables redirect a child
 * `git` away from the repository it was handed, and how to remove them.
 *
 * This lives in `@vibe-validate/git` rather than in `core` or `utils` because it
 * is git-specific knowledge, not generic process plumbing: knowing that
 * `GIT_CONFIG_COUNT` implies numbered `GIT_CONFIG_KEY_*` reads, or that
 * `GIT_SHALLOW_FILE` alters the history git believes exists, is exactly the sort
 * of thing this package exists to own. `@vibe-validate/core` depends on this
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
  // Alternate config loading (can change defaults, point at other repos)
  'GIT_CONFIG',
  'GIT_CONFIG_GLOBAL',
  'GIT_CONFIG_SYSTEM',
  'GIT_CONFIG_NOSYSTEM',
  'GIT_CONFIG_COUNT',
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
 * Prefixes for groups of dangerous `GIT_*` vars (e.g. `GIT_CONFIG_KEY_0`,
 * `GIT_CONFIG_VALUE_0`, … which are read when `GIT_CONFIG_COUNT` is set).
 */
const DANGEROUS_GIT_ENV_PREFIXES: readonly string[] = [
  'GIT_CONFIG_KEY_',
  'GIT_CONFIG_VALUE_',
];

/**
 * Whether one env var name can redirect or reconfigure a child `git`.
 *
 * @param key - Environment variable name
 * @returns true if the variable must not be inherited by a git child
 */
function isDangerousGitEnvKey(key: string): boolean {
  if (DANGEROUS_GIT_ENV_KEYS.has(key)) return true;
  return DANGEROUS_GIT_ENV_PREFIXES.some(prefix => key.startsWith(prefix));
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

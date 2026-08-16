/**
 * Tests for the dangerous-GIT_*-variable blacklist.
 *
 * Moved here from `@vibe-validate/core` alongside the implementation: the
 * knowledge of which variables redirect a child `git` is git-specific, not
 * process-plumbing. `core` re-exports `stripGitEnv`, and its own tests still
 * cover the scrub as applied by `spawnCommand`.
 */

import { describe, it, expect } from 'vitest';

import { stripGitEnv } from '../src/git-env.js';

describe('stripGitEnv', () => {
  it('strips repository/index/worktree redirection vars', () => {
    const result = stripGitEnv({
      GIT_DIR: '/some/.git',
      GIT_INDEX_FILE: '/some/idx',
      GIT_WORK_TREE: '/some/wt',
      GIT_COMMON_DIR: '/some/common',
      GIT_OBJECT_DIRECTORY: '/some/objects',
      GIT_ALTERNATE_OBJECT_DIRECTORIES: '/some/alt',
      PATH: '/usr/bin',
    });
    expect(result.GIT_DIR).toBeUndefined();
    expect(result.GIT_INDEX_FILE).toBeUndefined();
    expect(result.GIT_WORK_TREE).toBeUndefined();
    expect(result.GIT_COMMON_DIR).toBeUndefined();
    expect(result.GIT_OBJECT_DIRECTORY).toBeUndefined();
    expect(result.GIT_ALTERNATE_OBJECT_DIRECTORIES).toBeUndefined();
    expect(result.PATH).toBe('/usr/bin');
  });

  it('strips ref-namespace and discovery vars', () => {
    const result = stripGitEnv({
      GIT_NAMESPACE: 'private',
      GIT_CEILING_DIRECTORIES: '/home',
      GIT_DISCOVERY_ACROSS_FILESYSTEM: '1',
      PATH: '/usr/bin',
    });
    expect(result.GIT_NAMESPACE).toBeUndefined();
    expect(result.GIT_CEILING_DIRECTORIES).toBeUndefined();
    expect(result.GIT_DISCOVERY_ACROSS_FILESYSTEM).toBeUndefined();
    expect(result.PATH).toBe('/usr/bin');
  });

  it('strips the hook-set pathspec prefix and the index format override', () => {
    // GIT_PREFIX is exported into every hook and names the subdirectory the
    // outer `git` was invoked from; git prepends it when interpreting a
    // pathspec, so an inherited value silently re-scopes `add --all` /
    // `ls-files` in a child that deliberately runs at the repository root.
    //
    // GIT_INDEX_VERSION forces the on-disk format of any index git writes,
    // which a child building a throwaway index should not inherit.
    const result = stripGitEnv({
      GIT_PREFIX: 'packages/git/',
      GIT_INDEX_VERSION: '4',
      PATH: '/usr/bin',
    });
    expect(result.GIT_PREFIX).toBeUndefined();
    expect(result.GIT_INDEX_VERSION).toBeUndefined();
    expect(result.PATH).toBe('/usr/bin');
  });

  it('strips alternate-config vars including numbered GIT_CONFIG_KEY_/VALUE_ groups', () => {
    const result = stripGitEnv({
      GIT_CONFIG: '/custom/.gitconfig',
      GIT_CONFIG_GLOBAL: '/empty',
      GIT_CONFIG_SYSTEM: '/empty',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_COUNT: '2',
      // Git sets this one ITSELF on every hook — it carries the outer
      // invocation's `-c` flags — so unlike its siblings it is present in
      // practice rather than only when a user opts in. Measured: injecting
      // `core.excludesFile` through it changes which paths
      // `ls-files --others --exclude-standard` reports.
      GIT_CONFIG_PARAMETERS: "'core.excludesFile'='/tmp/evil'",
      GIT_CONFIG_KEY_0: 'user.email',
      GIT_CONFIG_VALUE_0: 'evil@example.com',
      GIT_CONFIG_KEY_1: 'core.autocrlf',
      GIT_CONFIG_VALUE_1: 'true',
      PATH: '/usr/bin',
    });
    expect(result.GIT_CONFIG).toBeUndefined();
    expect(result.GIT_CONFIG_GLOBAL).toBeUndefined();
    expect(result.GIT_CONFIG_SYSTEM).toBeUndefined();
    expect(result.GIT_CONFIG_NOSYSTEM).toBeUndefined();
    expect(result.GIT_CONFIG_COUNT).toBeUndefined();
    expect(result.GIT_CONFIG_PARAMETERS).toBeUndefined();
    expect(result.GIT_CONFIG_KEY_0).toBeUndefined();
    expect(result.GIT_CONFIG_VALUE_0).toBeUndefined();
    expect(result.GIT_CONFIG_KEY_1).toBeUndefined();
    expect(result.GIT_CONFIG_VALUE_1).toBeUndefined();
    expect(result.PATH).toBe('/usr/bin');
  });

  it('strips notes-redirect and history-altering vars', () => {
    const result = stripGitEnv({
      GIT_NOTES_REF: 'refs/notes/other',
      GIT_SHALLOW_FILE: '/some/shallow',
      GIT_GRAFT_FILE: '/some/grafts',
    });
    expect(result.GIT_NOTES_REF).toBeUndefined();
    expect(result.GIT_SHALLOW_FILE).toBeUndefined();
    expect(result.GIT_GRAFT_FILE).toBeUndefined();
  });

  it('preserves identity, editor, SSH, credential, tracing, and cosmetic GIT_* vars', () => {
    const result = stripGitEnv({
      // identity
      GIT_AUTHOR_NAME: 'Test User',
      GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_AUTHOR_DATE: '2026-05-12T00:00:00Z',
      GIT_COMMITTER_NAME: 'Test User',
      GIT_COMMITTER_EMAIL: 'test@example.com',
      GIT_COMMITTER_DATE: '2026-05-12T00:00:00Z',
      // editor / UI
      GIT_EDITOR: 'vim',
      GIT_SEQUENCE_EDITOR: 'vim',
      GIT_PAGER: 'less',
      // SSH / network / credentials
      GIT_SSH: '/usr/bin/ssh',
      GIT_SSH_COMMAND: 'ssh -i /run/secrets/key',
      GIT_SSH_VARIANT: 'openssh',
      GIT_ASKPASS: '/usr/local/bin/askpass',
      GIT_TERMINAL_PROMPT: '0',
      GIT_HTTP_USER_AGENT: 'vv-test',
      // tracing
      GIT_TRACE: '1',
      GIT_TRACE_PERFORMANCE: '1',
      GIT_TRACE2: '1',
      GIT_CURL_VERBOSE: '1',
      // sanity: dangerous one is still stripped
      GIT_DIR: '/dangerous/.git',
    });
    expect(result.GIT_AUTHOR_NAME).toBe('Test User');
    expect(result.GIT_AUTHOR_EMAIL).toBe('test@example.com');
    expect(result.GIT_AUTHOR_DATE).toBe('2026-05-12T00:00:00Z');
    expect(result.GIT_COMMITTER_NAME).toBe('Test User');
    expect(result.GIT_COMMITTER_EMAIL).toBe('test@example.com');
    expect(result.GIT_COMMITTER_DATE).toBe('2026-05-12T00:00:00Z');
    expect(result.GIT_EDITOR).toBe('vim');
    expect(result.GIT_SEQUENCE_EDITOR).toBe('vim');
    expect(result.GIT_PAGER).toBe('less');
    expect(result.GIT_SSH).toBe('/usr/bin/ssh');
    expect(result.GIT_SSH_COMMAND).toBe('ssh -i /run/secrets/key');
    expect(result.GIT_SSH_VARIANT).toBe('openssh');
    expect(result.GIT_ASKPASS).toBe('/usr/local/bin/askpass');
    expect(result.GIT_TERMINAL_PROMPT).toBe('0');
    expect(result.GIT_HTTP_USER_AGENT).toBe('vv-test');
    expect(result.GIT_TRACE).toBe('1');
    expect(result.GIT_TRACE_PERFORMANCE).toBe('1');
    expect(result.GIT_TRACE2).toBe('1');
    expect(result.GIT_CURL_VERBOSE).toBe('1');
    expect(result.GIT_DIR).toBeUndefined();
  });

  it('returns an empty object when given an empty env', () => {
    expect(stripGitEnv({})).toEqual({});
  });

  it('preserves vars whose name contains GIT but does not start with GIT_', () => {
    const result = stripGitEnv({
      MYGIT_TOKEN: 'abc',
      LEGIT_VAR: 'xyz',
      GITHUB_TOKEN: 'gh',
    });
    expect(result.MYGIT_TOKEN).toBe('abc');
    expect(result.LEGIT_VAR).toBe('xyz');
    expect(result.GITHUB_TOKEN).toBe('gh');
  });

  it('does not mutate the input env', () => {
    const input = { GIT_DIR: '/x', PATH: '/usr/bin' };
    stripGitEnv(input);
    expect(input.GIT_DIR).toBe('/x');
  });

  it('drops keys whose value is undefined (NodeJS.ProcessEnv-compatible)', () => {
    const input: NodeJS.ProcessEnv = { GIT_DIR: '/x', PATH: '/usr/bin', UNDEF: undefined };
    const result = stripGitEnv(input);
    expect(result.PATH).toBe('/usr/bin');
    expect('UNDEF' in result).toBe(false);
  });
});

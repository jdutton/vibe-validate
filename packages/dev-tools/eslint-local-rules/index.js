/**
 * Custom ESLint rules for vibe-validate
 *
 * Windows Compatibility Rules:
 * - no-os-tmpdir: Enforce normalizedTmpdir() instead of os.tmpdir()
 * - no-fs-mkdirSync: Enforce mkdirSyncReal() instead of fs.mkdirSync()
 * - no-fs-realpathSync: Enforce normalizePath() instead of fs.realpathSync()
 * - no-path-resolve-dirname: Enforce normalizePath() instead of path.resolve(__dirname) in tests
 * - no-unix-shell-commands: Prevent Unix-specific commands (tar, ls, grep, etc.) that break Windows compatibility
 * - no-manual-path-normalize: Enforce toForwardSlash() instead of manual .split(path.sep).join('/') patterns (auto-fixable)
 * - no-path-sep-in-strings: Prevent path.sep in string operations (split, includes, etc.)
 * - no-path-operations-in-comparisons: Require normalizing path operations before string comparisons
 * - no-hardcoded-path-split: Prevent .split('/') or .split('\\') on paths without normalization
 *
 * Security and Architecture Rules:
 * - no-child-process-execSync: Enforce safeExecSync() instead of execSync() (security + cross-platform)
 * - no-git-commands-direct: Enforce @vibe-validate/git functions instead of direct git commands
 * - no-gh-commands-direct: Enforce @vibe-validate/git functions instead of direct gh commands
 * - no-npm-pnpm-direct: Enforce @vibe-validate/utils package manager functions instead of direct npm/pnpm commands
 * - no-direct-cli-bin-execution: Enforce shared CLI execution helpers instead of direct node + bin.js
 */

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

export default {
  rules: {
    // Windows compatibility rules
    'no-os-tmpdir': require('./no-os-tmpdir.cjs'),
    'no-fs-mkdirSync': require('./no-fs-mkdirSync.cjs'),
    'no-fs-realpathSync': require('./no-fs-realpathSync.cjs'),
    'no-path-resolve-dirname': require('./no-path-resolve-dirname.cjs'),
    'no-unix-shell-commands': require('./no-unix-shell-commands.cjs'),
    'no-manual-path-normalize': require('./no-manual-path-normalize.cjs'),
    'no-path-sep-in-strings': require('./no-path-sep-in-strings.cjs'),
    'no-path-operations-in-comparisons': require('./no-path-operations-in-comparisons.cjs'),
    'no-path-startswith': require('./no-path-startswith.cjs'),
    'no-hardcoded-path-split': require('./no-hardcoded-path-split.cjs'),

    // Security and architecture rules
    'no-child-process-execSync': require('./no-child-process-execSync.cjs'),
    'no-git-commands-direct': require('./no-git-commands-direct.cjs'),
    'no-gh-commands-direct': require('./no-gh-commands-direct.cjs'),
    'no-npm-pnpm-direct': require('./no-npm-pnpm-direct.cjs'),
    'no-direct-cli-bin-execution': require('./no-direct-cli-bin-execution.cjs'),
  },
};

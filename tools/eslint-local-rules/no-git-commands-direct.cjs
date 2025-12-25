/**
 * ESLint rule: no-git-commands-direct
 *
 * Prevents direct execution of git commands via safeExecSync/safeExecResult/spawn/spawnSync/execSync.
 * Enforces using centralized functions from @vibe-validate/git instead.
 *
 * Why:
 * - Architectural consistency (all git commands in one place)
 * - Easy mocking in tests (mock @vibe-validate/git instead of utils)
 * - Better error handling and validation
 *
 * Exemptions:
 * - @vibe-validate/git package itself (where centralization happens)
 * - Test files for environment bootstrap (git init, git config)
 *
 * NO AUTO-FIX: Manual refactoring required to use appropriate @vibe-validate/git function.
 */

const factory = require('./no-command-direct-factory.cjs');

module.exports = factory({
  command: 'git',
  packageName: '@vibe-validate/git',
  availableFunctions: [
    'executeGitCommand()',
    'getTreeHash()',
    'addNote()',
    'listNotesRefs()',
    'getCurrentBranch()',
    'getDiffStats()',
  ],
  exemptPackage: 'packages/git/',
});

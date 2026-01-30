/**
 * ESLint rule: no-gh-commands-direct
 *
 * Prevents direct execution of gh (GitHub CLI) commands via safeExecSync/safeExecResult/spawn/spawnSync/execSync.
 * Enforces using centralized functions from @vibe-validate/git instead.
 *
 * Why:
 * - Architectural consistency (all gh commands in one place)
 * - Easy mocking in tests (mock @vibe-validate/git instead of utils)
 * - Better error handling and validation
 *
 * Exemptions:
 * - @vibe-validate/git package itself (where centralization happens)
 *
 * NO AUTO-FIX: Manual refactoring required to use appropriate @vibe-validate/git function.
 */

const factory = require('./no-command-direct-factory.cjs');

module.exports = factory({
  command: 'gh',
  packageName: '@vibe-validate/git',
  availableFunctions: [
    'fetchPRDetails()',
    'listPullRequests()',
    'fetchRunDetails()',
    'listWorkflowRuns()',
  ],
  exemptPackage: 'packages/git/',
});

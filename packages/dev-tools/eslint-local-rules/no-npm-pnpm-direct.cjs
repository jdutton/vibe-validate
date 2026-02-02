/**
 * ESLint rule: no-npm-pnpm-direct
 *
 * Prevents direct execution of npm/pnpm commands via safeExecSync/safeExecResult/spawn/spawnSync/execSync.
 * Enforces using centralized functions from @vibe-validate/utils instead.
 *
 * Why:
 * - Architectural consistency (all npm/pnpm commands in one place)
 * - Easy mocking in tests (mock @vibe-validate/utils instead of individual commands)
 * - Better error handling and validation
 *
 * Exemptions:
 * - @vibe-validate/utils package itself (where centralization happens)
 * - Test helpers that wrap commands
 *
 * NO AUTO-FIX: Manual refactoring required to use appropriate @vibe-validate/utils function.
 */

const factory = require('./no-command-direct-factory.cjs');

module.exports = factory({
  command: 'npm',
  packageName: '@vibe-validate/utils',
  availableFunctions: [
    'getPackageVersion()',
    'getLatestVersion()',
    'packageExists()',
    'publishPackage()',
    'addDistTag()',
    'unpublishPackage()',
    'deprecatePackage()',
    'installPackage()',
  ],
  exemptPackage: 'packages/utils/src/package-manager.ts|packages/cli/test/helpers/test-command-runner.ts',
});

// Create pnpm rule separately since factory expects single command
const pnpmRule = factory({
  command: 'pnpm',
  packageName: '@vibe-validate/utils',
  availableFunctions: [
    'executePnpmCommand()',
    'publishPackage()',
  ],
  exemptPackage: 'packages/utils/src/package-manager.ts|packages/cli/test/helpers/test-command-runner.ts',
});

// Export combined rule that checks both npm and pnpm
module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Enforce use of @vibe-validate/utils package manager functions instead of direct npm/pnpm execution',
      category: 'Architecture',
      recommended: true,
    },
    fixable: null,
    schema: [],
    messages: {
      noNpmDirect: 'Use functions from @vibe-validate/utils instead of calling npm commands directly. Available functions: getPackageVersion(), getLatestVersion(), packageExists(), publishPackage(), addDistTag(), unpublishPackage(), deprecatePackage(), installPackage().',
      noPnpmDirect: 'Use functions from @vibe-validate/utils instead of calling pnpm commands directly. Available functions: executePnpmCommand(), publishPackage().',
    },
  },

  create(context) {
    const filename = context.getFilename();

    // Exempt the package manager module itself and test helpers
    const normalizedFilename = filename.replaceAll('\\', '/');
    const exemptPatterns = ['packages/utils/src/package-manager.ts', 'packages/cli/test/helpers/test-command-runner.ts'];
    if (exemptPatterns.some(pattern => normalizedFilename.includes(pattern))) {
      return {};
    }

    // Use both npm and pnpm rule implementations
    const npmChecker = module.exports.create ? undefined : factory({
      command: 'npm',
      packageName: '@vibe-validate/utils',
      availableFunctions: ['getPackageVersion()', 'getLatestVersion()', 'packageExists()', 'publishPackage()', 'addDistTag()', 'unpublishPackage()', 'deprecatePackage()', 'installPackage()'],
      exemptPackage: 'packages/utils/src/package-manager.ts|packages/cli/test/helpers/test-command-runner.ts',
    }).create(context);

    const pnpmChecker = pnpmRule.create(context);

    return {
      CallExpression(node) {
        // Check both npm and pnpm
        if (npmChecker?.CallExpression) {
          npmChecker.CallExpression(node);
        }
        if (pnpmChecker?.CallExpression) {
          pnpmChecker.CallExpression(node);
        }
      },
    };
  },
};

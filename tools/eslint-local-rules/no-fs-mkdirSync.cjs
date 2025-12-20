/**
 * ESLint rule: no-fs-mkdirSync
 *
 * Prevents usage of fs.mkdirSync() in favor of mkdirSyncReal() from @vibe-validate/utils
 *
 * Why: After mkdirSync(), the path might not match what filesystem uses on Windows.
 * Short path input creates long path output, causing subsequent existsSync() checks to fail.
 *
 * Auto-fix: Replaces fs.mkdirSync() with mkdirSyncReal() and adds required import.
 */

const factory = require('./eslint-rule-factory.cjs');

module.exports = factory({
  unsafeFn: 'mkdirSync',
  unsafeModule: 'node:fs',
  safeFn: 'mkdirSyncReal',
  safeModule: '@vibe-validate/utils',
  message: 'Use mkdirSyncReal() from @vibe-validate/utils instead of fs.mkdirSync() for Windows path normalization',
  exemptFile: 'path-helpers.ts', // Implementation file
});

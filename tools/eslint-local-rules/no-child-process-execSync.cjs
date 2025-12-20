/**
 * ESLint rule: no-child-process-execSync
 *
 * Prevents usage of child_process.execSync() in favor of safeExecSync() from @vibe-validate/utils
 *
 * Why: execSync() uses shell interpreter which enables command injection attacks.
 * safeExecSync() uses direct spawn (no shell) and validates commands via 'which'.
 *
 * Auto-fix: Replaces execSync() with safeExecSync() and adds required import.
 */

const factory = require('./eslint-rule-factory.cjs');

module.exports = factory({
  unsafeFn: 'execSync',
  unsafeModule: 'node:child_process',
  safeFn: 'safeExecSync',
  safeModule: '@vibe-validate/utils',
  message: 'Use safeExecSync() from @vibe-validate/utils instead of child_process.execSync() to prevent command injection (security + cross-platform)',
  exemptFile: 'safe-exec.ts', // Implementation file
});

/**
 * Custom ESLint rules for vibe-validate
 *
 * Windows Compatibility Rules:
 * - no-os-tmpdir: Enforce normalizedTmpdir() instead of os.tmpdir()
 * - no-fs-mkdirSync: Enforce mkdirSyncReal() instead of fs.mkdirSync()
 *
 * Security and Architecture Rules:
 * - no-child-process-execSync: Enforce safeExecSync() instead of execSync() (security + cross-platform)
 * - no-git-commands-direct: Enforce @vibe-validate/git functions instead of direct git commands
 * - no-gh-commands-direct: Enforce @vibe-validate/git functions instead of direct gh commands
 */

import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

export default {
  rules: {
    // Windows compatibility rules
    'no-os-tmpdir': require('./no-os-tmpdir.cjs'),
    'no-fs-mkdirSync': require('./no-fs-mkdirSync.cjs'),

    // Security and architecture rules
    'no-child-process-execSync': require('./no-child-process-execSync.cjs'),
    'no-git-commands-direct': require('./no-git-commands-direct.cjs'),
    'no-gh-commands-direct': require('./no-gh-commands-direct.cjs'),
  },
};

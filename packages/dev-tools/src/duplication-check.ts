#!/usr/bin/env tsx
/**
 * duplication-check.js
 *
 * Wrapper script that runs jscpd-check-new.js on supported platforms.
 * SKIPS on Windows due to known jscpd path issues.
 *
 * Windows Support:
 * ================
 * jscpd has a known issue on Windows where output files are not generated
 * due to a path handling bug in @jscpd/finder package.
 *
 * References:
 * - https://github.com/kucherenko/jscpd/issues/143
 * - https://github.com/kucherenko/jscpd/issues/488
 * - https://github.com/kucherenko/jscpd/issues/165
 *
 * If you're a Windows user and want to help fix this:
 * 1. The workaround involves patching @jscpd/finder/dist/files.js
 * 2. Change: const currentPath = fs_extra_1.realpathSync(path)
 *    To:     const currentPath = path;
 * 3. Test with: pnpm duplication-check
 * 4. If it works, please open a PR with a patch-package fix!
 */

if (process.platform === 'win32') {
  console.log('⏭️  Skipping code duplication check on Windows');
  console.log('   Known issue: jscpd does not generate output files on Windows');
  console.log('   See: https://github.com/kucherenko/jscpd/issues/143');
  console.log('   Windows contributors: Help wanted to fix this!');
  process.exit(0);
}

// Run the actual duplication check on supported platforms
await import('./jscpd-check-new.js');

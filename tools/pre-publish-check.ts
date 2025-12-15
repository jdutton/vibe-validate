#!/usr/bin/env tsx
/**
 * Pre-Publish Validation Check
 *
 * This script ensures the repository is in a publishable state:
 * 1. No uncommitted changes (clean working tree)
 * 2. No untracked files (except allowed patterns)
 * 3. All validation checks pass
 * 4. On main branch (or explicitly allow other branches)
 *
 * Usage:
 *   node tools/pre-publish-check.js [--allow-branch BRANCH]
 *   pnpm pre-publish [--allow-branch BRANCH]
 *
 * Exit codes:
 *   0 - Ready to publish
 *   1 - Not ready (with explanation)
 */

import { readdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { safeExecSync } from '../packages/utils/dist/safe-exec.js';

import { PROJECT_ROOT, log } from './common.js';

/**
 * Detect if running in CI environment
 */
function isCI(): boolean {
  return !!(
    process.env.CI ||
    process.env.GITHUB_ACTIONS ||
    process.env.GITLAB_CI ||
    process.env.CIRCLECI ||
    process.env.TRAVIS ||
    process.env.JENKINS_URL
  );
}

const IS_CI = isCI();

// Parse command-line arguments
const args = process.argv.slice(2);
let allowedBranch = 'main';
let allowCustomBranch = false;

// Use while loop with explicit index control to handle argument consumption
let i = 0;
while (i < args.length) {
  if (args[i] === '--allow-branch' && args[i + 1]) {
    allowedBranch = args[i + 1];
    allowCustomBranch = true;
    i += 2; // Consume both --allow-branch and its value
  } else if (args[i] === '--help' || args[i] === '-h') {
    console.log(`
Pre-Publish Validation Check

Usage:
  node tools/pre-publish-check.js [--allow-branch BRANCH]
  pnpm pre-publish [--allow-branch BRANCH]

Options:
  --allow-branch BRANCH  Allow publishing from a specific branch (default: main)
  --help, -h            Show this help message

Exit codes:
  0 - Ready to publish
  1 - Not ready (with explanation)
    `);
    process.exit(0);
  } else {
    console.error(`Unknown option: ${args[i]}`);
    console.error('Usage: node tools/pre-publish-check.js [--allow-branch BRANCH]');
    process.exit(1);
  }
  i++;
}

console.log(IS_CI ? '🔍 Pre-Publish Validation Check (CI Mode)' : '🔍 Pre-Publish Validation Check');
console.log('==========================================');
console.log('');

// Check 1: Git repository exists
try {
  safeExecSync('git', ['rev-parse', '--git-dir'], { stdio: 'pipe', cwd: PROJECT_ROOT });
  log('✓ Git repository detected', 'green');
} catch (error) {
  // Expected failure: not a git repository (fatal, cannot proceed)
  log('✗ Not a git repository', 'red');
  if (error instanceof Error && error.message.includes('ENOENT')) {
    console.log('  Git executable not found. Please install git.');
  }
  process.exit(1);
}

// Check 2: Current branch (skip in CI - uses detached HEAD on tag checkout)
if (IS_CI) {
  log('⊘ Branch check skipped (CI mode)', 'yellow');
} else {
  let currentBranch;
  try {
    currentBranch = safeExecSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      encoding: 'utf8',
      stdio: 'pipe',
      cwd: PROJECT_ROOT,
    }).trim();
  } catch (error) {
    // Expected failure: detached HEAD or git error (fatal, cannot proceed)
    log('✗ Failed to determine current branch', 'red');
    if (error instanceof Error && error.message.includes('HEAD')) {
      console.log('  You may be in a detached HEAD state. Check git status.');
    }
    process.exit(1);
  }

  if (currentBranch !== allowedBranch) {
    log(`✗ Not on ${allowedBranch} branch (current: ${currentBranch})`, 'red');
    console.log(`  Tip: Run 'git checkout ${allowedBranch}' or use --allow-branch flag`);
    process.exit(1);
  }

  if (allowCustomBranch && currentBranch !== 'main') {
    log(`⚠ On branch: ${currentBranch} (explicitly allowed)`, 'yellow');
  } else {
    log('✓ On main branch', 'green');
  }
}

// Check 3: Working tree is clean (skip in CI - always starts with clean checkout)
if (IS_CI) {
  log('⊘ Uncommitted changes check skipped (CI mode)', 'yellow');
} else {
  let hasUncommittedChanges = false;
  try {
    safeExecSync('git', ['diff-index', '--quiet', 'HEAD', '--'], { stdio: 'pipe', cwd: PROJECT_ROOT });
  } catch (error) {
    // Expected failure: uncommitted changes detected (non-zero exit from diff-index)
    // This is normal operation - the command exits non-zero when changes exist
    hasUncommittedChanges = true;
    // Verify it's the expected failure (not a critical git error)
    if (error instanceof Error && error.message.includes('ENOENT')) {
      log('✗ Git executable error', 'red');
      console.error(error.message);
      process.exit(1);
    }
  }

  if (hasUncommittedChanges) {
    log('✗ Uncommitted changes detected', 'red');
    console.log('');

    try {
      const status = safeExecSync('git', ['status', '--short'], { encoding: 'utf8', cwd: PROJECT_ROOT });
      console.log(status);
    } catch (error) {
      // Non-critical: git status display failed, but we already know changes exist
      // Continue with generic error message below
      console.log('  (Unable to show git status details)');
      if (error instanceof Error && error.message) {
        console.error(`  Debug: ${error.message}`);
      }
    }

    console.log('  Please commit or stash your changes before publishing');
    process.exit(1);
  }
  log('✓ No uncommitted changes', 'green');
}

// Check 4: No untracked files (skip in CI - not applicable)
if (IS_CI) {
  log('⊘ Untracked files check skipped (CI mode)', 'yellow');
} else {
  let untracked = '';
  try {
    untracked = safeExecSync('git', ['ls-files', '--others', '--exclude-standard'], {
      encoding: 'utf8',
      stdio: 'pipe',
      cwd: PROJECT_ROOT,
    }).trim();
  } catch (error) {
    // Non-critical: untracked files check is optional (best-effort)
    // Continue with empty untracked list if git command fails
    if (error instanceof Error && error.message.includes('ENOENT')) {
      log('⚠ Warning: Could not check untracked files (git not available)', 'yellow');
    }
    // Continue with empty untracked string (no files to check)
  }

  if (untracked) {
    // Filter out allowed patterns
    const allowedPatterns = [
      /node_modules/,
      /dist/,
      /\.DS_Store/,
      /TODO\.md/,
    ];

    const untrackedLines = untracked.split('\n').filter(line => line.trim());
    const filteredUntracked = untrackedLines.filter(line => {
      return !allowedPatterns.some(pattern => pattern.test(line));
    });

    if (filteredUntracked.length > 0) {
      log('✗ Untracked files detected', 'red');
      console.log('');
      for (const file of filteredUntracked) console.log(file);
      console.log('');
      console.log('  Please add these files to git or .gitignore before publishing');
      process.exit(1);
    }
  }
  log('✓ No untracked files', 'green');
}

// Check 5: Run validation
console.log('');
console.log('Running validation checks...');

try {
  safeExecSync('pnpm', ['validate'], { stdio: 'inherit', cwd: PROJECT_ROOT });
  log('✓ All validation checks passed', 'green');
} catch (error) {
  // Expected failure: validation checks failed (fatal, cannot proceed)
  console.log('');
  log('✗ Validation failed', 'red');
  console.log('  Check the output above and fix all issues before publishing');
  if (error instanceof Error && error.message.includes('ENOENT')) {
    console.log('  (pnpm not found - install pnpm to run validation)');
  }
  process.exit(1);
}

// Check 6: Packages are built
console.log('');
console.log('Checking package builds...');

const packagesDir = join(PROJECT_ROOT, 'packages');
const missingBuilds = [];

try {
  const packages = readdirSync(packagesDir, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name);

  for (const pkg of packages) {
    // Check if package is private (skip build check for private packages)
    const pkgJsonPath = join(packagesDir, pkg, 'package.json');
    if (existsSync(pkgJsonPath)) {
      const pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));

      // Skip private packages (like test beds)
      if (pkgJson.private) {
        continue;
      }

      // Skip umbrella package (vibe-validate) - it's just a wrapper with bin scripts
      if (pkg === 'vibe-validate') {
        continue;
      }
    }

    const distDir = join(packagesDir, pkg, 'dist');
    if (!existsSync(distDir)) {
      missingBuilds.push(`packages/${pkg}/`);
    }
  }
} catch (err) {
  log('✗ Failed to check package builds', 'red');
  console.error(err.message);
  process.exit(1);
}

if (missingBuilds.length > 0) {
  log('✗ Missing build outputs', 'red');
  for (const pkg of missingBuilds) console.log(pkg);
  console.log('  Run \'pnpm build\' to build all packages');
  process.exit(1);
}
log('✓ All packages built', 'green');

// Success!
console.log('');
log('✅ Repository is ready to publish!', 'green');
console.log('');
console.log('Next steps:');
console.log('  1. Update package versions: pnpm version:patch (or minor/major)');
console.log('  2. Commit version changes: git commit -am \'Release vX.Y.Z\'');
console.log('  3. Create git tag: git tag -a vX.Y.Z -m \'Release vX.Y.Z\'');
console.log('  4. Push to GitHub: git push origin main --tags');
console.log('  5. Publish to npm: pnpm publish:all');
console.log('');

process.exit(0);

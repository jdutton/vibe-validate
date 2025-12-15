#!/usr/bin/env tsx
/**
 * Pre-Publish Validation Check (CI Adapted)
 *
 * CI-adapted version of pre-publish-check.js for GitHub Actions environment.
 * Skips git-related checks that don't apply in CI (detached HEAD, clean checkout).
 *
 * This script ensures the repository is in a publishable state:
 * 1. All validation checks pass
 * 2. All packages are built
 *
 * Skipped checks (not applicable in CI):
 * - Git branch check (CI uses detached HEAD on tag)
 * - Uncommitted changes check (CI starts with clean checkout)
 * - Untracked files check (not applicable in CI)
 *
 * Usage:
 *   node tools/pre-publish-check-ci.js
 *   (typically called from GitHub Actions workflow)
 *
 * Exit codes:
 *   0 - Ready to publish
 *   1 - Not ready (with explanation)
 */

import { safeExecSync } from '../packages/utils/dist/safe-exec.js';
import { readdirSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..');

// Colors for output
const colors = {
  red: '\x1b[0;31m',
  green: '\x1b[0;32m',
  yellow: '\x1b[1;33m',
  blue: '\x1b[0;34m',
  reset: '\x1b[0m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

// Parse command-line arguments
const args = process.argv.slice(2);

if (args[0] === '--help' || args[0] === '-h') {
  console.log(`
Pre-Publish Validation Check (CI Adapted)

CI-adapted version for GitHub Actions environment.
Validates build outputs and runs validation checks.

Usage:
  node tools/pre-publish-check-ci.js

Exit codes:
  0 - Ready to publish
  1 - Not ready (with explanation)
  `);
  process.exit(0);
}

console.log('🔍 Pre-Publish Validation Check (CI Mode)');
console.log('==========================================');
console.log('');

// Check 1: Git repository exists (sanity check)
try {
  safeExecSync('git', ['rev-parse', '--git-dir'], { stdio: 'pipe', cwd: PROJECT_ROOT });
  log('✓ Git repository detected', 'green');
} catch (_error) { // NOSONAR - Exception handled by logging and exiting
  log('✗ Not a git repository', 'red');
  process.exit(1);
}

// Check 2: Run validation
console.log('');
console.log('Running validation checks...');

try {
  safeExecSync('pnpm', ['validate'], { stdio: 'inherit', cwd: PROJECT_ROOT });
  log('✓ All validation checks passed', 'green');
} catch (_error) { // NOSONAR - Exception handled by logging and exiting
  console.log('');
  log('✗ Validation failed', 'red');
  console.log('  Check the output above and fix all issues before publishing');
  process.exit(1);
}

// Check 3: Packages are built
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
  console.log('  Run \'pnpm -r build\' to build all packages');
  process.exit(1);
}
log('✓ All packages built', 'green');

// Success!
console.log('');
log('✅ CI validation passed - ready to publish!', 'green');
console.log('');

process.exit(0);

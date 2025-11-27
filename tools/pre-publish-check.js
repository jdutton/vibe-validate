#!/usr/bin/env node
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

import { execSync } from 'node:child_process';
import { readdirSync, existsSync, readFileSync } from 'node:fs';
import { join , dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..');

// Colors for output
const colors = {
  red: '\x1b[0;31m',
  green: '\x1b[0;32m',
  yellow: '\x1b[1;33m',
  reset: '\x1b[0m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

// Parse command-line arguments
const args = process.argv.slice(2);
let allowedBranch = 'main';
let allowCustomBranch = false;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--allow-branch' && args[i + 1]) {
    allowedBranch = args[i + 1];
    allowCustomBranch = true;
    i++; // NOSONAR - Intentionally skip next arg (consumed as --allow-branch value)
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
}

console.log('🔍 Pre-Publish Validation Check');
console.log('================================');
console.log('');

// Check 1: Git repository exists
try {
  execSync('git rev-parse --git-dir', { stdio: 'pipe', cwd: PROJECT_ROOT });
  log('✓ Git repository detected', 'green');
} catch (_error) { // NOSONAR - Exception handled by logging and exiting
  log('✗ Not a git repository', 'red');
  process.exit(1);
}

// Check 2: Current branch
let currentBranch;
try {
  currentBranch = execSync('git rev-parse --abbrev-ref HEAD', {
    encoding: 'utf8',
    stdio: 'pipe',
    cwd: PROJECT_ROOT,
  }).trim();
} catch (_error) { // NOSONAR - Exception handled by logging and exiting
  log('✗ Failed to determine current branch', 'red');
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

// Check 3: Working tree is clean
let hasUncommittedChanges = false;
try {
  execSync('git diff-index --quiet HEAD --', { stdio: 'pipe', cwd: PROJECT_ROOT });
} catch (_error) { // NOSONAR - Exception intentionally caught to set flag
  hasUncommittedChanges = true;
}

if (hasUncommittedChanges) {
  log('✗ Uncommitted changes detected', 'red');
  console.log('');

  try {
    const status = execSync('git status --short', { encoding: 'utf8', cwd: PROJECT_ROOT });
    console.log(status);
  } catch (_error) { // NOSONAR - Ignore if git status fails (non-critical)
    // Silently continue if git status fails
  }

  console.log('  Please commit or stash your changes before publishing');
  process.exit(1);
}
log('✓ No uncommitted changes', 'green');

// Check 4: No untracked files (except common patterns)
let untracked = '';
try {
  untracked = execSync('git ls-files --others --exclude-standard', {
    encoding: 'utf8',
    stdio: 'pipe',
    cwd: PROJECT_ROOT,
  }).trim();
} catch (_error) { // NOSONAR - Ignore errors (untracked files check is optional)
  // Silently continue if command fails
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

// Check 5: Run validation
console.log('');
console.log('Running validation checks...');

try {
  execSync('pnpm validate', { stdio: 'inherit', cwd: PROJECT_ROOT });
  log('✓ All validation checks passed', 'green');
} catch (_error) { // NOSONAR - Exception handled by logging and exiting
  console.log('');
  log('✗ Validation failed', 'red');
  console.log('  Check the output above and fix all issues before publishing');
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

#!/usr/bin/env node
/**
 * Version Bump Script
 *
 * Updates version in ALL package.json files (root + all workspace packages).
 * This ensures consistent versioning across the monorepo.
 *
 * Usage:
 *   node tools/bump-version.js <version>
 *   pnpm bump-version <version>
 *
 * Examples:
 *   node tools/bump-version.js 0.14.2
 *   pnpm bump-version 0.15.0
 *
 * Exit codes:
 *   0 - Success
 *   1 - Error (invalid version, file not found, etc.)
 */

import { readFileSync, writeFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

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

if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
  console.log(`
Version Bump Script

Updates version in ALL package.json files (root + all workspace packages).

Usage:
  node tools/bump-version.js <version|increment>
  pnpm bump-version <version|increment>

Arguments:
  version      Explicit version (e.g., 0.14.2, 1.0.0)
  increment    patch, minor, or major (auto-calculates from current version)

Examples:
  node tools/bump-version.js 0.14.2       # Set to explicit version
  node tools/bump-version.js patch        # Increment patch (0.14.2 -> 0.14.3)
  node tools/bump-version.js minor        # Increment minor (0.14.2 -> 0.15.0)
  node tools/bump-version.js major        # Increment major (0.14.2 -> 1.0.0)

Exit codes:
  0 - Success
  1 - Error (invalid version, file not found, etc.)
  `);
  process.exit(args.length === 0 ? 1 : 0);
}

const versionArg = args[0];

// Helper to increment version
function incrementVersion(currentVersion, type) {
  const parts = currentVersion.split('.').map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) {
    throw new Error(`Invalid current version: ${currentVersion}`);
  }

  switch (type) {
    case 'patch':
      parts[2]++;
      break;
    case 'minor':
      parts[1]++;
      parts[2] = 0;
      break;
    case 'major':
      parts[0]++;
      parts[1] = 0;
      parts[2] = 0;
      break;
    default:
      throw new Error(`Invalid increment type: ${type}`);
  }

  return parts.join('.');
}

// Determine new version
let newVersion;
if (['patch', 'minor', 'major'].includes(versionArg)) {
  // Get current version from a published package (use cli as reference)
  try {
    const cliPkgPath = join(PROJECT_ROOT, 'packages/cli/package.json');
    const cliPkg = JSON.parse(readFileSync(cliPkgPath, 'utf8'));
    const currentVersion = cliPkg.version;

    if (!currentVersion) {
      log('✗ Could not determine current version from @vibe-validate/cli', 'red');
      process.exit(1);
    }

    newVersion = incrementVersion(currentVersion, versionArg);
    log(`Current version: ${currentVersion}`, 'blue');
    log(`Increment type: ${versionArg}`, 'blue');
  } catch (error) {
    log(`✗ Failed to read current version: ${error.message}`, 'red');
    process.exit(1);
  }
} else {
  // Explicit version provided
  newVersion = versionArg;

  // Validate version format (simple semver check)
  if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(newVersion)) {
    log(`✗ Invalid version format: ${newVersion}`, 'red');
    log('  Expected format: X.Y.Z or X.Y.Z-prerelease', 'yellow');
    log('  Examples: 0.14.2, 1.0.0, 1.0.0-beta.1, patch, minor, major', 'yellow');
    process.exit(1);
  }
}

log(`📦 Bumping version to ${newVersion}`, 'blue');
console.log('');

// Function to update version in a package.json file
function updatePackageVersion(filePath, newVersion, skipPrivate = true) {
  try {
    const content = readFileSync(filePath, 'utf8');
    const pkg = JSON.parse(content);
    const oldVersion = pkg.version;

    // Skip packages without version field (likely private packages that don't need versioning)
    if (!oldVersion) {
      return { skipped: true, reason: 'no-version', name: pkg.name };
    }

    // Skip private packages unless root package.json
    const isRootPackage = filePath.endsWith(join('vibe-validate', 'package.json'));
    if (skipPrivate && !isRootPackage && pkg.private === true) {
      return { skipped: true, reason: 'private', name: pkg.name, version: oldVersion };
    }

    if (oldVersion === newVersion) {
      return { updated: false, oldVersion, newVersion, name: pkg.name };
    }

    pkg.version = newVersion;

    // Preserve original formatting by replacing only the version line
    const updatedContent = content.replace(
      /"version":\s*"[^"]+"/,
      `"version": "${newVersion}"`
    );

    writeFileSync(filePath, updatedContent, 'utf8');

    return { updated: true, oldVersion, newVersion, name: pkg.name };
  } catch (error) {
    throw new Error(`Failed to update ${filePath}: ${error.message}`);
  }
}

// Update root package.json
const rootPackagePath = join(PROJECT_ROOT, 'package.json');
log('Updating root package.json...', 'blue');

try {
  const result = updatePackageVersion(rootPackagePath, newVersion);
  if (result.skipped) {
    log(`  - ${result.name || 'vibe-validate'}: skipped (${result.reason})`, 'yellow');
  } else if (result.updated) {
    log(`  ✓ ${result.name || 'vibe-validate'}: ${result.oldVersion} → ${result.newVersion}`, 'green');
  } else {
    log(`  - ${result.name || 'vibe-validate'}: already at ${result.newVersion}`, 'yellow');
  }
} catch (error) {
  log(`  ✗ ${error.message}`, 'red');
  process.exit(1);
}

console.log('');
log('Updating workspace packages...', 'blue');

// Update all workspace packages
const packagesDir = join(PROJECT_ROOT, 'packages');
let updatedCount = 0;
let skippedCount = 0;

try {
  const packages = readdirSync(packagesDir, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name)
    .sort();

  for (const pkg of packages) {
    const pkgPath = join(packagesDir, pkg, 'package.json');
    try {
      const result = updatePackageVersion(pkgPath, newVersion);
      if (result.skipped) {
        const reasonText = result.reason === 'no-version'
          ? 'no version field'
          : `${result.reason}${result.version ? ', v' + result.version : ''}`;
        log(`  - ${result.name}: skipped (${reasonText})`, 'yellow');
        skippedCount++;
      } else if (result.updated) {
        log(`  ✓ ${result.name}: ${result.oldVersion} → ${result.newVersion}`, 'green');
        updatedCount++;
      } else {
        log(`  - ${result.name}: already at ${result.newVersion}`, 'yellow');
        skippedCount++;
      }
    } catch (error) {
      log(`  ✗ ${pkg}: ${error.message}`, 'red');
      process.exit(1);
    }
  }
} catch (error) {
  log(`✗ Failed to read packages directory: ${error.message}`, 'red');
  process.exit(1);
}

console.log('');
log(`✅ Version bump complete!`, 'green');
log(`   Updated: ${updatedCount + (updatedCount > 0 || skippedCount === 0 ? 1 : 0)} packages`, 'green');
if (skippedCount > 0) {
  log(`   Skipped: ${skippedCount} (already at ${newVersion})`, 'yellow');
}
console.log('');
console.log('Next steps:');
console.log(`  1. Review changes: git diff`);
console.log(`  2. Commit: git add -A && git commit -m "chore: Release v${newVersion}"`);
console.log(`  3. Tag: git tag v${newVersion}`);
console.log(`  4. Push: git push origin main && git push origin v${newVersion}`);
console.log('');

process.exit(0);

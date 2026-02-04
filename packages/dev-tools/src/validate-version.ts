#!/usr/bin/env tsx
/**
 * Version Validation Script
 *
 * Ensures all package.json versions match the expected version from git tag.
 * This prevents publishing with mismatched versions across the monorepo.
 *
 * Usage:
 *   node tools/validate-version.js <expected-version>
 *
 * Examples:
 *   node tools/validate-version.js 0.17.5
 *   node tools/validate-version.js 0.17.5-rc.1
 *
 * Exit codes:
 *   0 - All versions match expected version
 *   1 - Version mismatch detected or validation error
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { log, processWorkspacePackages } from './common.js';

// Parse command-line arguments
const args = process.argv.slice(2);

if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
  console.log(`
Version Validation Script

Ensures all package.json versions match the expected version from git tag.

Usage:
  node tools/validate-version.js <expected-version>

Examples:
  node tools/validate-version.js 0.17.5
  node tools/validate-version.js 0.17.5-rc.1

Exit codes:
  0 - All versions match expected version
  1 - Version mismatch detected or validation error
  `);
  process.exit(args.length === 0 ? 1 : 0);
}

const expectedVersion = args[0];

// Validate version format (semver)
// eslint-disable-next-line security/detect-unsafe-regex -- Simple semver pattern, safe
if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(expectedVersion)) {
  log(`✗ Invalid version format: ${expectedVersion}`, 'red');
  log('  Expected format: X.Y.Z or X.Y.Z-prerelease', 'yellow');
  log('  Examples: 0.17.5, 1.0.0, 0.17.5-rc.1', 'yellow');
  process.exit(1);
}

log(`🔍 Validating version consistency: ${expectedVersion}`, 'blue');
console.log('');

interface VersionMismatch {
  name: string;
  actualVersion: string;
  expectedVersion: string;
  filePath: string;
}

let hasErrors = false;
const mismatches: VersionMismatch[] = [];

/**
 * Check version in a package.json file
 * @param {string} filePath - Path to package.json
 * @param {string} expectedVersion - Expected version
 * @param {boolean} skipPrivate - Skip private packages
 * @returns {Object} Validation result
 */
function checkPackageVersion(filePath: string, expectedVersion: string, skipPrivate = true) {
  try {
    const content = readFileSync(filePath, 'utf8');
    const pkg = JSON.parse(content);
    const actualVersion = pkg.version;

    // Skip packages without version field
    if (!actualVersion) {
      return { skipped: true, reason: 'no-version', name: pkg.name };
    }

    // Skip private packages (except root)
    const isRootPackage = filePath.endsWith(join('vibe-validate', 'package.json'));
    if (skipPrivate && !isRootPackage && pkg.private === true) {
      return { skipped: true, reason: 'private', name: pkg.name, version: actualVersion };
    }

    // Check version match
    if (actualVersion !== expectedVersion) {
      return {
        valid: false,
        name: pkg.name,
        actualVersion,
        expectedVersion,
        filePath,
        skipped: false,
      };
    }

    return { valid: true, name: pkg.name, version: actualVersion, skipped: false };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to read ${filePath}: ${message}`);
  }
}

// Check all workspace packages
const counts = processWorkspacePackages(
  (pkgPath) => checkPackageVersion(pkgPath, expectedVersion),
  (result) => {
    if (result.valid) {
      log(`  ✓ ${String(result.name)}: ${String(result.version)}`, 'green');
    } else if (!result.skipped) {
      const mismatch = result as VersionMismatch;
      log(`  ✗ ${String(mismatch.name)}: ${String(mismatch.actualVersion)} (expected: ${String(mismatch.expectedVersion)})`, 'red');
      mismatches.push(mismatch);
      hasErrors = true;
    }
  },
  () => {
    // Skip logging handled by processWorkspacePackages
  },
  (pkgName, error) => {
    log(`  ✗ ${pkgName}: ${error.message}`, 'red');
    hasErrors = true;
  }
);

const checkedCount = counts.processed;
const skippedCount = counts.skipped;

console.log('');

if (hasErrors) {
  log(`❌ Version validation FAILED`, 'red');
  log(`   Packages checked: ${checkedCount}`, 'yellow');
  log(`   Mismatches found: ${mismatches.length}`, 'red');

  if (mismatches.length > 0) {
    console.log('');
    log('Mismatched packages:', 'red');
    for (const mismatch of mismatches) {
      log(`  - ${mismatch.name}: ${mismatch.actualVersion} (expected: ${mismatch.expectedVersion})`, 'red');
    }

    console.log('');
    log('Recovery instructions:', 'yellow');
    log(`  1. Run: pnpm bump-version ${expectedVersion}`, 'yellow');
    log(`  2. Commit: git add -A && git commit -m "chore: Fix version to ${expectedVersion}"`, 'yellow');
    log(`  3. Delete old tag: git tag -d v${expectedVersion}`, 'yellow');
    log(`  4. Push tag deletion: git push origin :refs/tags/v${expectedVersion}`, 'yellow');
    log(`  5. Create new tag: git tag v${expectedVersion}`, 'yellow');
    log(`  6. Push: git push origin main v${expectedVersion}`, 'yellow');
  }

  process.exit(1);
}

log(`✅ Version validation PASSED`, 'green');
log(`   All ${checkedCount} packages match version ${expectedVersion}`, 'green');
if (skippedCount > 0) {
  log(`   Skipped: ${skippedCount} (private packages)`, 'yellow');
}
console.log('');

process.exit(0);

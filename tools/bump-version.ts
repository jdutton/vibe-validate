#!/usr/bin/env tsx
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

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { PROJECT_ROOT, log, processWorkspacePackages } from './common.js';

// Constants for duplicate string elimination
const PACKAGE_JSON_FILENAME = 'package.json';
const VIBE_VALIDATE_PKG_NAME = 'vibe-validate';

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
  if (parts.length !== 3 || parts.some(Number.isNaN)) {
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
    const isRootPackage = filePath.endsWith(join(VIBE_VALIDATE_PKG_NAME, PACKAGE_JSON_FILENAME));
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
const rootPackagePath = join(PROJECT_ROOT, PACKAGE_JSON_FILENAME);
log('Updating root package.json...', 'blue');

try {
  const result = updatePackageVersion(rootPackagePath, newVersion);
  if (result.skipped) {
    log(`  - ${result.name || VIBE_VALIDATE_PKG_NAME}: skipped (${result.reason})`, 'yellow');
  } else if (result.updated) {
    log(`  ✓ ${result.name || VIBE_VALIDATE_PKG_NAME}: ${result.oldVersion} → ${result.newVersion}`, 'green');
  } else {
    log(`  - ${result.name || VIBE_VALIDATE_PKG_NAME}: already at ${result.newVersion}`, 'yellow');
  }
} catch (error) {
  log(`  ✗ ${error.message}`, 'red');
  process.exit(1);
}

console.log('');
log('Updating workspace packages...', 'blue');

// Update all workspace packages
const counts = processWorkspacePackages(
  (pkgPath) => updatePackageVersion(pkgPath, newVersion),
  (result) => {
    if (result.updated) {
      log(`  ✓ ${result.name}: ${result.oldVersion} → ${result.newVersion}`, 'green');
    } else {
      log(`  - ${result.name}: already at ${result.newVersion}`, 'yellow');
    }
  },
  () => {
    // Skip logging handled by processWorkspacePackages
  }
);

const updatedCount = counts.processed;
const skippedCount = counts.skipped;

console.log('');
log('Updating test version expectations...', 'blue');

// Update test files with BUMP_VERSION_UPDATE markers
const testFilesWithVersions = [
  join(PROJECT_ROOT, 'packages/cli/test/bin/wrapper.test.ts'),
];

let testUpdatedCount = 0;
let testSkippedCount = 0;

for (const testFile of testFilesWithVersions) {
  try {
    const content = readFileSync(testFile, 'utf8');

    // Find all lines with BUMP_VERSION_UPDATE marker
    // Pattern matches:
    //   .toContain('0.17.0-rc4'); // BUMP_VERSION_UPDATE
    //   const EXPECTED_VERSION = '0.18.0'; // BUMP_VERSION_UPDATE
    const versionPattern = /(['"])\d+\.\d+\.\d+(-[\w.]+)?\1[);]*\s*\/\/\s*BUMP_VERSION_UPDATE/g;
    const matches = [...content.matchAll(versionPattern)];

    if (matches.length === 0) {
      log(`  - ${testFile.split('/').pop()}: no version markers found`, 'yellow');
      testSkippedCount++;
      continue;
    }

    // Replace all version strings marked with BUMP_VERSION_UPDATE
    // Capture the ending characters ([);]*) to preserve them in replacement
    const updatedContent = content.replaceAll(
      versionPattern,
      (match) => {
        // Extract quote type and trailing characters (;, ), etc.) after version
        const quoteMatch = match.match(/(['"])/);
        const quote = quoteMatch?.[1] ?? "'";
        // Find the last occurrence of the quote to get trailing characters
        const lastQuoteIndex = match.lastIndexOf(quote);
        const afterLastQuote = match.substring(lastQuoteIndex + 1);
        const trailingMatch = afterLastQuote.match(/^([);]*)/);
        const trailing = trailingMatch?.[1] ?? '';
        return `${quote}${newVersion}${quote}${trailing} // BUMP_VERSION_UPDATE`;
      }
    );

    if (updatedContent === content) {
      log(`  - ${testFile.split('/').pop()}: already at ${newVersion}`, 'yellow');
      testSkippedCount++;
    } else {
      writeFileSync(testFile, updatedContent, 'utf8');
      log(`  ✓ ${testFile.split('/').pop()}: updated ${matches.length} version expectation(s)`, 'green');
      testUpdatedCount++;
    }
  } catch (error) {
    log(`  - ${testFile.split('/').pop()}: skipped (${error.code === 'ENOENT' ? 'not found' : error.message})`, 'yellow');
    testSkippedCount++;
  }
}

console.log('');
log('Updating Claude Code skill documentation...', 'blue');

// Update skill documentation version
const skillFile = { path: join(PROJECT_ROOT, 'docs/skill/SKILL.md'), name: 'Skill documentation' };

let skillUpdatedCount = 0;
let skillSkippedCount = 0;

try {
  const content = readFileSync(skillFile.path, 'utf8');

  // Match: version: 0.17.2 # Tracks vibe-validate package version
  const versionPattern = /^version:\s*(\d+\.\d+\.\d+(?:-[\w.]+)?)\s*#\s*Tracks vibe-validate package version/m;
  const match = content.match(versionPattern);

  if (match) {
    const oldVersion = match[1];
    if (oldVersion === newVersion) {
      log(`  - ${skillFile.name}: already at ${newVersion}`, 'yellow');
      skillSkippedCount++;
    } else {
      const updatedContent = content.replace(
        versionPattern,
        `version: ${newVersion} # Tracks vibe-validate package version`
      );
      writeFileSync(skillFile.path, updatedContent, 'utf8');
      log(`  ✓ ${skillFile.name}: ${oldVersion} → ${newVersion}`, 'green');
      skillUpdatedCount++;
    }
  } else {
    log(`  - ${skillFile.name}: skipped (version tracking comment not found)`, 'yellow');
    skillSkippedCount++;
  }
} catch (error) {
  log(`  - ${skillFile.name}: skipped (${error.code === 'ENOENT' ? 'not found' : error.message})`, 'yellow');
  skillSkippedCount++;
}

console.log('');
log(`✅ Version bump complete!`, 'green');
log(`   Packages updated: ${updatedCount + (updatedCount > 0 || skippedCount === 0 ? 1 : 0)}`, 'green');
log(`   Test files updated: ${testUpdatedCount}`, 'green');
log(`   Skill documentation updated: ${skillUpdatedCount}`, 'green');
if (skippedCount > 0 || testSkippedCount > 0 || skillSkippedCount > 0) {
  log(`   Skipped: ${skippedCount + testSkippedCount + skillSkippedCount} (already at ${newVersion})`, 'yellow');
}
console.log('');
console.log('Next steps:');
console.log(`  1. Review changes: git diff`);
console.log(`  2. Commit: git add -A && git commit -m "chore: Release v${newVersion}"`);
console.log(`  3. Tag: git tag v${newVersion}`);
console.log(`  4. Push: git push origin main && git push origin v${newVersion}`);
console.log('');

process.exit(0);

#!/usr/bin/env tsx
/**
 * Publish with Rollback Safety Script
 *
 * Core publishing engine with transaction-like rollback capability.
 * Publishes all packages in dependency order with safety mechanisms.
 *
 * Features:
 * - Dependency-order publishing (8 packages)
 * - Persistent manifest for rollback tracking
 * - Dual-tag support for stable releases (@latest + @next)
 * - Smart rollback: unpublish → deprecate fallback
 * - Dry-run mode for testing
 *
 * Usage:
 *   node tools/publish-with-rollback.js <version> [--dry-run]
 *
 * Examples:
 *   node tools/publish-with-rollback.js 0.17.5-rc.1
 *   node tools/publish-with-rollback.js 0.17.5
 *   node tools/publish-with-rollback.js 0.17.5 --dry-run
 *
 * Environment Variables:
 *   NODE_AUTH_TOKEN - npm authentication token (required for actual publish)
 *
 * Exit codes:
 *   0 - Success (all packages published)
 *   1 - Failure (with rollback attempted)
 */

import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

import semver from 'semver';

import { safeExecSync, safeExecResult } from '../../utils/dist/safe-exec.js';

import { PROJECT_ROOT, log, getNpmTagVersion } from './common.js';

const MANIFEST_PATH = join(PROJECT_ROOT, '.publish-manifest.json');

// Constants for duplicate string elimination
const VIBE_VALIDATE_PKG_NAME = 'vibe-validate';

/**
 * Package publishing order (dependency-order)
 */
const PACKAGES = [
  'utils',                    // Foundational package (no dependencies)
  'config',                   // No dependencies
  'extractors',               // Depends on config
  'git',                      // Depends on utils
  'history',                  // Depends on core, git, utils
  'core',                     // Depends on config, git, extractors, utils
  'cli',                      // Depends on ALL
  VIBE_VALIDATE_PKG_NAME,     // Umbrella package (depends on cli)
];

/**
 * Publishing manifest for rollback tracking
 */
const manifest: {
  version: string;
  primaryTag: string;
  publishedPackages: string[];
  nextTagAdded: boolean;
} = {
  version: '',
  primaryTag: '',
  publishedPackages: [],
  nextTagAdded: false,
};

/**
 * Save manifest to disk
 */
function saveManifest() {
  writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2), 'utf8');
}

/**
 * Load manifest from disk
 */
function loadManifest() {
  if (existsSync(MANIFEST_PATH)) {
    const content = readFileSync(MANIFEST_PATH, 'utf8');
    const loaded = JSON.parse(content);
    Object.assign(manifest, loaded);
  }
}

/**
 * Cleanup manifest file
 */
function cleanupManifest() {
  if (existsSync(MANIFEST_PATH)) {
    unlinkSync(MANIFEST_PATH);
  }
}

/**
 * Publish a single package
 */
function publishPackage(packageName: string, version: string, tag: string, dryRun = false) {
  const packagePath = join(PROJECT_ROOT, 'packages', packageName);
  const fullPackageName = packageName === VIBE_VALIDATE_PKG_NAME ? VIBE_VALIDATE_PKG_NAME : `@vibe-validate/${packageName}`;

  log(`\n📦 Publishing ${fullPackageName}@${version} with tag @${tag}...`, 'blue');

  if (dryRun) {
    log('  [DRY-RUN] Skipping actual publish', 'yellow');
    return { success: true, dryRun: true };
  }

  try {
    const args = ['publish', '--no-git-checks', '--tag', tag];

    // Add provenance if in CI (GitHub Actions)
    if (process.env.CI && process.env.GITHUB_ACTIONS) {
      args.push('--provenance');
    }

    safeExecSync('pnpm', args, {
      cwd: packagePath,
      stdio: ['inherit', 'inherit', 'inherit'],
      env: {
        ...process.env,
        NODE_AUTH_TOKEN: process.env.NODE_AUTH_TOKEN,
      },
    });

    log(`  ✅ ${fullPackageName} published successfully`, 'green');
    return { success: true };
  } catch (error) {
    log(`  ❌ Failed to publish ${fullPackageName}`, 'red');
    return { success: false, error };
  }
}

/**
 * Add dist-tag to a package
 */
function addDistTag(packageName: string, version: string, tag: string, dryRun = false) {
  const fullPackageName = packageName === VIBE_VALIDATE_PKG_NAME ? VIBE_VALIDATE_PKG_NAME : `@vibe-validate/${packageName}`;

  log(`  Adding @${tag} tag to ${fullPackageName}@${version}...`, 'blue');

  if (dryRun) {
    log('    [DRY-RUN] Skipping actual tag addition', 'yellow');
    return { success: true, dryRun: true };
  }

  try {
    safeExecSync('npm', ['dist-tag', 'add', `${fullPackageName}@${version}`, tag], {
      stdio: ['inherit', 'inherit', 'inherit'],
    });

    log(`    ✅ @${tag} tag added`, 'green');
    return { success: true };
  } catch (error) {
    log(`    ❌ Failed to add @${tag} tag`, 'red');
    return { success: false, error };
  }
}

/**
 * Attempt to unpublish a package
 */
function unpublishPackage(packageName: string, version: string, dryRun = false) {
  const fullPackageName = packageName === VIBE_VALIDATE_PKG_NAME ? VIBE_VALIDATE_PKG_NAME : `@vibe-validate/${packageName}`;

  log(`  Unpublishing ${fullPackageName}@${version}...`, 'yellow');

  if (dryRun) {
    log('    [DRY-RUN] Skipping actual unpublish', 'yellow');
    return { success: true, dryRun: true };
  }

  const result = safeExecResult('npm', ['unpublish', `${fullPackageName}@${version}`, '--force'], {
    stdio: 'pipe',
  });

  if (result.status === 0) {
    log(`    ✅ Unpublished successfully`, 'green');
    return { success: true };
  }

  log(`    ⚠️  Unpublish failed (likely >72hr limit or has dependents)`, 'yellow');
  return { success: false, reason: 'unpublish_failed' };
}

/**
 * Deprecate a package (fallback when unpublish fails)
 */
function deprecatePackage(packageName: string, version: string, dryRun = false) {
  const fullPackageName = packageName === VIBE_VALIDATE_PKG_NAME ? VIBE_VALIDATE_PKG_NAME : `@vibe-validate/${packageName}`;
  const message = '⚠️ Incomplete publish - DO NOT USE. See https://github.com/jdutton/vibe-validate/issues';

  log(`  Deprecating ${fullPackageName}@${version}...`, 'yellow');

  if (dryRun) {
    log('    [DRY-RUN] Skipping actual deprecation', 'yellow');
    return { success: true, dryRun: true };
  }

  const result = safeExecResult('npm', ['deprecate', `${fullPackageName}@${version}`, message], {
    stdio: ['inherit', 'inherit', 'inherit'],
  });

  if (result.status === 0) {
    log(`    ✅ Deprecated with warning`, 'green');
    return { success: true };
  }

  log(`    ❌ Deprecation failed`, 'red');
  return { success: false };
}

/**
 * Rollback: unpublish or deprecate all published packages
 */
function rollback(dryRun = false) {
  log('\n🔄 ROLLBACK: Attempting to unpublish packages...', 'yellow');
  log('─'.repeat(60), 'yellow');

  loadManifest();

  if (manifest.publishedPackages.length === 0) {
    log('  No packages to rollback', 'yellow');
    return;
  }

  log(`  Found ${manifest.publishedPackages.length} published packages`, 'yellow');
  console.log('');

  // Rollback in reverse order
  const packagesToRollback = [...manifest.publishedPackages].reverse();
  const rollbackResults = [];

  for (const packageName of packagesToRollback) {
    const unpublishResult = unpublishPackage(packageName, manifest.version, dryRun);

    if (unpublishResult.success) {
      rollbackResults.push({ package: packageName, action: 'unpublished' });
    } else {
      // Unpublish failed - try deprecate as fallback
      const deprecateResult = deprecatePackage(packageName, manifest.version, dryRun);

      if (deprecateResult.success) {
        rollbackResults.push({ package: packageName, action: 'deprecated' });
      } else {
        rollbackResults.push({ package: packageName, action: 'failed' });
      }
    }
  }

  // Summary
  console.log('');
  log('─'.repeat(60), 'yellow');
  log('Rollback Summary:', 'yellow');

  const unpublished = rollbackResults.filter(r => r.action === 'unpublished');
  const deprecated = rollbackResults.filter(r => r.action === 'deprecated');
  const failed = rollbackResults.filter(r => r.action === 'failed');

  if (unpublished.length > 0) {
    log(`  ✅ Unpublished: ${unpublished.length} packages`, 'green');
  }
  if (deprecated.length > 0) {
    log(`  ⚠️  Deprecated: ${deprecated.length} packages (couldn't unpublish)`, 'yellow');
  }
  if (failed.length > 0) {
    log(`  ❌ Failed rollback: ${failed.length} packages`, 'red');
    for (const result of failed) {
      log(`     - ${result.package}`, 'red');
    }
  }

  // Cleanup manifest
  cleanupManifest();

  if (failed.length > 0) {
    console.log('');
    log('⚠️  Manual intervention required for failed rollbacks', 'yellow');
    log('   See recovery guide in docs/publishing.md', 'yellow');
  }
}

/**
 * Parse and validate command-line arguments
 */
function parseArguments() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    console.log(`
Publish with Rollback Safety Script

Usage:
  node tools/publish-with-rollback.js <version> [--dry-run]

Examples:
  node tools/publish-with-rollback.js 0.17.5-rc.1
  node tools/publish-with-rollback.js 0.17.5
  node tools/publish-with-rollback.js 0.17.5 --dry-run

Environment Variables:
  NODE_AUTH_TOKEN - npm authentication token (required)

Exit codes:
  0 - Success (all packages published)
  1 - Failure (with rollback attempted)
    `);
    process.exit(args.length === 0 ? 1 : 0);
  }

  const version = args[0];
  const dryRun = args.includes('--dry-run');

  // Validate version format
  if (!semver.valid(version)) {
    log(`✗ Invalid semver version: ${version}`, 'red');
    process.exit(1);
  }

  return { version, dryRun };
}

/**
 * Publish all packages with primary tag
 */
function publishAllPackages(version: string, primaryTag: string, dryRun: boolean): void {
  log('📋 Phase 1: Publishing packages...', 'blue');
  log('─'.repeat(60), 'blue');

  for (const pkg of PACKAGES) {
    const result = publishPackage(pkg, version, primaryTag, dryRun);

    if (result.success) {
      manifest.publishedPackages.push(pkg);
      saveManifest();
    } else {
      log('\n❌ Publish failed!', 'red');
      log(`   Package: ${pkg}`, 'red');
      rollback(dryRun);
      process.exit(1);
    }
  }

  log('\n✅ Phase 1 complete - all packages published', 'green');
}

/**
 * Update @next tag for stable releases if needed
 */
function updateNextTag(version: string, dryRun: boolean): void {
  log('\n📋 Phase 2: Checking @next tag update...', 'blue');
  log('─'.repeat(60), 'blue');

  const currentNextVersion = getNpmTagVersion(VIBE_VALIDATE_PKG_NAME, 'next');

  let shouldUpdateNext = false;
  if (!currentNextVersion) {
    log('  No current @next version found', 'yellow');
    log('  → Will update @next to this stable version', 'green');
    shouldUpdateNext = true;
  } else if (semver.gt(version, currentNextVersion)) {
    log(`  Current @next: ${currentNextVersion}`, 'blue');
    log(`  New version: ${version} > ${currentNextVersion}`, 'green');
    log('  → Will update @next to this stable version', 'green');
    shouldUpdateNext = true;
  } else {
    log(`  Current @next: ${currentNextVersion}`, 'blue');
    log(`  New version: ${version} <= ${currentNextVersion}`, 'yellow');
    log('  → Skipping @next update (already newer or equal)', 'yellow');
  }

  if (shouldUpdateNext) {
    log('\n  Adding @next tag to all packages...', 'blue');

    for (const pkg of PACKAGES) {
      const result = addDistTag(pkg, version, 'next', dryRun);

      if (!result.success) {
        log('\n❌ Failed to add @next tag!', 'red');
        log(`   Package: ${pkg}`, 'red');
        log('   All packages published but @next tag incomplete', 'red');
        rollback(dryRun);
        process.exit(1);
      }
    }

    manifest.nextTagAdded = true;
    saveManifest();
    log('\n  ✅ @next tag added to all packages', 'green');
  }

  log('\n✅ Phase 2 complete', 'green');
}

/**
 * Print success message and verification commands
 */
function printSuccess(version: string, primaryTag: string, dryRun: boolean): void {
  console.log('');
  log('='.repeat(60), 'green');
  log('✅ PUBLISH SUCCESSFUL', 'green');
  log('='.repeat(60), 'green');
  log(`Version: ${version}`, 'green');
  log(`Primary tag: @${primaryTag}`, 'green');
  if (manifest.nextTagAdded) {
    log(`@next tag: Updated`, 'green');
  }
  log(`Packages published: ${PACKAGES.length}`, 'green');
  console.log('');

  if (!dryRun) {
    log('📦 Verify with:', 'blue');
    log(`   npm view vibe-validate@${primaryTag} version`, 'reset');
    log(`   npm view vibe-validate@${version}`, 'reset');
    if (manifest.nextTagAdded) {
      log(`   npm view vibe-validate@next version`, 'reset');
    }
    console.log('');
  }
}

/**
 * Main publishing flow
 */
function main() {
  // Parse and validate arguments
  const { version, dryRun } = parseArguments();

  // Determine version type and tags
  const isPrerelease = semver.prerelease(version) !== null;
  const isStable = !isPrerelease;
  const primaryTag = isStable ? 'latest' : 'next';

  // Initialize manifest
  manifest.version = version;
  manifest.primaryTag = primaryTag;
  manifest.publishedPackages = [];
  manifest.nextTagAdded = false;
  saveManifest();

  // Header
  log('\n' + '='.repeat(60), 'blue');
  log(`📦 Publishing vibe-validate v${version}`, 'blue');
  log(`🏷️  Primary npm tag: @${primaryTag}`, 'blue');
  if (dryRun) {
    log(`🧪 DRY-RUN MODE (no actual publishing)`, 'yellow');
  }
  log('='.repeat(60) + '\n', 'blue');

  // Check npm authentication (skip for dry-run)
  if (!dryRun && !process.env.NODE_AUTH_TOKEN && !process.env.NPM_TOKEN) {
    log('✗ Missing npm authentication', 'red');
    log('  Set NODE_AUTH_TOKEN or NPM_TOKEN environment variable', 'yellow');
    process.exit(1);
  }

  // Phase 1: Publish all packages with primary tag
  publishAllPackages(version, primaryTag, dryRun);

  // Phase 2: For stable versions, add @next tag if needed
  if (isStable) {
    updateNextTag(version, dryRun);
  }

  // Success!
  cleanupManifest();
  printSuccess(version, primaryTag, dryRun);

  process.exit(0);
}

// Run
main();

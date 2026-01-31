#!/usr/bin/env tsx
/**
 * Intelligent publish script that determines npm dist-tag from package version
 *
 * Version patterns:
 * - X.Y.Z          → --tag latest (stable release)
 * - X.Y.Z-rc.N     → --tag next (release candidate)
 * - X.Y.Z-beta.N   → --tag beta (beta release)
 * - X.Y.Z-alpha.N  → --tag alpha (alpha release)
 * - X.Y.Z-canary.N → --tag canary (canary release)
 *
 * Usage:
 *   node tools/publish-all.js
 *   pnpm publish:all
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { safeExecSync } from '../../utils/dist/safe-exec.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');

/**
 * Determine npm dist-tag from version string
 * @param {string} version - Package version (e.g., "0.17.0-rc1")
 * @returns {string} - npm dist-tag (e.g., "rc", "latest")
 */
function determineTag(version: string): string {
  // Extract prerelease identifier (e.g., "rc1", "beta.2", "alpha", etc.)
  const prereleasePattern = /-([a-z]+)/i;
  const prereleaseMatch = prereleasePattern.exec(version);

  if (!prereleaseMatch) {
    // No prerelease identifier → stable release
    return 'latest';
  }

  const prerelease = prereleaseMatch[1].toLowerCase();

  // Map common prerelease identifiers to dist-tags
  const tagMap: Record<string, string> = {
    'rc': 'next',      // Changed from 'rc' to 'next' for consistency with automation
    'beta': 'beta',
    'alpha': 'alpha',
    'canary': 'canary',
    'next': 'next',
  };

  return tagMap[prerelease] || 'next'; // Default to 'next' for unknown prerelease types
}

/**
 * Get version from CLI package.json (canonical version)
 */
function getVersion() {
  const pkgPath = join(ROOT, 'packages/cli/package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
  return pkg.version;
}

/**
 * Publish a package with the determined tag
 * @param {string} packageName - Package directory name
 * @param {string} tag - npm dist-tag
 */
function publishPackage(packageName: string, tag: string): void {
  const packagePath = join(ROOT, 'packages', packageName);
  console.log(`\n📦 Publishing ${packageName}...`);

  try {
    safeExecSync('pnpm', ['publish', '--no-git-checks', '--tag', tag], {
      cwd: packagePath,
      stdio: ['inherit', 'inherit', 'inherit'],
    });
    console.log(`✅ ${packageName} published with tag: ${tag}`);
  } catch (error) {
    console.error(`❌ Failed to publish ${packageName}`);
    throw error;
  }
}

/**
 * Run pre-publish checks
 * @param {string[]} args - Command-line arguments to pass through
 */
function runPrePublishChecks(args: string[] = []): void {
  console.log('🔍 Running pre-publish checks...\n');

  try {
    safeExecSync('node', ['tools/pre-publish-check.js', ...args], {
      cwd: ROOT,
      stdio: ['inherit', 'inherit', 'inherit'],
    });
    console.log('\n✅ Pre-publish checks passed\n');
  } catch (error) {
    console.error('\n❌ Pre-publish checks failed');
    throw error;
  }
}

/**
 * Main publish flow
 */
function main() {
  const version = getVersion();
  const tag = determineTag(version);

  console.log(`\n${'='.repeat(60)}`);
  console.log(`📦 Publishing vibe-validate v${version}`);
  console.log(`🏷️  npm dist-tag: ${tag}`);
  console.log(`${'='.repeat(60)}\n`);

  // Pass through command-line arguments to pre-publish-check
  const args = process.argv.slice(2);
  runPrePublishChecks(args);

  // Publish packages in dependency order
  const packages = [
    'utils',         // foundational package (no dependencies)
    'config',        // no dependencies
    'extractors',
    'git',           // depends on utils
    'history',
    'core',
    'cli',
    'vibe-validate', // umbrella package last
  ];

  for (const pkg of packages) {
    publishPackage(pkg, tag);
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`✅ All packages published successfully!`);
  console.log(`📦 Version: ${version}`);
  console.log(`🏷️  Tag: ${tag}`);
  console.log(`${'='.repeat(60)}\n`);

  if (tag !== 'latest') {
    console.log(`\n💡 Users can install with:`);
    console.log(`   npm install -g vibe-validate@${tag}`);
    console.log(`   npm install -g vibe-validate@${version}\n`);
  }
}

// Run
main();

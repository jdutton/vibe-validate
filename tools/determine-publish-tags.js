#!/usr/bin/env node
/**
 * Publish Tag Determination Script
 *
 * Determines npm dist-tags and version type based on version string.
 * For stable versions, checks if @next tag should be updated via semver comparison.
 *
 * Usage:
 *   node tools/determine-publish-tags.js <version>
 *
 * Examples:
 *   node tools/determine-publish-tags.js 0.17.5-rc.1
 *   node tools/determine-publish-tags.js 0.17.5
 *
 * Outputs (GitHub Actions format):
 *   is_stable=true|false
 *   is_rc=true|false
 *   primary_tag=latest|next
 *   update_next=true|false (only for stable versions)
 *
 * Exit codes:
 *   0 - Success
 *   1 - Error (invalid version, network error, etc.)
 */

import { safeExecResult } from '../packages/utils/dist/safe-exec.js';
import { appendFileSync } from 'node:fs';
import semver from 'semver';

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

/**
 * Output GitHub Actions output variable
 * @param {string} name - Variable name
 * @param {string} value - Variable value
 */
function setGitHubOutput(name, value) {
  if (process.env.GITHUB_OUTPUT) {
    // Running in GitHub Actions - append to $GITHUB_OUTPUT file
    appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
  } else {
    // Running locally - output to console for debugging
    console.log(`[OUTPUT] ${name}=${value}`);
  }
}

/**
 * Query npm registry for current version on a dist-tag
 * @param {string} packageName - npm package name
 * @param {string} tag - dist-tag (e.g., 'next', 'latest')
 * @returns {string|null} - Version string or null if not found
 */
function getNpmTagVersion(packageName, tag) {
  const result = safeExecResult('npm', ['view', `${packageName}@${tag}`, 'version'], {
    encoding: 'utf8',
    stdio: 'pipe',
  });

  if (result.status === 0 && result.stdout) {
    return result.stdout.trim();
  }

  return null;
}

// Parse command-line arguments
const args = process.argv.slice(2);

if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
  console.log(`
Publish Tag Determination Script

Determines npm dist-tags and version type based on version string.

Usage:
  node tools/determine-publish-tags.js <version>

Examples:
  node tools/determine-publish-tags.js 0.17.5-rc.1  # RC version
  node tools/determine-publish-tags.js 0.17.5       # Stable version

Outputs (GitHub Actions format):
  is_stable=true|false        # Is this a stable release?
  is_rc=true|false            # Is this an RC release?
  primary_tag=latest|next     # Primary npm dist-tag to use
  update_next=true|false      # Should @next tag be updated? (stable only)

Exit codes:
  0 - Success
  1 - Error (invalid version, network error, etc.)
  `);
  process.exit(args.length === 0 ? 1 : 0);
}

const version = args[0];

// Validate version format (semver)
if (!semver.valid(version)) {
  log(`✗ Invalid semver version: ${version}`, 'red');
  log('  Expected format: X.Y.Z or X.Y.Z-prerelease', 'yellow');
  log('  Examples: 0.17.5, 1.0.0, 0.17.5-rc.1', 'yellow');
  process.exit(1);
}

log(`🏷️  Determining publish tags for: ${version}`, 'blue');
console.log('');

// Determine version type
const isPrerelease = semver.prerelease(version) !== null;
const isStable = !isPrerelease;
const isRC = isPrerelease && version.includes('-rc');

// Determine primary npm dist-tag
const primaryTag = isStable ? 'latest' : 'next';

// Determine version type label
let versionType = 'Prerelease';
if (isStable) {
  versionType = 'Stable';
} else if (isRC) {
  versionType = 'RC (Release Candidate)';
}

log(`Version type: ${versionType}`, isStable ? 'green' : 'yellow');
log(`Primary npm tag: @${primaryTag}`, 'blue');

// For stable versions, check if we should update @next tag
let updateNext = false;
if (isStable) {
  log('', 'reset');
  log('Checking if @next tag should be updated...', 'blue');

  try {
    const currentNextVersion = getNpmTagVersion('vibe-validate', 'next');

    if (!currentNextVersion) {
      log('  ⚠ No current @next version found on npm', 'yellow');
      log('  → Will update @next to this stable version', 'green');
      updateNext = true;
    } else {
      log(`  Current @next version: ${currentNextVersion}`, 'blue');

      // Compare versions using semver
      if (semver.gt(version, currentNextVersion)) {
        log(`  ✓ ${version} > ${currentNextVersion}`, 'green');
        log('  → Will update @next to this stable version', 'green');
        updateNext = true;
      } else {
        log(`  - ${version} <= ${currentNextVersion}`, 'yellow');
        log('  → Will NOT update @next (already newer or equal)', 'yellow');
        // updateNext remains false (no assignment needed)
      }
    }
  } catch (error) {
    log(`  ✗ Failed to query npm registry: ${error.message}`, 'red');
    log('  → Defaulting to update @next (safer)', 'yellow');
    updateNext = true;
  }
}

console.log('');
log('📋 Summary:', 'blue');
log(`  Version: ${version}`, 'reset');
log(`  Type: ${versionType}`, 'reset');
log(`  Primary tag: @${primaryTag}`, 'reset');
if (isStable) {
  log(`  Update @next: ${updateNext ? 'Yes' : 'No'}`, updateNext ? 'green' : 'yellow');
}

console.log('');

// Output GitHub Actions outputs
setGitHubOutput('is_stable', isStable ? 'true' : 'false');
setGitHubOutput('is_rc', isRC ? 'true' : 'false');
setGitHubOutput('primary_tag', primaryTag);
setGitHubOutput('update_next', updateNext ? 'true' : 'false');

log('✅ Tag determination complete', 'green');
console.log('');

process.exit(0);

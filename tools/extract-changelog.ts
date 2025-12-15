#!/usr/bin/env tsx
/**
 * CHANGELOG Extraction Script
 *
 * Extracts version-specific content from CHANGELOG.md for GitHub releases.
 * Parses Keep a Changelog format and outputs release notes to temporary file.
 *
 * Usage:
 *   node tools/extract-changelog.js <version>
 *
 * Examples:
 *   node tools/extract-changelog.js 0.17.5
 *   node tools/extract-changelog.js 1.0.0
 *
 * Output:
 *   Creates .changelog-release.md with extracted content
 *
 * Exit codes:
 *   0 - Success (content extracted)
 *   1 - Error (version not found, invalid format, etc.)
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..');
const CHANGELOG_PATH = join(PROJECT_ROOT, 'CHANGELOG.md');
const OUTPUT_PATH = join(PROJECT_ROOT, '.changelog-release.md');

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
 * Extract version section from CHANGELOG
 * @param {string} changelogContent - Full CHANGELOG content
 * @param {string} version - Version to extract (e.g., '0.17.5')
 * @returns {string} - Extracted content for the version
 */
function extractVersionSection(changelogContent, version) {
  // Escape version for regex (handles dots and dashes)
  const escapedVersion = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // Match: ## [VERSION] - YYYY-MM-DD
  // eslint-disable-next-line security/detect-non-literal-regexp -- escapedVersion is sanitized above
  const versionHeaderPattern = new RegExp(`^## \\[${escapedVersion}\\] - \\d{4}-\\d{2}-\\d{2}$`, 'm');
  const versionHeaderMatch = changelogContent.match(versionHeaderPattern);

  if (!versionHeaderMatch) {
    throw new Error(`Version ${version} not found in CHANGELOG.md`);
  }

  const versionHeaderIndex = versionHeaderMatch.index;
  const versionHeaderLine = versionHeaderMatch[0];

  // Find start of content (after version header line)
  const contentStart = versionHeaderIndex + versionHeaderLine.length + 1;

  // Find next version header or end of file
  const nextVersionPattern = /^## \[/m;
  const remainingContent = changelogContent.slice(contentStart);
  const nextVersionMatch = remainingContent.match(nextVersionPattern);

  let contentEnd;
  if (nextVersionMatch) {
    // Next version found - content ends there
    contentEnd = contentStart + nextVersionMatch.index;
  } else {
    // No next version - check for link references section
    const linkReferencesPattern = /^\[Unreleased\]:/m;
    const linkReferencesMatch = remainingContent.match(linkReferencesPattern);

    if (linkReferencesMatch) {
      // Link references found - content ends there
      contentEnd = contentStart + linkReferencesMatch.index;
    } else {
      // No link references - content goes to end of file
      contentEnd = changelogContent.length;
    }
  }

  // Extract content
  const content = changelogContent.slice(contentStart, contentEnd).trim();

  return content;
}

// Parse command-line arguments
const args = process.argv.slice(2);

if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
  console.log(`
CHANGELOG Extraction Script

Extracts version-specific content from CHANGELOG.md for GitHub releases.

Usage:
  node tools/extract-changelog.js <version>

Examples:
  node tools/extract-changelog.js 0.17.5
  node tools/extract-changelog.js 1.0.0

Output:
  Creates .changelog-release.md with extracted content

Exit codes:
  0 - Success (content extracted)
  1 - Error (version not found, invalid format, etc.)
  `);
  process.exit(args.length === 0 ? 1 : 0);
}

const version = args[0];

// Validate version format (semver)
if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) {
  log(`✗ Invalid version format: ${version}`, 'red');
  log('  Expected format: X.Y.Z or X.Y.Z-prerelease', 'yellow');
  log('  Examples: 0.17.5, 1.0.0', 'yellow');
  process.exit(1);
}

log(`📝 Extracting CHANGELOG for version: ${version}`, 'blue');
console.log('');

// Read CHANGELOG.md
let changelogContent;
try {
  changelogContent = readFileSync(CHANGELOG_PATH, 'utf8');
  log(`✓ Read CHANGELOG.md (${changelogContent.length} bytes)`, 'green');
} catch (error) {
  log(`✗ Failed to read CHANGELOG.md: ${error.message}`, 'red');
  process.exit(1);
}

// Extract version section
let content;
try {
  content = extractVersionSection(changelogContent, version);
  log(`✓ Extracted version section (${content.length} bytes)`, 'green');
} catch (error) {
  log(`✗ ${error.message}`, 'red');
  console.log('');
  log('Recovery instructions:', 'yellow');
  log(`  1. Update CHANGELOG.md to include version ${version}`, 'yellow');
  log(`  2. Format: ## [${version}] - YYYY-MM-DD`, 'yellow');
  log(`  3. Add release notes under the version header`, 'yellow');
  log(`  4. Delete old tag: git tag -d v${version}`, 'yellow');
  log(`  5. Push tag deletion: git push origin :refs/tags/v${version}`, 'yellow');
  log(`  6. Commit CHANGELOG: git add CHANGELOG.md && git commit -m "docs: Add v${version} to CHANGELOG"`, 'yellow');
  log(`  7. Create new tag: git tag v${version}`, 'yellow');
  log(`  8. Push: git push origin main v${version}`, 'yellow');
  process.exit(1);
}

// Validate content is meaningful
if (content.length < 50) {
  log(`✗ Content too short (${content.length} bytes, minimum 50)`, 'red');
  log('  Version section appears to be empty or incomplete', 'yellow');
  log('  Please add release notes to CHANGELOG.md before publishing', 'yellow');
  process.exit(1);
}

// Write to output file
try {
  writeFileSync(OUTPUT_PATH, content, 'utf8');
  log(`✓ Wrote release notes to ${OUTPUT_PATH}`, 'green');
} catch (error) {
  log(`✗ Failed to write output file: ${error.message}`, 'red');
  process.exit(1);
}

console.log('');
log('📋 Release notes preview:', 'blue');
console.log('');
console.log('─'.repeat(60));
// Show first 500 chars of content
const preview = content.length > 500 ? content.slice(0, 500) + '\n...(truncated)' : content;
console.log(preview);
console.log('─'.repeat(60));

console.log('');
log('✅ CHANGELOG extraction complete', 'green');
console.log('');

process.exit(0);

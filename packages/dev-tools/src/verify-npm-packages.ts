#!/usr/bin/env tsx

/**
 * Verifies all publishable packages in the workspace are published to npm
 * with the expected version.
 *
 * Usage:
 *   node tools/verify-npm-packages.js
 *   node tools/verify-npm-packages.js --version 0.13.0
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { packageExists } from '../../utils/dist/package-manager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

// Get expected version from CLI or package.json
const expectedVersion = process.argv.includes('--version')
  ? process.argv[process.argv.indexOf('--version') + 1]
  : JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf-8')).version;

// Publishable packages (exclude test-only packages)
const publishablePackages = [
  '@vibe-validate/extractors',
  '@vibe-validate/git',
  '@vibe-validate/config',
  '@vibe-validate/history',
  '@vibe-validate/core',
  '@vibe-validate/cli',
  'vibe-validate'
];

console.log(`🔍 Verifying npm packages for version ${String(expectedVersion)}...\n`);

let allPublished = true;
const results = [];

for (const packageName of publishablePackages) {
  try {
    const exists = packageExists(packageName, expectedVersion);

    if (exists) {
      results.push({ package: packageName, status: 'ok', version: expectedVersion });
      console.log(`✅ ${packageName}@${String(expectedVersion)}`);
    } else {
      results.push({ package: packageName, status: 'missing', expected: expectedVersion });
      console.log(`❌ ${packageName}@${String(expectedVersion)} not found on npm`);
      allPublished = false;
    }
  } catch (error) {
    // Expected failure: package not published or version not found on npm
    // This is the primary check - if npm view fails, package is missing
    results.push({ package: packageName, status: 'missing', expected: expectedVersion });
    console.log(`❌ ${packageName}@${String(expectedVersion)} - NOT PUBLISHED`);
    allPublished = false;
    // Log unexpected errors for debugging
    if (error instanceof Error && error.message.includes('ENOENT')) {
      console.error(`  (npm executable not found)`);
    }
  }
}

console.log('');

if (allPublished) {
  console.log(`✅ All ${String(publishablePackages.length)} packages verified on npm\n`);
  process.exit(0);
} else {
  const missing = results.filter(r => r.status === 'missing');
  const mismatched = results.filter(r => r.status === 'mismatch');

  console.log('❌ Verification failed!\n');

  if (missing.length > 0) {
    console.log(`Missing packages (${String(missing.length)}):`);
    for (const r of missing) console.log(`  - ${r.package}@${String(r.expected)}`);
    console.log('');
  }

  if (mismatched.length > 0) {
    console.log(`Missing packages (${String(mismatched.length)}):`);
    for (const r of mismatched) console.log(`  - ${r.package}@${String(r.expected)} not published to npm`);
    console.log('');
  }

  console.log('Run the missing publish scripts:');
  for (const r of missing) {
    const pkgName = r.package.replace('@vibe-validate/', '').replace('vibe-validate', 'umbrella');
    console.log(`  pnpm publish:${pkgName}`);
  }
  console.log('');

  process.exit(1);
}

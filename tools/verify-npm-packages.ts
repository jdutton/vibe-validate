#!/usr/bin/env tsx

/**
 * Verifies all publishable packages in the workspace are published to npm
 * with the expected version.
 *
 * Usage:
 *   node tools/verify-npm-packages.js
 *   node tools/verify-npm-packages.js --version 0.13.0
 */

import { safeExecSync } from '../packages/utils/dist/safe-exec.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

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

console.log(`🔍 Verifying npm packages for version ${expectedVersion}...\n`);

let allPublished = true;
const results = [];

for (const packageName of publishablePackages) {
  try {
    const npmVersion = safeExecSync('npm', ['view', `${packageName}@${expectedVersion}`, 'version'], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim();

    if (npmVersion === expectedVersion) {
      results.push({ package: packageName, status: 'ok', version: npmVersion });
      console.log(`✅ ${packageName}@${expectedVersion}`);
    } else {
      results.push({ package: packageName, status: 'mismatch', expected: expectedVersion, actual: npmVersion });
      console.log(`❌ ${packageName}: expected ${expectedVersion}, found ${npmVersion}`);
      allPublished = false;
    }
  } catch (_error) {
    results.push({ package: packageName, status: 'missing', expected: expectedVersion });
    console.log(`❌ ${packageName}@${expectedVersion} - NOT PUBLISHED`);
    allPublished = false;
  }
}

console.log('');

if (allPublished) {
  console.log(`✅ All ${publishablePackages.length} packages verified on npm\n`);
  process.exit(0);
} else {
  const missing = results.filter(r => r.status === 'missing');
  const mismatched = results.filter(r => r.status === 'mismatch');

  console.log('❌ Verification failed!\n');

  if (missing.length > 0) {
    console.log(`Missing packages (${missing.length}):`);
    for (const r of missing) console.log(`  - ${r.package}@${r.expected}`);
    console.log('');
  }

  if (mismatched.length > 0) {
    console.log(`Version mismatches (${mismatched.length}):`);
    for (const r of mismatched) console.log(`  - ${r.package}: expected ${r.expected}, found ${r.actual}`);
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

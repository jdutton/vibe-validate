#!/usr/bin/env node
/**
 * Cross-platform script to prepare CLI bin files
 * Replaces Unix-specific cp and chmod commands
 */

import { copyFileSync, chmodSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const binDir = join(__dirname, '../dist/bin');

const sourceFile = join(binDir, 'vibe-validate.js');
const targets = [
  join(binDir, 'vibe-validate'),
  join(binDir, 'vv')
];

// Verify source exists
if (!existsSync(sourceFile)) {
  console.error(`Error: Source file not found: ${sourceFile}`);
  process.exit(1);
}

// Copy source to targets
for (const target of targets) {
  try {
    copyFileSync(sourceFile, target);
    console.log(`✓ Copied ${sourceFile} → ${target}`);

    // Make executable (Unix-like systems only, no-op on Windows)
    try {
      chmodSync(target, 0o755);
    } catch (err) {
      // Ignore chmod errors on Windows
      if (process.platform !== 'win32') {
        throw err;
      }
    }
  } catch (err) {
    console.error(`Error copying ${target}:`, err.message);
    process.exit(1);
  }
}

console.log('✓ CLI bin files prepared successfully');

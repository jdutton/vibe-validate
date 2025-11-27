#!/usr/bin/env node
/**
 * Extractor Migration Tool
 *
 * Migrates legacy extractors to new plugin structure.
 * Usage: node tools/migrate-extractor.js <extractor-name>
 * Example: node tools/migrate-extractor.js eslint
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

async function main() {
  const extractorName = process.argv[2];
  if (!extractorName) {
    console.error('Usage: node tools/migrate-extractor.js <extractor-name>');
    console.error('Example: node tools/migrate-extractor.js eslint');
    process.exit(1);
  }

  console.log(`Migrating ${extractorName} extractor to plugin structure...`);

  const srcFile = path.join(ROOT, 'packages/extractors/src', `${extractorName}-extractor.ts`);
  const testFile = path.join(ROOT, 'packages/extractors/test', `${extractorName}-extractor.test.ts`);
  const pluginDir = path.join(ROOT, 'packages/extractors/src/extractors', extractorName);

  // Check if source files exist
  try {
    await fs.access(srcFile);
  } catch {
    console.error(`Source file not found: ${srcFile}`);
    process.exit(1);
  }

  try {
    await fs.access(testFile);
  } catch {
    console.error(`Test file not found: ${testFile}`);
    process.exit(1);
  }

  // Create plugin directory
  await fs.mkdir(pluginDir, { recursive: true });
  await fs.mkdir(path.join(pluginDir, 'samples'), { recursive: true });

  // Files validated, ready for future implementation
  // FUTURE: Read and process source files when implementing full migration
  // await fs.readFile(srcFile, 'utf-8');
  // await fs.readFile(testFile, 'utf-8');

  console.log('✅ Created plugin directory structure');
  console.log('📂', pluginDir);
  console.log('\nNext steps:');
  console.log('1. Convert source to plugin format (index.ts)');
  console.log('2. Update test imports (index.test.ts)');
  console.log('3. Create README.md and CLAUDE.md');
  console.log('4. Update extractor-registry.ts import');
  console.log('5. Remove old files');
  console.log('\nFiles to process:');
  console.log(`  - ${srcFile} → ${path.join(pluginDir, 'index.ts')}`);
  console.log(`  - ${testFile} → ${path.join(pluginDir, 'index.test.ts')}`);
}

main().catch(console.error);

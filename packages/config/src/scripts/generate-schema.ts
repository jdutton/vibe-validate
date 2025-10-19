#!/usr/bin/env node
/**
 * Generate JSON Schema File
 *
 * Creates vibe-validate.schema.json in the package root for use in YAML configs.
 * This script runs during the build process.
 */

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { vibeValidateJsonSchema } from '../schema-export.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageRoot = join(__dirname, '..', '..');
const schemaPath = join(packageRoot, 'vibe-validate.schema.json');

// Generate and write schema file
writeFileSync(
  schemaPath,
  JSON.stringify(vibeValidateJsonSchema, null, 2),
  'utf-8'
);

console.log('✓ Generated vibe-validate.schema.json');

#!/usr/bin/env node
/**
 * Generate JSON Schema File
 *
 * Creates config.schema.json in the package root for use in YAML configs.
 * This script runs during the build process.
 */

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { vibeValidateJsonSchema } from '../schema-export.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageRoot = join(__dirname, '..', '..');
const schemaPath = join(packageRoot, 'config.schema.json');

// Generate and write schema file
writeFileSync(
  schemaPath,
  JSON.stringify(vibeValidateJsonSchema, null, 2),
  'utf-8'
);

console.log('✓ Generated config.schema.json');

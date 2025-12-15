#!/usr/bin/env node
/**
 * Generate JSON Schema File for Error Extractor Results
 *
 * Creates error-extractor-result.schema.json in the package root for use in
 * validating documentation examples and agent integration code.
 * This script runs during the build process.
 */

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { extractorResultJsonSchema } from '../result-schema-export.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageRoot = join(__dirname, '..', '..');
const schemaPath = join(packageRoot, 'error-extractor-result.schema.json');

// Generate and write schema file
writeFileSync(
  schemaPath,
  JSON.stringify(extractorResultJsonSchema, null, 2),
  'utf-8'
);

console.log('✓ Generated error-extractor-result.schema.json');

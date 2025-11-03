#!/usr/bin/env node
/**
 * Generate JSON Schema File for Run Command Results
 *
 * Creates run-result.schema.json in the package root for use in
 * validating documentation examples and agent integration code.
 * This script runs during the build process.
 */

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runResultJsonSchema } from '../schemas/run-result-schema-export.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageRoot = join(__dirname, '..', '..');
const schemaPath = join(packageRoot, 'run-result.schema.json');

// Generate and write schema file
writeFileSync(
  schemaPath,
  JSON.stringify(runResultJsonSchema, null, 2),
  'utf-8'
);

console.log('✓ Generated run-result.schema.json');

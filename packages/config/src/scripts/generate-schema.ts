#!/usr/bin/env node
/**
 * Generate JSON Schema File
 *
 * Creates config.schema.json in the package root for use in YAML configs, and
 * mirrors it into the setting-up-projects skill, which ships its own copy for
 * adopters. Both are written here so the skill copy cannot silently drift out
 * of date with the schema it claims to document.
 *
 * This script runs during the build process.
 */

import { existsSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { vibeValidateJsonSchema } from '../schema-export.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageRoot = join(__dirname, '..', '..');
const repoRoot = join(packageRoot, '..', '..');

const schemaJson = JSON.stringify(vibeValidateJsonSchema, null, 2);

writeFileSync(join(packageRoot, 'config.schema.json'), schemaJson, 'utf-8');
console.log('✓ Generated config.schema.json');

// Only present in this repository, not in a published/installed package.
const skillSchemaPath = join(repoRoot, 'docs', 'skills', 'setting-up-projects', 'config.schema.json');
if (existsSync(dirname(skillSchemaPath))) {
  writeFileSync(skillSchemaPath, schemaJson, 'utf-8');
  console.log('✓ Mirrored schema to docs/skills/setting-up-projects/');
}

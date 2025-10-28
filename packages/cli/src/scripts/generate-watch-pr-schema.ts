#!/usr/bin/env node
/**
 * Generate JSON Schema for watch-pr command output
 *
 * This script generates a JSON Schema file from the Zod schema defined in
 * watch-pr-schema.ts. The JSON Schema can be used for:
 * - IDE autocomplete/validation for YAML files
 * - Validating watch-pr output in tests
 * - Documentation generation
 */

import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { WatchPRResultSchema } from '../schemas/watch-pr-schema.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Generate JSON Schema
const jsonSchema = zodToJsonSchema(WatchPRResultSchema, {
  name: 'WatchPRResult',
  $refStrategy: 'none', // Inline all definitions for simpler schema
});

// Add metadata
const schemaWithMetadata = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: 'https://github.com/jdutton/vibe-validate/blob/main/packages/cli/watch-pr-result.schema.json',
  title: 'vibe-validate watch-pr Result Schema',
  description: 'JSON Schema for vibe-validate watch-pr command YAML output',
  ...jsonSchema,
};

// Write to file
const outputPath = join(__dirname, '../../watch-pr-result.schema.json');
writeFileSync(outputPath, JSON.stringify(schemaWithMetadata, null, 2));

console.log('✓ Generated watch-pr-result.schema.json');

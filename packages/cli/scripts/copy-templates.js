#!/usr/bin/env node
/**
 * Copy config-templates from monorepo root to CLI package
 *
 * This script runs during build to ensure templates are packaged with the CLI.
 * Templates must be included in the published npm package for `vibe-validate init` to work.
 */

import { cpSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Source: monorepo root config-templates/
const sourceDir = join(__dirname, '../../../config-templates');

// Destination: packages/cli/config-templates/
const destDir = join(__dirname, '../config-templates');

// Verify source exists
if (!existsSync(sourceDir)) {
  console.error(`❌ Source templates directory not found: ${sourceDir}`);
  process.exit(1);
}

// Create destination if it doesn't exist
if (!existsSync(destDir)) {
  mkdirSync(destDir, { recursive: true });
}

// Copy templates
try {
  cpSync(sourceDir, destDir, {
    recursive: true,
    filter: (src) => {
      // Only copy .yaml files and README.md
      const basename = src.split('/').pop();
      return basename.endsWith('.yaml') || basename === 'README.md' || src === sourceDir;
    },
  });
  console.log('✅ Config templates copied successfully');
} catch (error) {
  console.error('❌ Failed to copy templates:', error.message);
  process.exit(1);
}

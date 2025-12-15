#!/usr/bin/env node
/**
 * Generate CLI Reference Documentation
 *
 * This script regenerates docs/skill/resources/cli-reference.md from the actual CLI --help --verbose output.
 * Run this script whenever you modify CLI help text or add new commands.
 *
 * Usage:
 *   node tools/generate-cli-docs.js
 *   pnpm generate-cli-docs
 *
 * Requirements:
 *   - vibe-validate CLI must be built (pnpm build)
 *   - Node.js 20+
 */

import { safeExecSync } from '../packages/utils/dist/safe-exec.js';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..');
const CLI_BIN = join(PROJECT_ROOT, 'packages/cli/dist/bin.js');
const DOCS_FILE = join(PROJECT_ROOT, 'docs/skill/resources/cli-reference.md');

// Colors for output
const colors = {
  green: '\x1b[0;32m',
  yellow: '\x1b[1;33m',
  red: '\x1b[0;31m',
  reset: '\x1b[0m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

// Check if CLI is built
if (!existsSync(CLI_BIN)) {
  log('❌ CLI not built', 'red');
  log('Run: pnpm build');
  process.exit(1);
}

log('📚 Generating CLI reference documentation...', 'yellow');

// Generate CLI help output
let helpOutput;
try {
  helpOutput = safeExecSync('node', [CLI_BIN, '--help', '--verbose'], {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
} catch (err) {
  log('❌ Failed to generate CLI help', 'red');
  console.error(err.message);
  process.exit(1);
}

// Use the entire help output (don't extract after separator)
const cliContent = helpOutput.trim();

// Create header
const header = `# CLI Reference

> **Complete command-line reference for vibe-validate**
>
> **This document is auto-synced with \`vibe-validate --help --verbose\` output**
>
> The content below is the exact output from running \`vibe-validate --help --verbose\`. This ensures perfect accuracy between CLI and documentation.

---
`;

// Combine header and content
const newContent = header + cliContent;

// Verify content was generated
if (!newContent || newContent.length < 500) {
  log('❌ Generated content seems too short', 'red');
  process.exit(1);
}

// Check if content has changed
if (existsSync(DOCS_FILE)) {
  const existingContent = readFileSync(DOCS_FILE, 'utf8');
  if (existingContent === newContent) {
    log('✓ CLI reference is already up-to-date', 'green');
    process.exit(0);
  }
}

// Write new content
writeFileSync(DOCS_FILE, newContent, 'utf8');

const lineCount = newContent.split('\n').length;
log(`✓ Generated docs/skill/resources/cli-reference.md (${lineCount} lines)`, 'green');
log('📋 Remember to commit the updated documentation', 'yellow');

#!/usr/bin/env node
/**
 * Vibe-Validate CLI Entry Point
 *
 * Main executable for the vibe-validate command-line tool.
 */

import { Command } from 'commander';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { validateCommand } from './commands/validate.js';
import { initCommand } from './commands/init.js';
import { preCommitCommand } from './commands/pre-commit.js';
import { stateCommand } from './commands/state.js';
import { syncCheckCommand } from './commands/sync-check.js';
import { cleanupCommand } from './commands/cleanup.js';
import { configCommand } from './commands/config.js';
import { generateWorkflowCommand } from './commands/generate-workflow.js';
import { doctorCommand } from './commands/doctor.js';

// Read version from package.json at runtime
// This approach works with ESM and survives TypeScript compilation
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJsonPath = join(__dirname, '../package.json');

let version = '0.9.2'; // Fallback version
try {
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
  version = packageJson.version;
} catch (_error) {
  // If package.json can't be read (shouldn't happen in production), use fallback
  console.warn('Warning: Could not read package.json version, using fallback');
}

const program = new Command();

program
  .name('vibe-validate')
  .description('Agent-friendly validation framework with git tree hash caching')
  .version(version);

// Register commands
validateCommand(program);            // vibe-validate validate
initCommand(program);                 // vibe-validate init
preCommitCommand(program);            // vibe-validate pre-commit
stateCommand(program);                // vibe-validate state
syncCheckCommand(program);            // vibe-validate sync-check
cleanupCommand(program);              // vibe-validate cleanup
configCommand(program);               // vibe-validate config
generateWorkflowCommand(program);     // vibe-validate generate-workflow
doctorCommand(program);               // vibe-validate doctor

// Parse command line arguments
program.parse();

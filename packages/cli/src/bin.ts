#!/usr/bin/env node
/**
 * Vibe-Validate CLI Entry Point
 *
 * Main executable for the vibe-validate command-line tool.
 */

import { Command } from 'commander';
import { validateCommand } from './commands/validate.js';
import { initCommand } from './commands/init.js';
import { preCommitCommand } from './commands/pre-commit.js';
import { stateCommand } from './commands/state.js';
import { syncCheckCommand } from './commands/sync-check.js';
import { cleanupCommand } from './commands/cleanup.js';
import { configCommand } from './commands/config.js';

const program = new Command();

program
  .name('vibe-validate')
  .description('Agent-friendly validation framework with git tree hash caching')
  .version('0.1.0');

// Register commands
validateCommand(program);       // vibe-validate validate
initCommand(program);            // vibe-validate init
preCommitCommand(program);       // vibe-validate pre-commit
stateCommand(program);           // vibe-validate state
syncCheckCommand(program);       // vibe-validate sync-check
cleanupCommand(program);         // vibe-validate cleanup
configCommand(program);          // vibe-validate config

// Parse command line arguments
program.parse();

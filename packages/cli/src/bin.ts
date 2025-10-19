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
  .version(version)
  .option('--verbose', 'Show detailed output (use with --help for comprehensive help)');

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

// Custom help handler: --help --verbose shows all subcommand options
const args = process.argv;
const hasHelp = args.includes('--help') || args.includes('-h');
const hasVerbose = args.includes('--verbose');

if (hasHelp && hasVerbose) {
  showComprehensiveHelp(program);
  process.exit(0);
}

// Parse command line arguments
program.parse();

/**
 * Show comprehensive help with all subcommand options
 * For AI assistants: Use `vibe-validate --help --verbose`
 */
function showComprehensiveHelp(program: Command): void {
  console.log('vibe-validate - Agent-friendly validation framework with git tree hash caching\n');
  console.log('Commands:\n');

  program.commands.forEach((cmd) => {
    console.log(`  ${cmd.name()} ${cmd.usage()}`);
    console.log(`    ${cmd.description()}`);

    const options = cmd.options.filter(opt => !opt.flags.includes('--help'));
    if (options.length > 0) {
      console.log('    Options:');
      options.forEach((opt) => {
        const flags = opt.flags.padEnd(30);
        console.log(`      ${flags} ${opt.description}`);
      });
    }
    console.log('');
  });

  console.log('Global Options:');
  console.log('  -V, --version                 output the version number');
  console.log('  --verbose                     Show detailed output (use with --help for comprehensive help)');
  console.log('  -h, --help                    display help for command\n');
  console.log('💡 Tip: For specific command help, run: vibe-validate <command> --help');
}

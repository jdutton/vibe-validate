#!/usr/bin/env node
/**
 * Vibe-Validate CLI Entry Point
 *
 * Main executable for the vibe-validate command-line tool.
 */

import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateCommand } from './commands/validate.js';
import { initCommand } from './commands/init.js';
import { preCommitCommand } from './commands/pre-commit.js';
import { stateCommand } from './commands/state.js';
import { syncCheckCommand } from './commands/sync-check.js';
import { cleanupCommand } from './commands/cleanup.js';
import { configCommand } from './commands/config.js';
import { generateWorkflowCommand } from './commands/generate-workflow.js';
import { doctorCommand } from './commands/doctor.js';
import { registerWatchPRCommand } from './commands/watch-pr.js';
import { historyCommand } from './commands/history.js';
import { runCommand } from './commands/run.js';

// Read version from package.json at runtime
// This approach works with ESM and survives TypeScript compilation
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJsonPath = join(__dirname, '../package.json');

let version = '0.9.2'; // Fallback version
try {
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
  version = packageJson.version;
} catch (error) {
  // If package.json can't be read (shouldn't happen in production), use fallback
  const errorMessage = error instanceof Error ? error.message : String(error);
  console.warn(`Warning: Could not read package.json version (${errorMessage}), using fallback`);
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
registerWatchPRCommand(program);      // vibe-validate watch-pr
historyCommand(program);              // vibe-validate history
runCommand(program);                  // vibe-validate run

/**
 * Registry mapping command names to their verbose help loaders
 *
 * Commands can optionally export a `show<CommandName>VerboseHelp()` function.
 * If not present, Commander.js handles --help normally.
 */
type VerboseHelpLoader = () => Promise<() => void>;

const verboseHelpRegistry: Partial<Record<string, VerboseHelpLoader>> = {
  'history': async () => {
    const { showHistoryVerboseHelp } = await import('./commands/history.js');
    return showHistoryVerboseHelp;
  },
  'validate': async () => {
    const { showValidateVerboseHelp } = await import('./commands/validate.js');
    return showValidateVerboseHelp;
  },
  'init': async () => {
    const { showInitVerboseHelp } = await import('./commands/init.js');
    return showInitVerboseHelp;
  },
  'pre-commit': async () => {
    const { showPreCommitVerboseHelp } = await import('./commands/pre-commit.js');
    return showPreCommitVerboseHelp;
  },
  'state': async () => {
    const { showStateVerboseHelp } = await import('./commands/state.js');
    return showStateVerboseHelp;
  },
  'sync-check': async () => {
    const { showSyncCheckVerboseHelp } = await import('./commands/sync-check.js');
    return showSyncCheckVerboseHelp;
  },
  'cleanup': async () => {
    const { showCleanupVerboseHelp } = await import('./commands/cleanup.js');
    return showCleanupVerboseHelp;
  },
  'config': async () => {
    const { showConfigVerboseHelp } = await import('./commands/config.js');
    return showConfigVerboseHelp;
  },
  'generate-workflow': async () => {
    const { showGenerateWorkflowVerboseHelp } = await import('./commands/generate-workflow.js');
    return showGenerateWorkflowVerboseHelp;
  },
  'doctor': async () => {
    const { showDoctorVerboseHelp } = await import('./commands/doctor.js');
    return showDoctorVerboseHelp;
  },
  'watch-pr': async () => {
    const { showWatchPRVerboseHelp } = await import('./commands/watch-pr.js');
    return showWatchPRVerboseHelp;
  },
  'run': async () => {
    const { showRunVerboseHelp } = await import('./commands/run.js');
    return showRunVerboseHelp;
  },
};

/**
 * Handle --help --verbose flag combination
 *
 * Returns true if help was shown and program should exit, false otherwise
 */
async function handleVerboseHelp(args: string[], program: Command): Promise<boolean> {
  const hasHelp = args.includes('--help') || args.includes('-h');
  const hasVerbose = args.includes('--verbose');

  if (!hasHelp || !hasVerbose) {
    return false;
  }

  // Check if a subcommand is specified
  const knownCommands = Object.keys(verboseHelpRegistry);
  const subcommandIndex = args.findIndex(arg => knownCommands.includes(arg));

  if (subcommandIndex === -1) {
    // Root level: show comprehensive CLI reference
    showComprehensiveHelp(program);
    return true;
  }

  // Subcommand level: show detailed docs if available
  const subcommand = args[subcommandIndex];
  const helpLoader = verboseHelpRegistry[subcommand];

  if (helpLoader) {
    const helpFn = await helpLoader();
    helpFn();
    return true;
  }

  // No verbose help available, let Commander.js handle it
  return false;
}

/**
 * Show comprehensive help with all subcommand options
 * For AI assistants: Use `vibe-validate --help --verbose`
 *
 * Outputs in Markdown format for better LLM parsing and perfect docs sync
 */
// eslint-disable-next-line sonarjs/cognitive-complexity -- Complex display logic, documented technical debt
function showComprehensiveHelp(program: Command): void {
  console.log('# vibe-validate CLI Reference\n');
  console.log('> Agent-friendly validation framework with git tree hash caching\n');
  console.log('## Usage\n');
  console.log('```bash');
  console.log('vibe-validate <command> [options]');
  console.log('```\n');
  console.log('## Commands\n');

  // Detailed command descriptions with exit codes, examples, etc.
  const commandDetails: Partial<Record<string, {
    whatItDoes?: string[];
    exitCodes?: Record<number, string>;
    creates?: string[];
    examples?: string[];
    whenToUse?: string;
    errorGuidance?: Record<string, string[]>;
  }>> = {
    validate: {
      whatItDoes: [
        '1. Calculates git tree hash of working directory',
        '2. Checks if hash matches cached state',
        '3. If match: exits immediately (~288ms)',
        '4. If no match: runs validation pipeline (~60-90s)',
        '5. Caches result for next run'
      ],
      exitCodes: {
        0: 'Validation passed (or cached pass)',
        1: 'Validation failed',
        2: 'Configuration error'
      },
      creates: ['Git notes under refs/notes/vibe-validate/runs'],
      examples: [
        'vibe-validate validate              # Use cache if available',
        'vibe-validate validate --force      # Always run validation',
        'vibe-validate validate --check      # Just check if already passed'
      ]
    },
    init: {
      whatItDoes: [
        'Creates vibe-validate.config.yaml in project root',
        'Optionally sets up pre-commit hooks',
        'Optionally creates GitHub Actions workflow',
        'Optionally updates .gitignore'
      ],
      exitCodes: {
        0: 'Configuration created successfully',
        1: 'Failed (config exists without --force, or invalid template)'
      },
      creates: [
        'vibe-validate.config.yaml (always)',
        '.husky/pre-commit (with --setup-hooks)',
        '.github/workflows/validate.yml (with --setup-workflow)',
        'Updates .gitignore (with --fix-gitignore)'
      ],
      examples: [
        'vibe-validate init  # Uses minimal template',
        'vibe-validate init --template typescript-nodejs',
        'vibe-validate init --template typescript-nodejs --setup-workflow --setup-hooks',
        'vibe-validate init --force --template typescript-react  # Overwrite existing'
      ]
    },
    'pre-commit': {
      whatItDoes: [
        '1. Runs sync-check (fails if branch behind origin/main)',
        '2. Runs validate (with caching)',
        '3. Reports git status (warns about unstaged files)'
      ],
      exitCodes: {
        0: 'Sync OK and validation passed',
        1: 'Sync failed OR validation failed'
      },
      whenToUse: 'Run before every commit to ensure code is synced and validated',
      errorGuidance: {
        'sync failed': ['git fetch origin', 'git merge origin/main', 'Resolve conflicts if any', 'vibe-validate pre-commit  # Retry'],
        'validation failed': ['Fix errors shown in output', 'vibe-validate pre-commit  # Retry']
      },
      examples: [
        'vibe-validate pre-commit  # Standard pre-commit workflow',
        'vibe-validate pre-commit --skip-sync  # Skip sync check (not recommended)'
      ]
    },
    state: {
      whatItDoes: [
        'Shows validation pass/fail status',
        'Shows git tree hash (cache key)',
        'Shows timestamp of last validation',
        'Shows error summary (if failed)'
      ],
      exitCodes: {
        0: 'State file found and read successfully',
        1: 'State file not found or invalid'
      },
      whenToUse: 'Debug why validation is cached/not cached, or see errors without re-running',
      examples: [
        'vibe-validate state           # Show current state',
        'vibe-validate state --verbose # Show full error output'
      ]
    },
    'sync-check': {
      whatItDoes: [
        'Checks if current branch is behind remote main',
        'Compares local and remote commit histories',
        'Reports sync status'
      ],
      exitCodes: {
        0: 'Up to date or no remote tracking',
        1: 'Branch is behind (needs merge)',
        2: 'Git command failed'
      },
      errorGuidance: {
        'branch behind (exit 1)': ['git fetch origin', 'git merge origin/main  # or git rebase origin/main', 'Resolve conflicts if any', 'vibe-validate pre-commit  # Retry']
      },
      examples: [
        'vibe-validate sync-check',
        'vibe-validate sync-check --yaml  # YAML output only'
      ]
    },
    cleanup: {
      whatItDoes: [
        '1. Switches to main branch',
        '2. Pulls latest from origin/main',
        '3. Identifies merged branches (via git log)',
        '4. Deletes confirmed-merged branches',
        '5. Reports cleanup summary'
      ],
      exitCodes: {
        0: 'Cleanup successful',
        1: 'Failed (not on deletable branch, git errors)'
      },
      whenToUse: 'After PR merge to clean up local branches',
      examples: [
        'vibe-validate cleanup --dry-run  # Preview',
        'vibe-validate cleanup            # Execute'
      ]
    },
    config: {
      whatItDoes: [
        'Shows resolved configuration',
        'Validates configuration structure',
        'Displays all configuration settings'
      ],
      exitCodes: {
        0: 'Configuration valid',
        1: 'Configuration invalid or not found'
      },
      examples: [
        'vibe-validate config            # Show config',
        'vibe-validate config --validate # Validate only'
      ]
    },
    'generate-workflow': {
      whatItDoes: [
        'Generates .github/workflows/validate.yml from config',
        'Supports matrix mode (multiple Node/OS versions)',
        'Supports non-matrix mode (separate jobs per phase)',
        'Can check if workflow is in sync with config'
      ],
      exitCodes: {
        0: 'Workflow generated (or in sync with --check)',
        1: 'Generation failed (or out of sync with --check)'
      },
      creates: ['.github/workflows/validate.yml'],
      examples: [
        'vibe-validate generate-workflow',
        'vibe-validate generate-workflow --node-versions 20,22 --os ubuntu-latest,macos-latest',
        'vibe-validate generate-workflow --check  # Verify workflow is up to date'
      ]
    },
    doctor: {
      whatItDoes: [
        'Checks Node.js version (20+)',
        'Verifies git repository exists',
        'Checks package manager availability',
        'Validates configuration file',
        'Checks pre-commit hook setup',
        'Verifies GitHub Actions workflow'
      ],
      exitCodes: {
        0: 'All critical checks passed',
        1: 'One or more critical checks failed'
      },
      whenToUse: 'Diagnose setup issues or verify environment before using vibe-validate',
      examples: [
        'vibe-validate doctor         # Run diagnostics',
        'vibe-validate doctor --yaml # YAML output only'
      ]
    },
    'watch-pr': {
      whatItDoes: [
        '1. Detects PR from current branch (or uses provided PR number)',
        '2. Polls CI provider (GitHub Actions) for check status',
        '3. Shows real-time progress of all matrix jobs',
        '4. On failure: fetches logs and extracts vibe-validate state file',
        '5. Provides actionable recovery commands',
        '6. Exits when all checks complete or timeout reached'
      ],
      exitCodes: {
        0: 'All checks passed',
        1: 'One or more checks failed',
        2: 'Timeout reached before completion'
      },
      whenToUse: 'Monitor CI checks in real-time after pushing to PR, especially useful for AI agents',
      examples: [
        'git push origin my-branch',
        'vibe-validate watch-pr              # Auto-detect PR',
        'vibe-validate watch-pr 42           # Watch specific PR',
        'vibe-validate watch-pr --yaml      # YAML output only',
        'vibe-validate watch-pr --fail-fast  # Exit on first failure',
        'vibe-validate watch-pr --timeout 600  # 10 minute timeout'
      ],
      errorGuidance: {
        'check fails': [
          '# View validation result from YAML output',
          'vibe-validate watch-pr 42 --yaml | yq \'.failures[0].validationResult\'',
          '',
          '# Re-run failed check',
          'gh run rerun <run-id> --failed'
        ],
        'no PR found': [
          '# Create PR first',
          'gh pr create',
          '',
          '# Or specify PR number explicitly',
          'vibe-validate watch-pr 42'
        ]
      }
    },
    run: {
      whatItDoes: [
        '1. Executes command in shell subprocess',
        '2. Captures stdout and stderr output',
        '3. Auto-detects format (vitest, jest, tsc, eslint, etc.)',
        '4. Extracts errors using appropriate extractor',
        '5. Outputs structured YAML with error details',
        '6. Passes through exit code from command'
      ],
      exitCodes: {
        0: 'Command succeeded',
        1: 'Command failed (same code as original command)'
      },
      whenToUse: 'Run individual tests or validation steps with LLM-friendly error extraction',
      examples: [
        'vibe-validate run "npx vitest test.ts"           # Single test file',
        'vibe-validate run "npx vitest -t \'test name\'"    # Specific test',
        'vibe-validate run "pnpm --filter @pkg test"    # Package tests',
        'vibe-validate run "npx tsc --noEmit"           # Type check',
        'vibe-validate run "pnpm lint"                  # Lint'
      ]
    }
  };

  for (const cmd of program.commands) {
    const cmdName = cmd.name();
    const details = commandDetails[cmdName];

    console.log(`### \`${cmd.name()}\`\n`);
    console.log(`${cmd.description()}\n`);

    if (details?.whatItDoes) {
      console.log('**What it does:**\n');
      for (const step of details.whatItDoes) console.log(`${step}`);
      console.log('');
    }

    if (details?.exitCodes) {
      console.log('**Exit codes:**\n');
      for (const [code, desc] of Object.entries(details.exitCodes)) {
        console.log(`- \`${code}\` - ${desc}`);
      }
      console.log('');
    }

    if (details?.creates) {
      console.log('**Creates/modifies:**\n');
      for (const file of details.creates) console.log(`- ${file}`);
      console.log('');
    }

    if (details?.whenToUse) {
      console.log(`**When to use:** ${details.whenToUse}\n`);
    }

    const options = cmd.options.filter(opt => !opt.flags.includes('--help'));
    if (options.length > 0) {
      console.log('**Options:**\n');
      for (const opt of options) {
        console.log(`- \`${opt.flags}\` - ${opt.description}`);
      }
      console.log('');
    }

    if (details?.errorGuidance) {
      console.log('**Error recovery:**\n');
      for (const [scenario, steps] of Object.entries(details.errorGuidance)) {
        console.log(`If **${scenario}**:`);
        console.log('```bash');
        for (const step of steps) console.log(step);
        console.log('```\n');
      }
    }

    if (details?.examples) {
      console.log('**Examples:**\n');
      console.log('```bash');
      for (const ex of details.examples) console.log(ex);
      console.log('```\n');
    }

    console.log('---\n');
  }

  console.log('## Global Options\n');
  console.log('- `-V, --version` - Show vibe-validate version');
  console.log('- `-v, --verbose` - Show detailed output (use with --help for this output)');
  console.log('- `-h, --help` - Show help for command\n');

  console.log('## Files\n');
  console.log('| File | Purpose |');
  console.log('|------|---------|');
  console.log('| `vibe-validate.config.yaml` | Configuration (required) |');
  console.log('| `refs/notes/vibe-validate/runs` | Validation state (git notes, auto-created) |');
  console.log('| `.github/workflows/validate.yml` | CI workflow (optional, generated) |');
  console.log('| `.husky/pre-commit` | Pre-commit hook (optional, setup via init) |\n');

  console.log('## Common Workflows\n');
  console.log('### First-time setup\n');
  console.log('```bash');
  console.log('vibe-validate init --template typescript-nodejs --setup-workflow');
  console.log('git add vibe-validate.config.yaml .github/workflows/validate.yml');
  console.log('git commit -m "feat: add vibe-validate"');
  console.log('```\n');

  console.log('### Before every commit (recommended)\n');
  console.log('```bash');
  console.log('vibe-validate pre-commit');
  console.log('# If fails: fix errors and retry');
  console.log('```\n');

  console.log('### After PR merge\n');
  console.log('```bash');
  console.log('vibe-validate cleanup');
  console.log('# Cleans up merged branches');
  console.log('```\n');

  console.log('### Check validation state\n');
  console.log('```bash');
  console.log('vibe-validate state --verbose');
  console.log('# Debug why validation failed');
  console.log('```\n');

  console.log('### Force re-validation\n');
  console.log('```bash');
  console.log('vibe-validate validate --force');
  console.log('# Bypass cache, always run');
  console.log('```\n');

  console.log('## Exit Codes\n');
  console.log('| Code | Meaning |');
  console.log('|------|---------|');
  console.log('| `0` | Success |');
  console.log('| `1` | Failure (validation failed, sync check failed, invalid config) |');
  console.log('| `2` | Error (git command failed, file system error) |\n');

  console.log('## Caching\n');
  console.log('- **Cache key**: Git tree hash of working directory (includes untracked files)');
  console.log('- **Cache hit**: Validation skipped (~288ms)');
  console.log('- **Cache miss**: Full validation runs (~60-90s)');
  console.log('- **Invalidation**: Any file change (tracked or untracked)\n');

  console.log('---\n');
  console.log('For more details: https://github.com/jdutton/vibe-validate');
}

// Custom help handler: --help --verbose shows detailed documentation
const didHandleVerboseHelp = await handleVerboseHelp(process.argv, program);
if (didHandleVerboseHelp) {
  process.exit(0);
}

// Parse command line arguments
program.parse();

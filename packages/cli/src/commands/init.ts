/**
 * Init Command
 *
 * Interactive setup wizard for vibe-validate configuration.
 */

import type { Command } from 'commander';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import chalk from 'chalk';
import { configExists } from '../utils/config-loader.js';
import { GIT_DEFAULTS } from '@vibe-validate/config';

export function initCommand(program: Command): void {
  program
    .command('init')
    .description('Initialize vibe-validate configuration')
    .option('-p, --preset <preset>', 'Use preset (typescript-library|typescript-nodejs|typescript-react)')
    .option('-f, --force', 'Overwrite existing configuration')
    .action(async (options) => {
      try {
        const cwd = process.cwd();

        // Check if config already exists
        if (configExists(cwd) && !options.force) {
          console.error(chalk.red('❌ Configuration file already exists'));
          console.error(chalk.gray('   Use --force to overwrite'));
          process.exit(1);
        }

        const preset = options.preset || 'typescript-library';

        // Validate preset
        const validPresets = ['typescript-library', 'typescript-nodejs', 'typescript-react'];
        if (!validPresets.includes(preset)) {
          console.error(chalk.red(`❌ Invalid preset: ${preset}`));
          console.error(chalk.gray(`   Valid presets: ${validPresets.join(', ')}`));
          process.exit(1);
        }

        // Detect git configuration
        const gitConfig = detectGitConfig();

        if (gitConfig.detected) {
          console.log(chalk.blue('🔍 Auto-detected git configuration:'));
          console.log(chalk.gray(`   Main branch: ${gitConfig.mainBranch}`));
          console.log(chalk.gray(`   Remote: ${gitConfig.remoteOrigin}`));
        } else {
          console.log(chalk.gray('ℹ️  Using default git configuration (main, origin)'));
        }

        // Generate config file content
        const configContent = generateConfig(preset, gitConfig);
        const configPath = join(cwd, 'vibe-validate.config.ts');

        // Write config file
        writeFileSync(configPath, configContent, 'utf-8');

        console.log(chalk.green('✅ Configuration file created successfully'));
        console.log(chalk.blue(`📋 Created: ${configPath}`));
        console.log(chalk.gray(`   Preset: ${preset}`));
        console.log();
        console.log(chalk.yellow('Next steps:'));
        console.log(chalk.gray('  1. Review and customize vibe-validate.config.ts'));
        console.log(chalk.gray('  2. Run: vibe-validate validate'));
        console.log(chalk.gray('  3. Add to package.json scripts:'));
        console.log(chalk.gray('     "validate": "vibe-validate validate"'));
        console.log(chalk.gray('     "pre-commit": "vibe-validate pre-commit"'));

        process.exit(0);
      } catch (error) {
        console.error(chalk.red('❌ Failed to initialize configuration:'), error);
        process.exit(1);
      }
    });
}

/**
 * Detect git configuration from repository
 */
interface DetectedGitConfig {
  mainBranch: string;
  remoteOrigin: string;
  detected: boolean;
}

function detectGitConfig(): DetectedGitConfig {
  const defaults = {
    mainBranch: GIT_DEFAULTS.MAIN_BRANCH,
    remoteOrigin: GIT_DEFAULTS.REMOTE_ORIGIN,
    detected: false,
  };

  try {
    // Check if we're in a git repository
    execSync('git rev-parse --git-dir', { stdio: 'pipe' });
  } catch {
    // Not a git repository - use defaults
    return defaults;
  }

  let mainBranch: string = GIT_DEFAULTS.MAIN_BRANCH;
  let remoteOrigin: string = GIT_DEFAULTS.REMOTE_ORIGIN;
  let detected = false;

  // Try to detect main branch from remote HEAD
  try {
    // First, get list of remotes
    const remotesOutput = execSync('git remote', { encoding: 'utf8', stdio: 'pipe' }).trim();
    const remotes = remotesOutput.split('\n').filter(Boolean);

    if (remotes.length > 0) {
      // Prefer 'upstream' if it exists (forked repo workflow), otherwise use first remote
      if (remotes.includes('upstream')) {
        remoteOrigin = 'upstream';
      } else if (remotes.includes('origin')) {
        remoteOrigin = 'origin';
      } else {
        remoteOrigin = remotes[0]; // Use first available remote
      }

      // Try to detect main branch from remote HEAD
      try {
        const headRef = execSync(`git symbolic-ref refs/remotes/${remoteOrigin}/HEAD`, {
          encoding: 'utf8',
          stdio: 'pipe',
        }).trim();
        mainBranch = headRef.replace(`refs/remotes/${remoteOrigin}/`, '');
        detected = true;
      } catch {
        // Remote HEAD not set, try to detect from common branch names
        try {
          const branches = execSync(`git ls-remote --heads ${remoteOrigin}`, {
            encoding: 'utf8',
            stdio: 'pipe',
          }).trim();

          // Check for common main branch names in order of preference
          if (branches.includes('refs/heads/main')) {
            mainBranch = 'main';
            detected = true;
          } else if (branches.includes('refs/heads/master')) {
            mainBranch = 'master';
            detected = true;
          } else if (branches.includes('refs/heads/develop')) {
            mainBranch = 'develop';
            detected = true;
          }
        } catch {
          // Failed to list remote branches - use defaults
        }
      }
    }
  } catch {
    // Failed to detect - use defaults
  }

  return {
    mainBranch,
    remoteOrigin,
    detected,
  };
}

/**
 * Generate configuration content based on preset
 */
function generateConfig(preset: string, gitConfig: DetectedGitConfig): string {
  const configs: Record<string, string> = {
    'typescript-library': `import { defineConfig } from '@vibe-validate/config';

export default defineConfig({
  // Use TypeScript library preset as base
  extends: 'typescript-library',

  validation: {
    phases: [
      // Phase 1: Fast Pre-Qualification (parallel)
      {
        name: 'Pre-Qualification',
        parallel: true,
        steps: [
          {
            name: 'TypeScript Type Check',
            command: 'tsc --noEmit',
            description: 'Type-check TypeScript files',
          },
          {
            name: 'ESLint',
            command: 'eslint src/',
            description: 'Lint source code',
          },
        ],
      },

      // Phase 2: Unit Tests
      {
        name: 'Testing',
        parallel: false,
        steps: [
          {
            name: 'Unit Tests',
            command: 'npm test',
            description: 'Run unit tests with coverage',
          },
        ],
      },

      // Phase 3: Build Verification
      {
        name: 'Build',
        parallel: false,
        steps: [
          {
            name: 'Build Package',
            command: 'npm run build',
            description: 'Build TypeScript to JavaScript',
          },
        ],
      },
    ],

    // Use git tree hash caching for maximum performance
    caching: {
      strategy: 'git-tree-hash',
      enabled: true,
    },

    // Fail fast on first error
    failFast: true,
  },

  // Git integration settings
  git: {
    mainBranch: '${gitConfig.mainBranch}',
    remoteOrigin: '${gitConfig.remoteOrigin}',
    autoSync: false, // Never auto-merge - safety first
  },

  // Output configuration
  output: {
    format: 'auto', // Auto-detect agent vs human context
  },
});
`,

    'typescript-nodejs': `import { defineConfig } from '@vibe-validate/config';

export default defineConfig({
  // Use TypeScript Node.js preset as base
  extends: 'typescript-nodejs',

  validation: {
    phases: [
      // Phase 1: Fast Pre-Qualification (parallel)
      {
        name: 'Pre-Qualification',
        parallel: true,
        steps: [
          {
            name: 'TypeScript Type Check',
            command: 'tsc --noEmit',
            description: 'Type-check TypeScript files',
          },
          {
            name: 'ESLint',
            command: 'eslint src/',
            description: 'Lint source code',
          },
        ],
      },

      // Phase 2: Unit Tests
      {
        name: 'Testing',
        parallel: false,
        steps: [
          {
            name: 'Unit Tests',
            command: 'npm test',
            description: 'Run unit tests with coverage',
          },
        ],
      },

      // Phase 3: Build Verification
      {
        name: 'Build',
        parallel: false,
        steps: [
          {
            name: 'Build Application',
            command: 'npm run build',
            description: 'Build TypeScript to JavaScript',
          },
        ],
      },
    ],

    // Use git tree hash caching for maximum performance
    caching: {
      strategy: 'git-tree-hash',
      enabled: true,
    },

    // Fail fast on first error
    failFast: true,
  },

  // Git integration settings
  git: {
    mainBranch: '${gitConfig.mainBranch}',
    remoteOrigin: '${gitConfig.remoteOrigin}',
    autoSync: false, // Never auto-merge - safety first
  },

  // Output configuration
  output: {
    format: 'auto', // Auto-detect agent vs human context
  },
});
`,

    'typescript-react': `import { defineConfig } from '@vibe-validate/config';

export default defineConfig({
  // Use TypeScript React preset as base
  extends: 'typescript-react',

  validation: {
    phases: [
      // Phase 1: Fast Pre-Qualification (parallel)
      {
        name: 'Pre-Qualification',
        parallel: true,
        steps: [
          {
            name: 'TypeScript Type Check',
            command: 'tsc --noEmit',
            description: 'Type-check TypeScript and React files',
          },
          {
            name: 'ESLint',
            command: 'eslint src/',
            description: 'Lint source code with React rules',
          },
        ],
      },

      // Phase 2: Unit Tests
      {
        name: 'Testing',
        parallel: false,
        steps: [
          {
            name: 'Unit Tests',
            command: 'npm test',
            description: 'Run unit tests with coverage',
          },
        ],
      },

      // Phase 3: Build Verification
      {
        name: 'Build',
        parallel: false,
        steps: [
          {
            name: 'Build Application',
            command: 'npm run build',
            description: 'Build React application for production',
          },
        ],
      },
    ],

    // Use git tree hash caching for maximum performance
    caching: {
      strategy: 'git-tree-hash',
      enabled: true,
    },

    // Fail fast on first error
    failFast: true,
  },

  // Git integration settings
  git: {
    mainBranch: '${gitConfig.mainBranch}',
    remoteOrigin: '${gitConfig.remoteOrigin}',
    autoSync: false, // Never auto-merge - safety first
  },

  // Output configuration
  output: {
    format: 'auto', // Auto-detect agent vs human context
  },
});
`,
  };

  return configs[preset] || configs['typescript-library'];
}

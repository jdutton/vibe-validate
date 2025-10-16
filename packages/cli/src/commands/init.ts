/**
 * Init Command
 *
 * Interactive setup wizard for vibe-validate configuration.
 */

import type { Command } from 'commander';
import { writeFileSync } from 'fs';
import { join } from 'path';
import chalk from 'chalk';
import { configExists } from '../utils/config-loader.js';

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

        // Generate config file content
        const configContent = generateConfig(preset);
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
 * Generate configuration content based on preset
 */
function generateConfig(preset: string): string {
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
    mainBranch: 'main',
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
    mainBranch: 'main',
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
    mainBranch: 'main',
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

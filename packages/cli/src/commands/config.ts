/**
 * Config Command
 *
 * Show or validate vibe-validate configuration.
 */

import type { VibeValidateConfig } from '@vibe-validate/config';
import chalk from 'chalk';
import type { Command } from 'commander';

import { getCommandName } from '../utils/command-name.js';
import { displayConfigErrors } from '../utils/config-error-reporter.js';
import { loadConfigWithErrors, findConfigPath } from '../utils/config-loader.js';

/**
 * Load and validate configuration, exiting on error
 * @returns Config file path and loaded configuration
 */
async function loadAndValidateConfig(): Promise<{ configPath: string; config: VibeValidateConfig }> {
  // Find config file
  const configPath = findConfigPath();
  if (!configPath) {
    const cmd = getCommandName();
    console.error(chalk.red('❌ No configuration file found'));
    console.error(chalk.gray(`   Run: ${cmd} init`));
    process.exit(1);
  }

  // Load and validate config with detailed error reporting
  const result = await loadConfigWithErrors();

  // Show detailed validation errors if config is invalid
  if (!result.config && result.errors) {
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- Need to filter empty strings, not just null/undefined
    const fileName = result.filePath?.split('/').pop() || 'vibe-validate.config.yaml';
    displayConfigErrors({ fileName, errors: result.errors });
    process.exit(1);
  }

  const config = result.config;
  if (!config) {
    console.error(chalk.red('❌ Configuration is invalid'));
    process.exit(1);
  }

  return { configPath, config };
}

export function configCommand(program: Command): void {
  program
    .command('config')
    .description('Show or validate vibe-validate configuration')
    .option('--validate', 'Validate configuration only (exit 0 if valid, 1 if invalid)')
    .option('-v, --verbose', 'Show detailed configuration with explanations')
    .action(async (options) => {
      try {
        const { configPath, config } = await loadAndValidateConfig();

        // If validate-only mode, exit here
        if (options.validate) {
          console.log(chalk.green('✅ Configuration is valid'));
          process.exit(0);
        }

        // Output YAML format (always)
        if (options.verbose) {
          // Verbose mode: show with colors and explanations
          displayVerboseConfig(config, configPath);
        } else {
          // Minimal mode: just the YAML
          displayYamlConfig(config);
        }

        process.exit(0);
      } catch (error) {
        // In tests, process.exit() throws an error - rethrow it so Commander can handle it
        if (error instanceof Error && error.message.startsWith('process.exit(')) {
          throw error;
        }
        console.error(chalk.red('❌ Failed to load configuration:'), error instanceof Error ? error.message : error);
        if (error instanceof Error && error.stack) {
          console.error(chalk.gray('Stack trace:'));
          console.error(chalk.gray(error.stack));
        }
        console.error(chalk.red('❌ Configuration is invalid'));
        process.exit(1);
      }
    });
}

/**
 * Display configuration in verbose format with colors and explanations
 */
function displayVerboseConfig(config: VibeValidateConfig, configPath: string): void {
  // First show YAML
  displayYamlConfig(config);

  // Then add colored summary
  console.log();
  console.log(chalk.gray('─'.repeat(50)));
  console.log(chalk.blue('⚙️  Vibe-Validate Configuration'));
  console.log(chalk.gray('─'.repeat(50)));
  console.log(chalk.gray(`Config file: ${configPath}`));
  console.log();

  // Validation settings
  if (config.validation) {
    console.log(chalk.blue('Validation:'));

    if (config.validation.phases) {
      console.log(chalk.gray(`  Phases: ${config.validation.phases.length}`));
      let index = 0;
      for (const phase of config.validation.phases) {
        const parallelIcon = phase.parallel ? '⚡' : '→';
        console.log(chalk.gray(`    ${index + 1}. ${parallelIcon} ${phase.name} (${phase.steps?.length ?? 0} steps)`));
        index++;
      }
    }

    console.log();
  }

  // Git settings
  if (config.git) {
    console.log(chalk.blue('Git:'));
    console.log(chalk.gray(`  Main Branch: ${config.git.mainBranch ?? 'main'}`));
    console.log(chalk.gray(`  Auto Sync: ${config.git.autoSync ? 'enabled' : 'disabled'}`));
    console.log();
  }

  console.log(chalk.gray('─'.repeat(50)));
  console.log(chalk.green('✅ Configuration is valid'));
}

/**
 * Display configuration in YAML format (simplified)
 */
function displayYamlConfig(config: VibeValidateConfig): void {
  // Simple YAML-like output
  console.log('validation:');

  if (config.validation?.phases) {
    console.log('  phases:');
    for (const phase of config.validation.phases) {
      console.log(`    - name: ${phase.name}`);
      console.log(`      parallel: ${phase.parallel}`);
      console.log(`      steps: ${phase.steps?.length ?? 0}`);
    }
  }

  if (config.git) {
    console.log('git:');
    console.log(`  mainBranch: ${config.git.mainBranch ?? 'main'}`);
    console.log(`  autoSync: ${config.git.autoSync ?? false}`);
  }

  // Output config removed - state files are always YAML
}

/**
 * Show verbose help with detailed documentation
 */
export function showConfigVerboseHelp(): void {
  console.log(`# config Command Reference

> Show or validate vibe-validate configuration

## Overview

The \`config\` command displays your resolved vibe-validate configuration and validates its structure. It helps you verify that your configuration file is correctly formatted and contains all required fields.

## How It Works

1. Locates vibe-validate.config.yaml in the current directory
2. Loads and parses the YAML configuration
3. Validates against the vibe-validate schema
4. Displays the configuration in YAML format
5. Optionally shows verbose details with explanations

## Options

- \`--validate\` - Validate configuration only (exit 0 if valid, 1 if invalid)
- \`-v, --verbose\` - Show detailed configuration with colored explanations

## Exit Codes

- \`0\` - Configuration valid
- \`1\` - Configuration invalid or not found

## Examples

\`\`\`bash
# Show configuration
vibe-validate config

# Validate only (no output)
vibe-validate config --validate

# Show with verbose explanations
vibe-validate config --verbose
\`\`\`

## Common Workflows

### Verify configuration after editing

\`\`\`bash
# Edit config
vim vibe-validate.config.yaml

# Validate syntax
vibe-validate config --validate

# View resolved configuration
vibe-validate config --verbose
\`\`\`

### Debug validation issues

\`\`\`bash
# Check if config is loaded correctly
vibe-validate config

# Verify phase and step counts
vibe-validate config --verbose
\`\`\`

## Error Recovery

**If config is invalid:**
1. Check YAML syntax (indentation, quotes)
2. Verify required fields exist (validation.phases)
3. See configuration docs: https://github.com/jdutton/vibe-validate/blob/main/docs/configuration-reference.md
4. Use JSON Schema for IDE validation: https://raw.githubusercontent.com/jdutton/vibe-validate/main/packages/config/config.schema.json

**If config is not found:**
\`\`\`bash
# Initialize with template
vibe-validate init
\`\`\`
`);
}

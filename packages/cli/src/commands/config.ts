/**
 * Config Command
 *
 * Show or validate vibe-validate configuration.
 */

import type { Command } from 'commander';
import { loadConfig, findConfigPath } from '../utils/config-loader.js';
import type { VibeValidateConfig } from '@vibe-validate/config';
import chalk from 'chalk';

export function configCommand(program: Command): void {
  program
    .command('config')
    .description('Show or validate vibe-validate configuration')
    .option('--validate', 'Validate configuration only (exit 0 if valid, 1 if invalid)')
    .option('-v, --verbose', 'Show detailed configuration with explanations')
    .action(async (options) => {
      try {
        // Find config file
        const configPath = findConfigPath();
        if (!configPath) {
          console.error(chalk.red('❌ No configuration file found'));
          console.error(chalk.gray('   Run: vibe-validate init'));
          process.exit(1);
        }

        // Load and validate config
        const config = await loadConfig();
        if (!config) {
          console.error(chalk.red('❌ Configuration is invalid'));
          process.exit(1);
        }

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
      config.validation.phases.forEach((phase, index: number) => {
        const parallelIcon = phase.parallel ? '⚡' : '→';
        console.log(chalk.gray(`    ${index + 1}. ${parallelIcon} ${phase.name} (${phase.steps?.length || 0} steps)`));
      });
    }

    console.log();
  }

  // Git settings
  if (config.git) {
    console.log(chalk.blue('Git:'));
    console.log(chalk.gray(`  Main Branch: ${config.git.mainBranch || 'main'}`));
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
    config.validation.phases.forEach((phase) => {
      console.log(`    - name: ${phase.name}`);
      console.log(`      parallel: ${phase.parallel}`);
      console.log(`      steps: ${phase.steps?.length || 0}`);
    });
  }

  if (config.git) {
    console.log('git:');
    console.log(`  mainBranch: ${config.git.mainBranch || 'main'}`);
    console.log(`  autoSync: ${config.git.autoSync || false}`);
  }

  // Output config removed - state files are always YAML
}

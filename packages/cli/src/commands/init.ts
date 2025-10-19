/**
 * Init Command
 *
 * Interactive setup wizard for vibe-validate configuration.
 */

import type { Command } from 'commander';
import { writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { dump as stringifyYaml } from 'js-yaml';
import chalk from 'chalk';
import { configExists } from '../utils/config-loader.js';
import { detectGitConfig, type DetectedGitConfig } from '../utils/git-detection.js';
import { GitignoreSetupCheck } from '../utils/setup-checks/gitignore-check.js';
import { HooksSetupCheck } from '../utils/setup-checks/hooks-check.js';
import { WorkflowSetupCheck } from '../utils/setup-checks/workflow-check.js';
import type { SetupCheck } from '../utils/setup-engine.js';

/**
 * Options for the init command
 */
interface InitOptions {
  preset?: string;
  force?: boolean;
  dryRun?: boolean;
  setupHooks?: boolean;
  setupWorkflow?: boolean;
  fixGitignore?: boolean;
  migrate?: boolean;
}

/**
 * Setup operation definition
 */
interface SetupOperation {
  name: string;
  check: SetupCheck;
  enabled: boolean;
}

export function initCommand(program: Command): void {
  program
    .command('init')
    .description('Initialize vibe-validate configuration')
    .option('-p, --preset <preset>', 'Use preset (typescript-library|typescript-nodejs|typescript-react)')
    .option('-f, --force', 'Overwrite existing configuration')
    .option('--dry-run', 'Preview changes without writing files')
    .option('--setup-hooks', 'Install pre-commit hook')
    .option('--setup-workflow', 'Create GitHub Actions workflow')
    .option('--fix-gitignore', 'Add state file to .gitignore')
    .option('--migrate', 'Migrate .mjs config to .yaml format')
    .action(async (options) => {
      try {
        const cwd = process.cwd();
        const isDryRun = options.dryRun || false;

        // Handle migration
        if (options.migrate) {
          await handleMigration(cwd, options, isDryRun);
          return;
        }

        // Check if this is a focused operation
        const isFocusedOperation = options.setupHooks || options.setupWorkflow || options.fixGitignore;

        // Handle focused operations
        if (isFocusedOperation) {
          await handleFocusedOperations(cwd, options, isDryRun);
          return;
        }

        // Handle config initialization
        await handleConfigInitialization(cwd, options, isDryRun);

      } catch (error) {
        console.error(chalk.red('❌ Failed to initialize configuration:'), error);
        process.exit(1);
      }
    });
}

/**
 * Handle focused operations (--setup-hooks, --setup-workflow, --fix-gitignore)
 *
 * Executes specific setup tasks independently without creating config files.
 * All operations are idempotent and can be safely run multiple times.
 *
 * @param cwd - Current working directory
 * @param options - Init command options
 * @param isDryRun - Preview mode (no file modifications)
 * @throws Error if setup check fails
 */
async function handleFocusedOperations(cwd: string, options: InitOptions, isDryRun: boolean): Promise<void> {
  const fixOptions = { cwd, dryRun: isDryRun, force: options.force };
  const operations: SetupOperation[] = [];

  // Setup gitignore check
  if (options.fixGitignore) {
    operations.push({
      name: 'Gitignore',
      check: new GitignoreSetupCheck(),
      enabled: true,
    });
  }

  // Setup hooks check
  if (options.setupHooks) {
    operations.push({
      name: 'Pre-commit hook',
      check: new HooksSetupCheck(),
      enabled: true,
    });
  }

  // Setup workflow check
  if (options.setupWorkflow) {
    operations.push({
      name: 'GitHub Actions workflow',
      check: new WorkflowSetupCheck(),
      enabled: true,
    });
  }

  // Execute operations
  for (const operation of operations) {
    if (!operation.enabled) continue;

    if (isDryRun) {
      // Preview mode
      const preview = await operation.check.preview(fixOptions);
      console.log(chalk.blue(`\n🔍 ${operation.name} (dry-run):`));
      console.log(chalk.gray(`   ${preview.description}`));

      if (preview.changes && preview.changes.length > 0) {
        console.log(chalk.yellow('   Would create:'));
        for (const change of preview.changes) {
          console.log(chalk.gray(`   - ${change.file} (${change.action})`));
          if (change.content && change.content.length < 500) {
            console.log(chalk.gray('\n' + change.content));
          }
        }
      }
    } else {
      // Fix mode
      const result = await operation.check.fix(fixOptions);
      if (result.success) {
        if (result.filesChanged.length > 0) {
          console.log(chalk.green(`✅ ${operation.name}: ${result.message}`));
        } else {
          console.log(chalk.gray(`ℹ️  ${operation.name}: ${result.message}`));
        }
      } else {
        console.error(chalk.red(`❌ ${operation.name}: ${result.message}`));
      }
    }
  }

  if (isDryRun) {
    console.log(chalk.yellow('\n💡 Run without --dry-run to apply changes'));
  }

  process.exit(0);
}

/**
 * Handle config file initialization
 *
 * Creates a new vibe-validate configuration file using the specified preset.
 * Auto-detects git configuration and generates appropriate defaults.
 *
 * @param cwd - Current working directory
 * @param options - Init command options
 * @param isDryRun - Preview mode (no file modifications)
 * @throws Error if config already exists (unless force is true)
 */
async function handleConfigInitialization(cwd: string, options: InitOptions, isDryRun: boolean): Promise<void> {
  // Check if config already exists
  if (configExists(cwd) && !options.force && !isDryRun) {
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

  if (!isDryRun) {
    if (gitConfig.detected) {
      console.log(chalk.blue('🔍 Auto-detected git configuration:'));
      console.log(chalk.gray(`   Main branch: ${gitConfig.mainBranch}`));
      console.log(chalk.gray(`   Remote: ${gitConfig.remoteOrigin}`));
    } else {
      console.log(chalk.gray('ℹ️  Using default git configuration (main, origin)'));
    }
  }

  // Generate YAML config file content
  const configContent = generateYamlConfig(preset, gitConfig);
  const configPath = join(cwd, 'vibe-validate.config.yaml');

  if (isDryRun) {
    // Preview mode - show what would be created
    console.log(chalk.blue('🔍 Configuration preview (dry-run):'));
    console.log(chalk.yellow('   Would create:'));
    console.log(chalk.gray(`   - ${configPath}`));
    console.log(chalk.gray(`   - Preset: ${preset}`));
    console.log();
    console.log(chalk.yellow('💡 Run without --dry-run to create configuration'));
    process.exit(0);
  }

  // Write config file
  writeFileSync(configPath, configContent, 'utf-8');

  console.log(chalk.green('✅ Configuration file created successfully'));
  console.log(chalk.blue(`📋 Created: ${configPath}`));
  console.log(chalk.gray(`   Preset: ${preset}`));
  console.log();
  console.log(chalk.yellow('Next steps:'));
  console.log(chalk.gray('  1. Review and customize vibe-validate.config.yaml'));
  console.log(chalk.gray('  2. Run: vibe-validate validate'));
  console.log(chalk.gray('  3. Add to package.json scripts:'));
  console.log(chalk.gray('     "validate": "vibe-validate validate"'));
  console.log(chalk.gray('     "pre-commit": "vibe-validate pre-commit"'));

  process.exit(0);
}

/**
 * Generate YAML configuration content based on preset
 *
 * Creates YAML configuration file content with the specified preset
 * and git configuration values.
 *
 * @param preset - Preset name (typescript-library, typescript-nodejs, typescript-react)
 * @param gitConfig - Detected git configuration
 * @returns YAML configuration file content
 */
function generateYamlConfig(preset: string, gitConfig: DetectedGitConfig): string {
  const baseConfig = {
    // JSON Schema for IDE validation
    $schema: 'https://raw.githubusercontent.com/jdutton/vibe-validate/main/packages/config/vibe-validate.schema.json',

    // Use preset as base configuration
    extends: preset,

    // Git integration settings
    git: {
      mainBranch: gitConfig.mainBranch,
      remoteOrigin: gitConfig.remoteOrigin,
      autoSync: false, // Never auto-merge - safety first
    },

    // Validation configuration (from preset)
    validation: {
      caching: {
        strategy: 'git-tree-hash',
        enabled: true,
      },
      failFast: true,
    },
  };

  return stringifyYaml(baseConfig, {
    indent: 2,
    lineWidth: 100,
    noRefs: true,
  });
}

/**
 * Handle migration from .mjs to .yaml config format
 *
 * Loads the existing .mjs configuration, converts it to YAML format,
 * and writes it to vibe-validate.config.yaml.
 *
 * @param cwd - Current working directory
 * @param options - Init command options
 * @param isDryRun - Preview mode (no file modifications)
 * @throws Error if .mjs config doesn't exist or .yaml already exists (without --force)
 */
async function handleMigration(cwd: string, options: InitOptions, isDryRun: boolean): Promise<void> {
  const mjsPath = join(cwd, 'vibe-validate.config.mjs');
  const yamlPath = join(cwd, 'vibe-validate.config.yaml');

  // Check if .mjs config exists
  if (!existsSync(mjsPath)) {
    console.error(chalk.red('❌ No .mjs config found to migrate'));
    console.error(chalk.gray('   Expected: vibe-validate.config.mjs'));
    process.exit(1);
  }

  // Check if .yaml config already exists (unless --force)
  if (existsSync(yamlPath) && !options.force && !isDryRun) {
    console.error(chalk.red('❌ YAML config already exists'));
    console.error(chalk.gray('   Use --force to overwrite'));
    process.exit(1);
  }

  // Load the .mjs config
  const fileUrl = pathToFileURL(mjsPath).href;
  const module = await import(fileUrl);
  const config = module.default || module;

  // Convert to YAML
  const yamlContent = stringifyYaml(config, {
    indent: 2,
    lineWidth: 100,
    noRefs: true,
  });

  if (isDryRun) {
    // Preview mode
    console.log(chalk.blue('🔍 Migration preview (dry-run):'));
    console.log(chalk.yellow('   Would create:'));
    console.log(chalk.gray(`   - ${yamlPath}`));
    console.log();
    console.log(chalk.gray('Preview of YAML content:'));
    console.log(chalk.gray('─'.repeat(60)));
    console.log(yamlContent);
    console.log(chalk.gray('─'.repeat(60)));
    console.log();
    console.log(chalk.yellow('💡 Run without --dry-run to apply migration'));
    console.log(chalk.gray('   Original .mjs file will be preserved (you can delete it manually)'));
    process.exit(0);
  }

  // Write YAML config
  writeFileSync(yamlPath, yamlContent, 'utf-8');

  console.log(chalk.green('✅ Migration completed successfully'));
  console.log(chalk.blue(`📋 Created: ${yamlPath}`));
  console.log();
  console.log(chalk.yellow('Next steps:'));
  console.log(chalk.gray('  1. Review vibe-validate.config.yaml'));
  console.log(chalk.gray('  2. Test with: vibe-validate validate'));
  console.log(chalk.gray(`  3. Delete old config: rm ${mjsPath}`));
  console.log(chalk.gray('  4. Commit the new YAML config'));

  process.exit(0);
}


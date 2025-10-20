/**
 * Init Command
 *
 * Interactive setup wizard for vibe-validate configuration.
 */

import type { Command } from 'commander';
import { writeFileSync, existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { stringify as stringifyYaml, parse as parseYaml } from 'yaml';
import chalk from 'chalk';
import { configExists } from '../utils/config-loader.js';
import { detectGitConfig, type DetectedGitConfig } from '../utils/git-detection.js';
import { GitignoreSetupCheck } from '../utils/setup-checks/gitignore-check.js';
import { HooksSetupCheck } from '../utils/setup-checks/hooks-check.js';
import { WorkflowSetupCheck } from '../utils/setup-checks/workflow-check.js';
import type { SetupCheck } from '../utils/setup-engine.js';
import { discoverTemplates } from '../utils/template-discovery.js';

/**
 * Options for the init command
 */
interface InitOptions {
  template?: string;
  force?: boolean;
  dryRun?: boolean;
  setupHooks?: boolean;
  setupWorkflow?: boolean;
  fixGitignore?: boolean;
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
    .option('-t, --template <name>', 'Template to use (minimal|typescript-library|typescript-nodejs|typescript-react)', 'minimal')
    .option('-f, --force', 'Overwrite existing configuration')
    .option('--dry-run', 'Preview changes without writing files')
    .option('--setup-hooks', 'Install pre-commit hook')
    .option('--setup-workflow', 'Create GitHub Actions workflow')
    .option('--fix-gitignore', 'Add state file to .gitignore')
    .action(async (options) => {
      try {
        const cwd = process.cwd();
        const isDryRun = options.dryRun || false;

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
 * Creates a vibe-validate configuration file by copying the specified template
 * from the config-templates directory and customizing it with auto-detected settings.
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

  // Get template name (defaults to 'minimal')
  const templateName = options.template || 'minimal';

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

  // Generate YAML config file content from template
  const configContent = generateYamlConfig(templateName, gitConfig);
  const configPath = join(cwd, 'vibe-validate.config.yaml');

  if (isDryRun) {
    // Preview mode - show what would be created
    console.log(chalk.blue('🔍 Configuration preview (dry-run):'));
    console.log(chalk.yellow('   Would create:'));
    console.log(chalk.gray(`   - ${configPath}`));
    console.log(chalk.gray(`   - Template: ${templateName}`));
    console.log();
    console.log(chalk.yellow('💡 Run without --dry-run to create configuration'));
    process.exit(0);
  }

  // Write config file
  writeFileSync(configPath, configContent, 'utf-8');

  console.log(chalk.green('✅ Configuration file created successfully'));
  console.log(chalk.blue(`📋 Created: ${configPath}`));
  console.log(chalk.gray(`   Template: ${templateName}`));
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
 * Get the path to the config-templates directory
 *
 * Works both in development (from source) and when installed as npm package.
 *
 * @returns Absolute path to config-templates directory
 */
function getTemplatesDir(): string {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);

  // Try paths in order:
  // 1. Development: packages/cli/src/commands/../../config-templates
  const devPath = join(__dirname, '../../../../config-templates');
  if (existsSync(devPath)) {
    return devPath;
  }

  // 2. Production: packages/cli/dist/commands/../config-templates
  const prodPath = join(__dirname, '../../../config-templates');
  if (existsSync(prodPath)) {
    return prodPath;
  }

  // 3. Fallback: assume monorepo root
  const fallbackPath = join(process.cwd(), 'config-templates');
  return fallbackPath;
}

/**
 * Generate YAML configuration content by copying specified template
 *
 * Reads the specified template from config-templates/ and customizes
 * it with the detected git configuration values.
 *
 * @param templateName - Name of the template (without .yaml extension)
 * @param gitConfig - Detected git configuration
 * @returns YAML configuration file content
 * @throws Error if template doesn't exist or is invalid
 */
function generateYamlConfig(templateName: string, gitConfig: DetectedGitConfig): string {
  const templatesDir = getTemplatesDir();

  // Add .yaml extension if not present
  const templateFile = templateName.endsWith('.yaml') ? templateName : `${templateName}.yaml`;
  const templatePath = join(templatesDir, templateFile);

  // Check if template exists
  if (!existsSync(templatePath)) {
    // List available templates using discovery utility
    const availableTemplates = discoverTemplates();

    console.error(chalk.red(`❌ Template '${templateName}' not found`));
    console.error(chalk.gray('   Available templates:'));
    for (const template of availableTemplates) {
      const displayName = template.filename.replace('.yaml', '');
      if (template.description) {
        console.error(chalk.gray(`   - ${displayName} (${template.description})`));
      } else {
        console.error(chalk.gray(`   - ${displayName}`));
      }
    }
    process.exit(1);
  }

  // Read and parse the template
  const templateContent = readFileSync(templatePath, 'utf-8');
  const templateConfig = parseYaml(templateContent) as Record<string, unknown>;

  // Customize git settings with auto-detected values
  if (typeof templateConfig.git === 'object' && templateConfig.git !== null) {
    const gitSection = templateConfig.git as Record<string, unknown>;
    gitSection.mainBranch = gitConfig.mainBranch;
    gitSection.remoteOrigin = gitConfig.remoteOrigin;
  }

  // Return the customized config
  return stringifyYaml(templateConfig, {
    indent: 2,
    lineWidth: 100,
  });
}


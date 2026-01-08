/**
 * Init Command
 *
 * Interactive setup wizard for vibe-validate configuration.
 */

import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import chalk from 'chalk';
import type { Command } from 'commander';
import { stringify as stringifyYaml, parse as parseYaml } from 'yaml';

import { getCommandName } from '../utils/command-name.js';
import { configExists } from '../utils/config-loader.js';
import { detectGitConfig, type DetectedGitConfig } from '../utils/git-detection.js';
import { detectPackageManager } from '../utils/package-manager-commands.js';
import { GitignoreSetupCheck } from '../utils/setup-checks/gitignore-check.js';
import { HooksSetupCheck } from '../utils/setup-checks/hooks-check.js';
import { WorkflowSetupCheck } from '../utils/setup-checks/workflow-check.js';
import type { SetupCheck, PreviewResult } from '../utils/setup-engine.js';
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
        const isDryRun = options.dryRun ?? false;

        // Check if this is a focused operation
        const isFocusedOperation = options.setupHooks ?? options.setupWorkflow ?? options.fixGitignore;

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
 * Display preview changes for a setup operation
 *
 * @param operationName - Name of the operation
 * @param preview - Preview result with changes
 */
function displayPreviewChanges(operationName: string, preview: PreviewResult): void {
  console.log(chalk.blue(`\n🔍 ${operationName} (dry-run):`));
  console.log(chalk.gray(`   ${preview.description}`));

  if (!preview.changes || preview.changes.length === 0) return;

  console.log(chalk.yellow('   Would create:'));
  for (const change of preview.changes) {
    console.log(chalk.gray(`   - ${change.file} (${change.action})`));
    if (change.content && change.content.length < 500) {
      console.log(chalk.gray('\n' + change.content));
    }
  }
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
// eslint-disable-next-line sonarjs/cognitive-complexity -- Complexity 33 acceptable for init workflow coordination (manages multiple optional setup operations: gitignore, package.json, workflow generation)
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
      displayPreviewChanges(operation.name, preview);
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
  const templateName = options.template ?? 'minimal';

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
  const cmd = getCommandName();
  console.log(chalk.yellow('Next steps:'));
  console.log(chalk.gray('  1. Review and customize vibe-validate.config.yaml'));
  console.log(chalk.gray(`  2. Run: ${cmd} validate`));
  console.log(chalk.gray('  3. Add to package.json scripts:'));
  console.log(chalk.gray('     "validate": "vibe-validate validate"'));
  console.log(chalk.gray('     "pre-commit": "vibe-validate pre-commit"'));

  process.exit(0);
}

/**
 * Get the path to the config-templates directory
 *
 * Templates are located at packages/cli/config-templates/ (permanent location).
 * Works both in development (from source) and when installed as npm package.
 *
 * @returns Absolute path to config-templates directory
 */
function getTemplatesDir(): string {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);

  // Both development and production use the same relative path:
  // - Development: packages/cli/src/commands/../../config-templates
  // - Production: packages/cli/dist/commands/../../config-templates
  const templatesPath = join(__dirname, '../../config-templates');

  if (!existsSync(templatesPath)) {
    throw new Error(
      `Config templates directory not found at ${templatesPath}. ` +
      `This should not happen - please report this bug at ` +
      `https://github.com/jdutton/vibe-validate/issues`
    );
  }

  return templatesPath;
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

  // Auto-detect and add package manager to CI config
  const packageManager = detectPackageManager(process.cwd());
  templateConfig.ci ??= {};
  if (typeof templateConfig.ci === 'object' && templateConfig.ci !== null) {
    const ciSection = templateConfig.ci as Record<string, unknown>;
    // Only set if not already specified in template
    ciSection.packageManager ??= packageManager;
  }

  // Add version-pinned $schema URL for IDE validation
  // Uses unpkg CDN to ensure schema matches installed CLI version
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const packageJsonPath = join(__dirname, '../../package.json');
  const { version } = JSON.parse(readFileSync(packageJsonPath, 'utf-8')) as { version: string };
  templateConfig.$schema = `https://unpkg.com/@vibe-validate/config@${version}/config.schema.json`;

  // Return the customized config
  return stringifyYaml(templateConfig, {
    indent: 2,
    lineWidth: 100,
  });
}

/**
 * Show verbose help with detailed documentation
 */
export function showInitVerboseHelp(): void {
  console.log(`# init Command Reference

> Initialize vibe-validate configuration

## Overview

The \`init\` command sets up vibe-validate in your project by creating configuration files, optionally setting up pre-commit hooks, and generating GitHub Actions workflows.

## How It Works

1. **Creates vibe-validate.config.yaml** in project root (required)
2. **Optionally sets up pre-commit hooks** via Husky (with \`--setup-hooks\`)
3. **Optionally creates GitHub Actions workflow** (with \`--setup-workflow\`)
4. **Optionally updates .gitignore** to exclude validation state (with \`--fix-gitignore\`)

## Options

- \`-t, --template <name>\` - Template to use (default: "minimal")
  - Available: \`minimal\`, \`typescript-library\`, \`typescript-nodejs\`, \`typescript-react\`
- \`--setup-hooks\` - Install Husky pre-commit hook
- \`--setup-workflow\` - Generate GitHub Actions workflow
- \`--fix-gitignore\` - Add validation state to .gitignore
- \`-f, --force\` - Overwrite existing config file

## Exit Codes

- \`0\` - Configuration created successfully
- \`1\` - Failed (config exists without --force, or invalid template)

## Files Created/Modified

- \`vibe-validate.config.yaml\` (always created)
- \`.husky/pre-commit\` (with \`--setup-hooks\`)
- \`.github/workflows/validate.yml\` (with \`--setup-workflow\`)
- \`.gitignore\` (with \`--fix-gitignore\`)

## Examples

\`\`\`bash
# Minimal setup (just config file)
vibe-validate init

# Full setup for TypeScript project
vibe-validate init --template typescript-nodejs --setup-workflow --setup-hooks

# React project with all features
vibe-validate init --template typescript-react --setup-workflow --setup-hooks --fix-gitignore

# Overwrite existing config
vibe-validate init --force --template typescript-library
\`\`\`

## Templates

### \`minimal\`
- Basic validation phases (build, test, lint)
- No TypeScript-specific checks
- Good starting point for customization

### \`typescript-library\`
- TypeScript type checking
- ESLint with TypeScript rules
- Jest/Vitest testing
- NPM package publishing checks

### \`typescript-nodejs\`
- TypeScript for Node.js applications
- API testing
- Security checks
- Docker build validation

### \`typescript-react\`
- React-specific linting
- Component testing
- Build size checks
- Accessibility validation

## Common Workflows

### First-time setup
\`\`\`bash
# 1. Initialize with template
vibe-validate init --template typescript-nodejs --setup-workflow

# 2. Review generated config
cat vibe-validate.config.yaml

# 3. Customize as needed
# Edit vibe-validate.config.yaml

# 4. Commit
git add vibe-validate.config.yaml .github/workflows/validate.yml
git commit -m "feat: add vibe-validate"
\`\`\`

### Migrating from another tool
\`\`\`bash
# 1. Initialize with minimal template
vibe-validate init

# 2. Manually configure validation phases
# Edit vibe-validate.config.yaml to match your existing workflow

# 3. Test locally
vibe-validate validate

# 4. If successful, commit
git add vibe-validate.config.yaml
git commit -m "feat: migrate to vibe-validate"
\`\`\`

### Updating existing config
\`\`\`bash
# Regenerate config (backs up old one)
vibe-validate init --force --template typescript-nodejs

# Compare old vs new
git diff vibe-validate.config.yaml

# Keep customizations, restore if needed
\`\`\`

## Pre-commit Hook Setup

When using \`--setup-hooks\`, init:
1. Installs Husky (if not already installed)
2. Creates \`.husky/pre-commit\` with:
   \`\`\`bash
   #!/bin/sh
   npx vibe-validate pre-commit
   \`\`\`
3. Ensures hook is executable

The hook runs \`vibe-validate pre-commit\` before every commit, which:
- Checks sync with origin/main
- Runs validation (with caching)
- Blocks commit if validation fails

## GitHub Actions Workflow

When using \`--setup-workflow\`, init creates \`.github/workflows/validate.yml\`:
- Runs on push and PR
- Matrix testing (multiple Node versions, OS)
- Caches validation results using git tree hashes
- Posts results as PR comments

## Error Recovery

**If config already exists:**
\`\`\`bash
# Option 1: Use --force to overwrite
vibe-validate init --force

# Option 2: Manually delete and re-init
rm vibe-validate.config.yaml
vibe-validate init
\`\`\`

**If template not found:**
\`\`\`bash
# List available templates (check error message)
# Use one of: minimal, typescript-library, typescript-nodejs, typescript-react

vibe-validate init --template typescript-nodejs
\`\`\`

**If Husky install fails:**
\`\`\`bash
# Manually install Husky (choose your package manager)
npm install --save-dev husky    # or: pnpm add -D husky / yarn add --dev husky / bun add --dev husky
npx husky install

# Then retry
vibe-validate init --setup-hooks
\`\`\`
`);
}


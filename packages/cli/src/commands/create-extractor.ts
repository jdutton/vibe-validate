/**
 * Create Extractor Command
 *
 * Interactive scaffold generator for vibe-validate extractor plugins.
 * Creates a fully-functional plugin directory with tests, samples, and documentation.
 */

import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { mkdirSyncReal, normalizePath } from '@vibe-validate/utils';
import chalk from 'chalk';
import type { Command } from 'commander';
import prompts from 'prompts';

import { getCommandName } from '../utils/command-name.js';
import { detectPackageManager, getInstallCommandUnfrozen } from '../utils/package-manager-commands.js';

/**
 * Options for the create-extractor command
 */
interface CreateExtractorOptions {
  name?: string;
  description?: string;
  author?: string;
  priority?: number;
  detectionPattern?: string;
  force?: boolean;
}

/**
 * Template context for variable substitution
 */
interface TemplateContext {
  pluginName: string;          // e.g., "my-plugin"
  className: string;            // e.g., "MyPlugin"
  displayName: string;          // e.g., "My Plugin"
  description: string;          // e.g., "Extracts errors from my tool"
  author: string;               // e.g., "John Doe <john@example.com>"
  priority: number;             // e.g., 70
  detectionPattern: string;     // e.g., "/ERROR:/"
  year: string;                 // e.g., "2025"
}

export function createExtractorCommand(program: Command): void {
  program
    .command('create-extractor [name]')
    .description('Create a new extractor plugin from template')
    .option('--description <desc>', 'Plugin description')
    .option('--author <author>', 'Author name and email')
    .option('--detection-pattern <pattern>', 'Detection keyword or pattern')
    .option('--priority <number>', 'Detection priority (higher = check first)', '70')
    .option('-f, --force', 'Overwrite existing plugin directory')
    .action(async (name: string | undefined, options: CreateExtractorOptions) => {
      try {
        // Normalize cwd to avoid Windows short path issues (e.g., RUNNER~1)
        const cwd = normalizePath(process.cwd());

        // Interactive prompts for missing information (skip entirely if all options provided)
        const context = await gatherContext(name, options);

        // Determine output directory
        const pluginDir = join(cwd, `vibe-validate-plugin-${context.pluginName}`);

        // Check if directory exists
        if (existsSync(pluginDir) && !options.force) {
          console.error(chalk.red('❌ Plugin directory already exists:'));
          console.error(chalk.gray(`   ${pluginDir}`));
          console.error(chalk.gray('   Use --force to overwrite'));
          process.exit(1);
        }

        // Create plugin directory
        console.log(chalk.blue('🔨 Creating extractor plugin...'));
        createPluginDirectory(pluginDir, context);

        console.log(chalk.green('✅ Extractor plugin created successfully!'));
        console.log(chalk.blue(`📁 Created: ${pluginDir}`));
        const cmd = getCommandName();
        const pm = detectPackageManager(pluginDir);
        const installCmd = getInstallCommandUnfrozen(pm);

        console.log();
        console.log(chalk.yellow('Next steps:'));
        console.log(chalk.gray('  1. cd ' + `vibe-validate-plugin-${context.pluginName}`));
        console.log(chalk.gray(`  2. ${installCmd}`));
        console.log(chalk.gray('  3. Add your sample error output to samples/sample-error.txt'));
        console.log(chalk.gray('  4. Implement detect() and extract() functions in index.ts'));
        console.log(chalk.gray(`  5. Run tests: ${pm} test`));
        console.log(chalk.gray(`  6. Test the plugin: ${cmd} test-extractor .`));

        process.exit(0);
      } catch (error) {
        console.error(chalk.red('❌ Failed to create extractor plugin:'), error);
        process.exit(1);
      }
    });
}

/**
 * Build prompts configuration for missing options
 */
function buildPromptsConfig(
  name: string | undefined,
  options: CreateExtractorOptions
): prompts.PromptObject[] {
  return [
    {
      type: name ? null : 'text',
      name: 'pluginName',
      message: 'Plugin name (kebab-case, e.g., "my-tool"):',
      validate: (value: string) =>
        /^[a-z][a-z0-9-]*$/.test(value) || 'Must be lowercase alphanumeric with hyphens',
    },
    {
      type: options.description ? null : 'text',
      name: 'description',
      message: 'Plugin description:',
      validate: (value: string) => value.length > 0 || 'Description is required',
    },
    {
      type: options.author ? null : 'text',
      name: 'author',
      message: 'Author (name <email>):',
      initial: process.env.GIT_AUTHOR_NAME
        ? `${process.env.GIT_AUTHOR_NAME} <${process.env.GIT_AUTHOR_EMAIL ?? ''}>`
        : '',
    },
    {
      type: options.detectionPattern ? null : 'text',
      name: 'detectionPattern',
      message: 'Detection keyword (e.g., "ERROR:", "[FAIL]"):',
      validate: (value: string) => value.length > 0 || 'Detection keyword is required',
    },
  ];
}

/**
 * Gather context from command-line arguments and interactive prompts
 */
async function gatherContext(
  name: string | undefined,
  options: CreateExtractorOptions
): Promise<TemplateContext> {
  // Check if all required options are provided (skip prompts for non-TTY/CI environments)
  // CRITICAL: The prompts library has issues on Windows CI even when all prompts have type: null.
  // By skipping the prompts() call entirely when all options are provided, we avoid these issues.
  const hasAllOptions = name && options.description && options.author && options.detectionPattern;

  let responses: Record<string, string | undefined> = {};

  // Only run prompts if we're missing required information
  if (!hasAllOptions) {
    responses = await prompts(buildPromptsConfig(name, options));

    // User cancelled prompts
    if (!responses.pluginName && !name) {
      console.log(chalk.yellow('\n✋ Cancelled'));
      process.exit(0);
    }
  }

  const pluginName = (name ?? responses.pluginName) as string;
  const description = (options.description ?? responses.description) as string;
  const author = options.author ?? responses.author ?? 'Unknown';
  const detectionPattern = (options.detectionPattern ?? responses.detectionPattern) as string;
  const priority = typeof options.priority === 'number'
    ? options.priority
    : Number.parseInt(options.priority ?? '70', 10);

  // Generate derived values
  const className = kebabToPascalCase(pluginName);
  const displayName = kebabToTitleCase(pluginName);
  const year = new Date().getFullYear().toString();

  return {
    pluginName,
    className,
    displayName,
    description,
    author,
    priority,
    detectionPattern,
    year,
  };
}

/**
 * Create plugin directory with all files
 */
function createPluginDirectory(pluginDir: string, context: TemplateContext): void {
  // Create directories (using mkdirSyncReal to handle Windows short paths)
  const normalizedPluginDir = mkdirSyncReal(pluginDir, { recursive: true });
  mkdirSyncReal(join(normalizedPluginDir, 'samples'), { recursive: true });

  // Write files (using normalized path to ensure consistency)
  writeFileSync(join(normalizedPluginDir, 'index.ts'), generateIndexTs(context), 'utf-8');
  writeFileSync(join(normalizedPluginDir, 'index.test.ts'), generateIndexTestTs(context), 'utf-8');
  writeFileSync(join(normalizedPluginDir, 'README.md'), generateReadme(context), 'utf-8');
  writeFileSync(join(normalizedPluginDir, 'CLAUDE.md'), generateClaudeMd(context), 'utf-8');
  writeFileSync(join(normalizedPluginDir, 'package.json'), generatePackageJson(context), 'utf-8');
  writeFileSync(join(normalizedPluginDir, 'tsconfig.json'), generateTsConfig(context), 'utf-8');
  writeFileSync(
    join(normalizedPluginDir, 'samples', 'sample-error.txt'),
    generateSampleError(context),
    'utf-8'
  );

  console.log(chalk.gray('   ✓ Created index.ts'));
  console.log(chalk.gray('   ✓ Created index.test.ts'));
  console.log(chalk.gray('   ✓ Created README.md'));
  console.log(chalk.gray('   ✓ Created CLAUDE.md'));
  console.log(chalk.gray('   ✓ Created package.json'));
  console.log(chalk.gray('   ✓ Created tsconfig.json'));
  console.log(chalk.gray('   ✓ Created samples/sample-error.txt'));
}

/**
 * Generate index.ts (main plugin file)
 */
function generateIndexTs(context: TemplateContext): string {
  return `/**
 * ${context.displayName} Extractor Plugin
 *
 * ${context.description}
 *
 * @package vibe-validate-plugin-${context.pluginName}
 */

import type {
  ExtractorPlugin,
  DetectionResult,
  ErrorExtractorResult,
  FormattedError,
} from '@vibe-validate/extractors';

/**
 * Detects if output is from ${context.displayName}
 */
export function detect${context.className}(output: string): DetectionResult {
  const lines = output.split('\\n');
  let score = 0;
  const foundPatterns: string[] = [];

  // TODO: Implement your detection logic here
  // Example: Look for specific keywords or patterns
  for (const line of lines) {
    if (line.includes('${context.detectionPattern}')) {
      score += 50;
      foundPatterns.push('${context.detectionPattern} marker');
      break;
    }
  }

  // Determine reason based on score
  let reason: string;
  if (score >= 70) {
    reason = '${context.displayName} output detected';
  } else if (score >= 40) {
    reason = 'Possible ${context.displayName} output';
  } else {
    reason = 'Not ${context.displayName} output';
  }

  return {
    confidence: Math.min(score, 100),
    patterns: foundPatterns,
    reason,
  };
}

/**
 * Extracts errors from ${context.displayName} output
 */
export function extract${context.className}(
  output: string,
  command?: string
): ErrorExtractorResult {
  const detection = detect${context.className}(output);

  if (detection.confidence < 40) {
    return {
      summary: 'Not ${context.displayName} output',
      totalErrors: 0,
      errors: [],
      metadata: {
        detection: {
          extractor: '${context.pluginName}',
          confidence: detection.confidence,
          patterns: detection.patterns,
          reason: detection.reason,
        },
        confidence: detection.confidence,
        completeness: 100,
        issues: [],
      },
    };
  }

  const errors: FormattedError[] = [];
  const lines = output.split('\\n');

  // TODO: Implement your error extraction logic here
  // Example: Parse error lines and extract file, line, column, message
  for (const line of lines) {
    if (line.includes('${context.detectionPattern}')) {
      // Extract error details (customize this for your format)
      errors.push({
        file: 'unknown',
        line: 1,
        message: line.trim(),
      });
    }
  }

  const summary = \`\${errors.length} error(s) found\`;
  const guidance = errors.length > 0
    ? \`Fix errors shown above. Run \${command ?? 'your-command'} to see all details.\`
    : undefined;

  return {
    summary,
    totalErrors: errors.length,
    errors,
    guidance,
    metadata: {
      detection: {
        extractor: '${context.pluginName}',
        confidence: detection.confidence,
        patterns: detection.patterns,
        reason: detection.reason,
      },
      confidence: 100,
      completeness: 100,
      issues: [],
    },
  };
}

/**
 * ${context.displayName} Extractor Plugin
 */
const ${context.pluginName.replaceAll('-', '')}Extractor: ExtractorPlugin = {
  metadata: {
    name: '${context.pluginName}',
    version: '1.0.0',
    author: '${context.author}',
    description: '${context.description}',
    repository: 'https://github.com/your-username/vibe-validate-plugin-${context.pluginName}',
    tags: ['custom', '${context.pluginName}'],
  },

  hints: {
    required: ['${context.detectionPattern}'],
  },

  priority: ${context.priority},

  detect: detect${context.className},
  extract: extract${context.className},

  samples: [
    {
      name: 'basic-error',
      description: 'Basic error output',
      inputFile: './samples/sample-error.txt',
      expected: {
        totalErrors: 1,
      },
    },
  ],
};

export default ${context.pluginName.replaceAll('-', '')}Extractor;
`;
}

/**
 * Generate index.test.ts (tests)
 */
function generateIndexTestTs(context: TemplateContext): string {
  return `/**
 * ${context.displayName} Extractor Tests
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import extractor from './index.js';

describe('${context.pluginName} extractor', () => {
  it('should have correct metadata', () => {
    expect(extractor.metadata.name).toBe('${context.pluginName}');
    expect(extractor.metadata.version).toBe('1.0.0');
  });

  it('should detect ${context.displayName} output', () => {
    const output = '${context.detectionPattern} Something went wrong';
    const result = extractor.detect(output);

    expect(result.confidence).toBeGreaterThan(40);
    expect(result.patterns.length).toBeGreaterThan(0);
  });

  it('should not detect non-${context.displayName} output', () => {
    const output = 'This is some random text';
    const result = extractor.detect(output);

    expect(result.confidence).toBeLessThan(40);
  });

  it('should extract errors from ${context.displayName} output', () => {
    const output = '${context.detectionPattern} Something went wrong';
    const result = extractor.extract(output);

    expect(result.totalErrors).toBeGreaterThan(0);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('should process sample file', () => {
    const samplePath = join(__dirname, 'samples', 'sample-error.txt');
    const sampleContent = readFileSync(samplePath, 'utf-8');

    const result = extractor.extract(sampleContent);

    // Update these expectations based on your sample file
    expect(result.totalErrors).toBeGreaterThanOrEqual(1);
    expect(result.summary).toBeTruthy();
  });
});
`;
}

/**
 * Generate README.md
 */
function generateReadme(context: TemplateContext): string {
  return `# ${context.displayName} Extractor Plugin

${context.description}

## Installation

\`\`\`bash
# Choose your package manager
npm install vibe-validate-plugin-${context.pluginName}
# or: pnpm add vibe-validate-plugin-${context.pluginName}
# or: yarn add vibe-validate-plugin-${context.pluginName}
# or: bun add vibe-validate-plugin-${context.pluginName}
\`\`\`

## Usage

Add to your \`vibe-validate.config.yaml\`:

\`\`\`yaml
extractors:
  external:
    - package: vibe-validate-plugin-${context.pluginName}
      trust: sandbox  # Run in sandbox for security
\`\`\`

Or use a local plugin:

\`\`\`yaml
extractors:
  localPlugins:
    - path: ./vibe-validate-local-plugins/${context.pluginName}
      trust: sandbox
\`\`\`

## Development

\`\`\`bash
# Install dependencies (choose your package manager)
npm install
# or: pnpm install
# or: yarn install
# or: bun install

# Run tests
npm test    # or: pnpm test / yarn test / bun test

# Build
npm run build    # or: pnpm build / yarn build / bun run build
\`\`\`

## How It Works

This extractor:
1. Detects ${context.displayName} output by looking for "${context.detectionPattern}"
2. Extracts error information (file, line, message)
3. Formats errors for LLM consumption

## Configuration

Priority: ${context.priority}

Detection hints:
- Required keywords: "${context.detectionPattern}"

## Sample Output

See \`samples/sample-error.txt\` for example error output this extractor handles.

## License

MIT

## Author

${context.author}
`;
}

/**
 * Generate CLAUDE.md
 */
function generateClaudeMd(context: TemplateContext): string {
  return `# ${context.displayName} Extractor - Claude Code Guidance

This file provides guidance to Claude Code when working on this extractor.

## What This Extractor Does

${context.description}

## Plugin Architecture

This extractor follows the **ExtractorPlugin** interface:

\`\`\`typescript
{
  metadata: { name, version, author, description, repository, tags },
  hints: { required, anyOf, forbidden },
  priority: number,
  detect(output: string): DetectionResult,
  extract(output: string, command?: string): ErrorExtractorResult,
  samples: ExtractorSample[],
}
\`\`\`

### Key Principles

1. **No File I/O** - Extractor receives \`output: string\` parameter only (safe for sandboxing)
2. **Hints for Performance** - Simple string.includes() checks filter candidates before expensive detect()
3. **Samples Required** - Real-world test data co-located for testing
4. **Metadata is Source of Truth** - Registration name comes from \`metadata.name\`

## Code Structure

### Files
- \`index.ts\` - Main plugin export with detect() and extract() functions
- \`samples/\` - Real-world error output samples
- \`index.test.ts\` - Tests using samples
- \`README.md\` - Human-readable documentation
- \`CLAUDE.md\` - This file (LLM-specific guidance)

## Detection Logic

### Two-Phase Detection

**Phase 1: Fast Hints (string.includes() only)**
\`\`\`typescript
hints: {
  required: ['${context.detectionPattern}'],
}
\`\`\`

**Phase 2: Precise Detection (if hints match)**
\`\`\`typescript
detect(output: string): DetectionResult {
  // Additive scoring based on patterns found
  // Returns confidence 0-100
}
\`\`\`

### Confidence Scoring

Adjust these thresholds based on your tool's output format:
- 70+ points = high confidence
- 40-69 = possible match
- <40 = not a match

## Testing Requirements

**CRITICAL:** All changes MUST include tests with real output from your tool.

### Test Data Requirements

1. **Real-world samples** - Use actual tool output (not hand-crafted)
2. **Co-located** - Store in \`samples/\` directory
3. **Redacted** - Remove sensitive paths, usernames, company names

### Running Tests

\`\`\`bash
# All tests
npm test

# Watch mode
npm test -- --watch
\`\`\`

## Security Considerations

This extractor is **SAFE for sandboxed execution**:
- ✅ **No file I/O** - Only reads \`output: string\` parameter
- ✅ **No process execution** - No \`child_process\`, \`exec\`, \`spawn\`
- ✅ **No network access** - No \`fetch\`, \`http\`, \`https\`
- ✅ **No dangerous APIs** - No \`eval\`, \`Function()\`, \`require()\`
- ✅ **Deterministic** - Same input always produces same output

## Common Modifications

### Adding New Error Pattern

1. Add pattern to detection logic
2. Update scoring if needed
3. Add sample demonstrating the pattern
4. Add test case

### Adjusting Detection Confidence

If false positives/negatives occur:
1. Review \`hints\` - are they too broad/narrow?
2. Review \`detect()\` scoring - do patterns need reweighting?
3. Add test case demonstrating the issue
4. Adjust hints or detection logic
`;
}

/**
 * Get CLI version from package.json
 */
function getCliVersion(): string {
  try {
    // Get the path to the CLI's package.json
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    // Go up from dist/commands/ to package.json
    const packageJsonPath = join(__dirname, '..', '..', 'package.json');
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8')) as { version: string };
    return packageJson.version;
  } catch {
    // Fallback to a known version if reading fails
    return '0.17.0';
  }
}

/**
 * Get version range for package.json (e.g., "0.17.0-rc4" -> "^0.17.0-rc4")
 */
function getVersionRange(version: string): string {
  // For RC versions, use exact version to avoid issues
  if (version.includes('-rc')) {
    return version;
  }
  // For stable versions, use caret range
  return `^${version}`;
}

/**
 * Generate package.json
 */
function generatePackageJson(context: TemplateContext): string {
  const cliVersion = getCliVersion();
  const versionRange = getVersionRange(cliVersion);

  return `{
  "name": "vibe-validate-plugin-${context.pluginName}",
  "version": "1.0.0",
  "description": "${context.description}",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "files": [
    "dist",
    "samples"
  ],
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "test:watch": "vitest watch",
    "prepublishOnly": "npm run build && npm test"
  },
  "keywords": [
    "vibe-validate",
    "extractor",
    "plugin",
    "${context.pluginName}"
  ],
  "author": "${context.author}",
  "license": "MIT",
  "peerDependencies": {
    "@vibe-validate/extractors": "${versionRange}"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "@vibe-validate/extractors": "${versionRange}",
    "typescript": "^5.3.0",
    "vitest": "^2.0.0"
  }
}
`;
}

/**
 * Generate tsconfig.json
 */
function generateTsConfig(_context: TemplateContext): string {
  return `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "lib": ["ES2022"],
    "moduleResolution": "node",
    "esModuleInterop": true,
    "declaration": true,
    "outDir": "./dist",
    "rootDir": "./",
    "strict": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["*.ts"],
  "exclude": ["node_modules", "dist"]
}
`;
}

/**
 * Generate sample error file
 */
function generateSampleError(context: TemplateContext): string {
  return `${context.detectionPattern} Example error message
${context.detectionPattern} Add real error output from your tool here
${context.detectionPattern} Replace this with actual error messages

Replace this file with real error output from your tool.
This helps with testing and validation.
`;
}

/**
 * Convert kebab-case to PascalCase
 */
function kebabToPascalCase(str: string): string {
  return str
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

/**
 * Convert kebab-case to Title Case
 */
function kebabToTitleCase(str: string): string {
  return str
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

/**
 * Show verbose help with detailed documentation
 */
export function showCreateExtractorVerboseHelp(): void {
  console.log(`# create-extractor Command Reference

> Create a new extractor plugin from template

## Overview

The \`create-extractor\` command generates a fully-functional extractor plugin directory with:
- TypeScript source code with detect() and extract() functions
- Test suite using Vitest
- Sample error data
- Documentation (README.md, CLAUDE.md)
- Package.json with proper dependencies
- TypeScript configuration

## How It Works

1. **Prompts for plugin metadata** (name, description, author, etc.)
2. **Generates plugin directory** with all necessary files
3. **Creates sample test data** directory
4. **Outputs next steps** for development

## Options

- \`[name]\` - Plugin name (kebab-case, e.g., "my-tool")
- \`--description <desc>\` - Plugin description
- \`--author <author>\` - Author name and email
- \`--detection-pattern <pattern>\` - Detection keyword or pattern
- \`--priority <number>\` - Detection priority (default: 70)
- \`-f, --force\` - Overwrite existing plugin directory

## Exit Codes

- \`0\` - Plugin created successfully
- \`1\` - Failed (directory exists without --force, or invalid input)

## Files Created

- \`vibe-validate-plugin-<name>/\`
  - \`index.ts\` - Main plugin code
  - \`index.test.ts\` - Test suite
  - \`README.md\` - User documentation
  - \`CLAUDE.md\` - AI assistant guidance
  - \`package.json\` - NPM package metadata
  - \`tsconfig.json\` - TypeScript configuration
  - \`samples/sample-error.txt\` - Example error output

## Examples

\`\`\`bash
# Interactive mode (prompts for all info)
vibe-validate create-extractor

# With plugin name specified
vibe-validate create-extractor my-tool

# Non-interactive (all options provided)
vibe-validate create-extractor my-tool \\
  --description "Extracts errors from my tool" \\
  --author "John Doe <john@example.com>" \\
  --detection-pattern "ERROR:" \\
  --priority 70

# Overwrite existing plugin
vibe-validate create-extractor my-tool --force
\`\`\`

## Development Workflow

\`\`\`bash
# 1. Create plugin
vibe-validate create-extractor my-tool

# 2. Navigate to plugin directory
cd vibe-validate-plugin-my-tool

# 3. Install dependencies (choose your package manager)
npm install    # or: pnpm install / yarn install / bun install

# 4. Add real error output to samples/
# Copy actual error output from your tool

# 5. Implement detect() and extract() functions
# Edit index.ts with your detection and extraction logic

# 6. Run tests
npm test

# 7. Test with vibe-validate
vibe-validate test-extractor .

# 8. Publish (optional)
npm publish
\`\`\`

## Plugin Structure

Generated plugins follow the vibe-validate plugin architecture:

- **ExtractorPlugin interface** with metadata, hints, priority, detect(), extract()
- **No file I/O** - safe for sandboxed execution
- **Fast hints** - string.includes() checks for efficient filtering
- **Samples** - co-located test data for validation

## Next Steps After Creation

1. **Replace sample-error.txt** with real error output from your tool
2. **Implement detect()** function to identify your tool's output
3. **Implement extract()** function to parse errors
4. **Run tests** to validate functionality
5. **Test with vibe-validate** using \`test-extractor\` command
6. **Publish to npm** (optional) or use locally

## Related Commands

- \`vibe-validate fork-extractor <name>\` - Copy built-in extractor for customization
- \`vibe-validate test-extractor <path>\` - Validate plugin functionality and security
`);
}

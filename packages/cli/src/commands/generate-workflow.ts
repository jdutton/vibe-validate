#!/usr/bin/env node
/**
 * GitHub Actions Workflow Generator Command
 *
 * Generates .github/workflows/validate.yml from vibe-validate.config.yaml
 * Ensures perfect sync between local validation and CI validation.
 *
 * Features:
 * - Reads vibe-validate.config.yaml configuration
 * - Generates GitHub Actions workflow with proper job dependencies
 * - Supports multi-OS and multi-Node.js version testing
 * - Includes coverage reporting integration
 * - Provides --check mode to verify workflow sync
 *
 * @packageDocumentation
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

import type { VibeValidateConfig } from '@vibe-validate/config';
import { mkdirSyncReal } from '@vibe-validate/utils';
import { type Command } from 'commander';
import { stringify as yamlStringify } from 'yaml';

import { loadConfig } from '../utils/config-loader.js';
import { findGitRoot } from '../utils/git-detection.js';
import { normalizeLineEndings } from '../utils/normalize-line-endings.js';
import {
  type PackageManager,
  detectPackageManager,
  getInstallCommand,
  getBuildCommand,
  getValidateCommand,
  getCoverageCommand,
} from '../utils/package-manager-commands.js';

// GitHub Actions constants
const ACTIONS_CHECKOUT_V4 = 'actions/checkout@v4';
const ACTIONS_SETUP_NODE_V4 = 'actions/setup-node@v4';
const ACTIONS_SETUP_BUN_V2 = 'oven-sh/setup-bun@v2';
const ACTIONS_SETUP_PNPM_V2 = 'pnpm/action-setup@v2';
const WORKFLOW_PROPERTY_NODE_VERSION = 'node-version';
const WORKFLOW_PROPERTY_FETCH_DEPTH = 'fetch-depth';
const STEP_NAME_SETUP_PNPM = 'Setup pnpm';
const DEFAULT_RUNNER_OS = 'ubuntu-latest';
const STEP_NAME_BUILD_PACKAGES = 'Build packages';

/**
 * GitHub Actions workflow step structure
 */
interface GitHubWorkflowStep {
  name?: string;
  uses?: string;
  with?: Record<string, unknown>;
  run?: string;
  'working-directory'?: string;
  env?: Record<string, string>;
  if?: string;
  shell?: string;
}

/**
 * GitHub Actions workflow job structure
 */
interface GitHubWorkflowJob {
  name: string;
  'runs-on': string;
  permissions?: Record<string, string>;
  needs?: string[];
  if?: string;
  steps: GitHubWorkflowStep[];
  strategy?: {
    'fail-fast': boolean;
    matrix: {
      os: string[];
      node: string[];
    };
  };
  env?: Record<string, string>;
}

/**
 * GitHub Actions workflow root structure
 */
interface GitHubWorkflow {
  name: string;
  on: unknown;
  concurrency?: {
    group: string;
    'cancel-in-progress'?: boolean;
  };
  jobs: Record<string, GitHubWorkflowJob>;
}

/**
 * Generate GitHub Actions workflow options
 */
export interface GenerateWorkflowOptions {
  /** Node.js versions to test (default: auto-detect from package.json engines) */
  nodeVersions?: string[];
  /** Operating systems to test (default: ['ubuntu-latest']) */
  os?: string[];
  /** Package manager (default: auto-detect from packageManager field or lockfiles) */
  packageManager?: PackageManager;
  /** Enable coverage reporting (default: false) */
  enableCoverage?: boolean;
  /** Coverage provider (default: 'codecov') */
  coverageProvider?: 'codecov' | 'coveralls';
  /** Codecov token secret name (default: 'CODECOV_TOKEN') */
  codecovTokenSecret?: string;
  /** Fail fast in matrix (default: false) */
  matrixFailFast?: boolean;
  /** Project root directory for detecting package.json and lockfiles (default: process.cwd()) */
  projectRoot?: string;
}

/**
 * Convert phase/step name to valid GitHub Actions job ID
 * (lowercase, replace spaces with dashes, remove special chars)
 */
export function toJobId(name: string): string {
  return name
    .toLowerCase()
    .replaceAll(/[^a-z0-9-]/g, '-')
    .replaceAll(/-+/g, '-')
    .replaceAll(/(^-)|(-$)/g, '');
}


/**
 * Generate bash script to check all job statuses
 */
function generateCheckScript(jobNames: string[]): string {
  const checks = jobNames
    .map(job => {
      const envVar = `needs.${job}.result`;
      return `[ "\${{ ${envVar} }}" != "success" ]`;
    })
    .join(' || \\\n  ');

  return `if ${checks}; then
  echo "❌ Some validation checks failed"
  exit 1
fi
echo "✅ All validation checks passed!"`;
}

/**
 * Detect Node.js version from package.json engines field
 * Returns major version only (e.g., "20" from ">=20.0.0")
 */
function detectNodeVersion(cwd: string = process.cwd()): string {
  const DEFAULT_NODE_VERSION = '22'; // Node 22 LTS

  try {
    const packageJsonPath = join(cwd, 'package.json');
    if (!existsSync(packageJsonPath)) {
      return DEFAULT_NODE_VERSION;
    }

    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
    const engines = packageJson.engines?.node;

    if (!engines) {
      return DEFAULT_NODE_VERSION;
    }

    // Parse version from various formats:
    // ">=20.0.0", "^20.0.0", "~20.0.0", "20.x", "20", ">=20"
    const match = engines.match(/(\d+)/);
    return match ? match[1] : DEFAULT_NODE_VERSION;
  } catch {
    return DEFAULT_NODE_VERSION;
  }
}

/**
 * Check if the project has a "build" script in package.json
 *
 * @param cwd - Project root directory
 * @returns true if package.json has a scripts.build entry
 */
export function projectHasBuildScript(cwd: string = process.cwd()): boolean {
  try {
    const packageJsonPath = join(cwd, 'package.json');
    if (!existsSync(packageJsonPath)) {
      return false;
    }

    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
    return typeof packageJson.scripts?.build === 'string';
  } catch {
    return false;
  }
}

/**
 * Build the common setup steps shared by validate and coverage jobs:
 * checkout, custom setup steps, package manager setup, Node.js setup, install, and optional build.
 */
function buildCommonJobSteps(params: {
  packageManager: PackageManager;
  ciSetupSteps: unknown[] | undefined;
  registryUrlConfig: Record<string, string>;
  nodeVersionLabel: string;
  nodeCacheConfig: Record<string, string>;
  hasBuildScript: boolean;
  skipNodeSetup?: boolean;
}): GitHubWorkflowStep[] {
  const steps: GitHubWorkflowStep[] = [
    {
      uses: ACTIONS_CHECKOUT_V4,
      with: {
        [WORKFLOW_PROPERTY_FETCH_DEPTH]: 0  // Fetch all history for git-based checks (doctor command)
      }
    },
  ];

  // Inject custom setup steps after checkout but before package manager setup
  if (params.ciSetupSteps) {
    steps.push(...(params.ciSetupSteps as GitHubWorkflowStep[]));
  }

  // Setup package manager
  if (params.packageManager === 'bun') {
    steps.push({
      name: 'Setup Bun',
      uses: ACTIONS_SETUP_BUN_V2,
    });
  } else if (params.packageManager === 'pnpm') {
    steps.push({
      name: STEP_NAME_SETUP_PNPM,
      uses: ACTIONS_SETUP_PNPM_V2,
      with: { version: '9' },
    });
  }

  // Setup Node.js (skip for bun-only coverage jobs)
  if (!params.skipNodeSetup) {
    steps.push({
      name: `Setup Node.js ${params.nodeVersionLabel}`,
      uses: ACTIONS_SETUP_NODE_V4,
      with: {
        [WORKFLOW_PROPERTY_NODE_VERSION]: params.nodeVersionLabel,
        ...params.nodeCacheConfig,
        ...params.registryUrlConfig,
      },
    });
  }

  // Install dependencies
  steps.push({
    name: 'Install dependencies',
    run: getInstallCommand(params.packageManager),
  });

  // Add build step if project has a build script
  if (params.hasBuildScript) {
    steps.push({
      name: STEP_NAME_BUILD_PACKAGES,
      run: getBuildCommand(params.packageManager),
    });
  }

  return steps;
}

/**
 * Build the top-level workflow metadata (concurrency only).
 *
 * Permissions and env are applied at the job level, not the workflow level.
 * This avoids granting permissions to jobs that don't need them (e.g., the
 * gate job only checks results and needs no special access). SonarQube and
 * other security scanners flag workflow-level permissions as a vulnerability.
 */
function buildWorkflowMetadata(config: VibeValidateConfig): Pick<GitHubWorkflow, 'concurrency'> {
  const metadata: Pick<GitHubWorkflow, 'concurrency'> = {};

  if (config.ci?.concurrency) {
    const concurrency: GitHubWorkflow['concurrency'] = {
      group: config.ci.concurrency.group,
    };
    if (config.ci.concurrency.cancelInProgress !== undefined) {
      concurrency['cancel-in-progress'] = config.ci.concurrency.cancelInProgress;
    }
    metadata.concurrency = concurrency;
  }

  return metadata;
}

/**
 * Build job-level metadata (permissions, env) from the vibe-validate config.
 * Applied to validate and coverage jobs, but NOT to the gate job.
 */
function buildJobMetadata(config: VibeValidateConfig): Pick<GitHubWorkflowJob, 'permissions' | 'env'> {
  const metadata: Pick<GitHubWorkflowJob, 'permissions' | 'env'> = {};

  if (config.ci?.permissions) {
    metadata.permissions = config.ci.permissions;
  }

  if (config.ci?.env) {
    metadata.env = config.ci.env;
  }

  return metadata;
}

/**
 * Generate GitHub Actions workflow from validation config
 *
 * Always generates a single "validate" job that runs all validation steps
 * sequentially within one CI runner - matching the local `pnpm validate` experience.
 * This ensures setup steps (e.g., playwright install) run before tests, and
 * new checkouts for developers and CI just work.
 *
 * Supports matrix strategy for testing across multiple Node.js versions and OS.
 */
export function generateWorkflow(
  config: VibeValidateConfig,
  options: GenerateWorkflowOptions = {}
): string {
  const projectRoot = options.projectRoot ?? process.cwd();
  const {
    nodeVersions = [detectNodeVersion(projectRoot)],
    os = [DEFAULT_RUNNER_OS],
    packageManager = detectPackageManager(projectRoot),
    enableCoverage = false,
    coverageProvider = 'codecov',
    codecovTokenSecret = 'CODECOV_TOKEN',
    matrixFailFast = false,
  } = options;

  const jobs: Record<string, GitHubWorkflowJob> = {};

  // Extract CI config fields
  const ciRegistryUrl = config.ci?.registryUrl;
  const ciSetupSteps = config.ci?.setupSteps;
  const registryUrlConfig: Record<string, string> = ciRegistryUrl ? { 'registry-url': ciRegistryUrl } : {};
  const hasBuildScript = projectHasBuildScript(projectRoot);
  const nodeCacheConfig: Record<string, string> = packageManager === 'bun' ? {} : { cache: packageManager };

  // Single validate job - runs all validation steps sequentially (like local)
  const jobSteps = buildCommonJobSteps({
    packageManager,
    ciSetupSteps,
    registryUrlConfig,
    nodeVersionLabel: '${{ matrix.node }}',
    nodeCacheConfig,
    hasBuildScript,
  });

  // Run validation - use exit code to determine success/failure
  // GitHub Actions will automatically fail the job if exit code != 0
  jobSteps.push({
    name: 'Run validation',
    run: getValidateCommand(packageManager),
    env: {
      GH_TOKEN: '${{ github.token }}',
    },
  });

  const jobMetadata = buildJobMetadata(config);

  jobs['validate'] = {
    name: 'Run vibe-validate validation',
    'runs-on': '${{ matrix.os }}',
    ...jobMetadata,
    steps: jobSteps,
    strategy: {
      'fail-fast': matrixFailFast,
      matrix: {
        os,
        node: nodeVersions,
      },
    },
  };

  // Add coverage job if enabled (separate, runs on ubuntu only)
  if (enableCoverage) {
    const coverageSteps = buildCommonJobSteps({
      packageManager,
      ciSetupSteps,
      registryUrlConfig,
      nodeVersionLabel: nodeVersions[0],
      nodeCacheConfig: { cache: packageManager } as Record<string, string>,
      hasBuildScript,
      skipNodeSetup: packageManager === 'bun',
    });

    coverageSteps.push({
      name: 'Run tests with coverage',
      run: getCoverageCommand(packageManager),
    });

    if (coverageProvider === 'codecov') {
      coverageSteps.push({
        name: 'Upload coverage to Codecov',
        uses: 'codecov/codecov-action@v4',
        with: {
          token: `\${{ secrets.${codecovTokenSecret} }}`,
          files: './coverage/coverage-final.json',
          'fail_ci_if_error': false,
        },
      });
    }

    jobs['validate-coverage'] = {
      name: 'Run validation with coverage',
      'runs-on': DEFAULT_RUNNER_OS,
      ...jobMetadata,
      steps: coverageSteps,
    };
  }

  // Add gate job - all validation must pass
  const allJobs = enableCoverage ? ['validate', 'validate-coverage'] : ['validate'];

  jobs['all-validation-passed'] = {
    name: 'All Validation Passed',
    'runs-on': DEFAULT_RUNNER_OS,
    needs: allJobs,
    if: 'always()',
    steps: [
      {
        name: 'Check all validation jobs',
        run: generateCheckScript(allJobs),
      },
    ],
  };

  const workflow: GitHubWorkflow = {
    name: 'Validation Pipeline',
    on: {
      push: {
        branches: [config.git?.mainBranch ?? 'main'],
      },
      pull_request: {
        branches: [config.git?.mainBranch ?? 'main'],
      },
    },
    ...buildWorkflowMetadata(config),
    jobs,
  };

  // Generate YAML with header comment
  const header = [
    '# THIS FILE IS AUTO-GENERATED by vibe-validate generate-workflow',
    '# DO NOT EDIT MANUALLY - Edit vibe-validate.config.yaml instead',
    '# Regenerate with: npx vibe-validate generate-workflow',
    '#',
    '# Source of truth: vibe-validate.config.yaml',
    '',
  ].join('\n');

  const workflowYaml = yamlStringify(workflow);

  return header + workflowYaml;
}

/**
 * Convert CI config to GenerateWorkflowOptions
 *
 * @param config - Full vibe-validate configuration
 * @returns Workflow options derived from config.ci
 */
export function ciConfigToWorkflowOptions(config: VibeValidateConfig): Partial<GenerateWorkflowOptions> {
  if (!config.ci) {
    return {};
  }

  return {
    nodeVersions: config.ci.nodeVersions,
    os: config.ci.os,
    packageManager: config.ci.packageManager,
    matrixFailFast: config.ci.failFast,
    enableCoverage: config.ci.coverage,
  };
}

/**
 * Check if workflow file is in sync with validation config
 *
 * @param config - Vibe-validate configuration
 * @param options - Workflow generation options
 * @param workflowPath - Path to workflow file (defaults to '.github/workflows/validate.yml' for backwards compatibility)
 */
export function checkSync(
  config: VibeValidateConfig,
  options: GenerateWorkflowOptions = {},
  workflowPath: string = '.github/workflows/validate.yml'
): { inSync: boolean; diff?: string } {
  if (!existsSync(workflowPath)) {
    return {
      inSync: false,
      diff: 'Workflow file does not exist - needs generation',
    };
  }

  const currentWorkflow = readFileSync(workflowPath, 'utf8');
  const expectedWorkflow = generateWorkflow(config, options);

  // Normalize line endings for cross-platform comparison (Windows CRLF vs Unix LF)
  const normalizedCurrent = normalizeLineEndings(currentWorkflow);
  const normalizedExpected = normalizeLineEndings(expectedWorkflow);

  if (normalizedCurrent === normalizedExpected) {
    return { inSync: true };
  }

  return {
    inSync: false,
    diff: 'Workflow file differs from validation config',
  };
}

/**
 * Main command handler for Commander.js
 */
export function generateWorkflowCommand(program: Command): void {
  program
    .command('generate-workflow')
    .description('Generate GitHub Actions workflow from vibe-validate config')
    .option('--check', 'Check if workflow is in sync with config (exit 0 if in sync, 1 if not)')
    .option('--dry-run', 'Show generated workflow without writing to file')
    .option('--coverage', 'Enable coverage reporting (Codecov)')
    .option('--node-versions <versions>', 'Node.js versions to test (comma-separated, default: "20,22")')
    .option('--os <systems>', 'Operating systems to test (comma-separated, default: "ubuntu-latest")')
    .option('--fail-fast', 'Fail fast in matrix strategy (default: false)')
    .action(async (options: {
      check?: boolean;
      dryRun?: boolean;
      coverage?: boolean;
      nodeVersions?: string;
      os?: string;
      failFast?: boolean;
    }) => {
      try {
        // Load configuration
        const config = await loadConfig();
        if (!config) {
          console.error('❌ Failed to load vibe-validate config');
          console.error('   Make sure vibe-validate.config.yaml exists and is valid.');
          process.exit(1);
        }

        // Detect git root for project-relative operations
        const gitRoot = findGitRoot();
        const projectRoot = gitRoot ?? process.cwd();

        // Parse options with config.ci as defaults
        // Priority: CLI flags > config.ci > generateWorkflow defaults
        const ciOptions = ciConfigToWorkflowOptions(config);
        const generateOptions: GenerateWorkflowOptions = {
          projectRoot,
          packageManager: detectPackageManager(projectRoot),
          enableCoverage: options.coverage ?? ciOptions.enableCoverage ?? false,
          nodeVersions: options.nodeVersions
            ? options.nodeVersions.split(',').map(v => v.trim())
            : ciOptions.nodeVersions,
          os: options.os
            ? options.os.split(',').map(o => o.trim())
            : ciOptions.os,
          matrixFailFast: options.failFast ?? ciOptions.matrixFailFast ?? false,
        };

        if (options.check) {
          // Check sync only
          const { inSync, diff } = checkSync(config, generateOptions);

          if (inSync) {
            console.log('✅ Workflow file is in sync with validation config');
            process.exit(0);
          } else {
            console.log('❌ Workflow file is out of sync with validation config');
            console.log('');
            console.log(diff);
            console.log('');
            console.log('Run this to regenerate:');
            console.log('  npx vibe-validate generate-workflow');
            process.exit(1);
          }
        } else if (options.dryRun) {
          // Show output without writing
          const workflow = generateWorkflow(config, generateOptions);
          console.log(workflow);
        } else {
          // Generate and write workflow
          const workflow = generateWorkflow(config, generateOptions);
          const workflowPath = join(projectRoot, '.github/workflows/validate.yml');

          // Ensure directory exists
          const workflowDir = dirname(workflowPath);
          if (!existsSync(workflowDir)) {
            mkdirSyncReal(workflowDir, { recursive: true });
          }

          writeFileSync(workflowPath, workflow);

          console.log('✅ Generated workflow file:');
          console.log(`   ${workflowPath}`);
          console.log('');
          console.log('📝 Commit this file to version control');
        }
      } catch (error) {
        console.error('❌ Failed to generate workflow:');
        console.error(error instanceof Error ? error.message : String(error));
        console.error('');
        console.error('Make sure vibe-validate.config.yaml exists and is valid.');
        process.exit(1);
      }
    });
}

/**
 * Show verbose help with detailed documentation
 */
export function showGenerateWorkflowVerboseHelp(): void {
  console.log(`# generate-workflow Command Reference

> Generate GitHub Actions workflow from vibe-validate config

## Overview

The \`generate-workflow\` command generates a \`.github/workflows/validate.yml\` file from your vibe-validate configuration. It ensures perfect sync between local validation and CI validation by using the same configuration source.

## How It Works

1. Reads vibe-validate.config.yaml configuration
2. Generates a single validate job matching local behavior
3. Supports matrix strategy for multiple Node/OS versions
4. Can check if workflow is in sync with config

## Options

- \`--check\` - Check if workflow is in sync with config (exit 0 if in sync, 1 if not)
- \`--dry-run\` - Show generated workflow without writing to file
- \`--coverage\` - Enable coverage reporting (Codecov)
- \`--node-versions <versions>\` - Node.js versions to test (comma-separated, default: "20,22")
- \`--os <systems>\` - Operating systems to test (comma-separated, default: "ubuntu-latest")
- \`--fail-fast\` - Fail fast in matrix strategy (default: false)

## Exit Codes

- \`0\` - Workflow generated (or in sync with --check)
- \`1\` - Generation failed (or out of sync with --check)

## Examples

\`\`\`bash
# Generate workflow from config
vibe-validate generate-workflow

# Generate with custom Node.js versions
vibe-validate generate-workflow --node-versions 20,22

# Generate with multiple OS and Node.js versions
vibe-validate generate-workflow --node-versions 20,22 --os ubuntu-latest,macos-latest

# Check if workflow is up to date
vibe-validate generate-workflow --check

# Preview without writing
vibe-validate generate-workflow --dry-run
\`\`\`

## Common Workflows

### Initial workflow setup

\`\`\`bash
# Initialize config
vibe-validate init

# Generate workflow
vibe-validate generate-workflow

# Commit workflow
git add .github/workflows/validate.yml
git commit -m "Add CI validation workflow"
\`\`\`

### Update workflow after config changes

\`\`\`bash
# Edit config
vim vibe-validate.config.yaml

# Check if workflow is in sync
vibe-validate generate-workflow --check

# If out of sync, regenerate
vibe-validate generate-workflow

# Review changes
git diff .github/workflows/validate.yml

# Commit if looks good
git add .github/workflows/validate.yml
git commit -m "Update CI workflow"
\`\`\`

### Multi-OS testing

\`\`\`bash
# Generate workflow for Ubuntu, macOS, and Windows
vibe-validate generate-workflow \\
  --node-versions 20,22 \\
  --os ubuntu-latest,macos-latest,windows-latest

# Review generated workflow
cat .github/workflows/validate.yml
\`\`\`

## Error Recovery

**If generation fails:**
1. Check configuration is valid: \`vibe-validate config --validate\`
2. Ensure .github/workflows directory exists
3. Verify file permissions

**If workflow is out of sync:**
\`\`\`bash
# Regenerate workflow
vibe-validate generate-workflow

# Or use init command
vibe-validate init --setup-workflow
\`\`\`
`);
}

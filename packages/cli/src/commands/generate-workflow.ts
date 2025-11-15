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

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { stringify as yamlStringify } from 'yaml';
import { Command } from 'commander';
import { loadConfig } from '../utils/config-loader.js';
import { normalizeLineEndings } from '../utils/normalize-line-endings.js';
import type { VibeValidateConfig, ValidationPhase } from '@vibe-validate/config';

/**
 * GitHub Actions workflow step structure
 */
interface GitHubWorkflowStep {
  name?: string;
  uses?: string;
  with?: Record<string, unknown>;
  run?: string;
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
}

/**
 * GitHub Actions workflow root structure
 */
interface GitHubWorkflow {
  name: string;
  on: unknown;
  jobs: Record<string, GitHubWorkflowJob>;
}

/**
 * Generate GitHub Actions workflow options
 */
export interface GenerateWorkflowOptions {
  /** Node.js versions to test (default: ['20', '22']) - set to single version to disable matrix */
  nodeVersions?: string[];
  /** Operating systems to test (default: ['ubuntu-latest']) - set to single OS to disable matrix */
  os?: string[];
  /** Package manager (default: 'npm', auto-detects pnpm) */
  packageManager?: 'npm' | 'pnpm';
  /** Enable coverage reporting (default: false) */
  enableCoverage?: boolean;
  /** Coverage provider (default: 'codecov') */
  coverageProvider?: 'codecov' | 'coveralls';
  /** Codecov token secret name (default: 'CODECOV_TOKEN') */
  codecovTokenSecret?: string;
  /** Use matrix strategy for multi-OS/Node testing (default: true if multiple values provided) */
  useMatrix?: boolean;
  /** Fail fast in matrix (default: false) */
  matrixFailFast?: boolean;
}

/**
 * Convert phase/step name to valid GitHub Actions job ID
 * (lowercase, replace spaces with dashes, remove special chars)
 */
export function toJobId(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/(^-)|(-$)/g, '');
}

/**
 * Get all job IDs from validation phases
 * Handles both phase-based (parallel: false) and step-based (parallel: true) jobs
 */
export function getAllJobIds(phases: ValidationPhase[]): string[] {
  const jobIds: string[] = [];

  for (const phase of phases) {
    if (phase.parallel === false) {
      // Phase-based: one job per phase
      jobIds.push(toJobId(phase.name));
    } else {
      // Step-based: one job per step
      for (const step of phase.steps) {
        jobIds.push(toJobId(step.name));
      }
    }
  }

  return jobIds;
}

/**
 * Create common job setup steps (checkout, node, package manager)
 */
function createCommonJobSetupSteps(
  nodeVersion: string,
  packageManager: string
): GitHubWorkflowStep[] {
  const steps: GitHubWorkflowStep[] = [
    {
      uses: 'actions/checkout@v4',
      with: {
        'fetch-depth': 0  // Fetch all history for git-based checks (doctor command)
      }
    },
    {
      uses: 'actions/setup-node@v4',
      with: {
        'node-version': nodeVersion,
        cache: packageManager,
      },
    },
  ];

  // Install dependencies
  if (packageManager === 'pnpm') {
    steps.push(
      {
        name: 'Install pnpm',
        uses: 'pnpm/action-setup@v2',
        with: { version: '8' },
      },
      { run: 'pnpm install' }
    );
  } else {
    steps.push({ run: 'npm ci' });
  }

  return steps;
}

/**
 * Add coverage reporting steps if enabled for this step
 */
function addCoverageReportingSteps(
  jobSteps: GitHubWorkflowStep[],
  stepName: string,
  enableCoverage: boolean,
  coverageProvider: string
): void {
  if (enableCoverage && stepName.toLowerCase().includes('coverage')) {
    if (coverageProvider === 'codecov') {
      jobSteps.push({
        name: 'Upload coverage to Codecov',
        uses: 'codecov/codecov-action@v3',
        with: {
          'fail_ci_if_error': true,
        },
      });
    } else if (coverageProvider === 'coveralls') {
      jobSteps.push({
        name: 'Upload coverage to Coveralls',
        uses: 'coverallsapp/github-action@v2',
      });
    }
  }
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
    .join(' || \\\n             ');

  return `if ${checks}; then
            echo "❌ Some validation checks failed"
            exit 1
          fi
          echo "✅ All validation checks passed!"`;
}

/**
 * Detect package manager from package.json and lockfiles
 * Priority:
 * 1. package.json packageManager field (official spec)
 * 2. Lockfile detection (prefer npm when both exist)
 */
function detectPackageManager(cwd: string = process.cwd()): 'npm' | 'pnpm' {
  // 1. Check package.json packageManager field (official spec)
  try {
    const packageJsonPath = join(cwd, 'package.json');
    if (existsSync(packageJsonPath)) {
      const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
      if (packageJson.packageManager) {
        if (packageJson.packageManager.startsWith('pnpm@')) return 'pnpm';
        if (packageJson.packageManager.startsWith('npm@')) return 'npm';
      }
    }
  } catch {
    // Continue to lockfile detection
  }

  // 2. Check for lockfiles
  const hasNpmLock = existsSync(join(cwd, 'package-lock.json'));
  const hasPnpmLock = existsSync(join(cwd, 'pnpm-lock.yaml'));

  // If only one lockfile exists, use that package manager
  if (hasPnpmLock && !hasNpmLock) return 'pnpm';
  if (hasNpmLock && !hasPnpmLock) return 'npm';

  // If both exist, prefer npm (more conservative default)
  return 'npm';
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
 * Generate GitHub Actions workflow from validation config
 */
// eslint-disable-next-line sonarjs/cognitive-complexity -- Complexity 69 acceptable for workflow generation (converts config phases/steps into GitHub Actions YAML with proper dependency management and caching logic)
export function generateWorkflow(
  config: VibeValidateConfig,
  options: GenerateWorkflowOptions = {}
): string {
  const {
    nodeVersions = [detectNodeVersion()],
    os = ['ubuntu-latest'],
    packageManager = detectPackageManager(),
    enableCoverage = false,
    coverageProvider = 'codecov',
    codecovTokenSecret = 'CODECOV_TOKEN',
    matrixFailFast = false,
  } = options;

  // Determine if we should use matrix strategy
  const useMatrix = options.useMatrix ?? (nodeVersions.length > 1 || os.length > 1);

  const jobs: Record<string, GitHubWorkflowJob> = {};
  const phases = config.validation.phases;

  if (useMatrix) {
    // Matrix strategy: Create single job that runs validation with matrix
    const jobSteps: GitHubWorkflowStep[] = [
      {
        uses: 'actions/checkout@v4',
        with: {
          'fetch-depth': 0  // Fetch all history for git-based checks (doctor command)
        }
      },
    ];

    // Add pnpm setup if needed
    if (packageManager === 'pnpm') {
      jobSteps.push({
        name: 'Setup pnpm',
        uses: 'pnpm/action-setup@v2',
        with: { version: '9' },
      });
    }

    // Setup Node.js with matrix variable
    jobSteps.push({
      name: 'Setup Node.js ${{ matrix.node }}',
      uses: 'actions/setup-node@v4',
      with: {
        'node-version': '${{ matrix.node }}',
        cache: packageManager,
      },
    });

    // Install dependencies
    jobSteps.push({
      name: 'Install dependencies',
      run: packageManager === 'pnpm' ? 'pnpm install' : 'npm ci',
    });

    // Add build step if needed (common pattern)
    const hasBuildPhase = phases.some(p =>
      p.steps.some(s => s.name.toLowerCase().includes('build'))
    );
    if (hasBuildPhase) {
      jobSteps.push({
        name: 'Build packages',
        run: packageManager === 'pnpm' ? 'pnpm -r build' : 'npm run build',
      });
    }

    // Run validation with --yaml --verbose flags for structured output
    // Redirect stdout (YAML result) to file, stderr (verbose logs) to console
    const validateCommand = packageManager === 'pnpm'
      ? 'pnpm validate --yaml --verbose'
      : 'npm run validate -- --yaml --verbose';

    jobSteps.push({
      name: 'Run validation (Unix)',
      if: "runner.os != 'Windows'",
      run: `${validateCommand} 1>validation-result.yaml || true`,
    });

    jobSteps.push({
      name: 'Run validation (Windows)',
      if: "runner.os == 'Windows'",
      shell: 'powershell',
      run: `${validateCommand} 1>validation-result.yaml
$exitCode = $LASTEXITCODE
exit 0  # Always succeed to allow result display`,
    });

    // Display validation result from YAML file (always runs, even on failure)
    jobSteps.push({
      name: 'Display validation result (Unix)',
      if: "always() && runner.os != 'Windows'",
      run: `echo "=========================================="
echo "VALIDATION RESULT"
echo "=========================================="
cat validation-result.yaml 2>/dev/null || echo "❌ Could not read validation result"
echo "=========================================="`,
    });

    jobSteps.push({
      name: 'Display validation result (Windows)',
      if: "always() && runner.os == 'Windows'",
      shell: 'powershell',
      run: `Write-Host '=========================================='
Write-Host 'VALIDATION RESULT'
Write-Host '=========================================='
if (Test-Path validation-result.yaml) { Get-Content validation-result.yaml } else { Write-Host 'Could not read validation result' }
Write-Host '=========================================='`,
    });

    // Fail the job if validation failed (check YAML result - Unix)
    // Match "passed: true" anywhere in file (YAML now has --- separator on line 1)
    jobSteps.push({
      name: 'Check validation result (Unix)',
      if: "always() && runner.os != 'Windows'",
      run: `grep -q "passed: true" validation-result.yaml || exit 1`,
    });

    // Fail the job if validation failed (check YAML result - Windows)
    // Match "passed: true" anywhere in file (YAML now has --- separator on line 1)
    jobSteps.push({
      name: 'Check validation result (Windows)',
      if: "always() && runner.os == 'Windows'",
      shell: 'powershell',
      run: `if (!(Select-String -Path validation-result.yaml -Pattern "passed: true" -Quiet)) { exit 1 }`,
    });

    jobs['validate'] = {
      name: 'Run vibe-validate validation',
      'runs-on': '${{ matrix.os }}',
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
      const coverageSteps: GitHubWorkflowStep[] = [
        {
          uses: 'actions/checkout@v4',
          with: {
            'fetch-depth': 0  // Fetch all history for git-based checks (doctor command)
          }
        },
      ];

      if (packageManager === 'pnpm') {
        coverageSteps.push({
          name: 'Setup pnpm',
          uses: 'pnpm/action-setup@v2',
          with: { version: '9' },
        });
      }

      coverageSteps.push({
        name: 'Setup Node.js',
        uses: 'actions/setup-node@v4',
        with: {
          'node-version': nodeVersions[0],
          cache: packageManager,
        },
      });

      coverageSteps.push({
        name: 'Install dependencies',
        run: packageManager === 'pnpm' ? 'pnpm install' : 'npm ci',
      });

      if (hasBuildPhase) {
        coverageSteps.push({
          name: 'Build packages',
          run: packageManager === 'pnpm' ? 'pnpm -r build' : 'npm run build',
        });
      }

      coverageSteps.push({
        name: 'Run tests with coverage',
        run: packageManager === 'pnpm' ? 'pnpm test:coverage' : 'npm run test:coverage',
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
        'runs-on': 'ubuntu-latest',
        steps: coverageSteps,
      };
    }
  } else {
    // Non-matrix: Create jobs based on parallel flag
    // - parallel: false → One job per phase (phase-based grouping)
    // - parallel: true → One job per step (step-based parallelism)

    let previousJobIds: string[] | undefined;

    for (let phaseIndex = 0; phaseIndex < phases.length; phaseIndex++) {
      const phase = phases[phaseIndex];

      // Determine needs based on previous phase
      let needs: string[] | undefined = previousJobIds;

      if (phase.parallel === false) {
        // Phase-based grouping: ONE job with sequential workflow steps
        const phaseJobId = toJobId(phase.name);
        const jobSteps = createCommonJobSetupSteps(nodeVersions[0], packageManager);

        // Add bootstrap build if this phase has a build step
        const hasBuildStep = phase.steps.some(s => s.name.toLowerCase().includes('build'));
        if (hasBuildStep) {
          jobSteps.push({
            name: 'Build packages',
            run: packageManager === 'pnpm' ? 'pnpm -r build' : 'npm run build',
          });
        }

        // Add each step as a separate workflow step
        for (const step of phase.steps) {
          const stepWorkflowStep: GitHubWorkflowStep = {
            name: step.name,
            run: step.command,
          };

          // Add environment variables from step config
          if (step.env) {
            stepWorkflowStep.env = { ...step.env };
          }

          jobSteps.push(stepWorkflowStep);

          // Add coverage reporting if enabled
          addCoverageReportingSteps(jobSteps, step.name, enableCoverage, coverageProvider);
        }

        jobs[phaseJobId] = {
          name: phase.name,
          'runs-on': os[0],
          ...(needs && { needs }),
          steps: jobSteps,
        };

        // Next phase depends on this phase job
        previousJobIds = [phaseJobId];
      } else {
        // Step-based parallelism: Separate job for each step (existing behavior)
        const stepJobIds: string[] = [];

        for (const step of phase.steps) {
          const jobId = toJobId(step.name);
          stepJobIds.push(jobId);

          const jobSteps = createCommonJobSetupSteps(nodeVersions[0], packageManager);

          // Add the actual validation command
          const testStep: GitHubWorkflowStep = { run: step.command };

          // Add environment variables from step config
          if (step.env) {
            testStep.env = { ...step.env };
          }

          jobSteps.push(testStep);

          // Add coverage reporting if enabled
          addCoverageReportingSteps(jobSteps, step.name, enableCoverage, coverageProvider);

          jobs[jobId] = {
            name: step.name,
            'runs-on': os[0],
            ...(needs && { needs }),
            steps: jobSteps,
          };
        }

        // Next phase depends on ALL step jobs from this phase
        previousJobIds = stepJobIds;
      }
    }
  }

  // Add gate job - all validation must pass
  let allJobs: string[];
  if (useMatrix) {
    allJobs = enableCoverage ? ['validate', 'validate-coverage'] : ['validate'];
  } else {
    allJobs = getAllJobIds(phases);
  }

  jobs['all-validation-passed'] = {
    name: 'All Validation Passed',
    'runs-on': 'ubuntu-latest',
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
    matrixFailFast: config.ci.failFast,
    enableCoverage: config.ci.coverage,
  };
}

/**
 * Check if workflow file is in sync with validation config
 */
export function checkSync(
  config: VibeValidateConfig,
  options: GenerateWorkflowOptions = {}
): { inSync: boolean; diff?: string } {
  const workflowPath = '.github/workflows/validate.yml';

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

        // Parse options with config.ci as defaults
        // Priority: CLI flags > config.ci > generateWorkflow defaults
        const ciOptions = ciConfigToWorkflowOptions(config);
        const generateOptions: GenerateWorkflowOptions = {
          packageManager: detectPackageManager(),
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
          const workflowPath = '.github/workflows/validate.yml';

          // Ensure directory exists
          const workflowDir = dirname(workflowPath);
          if (!existsSync(workflowDir)) {
            mkdirSync(workflowDir, { recursive: true });
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
2. Generates GitHub Actions workflow with proper job dependencies
3. Supports matrix mode (multiple Node/OS versions)
4. Supports non-matrix mode (separate jobs per phase)
5. Can check if workflow is in sync with config

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

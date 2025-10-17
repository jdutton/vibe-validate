#!/usr/bin/env node
/**
 * Doctor Command
 *
 * Diagnoses common issues with vibe-validate setup:
 * - Environment checks (Node.js version, package manager, git)
 * - Configuration validation
 * - Git integration health
 * - CI/CD workflow sync
 *
 * @packageDocumentation
 */

import { existsSync, readFileSync } from 'fs';
import { execSync } from 'child_process';
import { Command } from 'commander';
import { loadConfig } from '../utils/config-loader.js';
import { checkSync, ciConfigToWorkflowOptions } from './generate-workflow.js';

/**
 * Result of a single doctor check
 */
export interface DoctorCheckResult {
  /** Name of the check */
  name: string;
  /** Whether the check passed */
  passed: boolean;
  /** Message describing the result */
  message: string;
  /** Optional suggestion for fixing the issue */
  suggestion?: string;
}

/**
 * Overall doctor diagnostic result
 */
export interface DoctorResult {
  /** Whether all checks passed */
  allPassed: boolean;
  /** Individual check results */
  checks: DoctorCheckResult[];
  /** Suggestions for fixing failures */
  suggestions: string[];
  /** Whether verbose mode was enabled */
  verboseMode?: boolean;
  /** Total number of checks run */
  totalChecks: number;
  /** Number of checks that passed */
  passedChecks: number;
}

/**
 * Options for running doctor checks
 */
export interface DoctorOptions {
  /** Show all checks including passing ones */
  verbose?: boolean;
}

/**
 * Check Node.js version meets requirements
 */
function checkNodeVersion(): DoctorCheckResult {
  try {
    const version = execSync('node --version', { encoding: 'utf8' }).trim();
    const majorVersion = parseInt(version.replace('v', '').split('.')[0]);

    if (majorVersion >= 20) {
      return {
        name: 'Node.js version',
        passed: true,
        message: `${version} (meets requirement: >=20.0.0)`,
      };
    } else {
      return {
        name: 'Node.js version',
        passed: false,
        message: `${version} is too old. Node.js 20+ required.`,
        suggestion: 'Upgrade Node.js: https://nodejs.org/ or use nvm',
      };
    }
  } catch (_error) {
    return {
      name: 'Node.js version',
      passed: false,
      message: 'Failed to detect Node.js version',
      suggestion: 'Install Node.js: https://nodejs.org/',
    };
  }
}

/**
 * Check if git is installed
 */
function checkGitInstalled(): DoctorCheckResult {
  try {
    const version = execSync('git --version', { encoding: 'utf8' }).trim();
    return {
      name: 'Git installed',
      passed: true,
      message: version,
    };
  } catch (_error) {
    return {
      name: 'Git installed',
      passed: false,
      message: 'Git is not installed',
      suggestion: 'Install Git: https://git-scm.com/',
    };
  }
}

/**
 * Check if current directory is a git repository
 */
function checkGitRepository(): DoctorCheckResult {
  try {
    execSync('git rev-parse --git-dir', { encoding: 'utf8', stdio: 'pipe' });
    return {
      name: 'Git repository',
      passed: true,
      message: 'Current directory is a git repository',
    };
  } catch (_error) {
    return {
      name: 'Git repository',
      passed: false,
      message: 'Current directory is not a git repository',
      suggestion: 'Run: git init',
    };
  }
}

/**
 * Check if configuration file exists
 */
function checkConfigFile(): DoctorCheckResult {
  const configPatterns = [
    'vibe-validate.config.ts',
    'vibe-validate.config.mjs',
    'vibe-validate.config.js',
    'vibe-validate.config.json',
    'vibe-validate.config.yaml',
    'vibe-validate.config.yml',
  ];

  const found = configPatterns.find(pattern => existsSync(pattern));

  if (found) {
    return {
      name: 'Configuration file',
      passed: true,
      message: `Found: ${found}`,
    };
  } else {
    return {
      name: 'Configuration file',
      passed: false,
      message: 'Configuration file not found',
      suggestion: 'Run: npx vibe-validate init',
    };
  }
}

/**
 * Check if configuration is valid
 */
async function checkConfigValid(): Promise<DoctorCheckResult> {
  try {
    const config = await loadConfig();
    if (!config) {
      return {
        name: 'Configuration valid',
        passed: false,
        message: 'Failed to load configuration',
        suggestion: 'Check syntax in vibe-validate.config.*',
      };
    }

    return {
      name: 'Configuration valid',
      passed: true,
      message: `Loaded successfully (${config.validation.phases.length} phases)`,
    };
  } catch (_error) {
    return {
      name: 'Configuration valid',
      passed: false,
      message: `Invalid configuration: ${_error instanceof Error ? _error.message : String(_error)}`,
      suggestion: 'Fix syntax errors in vibe-validate.config.*',
    };
  }
}

/**
 * Check if package manager is available
 */
async function checkPackageManager(): Promise<DoctorCheckResult> {
  try {
    const config = await loadConfig();
    if (!config) {
      // Config check will catch this
      return {
        name: 'Package manager',
        passed: true,
        message: 'Skipped (no config)',
      };
    }

    // Detect package manager from config commands
    const firstCommand = config.validation.phases[0]?.steps[0]?.command || '';
    const pm = firstCommand.startsWith('pnpm ') ? 'pnpm' : 'npm';

    try {
      const version = execSync(`${pm} --version`, { encoding: 'utf8' }).trim();
      return {
        name: 'Package manager',
        passed: true,
        message: `${pm} ${version} is available`,
      };
    } catch (_error) {
      return {
        name: 'Package manager',
        passed: false,
        message: `${pm} not found (required by config commands)`,
        suggestion: pm === 'pnpm'
          ? 'Install pnpm: npm install -g pnpm'
          : 'npm should be installed with Node.js',
      };
    }
  } catch (_error) {
    return {
      name: 'Package manager',
      passed: true,
      message: 'Skipped (config check failed)',
    };
  }
}

/**
 * Check if GitHub Actions workflow is in sync
 */
async function checkWorkflowSync(): Promise<DoctorCheckResult> {
  const workflowPath = '.github/workflows/validate.yml';

  if (!existsSync(workflowPath)) {
    return {
      name: 'GitHub Actions workflow',
      passed: true,
      message: 'No workflow file (optional)',
    };
  }

  try {
    const config = await loadConfig();
    if (!config) {
      return {
        name: 'GitHub Actions workflow',
        passed: true,
        message: 'Skipped (no config)',
      };
    }

    // Use CI config from vibe-validate.config.mjs if available
    const generateOptions = ciConfigToWorkflowOptions(config);

    const { inSync, diff } = checkSync(config, generateOptions);

    if (inSync) {
      return {
        name: 'GitHub Actions workflow',
        passed: true,
        message: 'Workflow is in sync with config',
      };
    } else {
      return {
        name: 'GitHub Actions workflow',
        passed: false,
        message: `Workflow is out of sync: ${diff || 'differs from config'}`,
        suggestion: 'Run: npx vibe-validate generate-workflow',
      };
    }
  } catch (_error) {
    return {
      name: 'GitHub Actions workflow',
      passed: false,
      message: `Failed to check workflow sync: ${_error instanceof Error ? _error.message : String(_error)}`,
      suggestion: 'Verify workflow file syntax',
    };
  }
}

/**
 * Check if pre-commit hook is installed
 */
async function checkPreCommitHook(): Promise<DoctorCheckResult> {
  const huskyPath = '.husky/pre-commit';

  // Load config to check if pre-commit is enabled
  // If config fails to load, use defaults (will be caught by checkConfigValid)
  let config;
  try {
    config = await loadConfig();
  } catch (_error) {
    // Config load failed - use defaults (error will be reported in checkConfigValid)
    config = null;
  }

  const preCommitEnabled = config?.hooks?.preCommit?.enabled ?? true; // Default true
  const expectedCommand = config?.hooks?.preCommit?.command ?? 'npx vibe-validate pre-commit';

  // If user explicitly disabled, acknowledge their choice
  if (!preCommitEnabled) {
    return {
      name: 'Pre-commit hook',
      passed: true,
      message: 'Pre-commit hook disabled in config (user preference)',
    };
  }

  // ⚠️ ENABLED but not installed
  if (!existsSync(huskyPath)) {
    return {
      name: 'Pre-commit hook',
      passed: false,
      message: 'Pre-commit hook not installed',
      suggestion: 'Install: npx husky init && echo "npx vibe-validate pre-commit" > .husky/pre-commit (or set hooks.preCommit.enabled=false to disable)',
    };
  }

  try {
    const hookContent = readFileSync(huskyPath, 'utf8');

    // Check if hook runs vibe-validate (directly or via npm script)
    const hasVibeValidate = hookContent.includes('vibe-validate pre-commit') ||
                            hookContent.includes('npm run pre-commit') ||
                            hookContent.includes('pnpm pre-commit') ||
                            hookContent.includes('npx vibe-validate validate');

    if (hasVibeValidate) {
      return {
        name: 'Pre-commit hook',
        passed: true,
        message: 'Pre-commit hook installed and runs vibe-validate',
      };
    } else {
      // ⚠️ ENABLED but custom hook (needs verification)
      const hookPreview = hookContent.split('\n').slice(0, 3).join('; ').trim();
      return {
        name: 'Pre-commit hook',
        passed: false,
        message: `Custom pre-commit hook detected: "${hookPreview}..."`,
        suggestion: `Verify that .husky/pre-commit runs "${expectedCommand}" OR set hooks.preCommit.enabled=false if you're handling validation differently`,
      };
    }
  } catch (_error) {
    return {
      name: 'Pre-commit hook',
      passed: false,
      message: 'Pre-commit hook exists but unreadable',
      suggestion: 'Fix file permissions or set hooks.preCommit.enabled=false',
    };
  }
}

/**
 * Check if validation state file exists
 */
function checkValidationState(): DoctorCheckResult {
  const statePath = '.vibe-validate-state.yaml';

  if (existsSync(statePath)) {
    return {
      name: 'Validation state',
      passed: true,
      message: 'Validation state file exists',
    };
  } else {
    return {
      name: 'Validation state',
      passed: false,
      message: 'Validation state file not found',
      suggestion: 'Run validation at least once: npx vibe-validate validate',
    };
  }
}

/**
 * Run all doctor checks
 */
export async function runDoctor(options: DoctorOptions = {}): Promise<DoctorResult> {
  const { verbose = false } = options;
  const allChecks: DoctorCheckResult[] = [];

  // Run all checks
  allChecks.push(checkNodeVersion());
  allChecks.push(checkGitInstalled());
  allChecks.push(checkGitRepository());
  allChecks.push(checkConfigFile());
  allChecks.push(await checkConfigValid());
  allChecks.push(await checkPackageManager());
  allChecks.push(await checkWorkflowSync());
  allChecks.push(await checkPreCommitHook());
  allChecks.push(checkValidationState());

  // Collect suggestions from failed checks
  const suggestions: string[] = allChecks
    .filter(c => !c.passed && c.suggestion)
    .map(c => c.suggestion as string);

  const allPassed = allChecks.every(c => c.passed);
  const totalChecks = allChecks.length;
  const passedChecks = allChecks.filter(c => c.passed).length;

  // In non-verbose mode, only show failing checks (or all if all pass for summary)
  const checks = verbose ? allChecks : (allPassed ? allChecks : allChecks.filter(c => !c.passed));

  return {
    allPassed,
    checks,
    suggestions,
    verboseMode: verbose,
    totalChecks,
    passedChecks,
  };
}

/**
 * Main command handler for Commander.js
 */
export function doctorCommand(program: Command): void {
  program
    .command('doctor')
    .description('Diagnose vibe-validate setup and environment')
    .option('--json', 'Output results as JSON')
    .option('--verbose', 'Show all checks including passing ones')
    .action(async (options: { json?: boolean; verbose?: boolean }) => {
      try {
        const result = await runDoctor({ verbose: options.verbose });

        if (options.json) {
          // JSON output for programmatic use
          console.log(JSON.stringify(result, null, 2));
        } else {
          // Human-friendly output
          console.log('🩺 vibe-validate Doctor\n');

          if (result.verboseMode) {
            console.log('Running diagnostic checks (verbose mode)...\n');
          } else {
            console.log('Running diagnostic checks...\n');
          }

          // Print each check
          for (const check of result.checks) {
            const icon = check.passed ? '✅' : '❌';
            console.log(`${icon} ${check.name}`);
            console.log(`   ${check.message}`);
            if (check.suggestion && !check.passed) {
              console.log(`   💡 ${check.suggestion}`);
            }
            console.log('');
          }

          // Summary
          console.log(`📊 Results: ${result.passedChecks}/${result.totalChecks} checks passed\n`);

          if (result.allPassed) {
            console.log('✨ All checks passed! Your vibe-validate setup looks healthy.');
            if (!result.verboseMode) {
              console.log('   (Use --verbose to see all checks)');
            }
          } else {
            console.log('⚠️  Some checks failed. See suggestions above to fix.');
            if (!result.verboseMode) {
              console.log('   (Use --verbose to see all checks including passing ones)');
            }
            process.exit(1);
          }
        }
      } catch (_error) {
        console.error('❌ Doctor check failed:');
        console.error(_error instanceof Error ? _error.message : String(_error));
        process.exit(1);
      }
    });
}

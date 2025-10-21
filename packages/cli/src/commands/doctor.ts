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
import { stringify as stringifyYaml } from 'yaml';
import { loadConfig, findConfigPath, loadConfigWithErrors } from '../utils/config-loader.js';
import { checkSync, ciConfigToWorkflowOptions } from './generate-workflow.js';
import { getMainBranch, getRemoteOrigin, type VibeValidateConfig } from '@vibe-validate/config';
import { formatTemplateList } from '../utils/template-discovery.js';
import { checkHistoryHealth as checkValidationHistoryHealth } from '@vibe-validate/history';

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
  const yamlConfig = 'vibe-validate.config.yaml';

  if (existsSync(yamlConfig)) {
    return {
      name: 'Configuration file',
      passed: true,
      message: `Found: ${yamlConfig}`,
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
 *
 * @param config - Config from loadConfig() (may be null)
 * @param configWithErrors - Result from loadConfigWithErrors() with detailed error info
 */
async function checkConfigValid(
  config?: VibeValidateConfig | null,
  configWithErrors?: { config: VibeValidateConfig | null; errors: string[] | null; filePath: string | null }
): Promise<DoctorCheckResult> {
  try {
    if (!config) {
      // Check if we have detailed error information
      if (configWithErrors?.errors && configWithErrors.filePath) {
        const fileName = configWithErrors.filePath.split('/').pop() || 'vibe-validate.config.yaml';
        const errorList = configWithErrors.errors.slice(0, 5); // Show first 5 errors
        const errorMessages = errorList.map(err => `     • ${err}`).join('\n');

        return {
          name: 'Configuration valid',
          passed: false,
          message: `Found ${fileName} but it contains validation errors:\n${errorMessages}`,
          suggestion: [
            'Fix validation errors shown above',
            'See configuration docs: https://github.com/jdutton/vibe-validate/blob/main/docs/configuration-reference.md',
            'JSON Schema for IDE validation: https://raw.githubusercontent.com/jdutton/vibe-validate/main/packages/config/vibe-validate.schema.json',
            'Example YAML configs: https://github.com/jdutton/vibe-validate/tree/main/config-templates'
          ].join('\n   '),
        };
      }

      // Fallback: try to find config file path
      const configPath = findConfigPath();
      if (configPath) {
        const fileName = configPath.split('/').pop() || 'vibe-validate.config.yaml';
        return {
          name: 'Configuration valid',
          passed: false,
          message: `Found ${fileName} but it contains validation errors`,
          suggestion: [
            `Fix syntax/validation errors in ${fileName}`,
            'See configuration docs: https://github.com/jdutton/vibe-validate/blob/main/docs/configuration-reference.md',
            'JSON Schema for IDE validation: https://raw.githubusercontent.com/jdutton/vibe-validate/main/packages/config/vibe-validate.schema.json',
            'Example YAML configs: https://github.com/jdutton/vibe-validate/tree/main/config-templates'
          ].join('\n   '),
        };
      } else {
        // No config file found
        const templateList = formatTemplateList();
        return {
          name: 'Configuration valid',
          passed: false,
          message: 'No configuration file found',
          suggestion: [
            'Copy a config template from GitHub:',
            'https://github.com/jdutton/vibe-validate/tree/main/config-templates',
            '',
            'Available templates:',
            ...templateList.map(line => line),
            '',
            'Quick start:',
            'curl -o vibe-validate.config.yaml \\',
            '  https://raw.githubusercontent.com/jdutton/vibe-validate/main/config-templates/typescript-nodejs.yaml',
            '',
            'JSON Schema for IDE validation:',
            'https://raw.githubusercontent.com/jdutton/vibe-validate/main/packages/config/vibe-validate.schema.json',
          ].join('\n   '),
        };
      }
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
      suggestion: 'Check syntax in vibe-validate.config.yaml',
    };
  }
}

/**
 * Check if package manager is available
 */
async function checkPackageManager(config?: VibeValidateConfig | null): Promise<DoctorCheckResult> {
  try {
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
async function checkWorkflowSync(config?: VibeValidateConfig | null): Promise<DoctorCheckResult> {
  const workflowPath = '.github/workflows/validate.yml';

  if (!existsSync(workflowPath)) {
    return {
      name: 'GitHub Actions workflow',
      passed: true,
      message: 'No workflow file (optional)',
    };
  }

  try {
    if (!config) {
      return {
        name: 'GitHub Actions workflow',
        passed: true,
        message: 'Skipped (no config)',
      };
    }

    // Use CI config from vibe-validate config
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
        suggestion: 'Manual: npx vibe-validate generate-workflow\n   💡 Or run: vibe-validate init --setup-workflow',
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
async function checkPreCommitHook(config?: VibeValidateConfig | null): Promise<DoctorCheckResult> {
  const huskyPath = '.husky/pre-commit';

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
      suggestion: 'Manual: npx husky init && echo "npx vibe-validate pre-commit" > .husky/pre-commit\n   💡 Or run: vibe-validate init --setup-hooks\n   💡 Or disable: set hooks.preCommit.enabled=false in config',
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
        suggestion: `Manual: Verify that .husky/pre-commit runs "${expectedCommand}"\n   💡 Or run: vibe-validate init --setup-hooks\n   💡 Or disable: set hooks.preCommit.enabled=false in config`,
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
 * Check if vibe-validate version is up to date
 */
async function checkVersion(): Promise<DoctorCheckResult> {
  try {
    // Get current version from package.json
    const packageJsonPath = new URL('../../package.json', import.meta.url);
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
    const currentVersion = packageJson.version;

    // Fetch latest version from npm registry
    try {
      const latestVersion = execSync('npm view vibe-validate version', {
        encoding: 'utf8',
        stdio: 'pipe',
      }).trim();

      if (currentVersion === latestVersion) {
        return {
          name: 'vibe-validate version',
          passed: true,
          message: `Current version ${currentVersion} is up to date`,
        };
      } else {
        return {
          name: 'vibe-validate version',
          passed: true, // Warning only, not a failure
          message: `Current: ${currentVersion}, Latest: ${latestVersion} available`,
          suggestion: `Upgrade: npm install -D vibe-validate@latest (or pnpm add -D vibe-validate@latest)\n   💡 After upgrade: Run 'vibe-validate doctor' to verify setup`,
        };
      }
    } catch (_npmError) {
      // npm registry unavailable - not a critical error
      return {
        name: 'vibe-validate version',
        passed: true,
        message: `Current version: ${currentVersion} (unable to check for updates)`,
      };
    }
  } catch (_error) {
    return {
      name: 'vibe-validate version',
      passed: true,
      message: 'Unable to determine version',
    };
  }
}

/**
 * Check if .vibe-validate-state.yaml is in .gitignore
 */
function checkGitignoreStateFile(): DoctorCheckResult {
  const gitignorePath = '.gitignore';
  const stateFileName = '.vibe-validate-state.yaml';

  // Check if .gitignore exists
  if (!existsSync(gitignorePath)) {
    return {
      name: 'Gitignore state file',
      passed: true,
      message: '.gitignore file not found (state file deprecated - using git notes)',
    };
  }

  try {
    const gitignoreContent = readFileSync(gitignorePath, 'utf8');

    // Check if deprecated state file is in .gitignore
    if (gitignoreContent.includes(stateFileName)) {
      return {
        name: 'Gitignore state file (deprecated)',
        passed: false,
        message: '.vibe-validate-state.yaml in .gitignore (deprecated - can be removed)',
        suggestion: 'Remove from .gitignore: sed -i.bak \'/.vibe-validate-state.yaml/d\' .gitignore && rm .gitignore.bak\n   ℹ️  Validation now uses git notes instead of state file',
      };
    } else {
      return {
        name: 'Gitignore state file',
        passed: true,
        message: 'No deprecated state file entries in .gitignore',
      };
    }
  } catch (_error) {
    return {
      name: 'Gitignore state file',
      passed: false,
      message: '.gitignore exists but is unreadable',
      suggestion: 'Fix file permissions: chmod 644 .gitignore',
    };
  }
}

/**
 * Check if validation state file exists
 */
function checkValidationState(): DoctorCheckResult {
  const statePath = '.vibe-validate-state.yaml';

  // Check if deprecated state file exists
  if (existsSync(statePath)) {
    return {
      name: 'Validation state (deprecated)',
      passed: false,
      message: '.vibe-validate-state.yaml found (deprecated file - safe to remove)',
      suggestion: 'Remove deprecated state file: rm .vibe-validate-state.yaml\n   ℹ️  Validation now uses git notes for improved caching',
    };
  } else {
    return {
      name: 'Validation state',
      passed: true,
      message: 'No deprecated state file found (using git notes)',
    };
  }
}

/**
 * Check validation history health
 */
async function checkHistoryHealth(): Promise<DoctorCheckResult> {
  try {
    const health = await checkValidationHistoryHealth();

    if (!health.shouldWarn) {
      return {
        name: 'Validation history',
        passed: true,
        message: `${health.totalNotes} tree hashes tracked, history is healthy`,
      };
    }

    // Has warnings
    return {
      name: 'Validation history',
      passed: false,
      message: `${health.totalNotes} tree hashes tracked (${health.oldNotesCount} older than 90 days)`,
      suggestion: 'Prune old history: vibe-validate history prune --older-than "90 days"',
    };
  } catch (_error) {
    // Git notes not available or other error - not critical
    return {
      name: 'Validation history',
      passed: true,
      message: 'History unavailable (not in git repo or no validation runs yet)',
    };
  }
}

/**
 * Check if configured main branch exists locally
 */
async function checkMainBranch(config?: VibeValidateConfig | null): Promise<DoctorCheckResult> {
  try {
    if (!config) {
      return {
        name: 'Git main branch',
        passed: true,
        message: 'Skipped (no config)',
      };
    }

    const mainBranch = getMainBranch(config.git);
    const remoteOrigin = getRemoteOrigin(config.git);

    // Check for local branch first
    try {
      execSync(`git rev-parse --verify ${mainBranch}`, { stdio: 'pipe' });
      return {
        name: 'Git main branch',
        passed: true,
        message: `Branch '${mainBranch}' exists locally`,
      };
    } catch (_localError) {
      // Local branch doesn't exist, check for remote branch
      try {
        execSync(`git rev-parse --verify ${remoteOrigin}/${mainBranch}`, { stdio: 'pipe' });
        return {
          name: 'Git main branch',
          passed: true,
          message: `Branch '${mainBranch}' exists on remote '${remoteOrigin}' (fetch-depth: 0 required in CI)`,
        };
      } catch (_remoteError) {
        return {
          name: 'Git main branch',
          passed: false,
          message: `Configured main branch '${mainBranch}' does not exist locally or on remote '${remoteOrigin}'`,
          suggestion: `Create branch: git checkout -b ${mainBranch} OR update config to use existing branch (e.g., 'master', 'develop')`,
        };
      }
    }
  } catch (_error) {
    return {
      name: 'Git main branch',
      passed: true,
      message: 'Skipped (config or git error)',
    };
  }
}

/**
 * Check if configured remote origin exists
 */
async function checkRemoteOrigin(config?: VibeValidateConfig | null): Promise<DoctorCheckResult> {
  try {
    if (!config) {
      return {
        name: 'Git remote origin',
        passed: true,
        message: 'Skipped (no config)',
      };
    }

    const remoteOrigin = getRemoteOrigin(config.git);

    try {
      const remotes = execSync('git remote', { encoding: 'utf8', stdio: 'pipe' })
        .trim()
        .split('\n')
        .filter(Boolean);

      if (remotes.includes(remoteOrigin)) {
        return {
          name: 'Git remote origin',
          passed: true,
          message: `Remote '${remoteOrigin}' exists`,
        };
      } else {
        const availableRemotes = remotes.join(', ') || '(none)';
        return {
          name: 'Git remote origin',
          passed: false,
          message: `Configured remote '${remoteOrigin}' does not exist. Available: ${availableRemotes}`,
          suggestion: `Add remote: git remote add ${remoteOrigin} <url> OR update config to use existing remote (e.g., 'origin')`,
        };
      }
    } catch (_error) {
      return {
        name: 'Git remote origin',
        passed: false,
        message: 'Failed to list git remotes',
        suggestion: 'Verify git repository is initialized',
      };
    }
  } catch (_error) {
    return {
      name: 'Git remote origin',
      passed: true,
      message: 'Skipped (config or git error)',
    };
  }
}

/**
 * Check if configured main branch exists on remote
 */
async function checkRemoteMainBranch(config?: VibeValidateConfig | null): Promise<DoctorCheckResult> {
  try {
    if (!config) {
      return {
        name: 'Git remote main branch',
        passed: true,
        message: 'Skipped (no config)',
      };
    }

    const mainBranch = getMainBranch(config.git);
    const remoteOrigin = getRemoteOrigin(config.git);

    try {
      // First check if remote exists
      const remotes = execSync('git remote', { encoding: 'utf8', stdio: 'pipe' })
        .trim()
        .split('\n')
        .filter(Boolean);

      if (!remotes.includes(remoteOrigin)) {
        return {
          name: 'Git remote main branch',
          passed: true,
          message: `Skipped (remote '${remoteOrigin}' not configured)`,
        };
      }

      // Check if remote branch exists
      execSync(`git ls-remote --heads ${remoteOrigin} ${mainBranch}`, { stdio: 'pipe' });
      return {
        name: 'Git remote main branch',
        passed: true,
        message: `Branch '${mainBranch}' exists on remote '${remoteOrigin}'`,
      };
    } catch (_error) {
      return {
        name: 'Git remote main branch',
        passed: false,
        message: `Branch '${mainBranch}' does not exist on remote '${remoteOrigin}'`,
        suggestion: `Push branch: git push ${remoteOrigin} ${mainBranch} OR update config to match remote branch name`,
      };
    }
  } catch (_error) {
    return {
      name: 'Git remote main branch',
      passed: true,
      message: 'Skipped (config or git error)',
    };
  }
}

/**
 * Run all doctor checks
 */
export async function runDoctor(options: DoctorOptions = {}): Promise<DoctorResult> {
  const { verbose = false } = options;
  const allChecks: DoctorCheckResult[] = [];

  // Load config once to avoid duplicate warnings
  let config;
  let configWithErrors;
  try {
    config = await loadConfig();
    configWithErrors = await loadConfigWithErrors();
  } catch (_error) {
    // Config load error will be caught by checkConfigValid
    config = null;
    configWithErrors = { config: null, errors: null, filePath: null };
  }

  // Run all checks
  allChecks.push(await checkVersion());
  allChecks.push(checkNodeVersion());
  allChecks.push(checkGitInstalled());
  allChecks.push(checkGitRepository());
  allChecks.push(checkConfigFile());
  allChecks.push(await checkConfigValid(config, configWithErrors));
  allChecks.push(await checkPackageManager(config));
  allChecks.push(await checkMainBranch(config));
  allChecks.push(await checkRemoteOrigin(config));
  allChecks.push(await checkRemoteMainBranch(config));
  allChecks.push(await checkWorkflowSync(config));
  allChecks.push(await checkPreCommitHook(config));
  allChecks.push(checkGitignoreStateFile());
  allChecks.push(checkValidationState());
  allChecks.push(await checkHistoryHealth());

  // Collect suggestions from failed checks
  const suggestions: string[] = allChecks
    .filter(c => !c.passed && c.suggestion)
    .map(c => c.suggestion as string);

  const allPassed = allChecks.every(c => c.passed);
  const totalChecks = allChecks.length;
  const passedChecks = allChecks.filter(c => c.passed).length;

  // In non-verbose mode, only show failing checks (empty array if all pass)
  // In verbose mode, always show all checks
  const checks = verbose ? allChecks : allChecks.filter(c => !c.passed);

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
    .option('--yaml', 'Output YAML only (no human-friendly display)')
    .action(async (options: { yaml?: boolean; verbose?: boolean }, command: Command) => {
      // Get verbose from global options (inherited from program)
      const verbose = command.optsWithGlobals().verbose as boolean | undefined;
      try {
        const result = await runDoctor({ verbose });

        if (options.yaml) {
          // YAML output for programmatic use
          console.log(stringifyYaml(result));
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

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
import { formatDoctorConfigError } from '../utils/config-error-reporter.js';
import { checkSync, ciConfigToWorkflowOptions } from './generate-workflow.js';
import { getMainBranch, getRemoteOrigin, type VibeValidateConfig } from '@vibe-validate/config';
import { formatTemplateList } from '../utils/template-discovery.js';
import { checkHistoryHealth as checkValidationHistoryHealth } from '@vibe-validate/history';

/** @deprecated State file deprecated in v0.12.0 - validation now uses git notes */
const DEPRECATED_STATE_FILE = '.vibe-validate-state.yaml';

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
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      name: 'Node.js version',
      passed: false,
      message: `Failed to detect Node.js version: ${errorMessage}`,
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
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      name: 'Git installed',
      passed: false,
      message: `Git is not installed: ${errorMessage}`,
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
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      name: 'Git repository',
      passed: false,
      message: `Current directory is not a git repository: ${errorMessage}`,
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
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- Need to filter empty strings, not just null/undefined
        const fileName = configWithErrors.filePath.split('/').pop() || 'vibe-validate.config.yaml';
        const { message, suggestion } = formatDoctorConfigError({
          fileName,
          errors: configWithErrors.errors
        });

        return {
          name: 'Configuration valid',
          passed: false,
          message,
          suggestion,
        };
      }

      // Fallback: try to find config file path
      const configPath = findConfigPath();
      if (configPath) {
        // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- Need to filter empty strings, not just null/undefined
        const fileName = configPath.split('/').pop() || 'vibe-validate.config.yaml';
        return {
          name: 'Configuration valid',
          passed: false,
          message: `Found ${fileName} but it contains validation errors`,
          suggestion: [
            `Fix syntax/validation errors in ${fileName}`,
            'See configuration docs: https://github.com/jdutton/vibe-validate/blob/main/docs/configuration-reference.md',
            'JSON Schema for IDE validation: https://raw.githubusercontent.com/jdutton/vibe-validate/main/packages/config/vibe-validate.schema.json',
            'Example YAML configs: https://github.com/jdutton/vibe-validate/tree/main/packages/cli/config-templates'
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
            'https://github.com/jdutton/vibe-validate/tree/main/packages/cli/config-templates',
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
  } catch (error) {
    return {
      name: 'Configuration valid',
      passed: false,
      message: `Invalid configuration: ${error instanceof Error ? error.message : String(error)}`,
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
    const firstCommand = config.validation.phases[0]?.steps[0]?.command ?? '';
    const pm = firstCommand.startsWith('pnpm ') ? 'pnpm' : 'npm';

    try {
      const version = execSync(`${pm} --version`, { encoding: 'utf8' }).trim();
      return {
        name: 'Package manager',
        passed: true,
        message: `${pm} ${version} is available`,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        name: 'Package manager',
        passed: false,
        message: `${pm} not found (required by config commands): ${errorMessage}`,
        suggestion: pm === 'pnpm'
          ? 'Install pnpm: npm install -g pnpm'
          : 'npm should be installed with Node.js',
      };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      name: 'Package manager',
      passed: true,
      message: `Skipped (config check failed): ${errorMessage}`,
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
        message: `Workflow is out of sync: ${diff ?? 'differs from config'}`,
        suggestion: 'Manual: npx vibe-validate generate-workflow\n   💡 Or run: vibe-validate init --setup-workflow',
      };
    }
  } catch (error) {
    return {
      name: 'GitHub Actions workflow',
      passed: false,
      message: `Failed to check workflow sync: ${error instanceof Error ? error.message : String(error)}`,
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
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      name: 'Pre-commit hook',
      passed: false,
      message: `Pre-commit hook exists but unreadable: ${errorMessage}`,
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

      // Compare versions (simple semver comparison)
      const current = currentVersion.split('.').map(Number);
      const latest = latestVersion.split('.').map(Number);

      let isOutdated = false;
      for (let i = 0; i < 3; i++) {
        if (current[i] < latest[i]) {
          isOutdated = true;
          break;
        } else if (current[i] > latest[i]) {
          break; // Current is newer
        }
      }

      if (currentVersion === latestVersion) {
        return {
          name: 'vibe-validate version',
          passed: true,
          message: `Current version ${currentVersion} is up to date`,
        };
      } else if (isOutdated) {
        // Only show suggestion if current version is behind npm
        return {
          name: 'vibe-validate version',
          passed: true, // Warning only, not a failure
          message: `Current: ${currentVersion}, Latest: ${latestVersion} available`,
          suggestion: `Upgrade: npm install -D vibe-validate@latest (or pnpm add -D vibe-validate@latest)\n   💡 After upgrade: Run 'vibe-validate doctor' to verify setup`,
        };
      } else {
        // Current version is ahead of npm (pre-release or unpublished)
        return {
          name: 'vibe-validate version',
          passed: true,
          message: `Current: ${currentVersion} (ahead of npm: ${latestVersion})`,
        };
      }
    } catch (npmError) {
      // npm registry unavailable - not a critical error
      const errorMessage = npmError instanceof Error ? npmError.message : String(npmError);
      return {
        name: 'vibe-validate version',
        passed: true,
        message: `Current version: ${currentVersion} (unable to check for updates: ${errorMessage})`,
      };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      name: 'vibe-validate version',
      passed: true,
      message: `Unable to determine version: ${errorMessage}`,
    };
  }
}

/**
 * Check if deprecated state file is in .gitignore
 */
function checkGitignoreStateFile(): DoctorCheckResult {
  const gitignorePath = '.gitignore';
  // eslint-disable-next-line sonarjs/deprecation -- Intentionally checking deprecated file location for migration guidance
  const stateFileName = DEPRECATED_STATE_FILE;

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
        // eslint-disable-next-line sonarjs/deprecation -- Intentionally checking deprecated file location for migration guidance
        message: `${DEPRECATED_STATE_FILE} in .gitignore (deprecated - can be removed)`,
        // eslint-disable-next-line sonarjs/deprecation -- Intentionally checking deprecated file location for migration guidance
        suggestion: `Remove from .gitignore: sed -i.bak '/${DEPRECATED_STATE_FILE}/d' .gitignore && rm .gitignore.bak\n   ℹ️  Validation now uses git notes instead of state file`,
      };
    } else {
      return {
        name: 'Gitignore state file',
        passed: true,
        message: 'No deprecated state file entries in .gitignore',
      };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      name: 'Gitignore state file',
      passed: false,
      message: `.gitignore exists but is unreadable: ${errorMessage}`,
      suggestion: 'Fix file permissions: chmod 644 .gitignore',
    };
  }
}

/**
 * Check if deprecated validation state file exists
 */
function checkValidationState(): DoctorCheckResult {
  // eslint-disable-next-line sonarjs/deprecation -- Intentionally checking deprecated file location for migration guidance
  const statePath = DEPRECATED_STATE_FILE;

  // Check if deprecated state file exists
  if (existsSync(statePath)) {
    return {
      name: 'Validation state (deprecated)',
      passed: false,
      // eslint-disable-next-line sonarjs/deprecation -- Intentionally checking deprecated file location for migration guidance
      message: `${DEPRECATED_STATE_FILE} found (deprecated file - safe to remove)`,
      // eslint-disable-next-line sonarjs/deprecation -- Intentionally checking deprecated file location for migration guidance
      suggestion: `Remove deprecated state file: rm ${DEPRECATED_STATE_FILE}\n   ℹ️  Validation now uses git notes for improved caching`,
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

    // Has warnings - advisory only, not a critical failure
    return {
      name: 'Validation history',
      passed: true, // Advisory: large history is a warning, not a failure
      message: `${health.totalNotes} tree hashes tracked (${health.oldNotesCount} older than 90 days)`,
      suggestion: 'Prune old history: vibe-validate history prune --older-than "90 days"',
    };
  } catch (error) {
    // Git notes not available or other error - not critical
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      name: 'Validation history',
      passed: true,
      message: `History unavailable (not in git repo or no validation runs yet): ${errorMessage}`,
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
    } catch (localError) {
      // Local branch doesn't exist, check for remote branch
      const localErrorMsg = localError instanceof Error ? localError.message : String(localError);
      try {
        execSync(`git rev-parse --verify ${remoteOrigin}/${mainBranch}`, { stdio: 'pipe' });
        return {
          name: 'Git main branch',
          passed: true,
          message: `Branch '${mainBranch}' exists on remote '${remoteOrigin}' (fetch-depth: 0 required in CI)`,
        };
      } catch (remoteError) {
        const remoteErrorMsg = remoteError instanceof Error ? remoteError.message : String(remoteError);
        return {
          name: 'Git main branch',
          passed: false,
          message: `Configured main branch '${mainBranch}' does not exist locally (${localErrorMsg}) or on remote '${remoteOrigin}' (${remoteErrorMsg})`,
          suggestion: `Create branch: git checkout -b ${mainBranch} OR update config to use existing branch (e.g., 'master', 'develop')`,
        };
      }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      name: 'Git main branch',
      passed: true,
      message: `Skipped (config or git error): ${errorMessage}`,
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
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        name: 'Git remote origin',
        passed: false,
        message: `Failed to list git remotes: ${errorMessage}`,
        suggestion: 'Verify git repository is initialized',
      };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      name: 'Git remote origin',
      passed: true,
      message: `Skipped (config or git error): ${errorMessage}`,
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
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        name: 'Git remote main branch',
        passed: false,
        message: `Branch '${mainBranch}' does not exist on remote '${remoteOrigin}': ${errorMessage}`,
        suggestion: `Push branch: git push ${remoteOrigin} ${mainBranch} OR update config to match remote branch name`,
      };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      name: 'Git remote main branch',
      passed: true,
      message: `Skipped (config or git error): ${errorMessage}`,
    };
  }
}

/**
 * Get tool version by trying multiple version flag variants
 */
function getToolVersion(toolName: string): string {
  try {
    return execSync(`${toolName} version`, { encoding: 'utf8', stdio: 'pipe' }).trim();
  } catch (versionError) {
    console.debug(`${toolName} version failed: ${versionError instanceof Error ? versionError.message : String(versionError)}`);
    return execSync(`${toolName} --version`, { encoding: 'utf8', stdio: 'pipe' }).trim();
  }
}

/**
 * Check if scanning tool is available
 */
function checkScanningToolAvailable(toolName: string): DoctorCheckResult {
  try {
    const version = getToolVersion(toolName);
    return {
      name: 'Pre-commit secret scanning',
      passed: true,
      message: `Secret scanning enabled with ${toolName} ${version}`,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const isCI = process.env.CI === 'true' || process.env.CI === '1';

    if (isCI) {
      return {
        name: 'Pre-commit secret scanning',
        passed: true,
        message: `Secret scanning enabled (pre-commit only, not needed in CI)`,
      };
    }

    return {
      name: 'Pre-commit secret scanning',
      passed: true,
      message: `Secret scanning enabled but '${toolName}' not found: ${errorMessage}`,
      suggestion: `Install ${toolName}:\n   • gitleaks: brew install gitleaks\n   • Or disable: set hooks.preCommit.secretScanning.enabled=false in config`,
    };
  }
}

/**
 * Check if secret scanning is configured and tool is available
 */
async function checkSecretScanning(config?: VibeValidateConfig | null): Promise<DoctorCheckResult> {
  try {
    if (!config) {
      return {
        name: 'Pre-commit secret scanning',
        passed: true,
        message: 'Skipped (no config)',
      };
    }

    const secretScanning = config.hooks?.preCommit?.secretScanning;

    if (!secretScanning) {
      return {
        name: 'Pre-commit secret scanning',
        passed: true,
        message: 'Secret scanning not configured',
        suggestion: 'Recommended: Enable secret scanning to prevent credential leaks\n   • Add to config: hooks.preCommit.secretScanning.enabled=true\n   • scanCommand: "gitleaks protect --staged --verbose"\n   • Install gitleaks: brew install gitleaks',
      };
    }

    if (secretScanning.enabled === false) {
      return {
        name: 'Pre-commit secret scanning',
        passed: true,
        message: 'Secret scanning disabled in config (user preference)',
      };
    }

    if (!secretScanning.scanCommand) {
      return {
        name: 'Pre-commit secret scanning',
        passed: true,
        message: 'Secret scanning enabled but no scanCommand configured',
        suggestion: 'Add hooks.preCommit.secretScanning.scanCommand to config',
      };
    }

    const toolName = secretScanning.scanCommand.split(' ')[0];
    return checkScanningToolAvailable(toolName);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      name: 'Pre-commit secret scanning',
      passed: true,
      message: `Skipped (config or execution error): ${errorMessage}`,
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
  } catch (error) {
    // Config load error will be caught by checkConfigValid
    // Intentionally suppressing error here as it will be reported by checkConfigValid
    console.debug(`Config load failed: ${error instanceof Error ? error.message : String(error)}`);
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
  allChecks.push(await checkSecretScanning(config));
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

  // In non-verbose mode, show failing checks OR checks with recommendations
  // In verbose mode, always show all checks
  const checks = verbose ? allChecks : allChecks.filter(c => !c.passed || c.suggestion);

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
 * Output doctor results in YAML format
 */
async function outputDoctorYaml(result: DoctorResult): Promise<void> {
  // Small delay to ensure stderr is flushed
  await new Promise(resolve => setTimeout(resolve, 10));

  // RFC 4627 separator
  process.stdout.write('---\n');

  // Write pure YAML
  process.stdout.write(stringifyYaml(result));

  // CRITICAL: Wait for stdout to flush before exiting
  await new Promise<void>(resolve => {
    if (process.stdout.write('')) {
      resolve();
    } else {
      process.stdout.once('drain', resolve);
    }
  });
}

/**
 * Display doctor results in human-friendly format
 */
function displayDoctorResults(result: DoctorResult): void {
  console.log('🩺 vibe-validate Doctor\n');

  const modeMessage = result.verboseMode
    ? 'Running diagnostic checks (verbose mode)...\n'
    : 'Running diagnostic checks...\n';
  console.log(modeMessage);

  // Print each check
  for (const check of result.checks) {
    const icon = check.passed ? '✅' : '❌';
    console.log(`${icon} ${check.name}`);
    console.log(`   ${check.message}`);
    if (check.suggestion) {
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

/**
 * Main command handler for Commander.js
 */
export function doctorCommand(program: Command): void {
  program
    .command('doctor')
    .description('Diagnose vibe-validate setup and environment (run after upgrading)')
    .option('--yaml', 'Output YAML only (no human-friendly display)')
    .action(async (options: { yaml?: boolean; verbose?: boolean }, command: Command) => {
      // Get verbose from global options (inherited from program)
      const verbose = command.optsWithGlobals().verbose as boolean | undefined;
      try {
        const result = await runDoctor({ verbose });

        if (options.yaml) {
          await outputDoctorYaml(result);
        } else {
          displayDoctorResults(result);
        }
      } catch (error) {
        console.error('❌ Doctor check failed:');
        console.error(error instanceof Error ? error.message : String(error));
        process.exit(1);
      }
    });
}

/**
 * Show verbose help with detailed documentation
 */
export function showDoctorVerboseHelp(): void {
  console.log(`# doctor Command Reference

> Diagnose vibe-validate setup and environment (run after upgrading)

## Overview

The \`doctor\` command performs comprehensive diagnostics of your vibe-validate setup and environment. It checks Node.js version, git repository health, configuration validity, package manager availability, and CI/CD integration status.

## How It Works

1. Checks Node.js version (20+)
2. Verifies git repository exists
3. Checks package manager availability
4. Validates configuration file
5. Checks pre-commit hook setup
6. Verifies GitHub Actions workflow sync

## Options

- \`--yaml\` - Output YAML only (no human-friendly display)

## Exit Codes

- \`0\` - All critical checks passed
- \`1\` - One or more critical checks failed

## Examples

\`\`\`bash
# Run diagnostics
vibe-validate doctor

# YAML output only
vibe-validate doctor --yaml
\`\`\`

## Common Workflows

### After installing vibe-validate

\`\`\`bash
# Initialize configuration
vibe-validate init

# Verify setup
vibe-validate doctor
\`\`\`

### After upgrading vibe-validate

\`\`\`bash
# Upgrade package
npm install -D vibe-validate@latest

# CRITICAL: Always run doctor after upgrade
vibe-validate doctor

# Fix any issues reported
\`\`\`

### Troubleshooting validation issues

\`\`\`bash
# Diagnose environment
vibe-validate doctor

# Fix reported issues

# Retry validation
vibe-validate validate
\`\`\`

## Checks Performed

### Critical Checks (must pass)

- **Node.js version**: >=20.0.0 required
- **Git installed**: git command available
- **Git repository**: Current directory is a git repo
- **Configuration file**: vibe-validate.config.yaml exists
- **Configuration valid**: No syntax or schema errors

### Advisory Checks (warnings only)

- **Package manager**: npm or pnpm available
- **Pre-commit hook**: Husky pre-commit hook configured
- **GitHub Actions workflow**: Workflow in sync with config
- **Validation history**: Git notes health status

## Error Recovery

**If Node.js version check fails:**
\`\`\`bash
# Upgrade Node.js to 20+
# Via nvm:
nvm install 20
nvm use 20

# Or download from: https://nodejs.org/
\`\`\`

**If configuration check fails:**
\`\`\`bash
# Reinitialize with template
vibe-validate init --force

# Or manually fix YAML syntax errors
\`\`\`

**If workflow is out of sync:**
\`\`\`bash
# Regenerate workflow
vibe-validate generate-workflow

# Or reinitialize
vibe-validate init --setup-workflow
\`\`\`
`);
}

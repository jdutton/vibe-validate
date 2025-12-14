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

import { join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { Command } from 'commander';
import * as semver from 'semver';
import { stringify as stringifyYaml } from 'yaml';
import { loadConfig, findConfigPath, loadConfigWithErrors } from '../utils/config-loader.js';
import {
  executeGitCommand,
  isGitRepository,
  verifyRef
} from '@vibe-validate/git';
import { getToolVersion, safeExecSync } from '@vibe-validate/utils';
import { formatDoctorConfigError } from '../utils/config-error-reporter.js';
import { checkSync, ciConfigToWorkflowOptions } from './generate-workflow.js';
import { getMainBranch, getRemoteOrigin, type VibeValidateConfig } from '@vibe-validate/config';
import { formatTemplateList } from '../utils/template-discovery.js';
import { checkHistoryHealth as checkValidationHistoryHealth } from '@vibe-validate/history';
import { detectSecretScanningTools, selectToolsToRun } from '../utils/secret-scanning.js';
import { findGitRoot } from '../utils/git-detection.js';

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
 * Project context information
 */
export interface ProjectContext {
  /** Current working directory */
  currentDir: string;
  /** Detected git repository root (null if not in git repo) */
  gitRoot: string | null;
  /** Detected config file path (null if not found) */
  configPath: string | null;
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
  /** Project context information */
  projectContext: ProjectContext;
}

/**
 * Version checker interface for dependency injection (enables fast tests)
 */
export interface VersionChecker {
  /** Fetch latest version from npm registry */
  fetchLatestVersion(): Promise<string>;
}

/**
 * Options for running doctor checks
 */
export interface DoctorOptions {
  /** Show all checks including passing ones */
  verbose?: boolean;
  /** Version checker (for testing - defaults to npm registry) */
  versionChecker?: VersionChecker;
}

/**
 * Check if CLI build is in sync with source code (development mode only)
 *
 * Detects when running from vibe-validate source tree and the built CLI
 * version doesn't match the source package.json version. This is the most
 * confusing scenario for developers - everything seems to work but uses
 * an old schema.
 */
function checkCliBuildSync(): DoctorCheckResult {
  try {
    // Check if we're in the vibe-validate source tree
    const gitRoot = findGitRoot();
    if (!gitRoot) {
      return {
        name: 'CLI build status',
        passed: true,
        message: 'Skipped (not in git repository)',
      };
    }

    const sourcePackageJsonPath = join(gitRoot, 'packages/cli/package.json');

    // Not in vibe-validate source tree
    if (!existsSync(sourcePackageJsonPath)) {
      return {
        name: 'CLI build status',
        passed: true,
        message: 'Skipped (not in vibe-validate source tree)',
      };
    }

    // Get running version
    const runningPackageJsonPath = new URL('../../package.json', import.meta.url);
    const runningPackageJson = JSON.parse(readFileSync(runningPackageJsonPath, 'utf8'));
    const runningVersion = runningPackageJson.version;

    // Get source version
    const sourcePackageJson = JSON.parse(readFileSync(sourcePackageJsonPath, 'utf8'));
    const sourceVersion = sourcePackageJson.version;

    // Compare versions - this is the confusing scenario that needs detection
    if (runningVersion !== sourceVersion) {
      return {
        name: 'CLI build status',
        passed: false,
        message: `Build is stale: running v${runningVersion}, source v${sourceVersion}`,
        suggestion: 'Rebuild packages: pnpm -r build',
      };
    }

    return {
      name: 'CLI build status',
      passed: true,
      message: `Build is up to date (v${runningVersion})`,
    };
  // eslint-disable-next-line sonarjs/no-ignored-exceptions -- Non-critical dev-only check, errors safely ignored
  } catch (_error) {
    // Any errors are non-critical - this is a development-only check
    return {
      name: 'CLI build status',
      passed: true,
      message: 'Skipped (could not determine build status)',
    };
  }
}

/**
 * Check Node.js version meets requirements
 */
function checkNodeVersion(): DoctorCheckResult {
  try {
    const version = getToolVersion('node');

    // Validate that we got a valid version number
    if (!version) {
      return {
        name: 'Node.js version',
        passed: false,
        message: 'Failed to detect Node.js version',
        suggestion: 'Install Node.js: https://nodejs.org/',
      };
    }

    const majorVersion = Number.parseInt(version.replace('v', '').split('.')[0]);

    if (Number.isNaN(majorVersion) || majorVersion === 0) {
      return {
        name: 'Node.js version',
        passed: false,
        message: `Failed to parse Node.js version from output: "${version}"`,
        suggestion: 'Install Node.js: https://nodejs.org/',
      };
    }

    return majorVersion >= 20 ? {
        name: 'Node.js version',
        passed: true,
        message: `${version} (meets requirement: >=20.0.0)`,
      } : {
        name: 'Node.js version',
        passed: false,
        message: `${version} is too old. Node.js 20+ required.`,
        suggestion: 'Upgrade Node.js: https://nodejs.org/ or use nvm',
      };
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
    const result = executeGitCommand(['--version']);
    const version = result.success ? result.stdout.trim() : '';
    return {
      name: 'Git installed',
      passed: result.success,
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
    const isGitRepo = isGitRepository();
    if (isGitRepo) {
      return {
        name: 'Git repository',
        passed: true,
        message: 'Current directory is a git repository',
      };
    } else {
      return {
        name: 'Git repository',
        passed: false,
        message: 'Current directory is not a git repository',
        suggestion: 'Run: git init',
      };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      name: 'Git repository',
      passed: false,
      message: `Error checking git repository: ${errorMessage}`,
      suggestion: 'Run: git init',
    };
  }
}

/**
 * Check if configuration file exists
 *
 * Uses findConfigPath() to walk up directory tree, consistent with validate command.
 * This allows doctor to work from any subdirectory, not just project root.
 */
function checkConfigFile(): DoctorCheckResult {
  const configPath = findConfigPath();

  if (configPath) {
    return {
      name: 'Configuration file',
      passed: true,
      message: `Found: ${configPath}`,
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
            'JSON Schema for IDE validation: https://raw.githubusercontent.com/jdutton/vibe-validate/main/packages/config/config.schema.json',
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
            'https://raw.githubusercontent.com/jdutton/vibe-validate/main/packages/config/config.schema.json',
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

    const version = getToolVersion(pm);

    if (version) {
      return {
        name: 'Package manager',
        passed: true,
        message: `${pm} ${version} is available`,
      };
    }

    return {
      name: 'Package manager',
      passed: false,
      message: `${pm} not found (required by config commands)`,
      suggestion: pm === 'pnpm'
        ? 'Install pnpm: npm install -g pnpm'
        : 'npm should be installed with Node.js',
    };
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
 *
 * Uses findGitRoot() to locate repository root, allowing doctor to work
 * correctly from any subdirectory within the project.
 */
async function checkWorkflowSync(config?: VibeValidateConfig | null): Promise<DoctorCheckResult> {
  // Find git root to locate .github directory
  const gitRoot = findGitRoot();
  if (!gitRoot) {
    return {
      name: 'GitHub Actions workflow',
      passed: true,
      message: 'Skipped (not in git repository)',
    };
  }

  const workflowPath = join(gitRoot, '.github/workflows/validate.yml');

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

    // Check if workflow check is disabled in config
    if (config.ci?.disableWorkflowCheck === true) {
      return {
        name: 'GitHub Actions workflow',
        passed: true,
        message: 'Workflow sync check disabled (ci.disableWorkflowCheck: true)',
      };
    }

    // Use CI config from vibe-validate config
    const generateOptions = {
      ...ciConfigToWorkflowOptions(config),
      projectRoot: gitRoot,  // Ensure detection happens at git root, not cwd
    };

    const { inSync, diff } = checkSync(config, generateOptions, workflowPath);

    return inSync ? {
        name: 'GitHub Actions workflow',
        passed: true,
        message: 'Workflow is in sync with config',
      } : {
        name: 'GitHub Actions workflow',
        passed: false,
        message: `Workflow is out of sync: ${diff ?? 'differs from config'}`,
        suggestion: [
          'Manual: npx vibe-validate generate-workflow',
          '💡 Or run: vibe-validate init --setup-workflow',
          '',
          'If regenerated workflow won\'t work for your project:',
          '   See: https://github.com/jdutton/vibe-validate/blob/main/docs/heterogeneous-projects.md#issue-github-actions-workflow-out-of-sync',
          '   Set ci.disableWorkflowCheck: true in config'
        ].join('\n   '),
      };
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
 *
 * Uses findGitRoot() to locate repository root, allowing doctor to work
 * correctly from any subdirectory within the project.
 */
async function checkPreCommitHook(config?: VibeValidateConfig | null): Promise<DoctorCheckResult> {
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

  // Find git root to locate .husky directory
  const gitRoot = findGitRoot();
  if (!gitRoot) {
    return {
      name: 'Pre-commit hook',
      passed: true,
      message: 'Skipped (not in git repository)',
    };
  }

  const huskyPath = join(gitRoot, '.husky/pre-commit');

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
 * Get context label for version display
 */
function getContextLabel(context: string): string {
  if (context === 'dev') return ' (dev)';
  if (context === 'local') return ' (local)';
  if (context === 'global') return ' (global)';
  return '';
}

/**
 * Get upgrade command based on context
 */
function getUpgradeCommand(context: string): string {
  return context === 'local'
    ? 'npm install -D vibe-validate@latest (or pnpm add -D vibe-validate@latest)'
    : 'npm install -g vibe-validate@latest';
}

/**
 * Default version checker - uses npm registry
 */
const defaultVersionChecker: VersionChecker = {
  async fetchLatestVersion(): Promise<string> {
    const version = safeExecSync('npm', ['view', 'vibe-validate', 'version'], {
      encoding: 'utf8',
      stdio: 'pipe',
    });
    return (version as string).trim();
  },
};

/**
 * Check if vibe-validate version is up to date
 */
async function checkVersion(versionChecker: VersionChecker = defaultVersionChecker): Promise<DoctorCheckResult> {
  try {
    // Get current version from package.json
    const packageJsonPath = new URL('../../package.json', import.meta.url);
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
    const currentVersion = packageJson.version;

    // Determine context (set by wrapper)
    const context = process.env.VV_CONTEXT ?? 'unknown';

    // Fetch latest version from npm registry
    try {
      const latestVersion = await versionChecker.fetchLatestVersion();

      // Compare versions using semver library (handles prereleases correctly)
      // semver.lt() returns true if currentVersion < latestVersion
      const isOutdated = semver.lt(currentVersion, latestVersion);

      // Build context-aware message
      const contextLabel = getContextLabel(context);

      if (currentVersion === latestVersion) {
        return {
          name: 'vibe-validate version',
          passed: true,
          message: `Current: ${currentVersion}${contextLabel} — up to date with npm`,
        };
      } else if (isOutdated) {
        // Only show suggestion if current version is behind npm
        return {
          name: 'vibe-validate version',
          passed: true, // Warning only, not a failure
          message: `Current: ${currentVersion}${contextLabel}, Latest: ${latestVersion} available`,
          suggestion: `Upgrade: ${getUpgradeCommand(context)}\n   💡 After upgrade: Run 'vibe-validate doctor' to verify setup`,
        };
      } else {
        // Current version is ahead of npm (pre-release or unpublished)
        return {
          name: 'vibe-validate version',
          passed: true,
          message: `Current: ${currentVersion}${contextLabel} (ahead of npm: ${latestVersion})`,
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
 *
 * Uses findGitRoot() to locate repository root, allowing doctor to work
 * correctly from any subdirectory within the project.
 */
function checkGitignoreStateFile(): DoctorCheckResult {
  // eslint-disable-next-line sonarjs/deprecation -- Intentionally checking deprecated file location for migration guidance
  const stateFileName = DEPRECATED_STATE_FILE;

  // Find git root to locate .gitignore
  const gitRoot = findGitRoot();
  if (!gitRoot) {
    return {
      name: 'Gitignore state file',
      passed: true,
      message: 'Skipped (not in git repository)',
    };
  }

  const gitignorePath = join(gitRoot, '.gitignore');

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
 * Check for old validation history format (pre-v0.15.0)
 *
 * Pre-v0.15.0 used refs under: refs/notes/vibe-validate/runs/*
 * v0.15.0+ uses two systems:
 *   - Validation history: refs/notes/vibe-validate/validate (current format)
 *   - Run cache: refs/notes/vibe-validate/run/{treeHash}/{commandHash}
 *
 * Only warn if the OLD "runs" namespace exists.
 */
function checkCacheMigration(): DoctorCheckResult {
  try {
    // Check if the EXACT old validation history ref exists (singular "runs", not "run/")
    // Using git for-each-ref with exact ref name to avoid matching "run/" subdirectories
    const result = executeGitCommand(
      ['for-each-ref', '--format=%(refname)', 'refs/notes/vibe-validate/runs'],
      { ignoreErrors: true, suppressStderr: true }
    );

    if (result.success && result.stdout.trim() === 'refs/notes/vibe-validate/runs') {
      // Old validation history namespace exists - automatically clean it up
      try {
        executeGitCommand(['update-ref', '-d', 'refs/notes/vibe-validate/runs']);
        return {
          name: 'Validation history migration',
          passed: true,
          message: 'Automatically removed old validation history format (pre-v0.15.0)',
        };
      // eslint-disable-next-line sonarjs/no-ignored-exceptions -- Auto-cleanup failure handled with manual suggestion
      } catch (_error) {
        // Fallback to manual suggestion if auto-cleanup fails
        return {
          name: 'Validation history migration',
          passed: true, // Not a failure, just informational
          message: 'Old validation history format detected (pre-v0.15.0)',
          suggestion: `Manual cleanup:\n   git update-ref -d refs/notes/vibe-validate/runs\n   ℹ️  This removes the deprecated "runs" namespace`,
        };
      }
    }

    return {
      name: 'Validation history migration',
      passed: true,
      message: 'Using current validation history format',
    };
  // eslint-disable-next-line sonarjs/no-ignored-exceptions -- Git command failure is non-critical for migration check
  } catch (_error) {
    // Git command failed or no git notes - that's fine
    return {
      name: 'Validation history migration',
      passed: true,
      message: 'No validation history to migrate',
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
    const localResult = verifyRef(mainBranch);
    if (localResult) {
      return {
        name: 'Git main branch',
        passed: true,
        message: `Branch '${mainBranch}' exists locally`,
      };
    }

    // Local branch doesn't exist, check for remote branch
    const remoteResult = verifyRef(`${remoteOrigin}/${mainBranch}`);
    if (remoteResult) {
      return {
        name: 'Git main branch',
        passed: true,
        message: `Branch '${mainBranch}' exists on remote '${remoteOrigin}' (fetch-depth: 0 required in CI)`,
      };
    }

    return {
      name: 'Git main branch',
      passed: false,
      message: `Configured main branch '${mainBranch}' does not exist locally or on remote '${remoteOrigin}'`,
      suggestion: `Create branch: git checkout -b ${mainBranch} OR update config to use existing branch (e.g., 'master', 'develop')`,
    };
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
      const result = executeGitCommand(['remote']);
      const remotes = result.success
        ? result.stdout.trim().split('\n').filter(Boolean)
        : [];

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
      const remotesResult = executeGitCommand(['remote']);
      const remotes = remotesResult.success
        ? remotesResult.stdout.trim().split('\n').filter(Boolean)
        : [];

      if (!remotes.includes(remoteOrigin)) {
        return {
          name: 'Git remote main branch',
          passed: true,
          message: `Skipped (remote '${remoteOrigin}' not configured)`,
        };
      }

      // Check if remote branch exists
      const lsRemoteResult = executeGitCommand(['ls-remote', '--heads', remoteOrigin, mainBranch]);
      if (!lsRemoteResult.success) {
        throw new Error(`Failed to check remote branch: ${lsRemoteResult.stderr}`);
      }
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
        suggestion: 'Recommended: Enable secret scanning to prevent credential leaks\n   • Add to config: hooks.preCommit.secretScanning.enabled=true\n   • Install gitleaks: brew install gitleaks\n   • Or add .secretlintrc.json for npm-based scanning',
      };
    }

    if (secretScanning.enabled === false) {
      return {
        name: 'Pre-commit secret scanning',
        passed: true,
        message: 'Secret scanning disabled in config (user preference)',
      };
    }

    // Detect available tools and what would be run
    const toolsToRun = selectToolsToRun(secretScanning.scanCommand);
    const availableTools = detectSecretScanningTools();

    if (toolsToRun.length === 0) {
      return {
        name: 'Pre-commit secret scanning',
        passed: true,
        message: 'Secret scanning enabled but no tools available',
        suggestion: 'Install a secret scanning tool:\n   • gitleaks: brew install gitleaks\n   • secretlint: npm install --save-dev @secretlint/secretlint-rule-preset-recommend\n   • Or add config files: .gitleaks.toml or .secretlintrc.json',
      };
    }

    // Build status message
    const toolStatuses = availableTools.map(tool => {
      if (tool.tool === 'gitleaks') {
        if (tool.available && tool.hasConfig) {
          return 'gitleaks (configured, available)';
        } else if (tool.available) {
          return 'gitleaks (available, no config)';
        } else if (tool.hasConfig) {
          return 'gitleaks (configured, NOT available)';
        }
      } else if (tool.tool === 'secretlint') {
        if (tool.hasConfig) {
          return 'secretlint (configured, via npx)';
        } else {
          return 'secretlint (available via npx, no config)';
        }
      }
      return null;
    }).filter(Boolean);

    const message = `Secret scanning enabled: ${toolStatuses.join(', ')}`;

    // Check if gitleaks is configured but not available
    const gitleaks = availableTools.find(t => t.tool === 'gitleaks');
    if (gitleaks?.hasConfig && !gitleaks.available) {
      return {
        name: 'Pre-commit secret scanning',
        passed: true,
        message,
        suggestion: 'Install gitleaks for better performance: brew install gitleaks',
      };
    }

    // Check if only secretlint is available (suggest gitleaks for performance)
    const hasGitleaksAvailable = availableTools.some(t => t.tool === 'gitleaks' && t.available);
    if (!hasGitleaksAvailable && toolsToRun.some(t => t.tool === 'secretlint')) {
      return {
        name: 'Pre-commit secret scanning',
        passed: true,
        message,
        suggestion: 'Consider installing gitleaks for faster scanning: brew install gitleaks',
      };
    }

    return {
      name: 'Pre-commit secret scanning',
      passed: true,
      message,
    };
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
  const { verbose = false, versionChecker } = options;
  const allChecks: DoctorCheckResult[] = [];

  // Detect project context
  const currentDir = process.cwd();
  const gitRoot = findGitRoot();
  const configPath = findConfigPath();

  const projectContext: ProjectContext = {
    currentDir,
    gitRoot,
    configPath,
  };

  // Load config once to avoid duplicate warnings
  let config;
  let configWithErrors;
  try {
    config = await loadConfig();
    configWithErrors = await loadConfigWithErrors();
  } catch {
    // Config load error will be caught by checkConfigValid
    // Intentionally suppressing error here as it will be reported by checkConfigValid
    config = null;
    configWithErrors = { config: null, errors: null, filePath: null };
  }

  // Run all checks
  allChecks.push(await checkVersion(versionChecker));
  allChecks.push(checkCliBuildSync());
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
  allChecks.push(checkCacheMigration());
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
    projectContext,
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
// eslint-disable-next-line sonarjs/cognitive-complexity -- Complexity 23 acceptable for display formatting logic (formats multiple check results with context-aware messages, color coding, and actionable suggestions)
function displayDoctorResults(result: DoctorResult): void {
  console.log('🩺 vibe-validate Doctor\n');

  // Show project context if running from subdirectory or if locations differ
  const { currentDir, gitRoot, configPath } = result.projectContext;
  const isSubdirectory = gitRoot && gitRoot !== currentDir;
  const configDir = configPath ? configPath.substring(0, configPath.lastIndexOf('/')) : null;

  if (isSubdirectory || (configDir && configDir !== currentDir && configDir !== gitRoot)) {
    console.log('📍 Project Context');
    console.log(`   Current directory: ${currentDir}`);
    if (gitRoot) {
      console.log(`   Git repository:    ${gitRoot}${isSubdirectory ? ' (project root)' : ''}`);
    }
    if (configPath) {
      console.log(`   Configuration:     ${configPath}`);
    }
    console.log('');
  }

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

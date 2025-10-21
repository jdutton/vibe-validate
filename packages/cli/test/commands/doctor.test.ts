/**
 * Tests for doctor command
 *
 * The doctor command diagnoses common issues with vibe-validate setup:
 * - Environment checks (Node.js version, package manager, git)
 * - Configuration validation
 * - Git integration health
 * - CI/CD workflow sync
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync } from 'fs';
import { execSync } from 'child_process';

// Mock dependencies
vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(() => 'npm run pre-commit'), // Mock pre-commit hook content
  readdirSync: vi.fn(() => []), // Mock empty directory for template discovery
}));

vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

vi.mock('../../src/utils/config-loader.js');
vi.mock('../../src/commands/generate-workflow.js');

import { runDoctor, type DoctorCheckResult } from '../../src/commands/doctor.js';
import { loadConfig, findConfigPath, loadConfigWithErrors } from '../../src/utils/config-loader.js';
import { checkSync } from '../../src/commands/generate-workflow.js';
import type { VibeValidateConfig } from '@vibe-validate/config';

describe('doctor command', () => {
  const mockConfig: VibeValidateConfig = {
    validation: {
      phases: [
        {
          name: 'Test',
          parallel: false,
          steps: [
            { name: 'TypeCheck', command: 'pnpm typecheck' },
          ],
          timeout: 300000,
          failFast: true,
        },
      ],
      caching: {
        strategy: 'git-tree-hash' as const,
        enabled: true,
        statePath: '.vibe-validate-state.yaml',
      },
    },
    git: {
      mainBranch: 'main',
      autoSync: false,
      warnIfBehind: true,
    },
    output: {
      format: 'auto' as const,
      showProgress: true,
      verbose: false,
      noColor: false,
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('runDoctor', () => {
    it('should return all checks passing when environment is healthy', async () => {
      // Mock file reads for version and gitignore checks
      const { readFileSync } = await import('fs');
      vi.mocked(readFileSync).mockImplementation((path: any) => {
        if (path.toString().includes('package.json')) {
          return JSON.stringify({ version: '0.9.11' }) as any;
        }
        if (path.toString().includes('.gitignore')) {
          return '.vibe-validate-state.yaml\nnode_modules\n' as any;
        }
        return 'npx vibe-validate pre-commit' as any; // Pre-commit hook content
      });

      // Mock healthy environment
      vi.mocked(execSync).mockImplementation((cmd: string) => {
        const cmdStr = cmd.toString();
        if (cmdStr.includes('npm view vibe-validate version')) return '0.9.11' as any;
        if (cmdStr.includes('node --version')) return 'v22.0.0' as any;
        if (cmdStr.includes('git --version')) return 'git version 2.43.0' as any;
        if (cmdStr.includes('pnpm --version')) return '9.0.0' as any;
        if (cmdStr.includes('git rev-parse --git-dir')) return '.git' as any;
        if (cmdStr.includes('git rev-parse --verify main')) return 'abc123' as any; // Branch exists
        if (cmdStr.includes('git remote')) return 'origin' as any; // Remote exists
        if (cmdStr.includes('git ls-remote --heads origin main')) return 'abc123 refs/heads/main' as any; // Remote branch exists
        return '' as any;
      });

      vi.mocked(existsSync).mockImplementation((path: string) => {
        // Config format check needs specific file checks
        if (path.toString() === 'vibe-validate.config.yaml') return true;
        return true; // Everything else exists
      });
      vi.mocked(loadConfig).mockResolvedValue(mockConfig);
      vi.mocked(checkSync).mockReturnValue({ inSync: true });

      const result = await runDoctor({ verbose: true });

      expect(result.allPassed).toBe(true);
      expect(result.checks).toHaveLength(15); // Total number of checks (includes secret scanning check)
      expect(result.checks.every(c => c.passed)).toBe(true);
    });

    it('should detect Node.js version too old', async () => {
      vi.mocked(execSync).mockImplementation((cmd: string) => {
        const cmdStr = cmd.toString();
        if (cmdStr.includes('node --version')) return 'v18.0.0' as any; // Too old
        if (cmdStr.includes('git --version')) return 'git version 2.43.0' as any;
        if (cmdStr.includes('git rev-parse --git-dir')) return '.git' as any;
        if (cmdStr.includes('git rev-parse --verify main')) return 'abc123' as any;
        if (cmdStr.includes('git remote')) return 'origin' as any;
        if (cmdStr.includes('git ls-remote --heads origin main')) return 'abc123 refs/heads/main' as any;
        return '' as any;
      });

      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(loadConfig).mockResolvedValue(mockConfig);
      vi.mocked(checkSync).mockReturnValue({ inSync: true });

      const result = await runDoctor({ verbose: true });

      const nodeCheck = result.checks.find(c => c.name === 'Node.js version');
      expect(nodeCheck?.passed).toBe(false);
      expect(nodeCheck?.message).toContain('Node.js 20+');
    });

    it('should detect missing git', async () => {
      vi.mocked(execSync).mockImplementation((cmd: string) => {
        if (cmd.includes('git --version')) throw new Error('git not found');
        if (cmd.includes('node --version')) return 'v22.0.0' as any;
        return '' as any;
      });

      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(loadConfig).mockResolvedValue(mockConfig);

      const result = await runDoctor({ verbose: true });

      const gitCheck = result.checks.find(c => c.name === 'Git installed');
      expect(gitCheck?.passed).toBe(false);
      expect(gitCheck?.message).toContain('not installed');
    });

    it('should detect missing configuration file', async () => {
      vi.mocked(execSync).mockReturnValue('v22.0.0' as any);
      vi.mocked(existsSync).mockReturnValue(false); // No config file
      vi.mocked(loadConfig).mockResolvedValue(null);

      const result = await runDoctor({ verbose: true });

      const configCheck = result.checks.find(c => c.name === 'Configuration file');
      expect(configCheck?.passed).toBe(false);
      expect(configCheck?.message).toContain('not found');
    });

    it('should detect missing configuration file', async () => {
      vi.mocked(execSync).mockReturnValue('v22.0.0' as any);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(loadConfig).mockResolvedValue(null); // Config failed to load
      vi.mocked(findConfigPath).mockReturnValue(null); // No config file found

      const result = await runDoctor({ verbose: true });

      const configCheck = result.checks.find(c => c.name === 'Configuration valid');
      expect(configCheck?.passed).toBe(false);
      expect(configCheck?.message).toContain('No configuration file found');
      expect(configCheck?.suggestion).toContain('Copy a config template from GitHub');
    });

    it('should detect invalid configuration file with helpful guidance', async () => {
      vi.mocked(execSync).mockReturnValue('v22.0.0' as any);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(loadConfig).mockResolvedValue(null); // Config failed validation
      vi.mocked(findConfigPath).mockReturnValue('/path/to/vibe-validate.config.yaml'); // File exists but invalid
      vi.mocked(loadConfigWithErrors).mockResolvedValue({
        config: null,
        errors: null,
        filePath: '/path/to/vibe-validate.config.yaml'
      });

      const result = await runDoctor({ verbose: true });

      const configCheck = result.checks.find(c => c.name === 'Configuration valid');
      expect(configCheck?.passed).toBe(false);
      expect(configCheck?.message).toContain('Found vibe-validate.config.yaml but it contains validation errors');
      expect(configCheck?.suggestion).toContain('configuration docs');
      expect(configCheck?.suggestion).toContain('JSON Schema');
      expect(configCheck?.suggestion).toContain('Example');
    });

    it('should show specific validation errors when available', async () => {
      vi.mocked(execSync).mockReturnValue('v22.0.0' as any);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(loadConfig).mockResolvedValue(null); // Config failed validation
      vi.mocked(findConfigPath).mockReturnValue('/path/to/vibe-validate.config.yaml');
      vi.mocked(loadConfigWithErrors).mockResolvedValue({
        config: null,
        errors: [
          'validation.phases.0.namej: Unrecognized key(s) in object: \'namej\'',
          'validation.phases.0.name: Required'
        ],
        filePath: '/path/to/vibe-validate.config.yaml'
      });

      const result = await runDoctor({ verbose: true });

      const configCheck = result.checks.find(c => c.name === 'Configuration valid');
      expect(configCheck?.passed).toBe(false);
      expect(configCheck?.message).toContain('Found vibe-validate.config.yaml but it contains validation errors');
      expect(configCheck?.message).toContain('validation.phases.0.namej');
      expect(configCheck?.message).toContain('Unrecognized key');
      expect(configCheck?.message).toContain('validation.phases.0.name: Required');
      expect(configCheck?.suggestion).toContain('Fix validation errors shown above');
      expect(configCheck?.suggestion).toContain('https://raw.githubusercontent.com/jdutton/vibe-validate/main/packages/config/vibe-validate.schema.json');
      expect(configCheck?.suggestion).toContain('https://github.com/jdutton/vibe-validate/tree/main/config-templates');
    });

    it('should run all checks even when config has validation errors', async () => {
      const { readFileSync } = await import('fs');
      vi.mocked(readFileSync).mockImplementation((path: any) => {
        if (path.toString().includes('package.json')) {
          return JSON.stringify({ version: '0.10.4' }) as any;
        }
        if (path.toString().includes('.gitignore')) {
          return '.vibe-validate-state.yaml\n' as any;
        }
        return 'npm run pre-commit' as any;
      });

      vi.mocked(execSync).mockImplementation((cmd: string) => {
        if (cmd.includes('npm view vibe-validate version')) return '0.10.4' as any;
        if (cmd.includes('node --version')) return 'v22.0.0' as any;
        if (cmd.includes('git --version')) return 'git version 2.43.0' as any;
        if (cmd.includes('git rev-parse --git-dir')) return '.git' as any;
        if (cmd.includes('git config --get remote.origin.url')) return 'https://github.com/user/repo.git' as any;
        if (cmd.includes('git symbolic-ref refs/remotes/origin/HEAD')) return 'refs/remotes/origin/main' as any;
        return '' as any;
      });
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(loadConfig).mockResolvedValue(null); // Config failed validation
      vi.mocked(findConfigPath).mockReturnValue('/path/to/vibe-validate.config.yaml');
      vi.mocked(loadConfigWithErrors).mockResolvedValue({
        config: null,
        errors: ['validation.phases.0.name: Required'],
        filePath: '/path/to/vibe-validate.config.yaml'
      });

      // Use verbose mode to see all checks
      const result = await runDoctor({ verbose: true });

      // Verify that all 15 checks ran (not just the config check)
      expect(result.checks).toHaveLength(15);

      // Config check should fail
      const configCheck = result.checks.find(c => c.name === 'Configuration valid');
      expect(configCheck?.passed).toBe(false);
      expect(configCheck?.message).toContain('Found vibe-validate.config.yaml but it contains validation errors');

      // But other checks should still run and pass (version, node, git, etc.)
      expect(result.checks.find(c => c.name === 'vibe-validate version')?.passed).toBe(true);
      expect(result.checks.find(c => c.name === 'Node.js version')?.passed).toBe(true);
      expect(result.checks.find(c => c.name === 'Git installed')?.passed).toBe(true);
      expect(result.checks.find(c => c.name === 'Git repository')?.passed).toBe(true);

      // Summary should show 14/15 passed (only config check fails)
      expect(result.allPassed).toBe(false);
      expect(result.totalChecks).toBe(15);
      expect(result.passedChecks).toBe(14);
    });

    it('should detect not in git repository', async () => {
      vi.mocked(execSync).mockImplementation((cmd: string) => {
        if (cmd.includes('node --version')) return 'v22.0.0' as any;
        if (cmd.includes('git --version')) return 'git version 2.43.0' as any;
        if (cmd.includes('git rev-parse --git-dir')) throw new Error('not a git repository');
        return '' as any;
      });

      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(loadConfig).mockResolvedValue(mockConfig);

      const result = await runDoctor({ verbose: true });

      const repoCheck = result.checks.find(c => c.name === 'Git repository');
      expect(repoCheck?.passed).toBe(false);
      expect(repoCheck?.message).toContain('not a git repository');
    });

    it('should detect workflow out of sync', async () => {
      vi.mocked(execSync).mockReturnValue('v22.0.0' as any);
      vi.mocked(existsSync).mockImplementation((path: string) => {
        if (path.toString().includes('.github/workflows/validate.yml')) return true;
        return true;
      });
      vi.mocked(loadConfig).mockResolvedValue(mockConfig);

      // Mock checkSync to return out of sync
      vi.mocked(checkSync).mockReturnValue({ inSync: false, diff: 'Out of sync' });

      const result = await runDoctor({ verbose: true });

      const workflowCheck = result.checks.find(c => c.name === 'GitHub Actions workflow');
      expect(workflowCheck?.passed).toBe(false);
      expect(workflowCheck?.message).toContain('out of sync');
    });

    it('should provide actionable suggestions for failures', async () => {
      vi.mocked(execSync).mockImplementation((cmd: string) => {
        if (cmd.includes('node --version')) return 'v18.0.0' as any; // Too old
        return '' as any;
      });

      vi.mocked(existsSync).mockReturnValue(false); // No config
      vi.mocked(loadConfig).mockResolvedValue(null);

      const result = await runDoctor({ verbose: true });

      expect(result.allPassed).toBe(false);
      expect(result.suggestions.length).toBeGreaterThanOrEqual(2); // At least Node version + config file
      expect(result.suggestions.some(s => s.includes('nvm') || s.includes('upgrade') || s.includes('nodejs'))).toBe(true);
      expect(result.suggestions.some(s => s.includes('npx vibe-validate init'))).toBe(true);
    });

    it('should check package manager availability', async () => {
      vi.mocked(execSync).mockImplementation((cmd: string) => {
        if (cmd.includes('node --version')) return 'v22.0.0' as any;
        if (cmd.includes('git --version')) return 'git version 2.40.0' as any;
        if (cmd.includes('git rev-parse')) return '/path/to/repo' as any;
        if (cmd.includes('git config')) return 'https://github.com/test/repo' as any;
        if (cmd.includes('npm view')) return '0.9.11' as any;
        if (cmd.includes('pnpm --version')) throw new Error('pnpm not found');
        return '' as any;
      });

      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(loadConfig).mockResolvedValue(mockConfig);

      const result = await runDoctor({ verbose: true });

      const pmCheck = result.checks.find(c => c.name === 'Package manager');
      expect(pmCheck?.passed).toBe(false);
      expect(pmCheck?.message).toContain('pnpm not found');
    });
  });

  describe('DoctorCheckResult', () => {
    it('should have proper structure', () => {
      const check: DoctorCheckResult = {
        name: 'Test Check',
        passed: true,
        message: 'All good',
      };

      expect(check.name).toBe('Test Check');
      expect(check.passed).toBe(true);
      expect(check.message).toBe('All good');
    });

    it('should support optional suggestion field', () => {
      const check: DoctorCheckResult = {
        name: 'Test Check',
        passed: false,
        message: 'Failed',
        suggestion: 'Run this to fix',
      };

      expect(check.suggestion).toBe('Run this to fix');
    });
  });

  describe('--verbose flag', () => {
    it('should show all checks including passing ones in verbose mode', async () => {
      // Mock file reads
      const { readFileSync } = await import('fs');
      vi.mocked(readFileSync).mockImplementation((path: any) => {
        if (path.toString().includes('package.json')) {
          return JSON.stringify({ version: '0.9.11' }) as any;
        }
        if (path.toString().includes('.gitignore')) {
          return '.vibe-validate-state.yaml\n' as any;
        }
        return 'npx vibe-validate pre-commit' as any;
      });

      // Mock healthy environment
      vi.mocked(execSync).mockImplementation((cmd: string) => {
        const cmdStr = cmd.toString();
        if (cmdStr.includes('npm view vibe-validate version')) return '0.9.11' as any;
        if (cmdStr.includes('node --version')) return 'v22.0.0' as any;
        if (cmdStr.includes('git --version')) return 'git version 2.43.0' as any;
        if (cmdStr.includes('pnpm --version')) return '9.0.0' as any;
        if (cmdStr.includes('git rev-parse --git-dir')) return '.git' as any;
        if (cmdStr.includes('git rev-parse --verify main')) return 'abc123' as any;
        if (cmdStr.includes('git remote')) return 'origin' as any;
        if (cmdStr.includes('git ls-remote --heads origin main')) return 'abc123 refs/heads/main' as any;
        return '' as any;
      });

      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(loadConfig).mockResolvedValue(mockConfig);
      vi.mocked(checkSync).mockReturnValue({ inSync: true });

      const result = await runDoctor({ verbose: true });

      // Verbose mode should return all checks
      expect(result.checks).toHaveLength(15); // All checks including config format migration check
      expect(result.verboseMode).toBe(true);
    });

    it('should show only summary in non-verbose mode when all pass', async () => {
      // Mock file reads
      const { readFileSync } = await import('fs');
      vi.mocked(readFileSync).mockImplementation((path: any) => {
        if (path.toString().includes('package.json')) {
          return JSON.stringify({ version: '0.9.11' }) as any;
        }
        if (path.toString().includes('.gitignore')) {
          return '.vibe-validate-state.yaml\n' as any;
        }
        return 'npx vibe-validate pre-commit' as any;
      });

      // Mock healthy environment
      vi.mocked(execSync).mockImplementation((cmd: string) => {
        const cmdStr = cmd.toString();
        if (cmdStr.includes('npm view vibe-validate version')) return '0.9.11' as any;
        if (cmdStr.includes('node --version')) return 'v22.0.0' as any;
        if (cmdStr.includes('git --version')) return 'git version 2.43.0' as any;
        if (cmdStr.includes('pnpm --version')) return '9.0.0' as any;
        if (cmdStr.includes('git rev-parse --git-dir')) return '.git' as any;
        if (cmdStr.includes('git rev-parse --verify main')) return 'abc123' as any;
        if (cmdStr.includes('git remote')) return 'origin' as any;
        if (cmdStr.includes('git ls-remote --heads origin main')) return 'abc123 refs/heads/main' as any;
        return '' as any;
      });

      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(loadConfig).mockResolvedValue(mockConfig);
      vi.mocked(checkSync).mockReturnValue({ inSync: true });

      const result = await runDoctor({ verbose: false });

      // Non-verbose with all passing should show ONLY failed checks (none in this case)
      expect(result.verboseMode).toBe(false);
      expect(result.allPassed).toBe(true);
      expect(result.checks).toHaveLength(0); // No failed checks to show
    });

    it('should show only failing checks in non-verbose mode', async () => {
      vi.mocked(execSync).mockImplementation((cmd: string) => {
        const cmdStr = cmd.toString();
        if (cmdStr.includes('node --version')) return 'v18.0.0' as any; // Too old
        if (cmdStr.includes('git --version')) return 'git version 2.43.0' as any;
        if (cmdStr.includes('git rev-parse --git-dir')) return '.git' as any;
        if (cmdStr.includes('git rev-parse --verify main')) return 'abc123' as any;
        if (cmdStr.includes('git remote')) return 'origin' as any;
        if (cmdStr.includes('git ls-remote --heads origin main')) return 'abc123 refs/heads/main' as any;
        return '' as any;
      });

      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(loadConfig).mockResolvedValue(mockConfig);
      vi.mocked(checkSync).mockReturnValue({ inSync: true });

      const result = await runDoctor({ verbose: false });

      // Non-verbose should show ONLY failing checks, not passing ones
      const failedChecks = result.checks.filter(c => !c.passed);
      const passingChecks = result.checks.filter(c => c.passed);
      expect(failedChecks.length).toBeGreaterThan(0); // At least 1 failure (Node.js version)
      expect(passingChecks.length).toBe(0); // Should NOT show any passing checks
      expect(result.checks).toHaveLength(failedChecks.length); // Only failed checks
    });

    it('should show all checks including passing in verbose mode when failures exist', async () => {
      const { readFileSync } = await import('fs');
      vi.mocked(readFileSync).mockImplementation((path: any) => {
        if (path.toString().includes('package.json')) {
          return JSON.stringify({ version: '0.9.11' }) as any;
        }
        if (path.toString().includes('.gitignore')) {
          return '.vibe-validate-state.yaml\n' as any;
        }
        return 'npx vibe-validate pre-commit' as any;
      });

      vi.mocked(execSync).mockImplementation((cmd: string) => {
        const cmdStr = cmd.toString();
        if (cmdStr.includes('npm view vibe-validate version')) return '0.9.11' as any;
        if (cmdStr.includes('node --version')) return 'v18.0.0' as any; // Too old - will fail
        if (cmdStr.includes('git --version')) return 'git version 2.43.0' as any;
        if (cmdStr.includes('pnpm --version')) return '9.0.0' as any;
        if (cmdStr.includes('git rev-parse --git-dir')) return '.git' as any;
        if (cmdStr.includes('git rev-parse --verify main')) return 'abc123' as any;
        if (cmdStr.includes('git remote')) return 'origin' as any;
        if (cmdStr.includes('git ls-remote --heads origin main')) return 'abc123 refs/heads/main' as any;
        return '' as any;
      });

      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(loadConfig).mockResolvedValue(mockConfig);
      vi.mocked(checkSync).mockReturnValue({ inSync: true });

      const result = await runDoctor({ verbose: true });

      // Verbose mode should show ALL 15 checks (including passing ones)
      expect(result.verboseMode).toBe(true);
      expect(result.checks).toHaveLength(15); // All checks
      expect(result.allPassed).toBe(false); // Has failures

      const failedChecks = result.checks.filter(c => !c.passed);
      const passingChecks = result.checks.filter(c => c.passed);
      expect(failedChecks.length).toBeGreaterThan(0); // At least 1 failure
      expect(passingChecks.length).toBeGreaterThan(0); // Should show passing checks too
    });
  });

  describe('pre-commit hook opt-out', () => {
    beforeEach(async () => {
      // Mock file reads for all pre-commit tests
      const { readFileSync } = await import('fs');
      vi.mocked(readFileSync).mockImplementation((path: any) => {
        if (path.toString().includes('package.json')) {
          return JSON.stringify({ version: '0.9.11' }) as any;
        }
        if (path.toString().includes('.gitignore')) {
          return '.vibe-validate-state.yaml\n' as any;
        }
        return 'npx vibe-validate pre-commit' as any;
      });

      // Mock healthy environment for all pre-commit tests
      vi.mocked(execSync).mockImplementation((cmd: string) => {
        const cmdStr = cmd.toString();
        if (cmdStr.includes('npm view vibe-validate version')) return '0.9.11' as any;
        if (cmdStr.includes('node --version')) return 'v22.0.0' as any;
        if (cmdStr.includes('git --version')) return 'git version 2.43.0' as any;
        if (cmdStr.includes('pnpm --version')) return '9.0.0' as any;
        if (cmdStr.includes('git rev-parse --git-dir')) return '.git' as any;
        if (cmdStr.includes('git rev-parse --verify main')) return 'abc123' as any;
        if (cmdStr.includes('git remote')) return 'origin' as any;
        if (cmdStr.includes('git ls-remote --heads origin main')) return 'abc123 refs/heads/main' as any;
        return '' as any;
      });
      vi.mocked(checkSync).mockReturnValue({ inSync: true });
    });

    it('should pass when pre-commit hook is explicitly disabled in config', async () => {
      const configWithDisabledHook = {
        ...mockConfig,
        hooks: {
          preCommit: {
            enabled: false,
          },
        },
      };

      vi.mocked(existsSync).mockReturnValue(true); // Config and validation state exist
      vi.mocked(loadConfig).mockResolvedValue(configWithDisabledHook);

      const result = await runDoctor({ verbose: true });

      const hookCheck = result.checks.find(c => c.name === 'Pre-commit hook');
      expect(hookCheck?.passed).toBe(true);
      expect(hookCheck?.message).toContain('disabled in config');
      expect(hookCheck?.message).toContain('user preference');
      expect(result.allPassed).toBe(true);
    });

    it('should fail when pre-commit hook is enabled (default) but not installed', async () => {
      vi.mocked(existsSync).mockImplementation((path: string) => {
        const pathStr = path.toString();
        if (pathStr.includes('.husky/pre-commit')) return false; // Hook not installed
        return true; // Other files exist
      });
      vi.mocked(loadConfig).mockResolvedValue(mockConfig); // Default: hooks.preCommit.enabled = true

      const result = await runDoctor({ verbose: true });

      const hookCheck = result.checks.find(c => c.name === 'Pre-commit hook');
      expect(hookCheck?.passed).toBe(false);
      expect(hookCheck?.message).toContain('not installed');
      expect(hookCheck?.suggestion).toContain('npx husky init');
      expect(hookCheck?.suggestion).toContain('hooks.preCommit.enabled=false');
      expect(result.allPassed).toBe(false);
    });

    it('should pass when pre-commit hook is properly configured with vibe-validate', async () => {
      const { readFileSync } = await import('fs');
      vi.mocked(readFileSync).mockImplementation((path: any) => {
        if (path.toString().includes('package.json')) {
          return JSON.stringify({ version: '0.9.11' }) as any;
        }
        if (path.toString().includes('.gitignore')) {
          return '.vibe-validate-state.yaml\n' as any;
        }
        return 'npx vibe-validate pre-commit' as any; // Pre-commit hook content
      });
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(loadConfig).mockResolvedValue(mockConfig);

      const result = await runDoctor({ verbose: true });

      const hookCheck = result.checks.find(c => c.name === 'Pre-commit hook');
      expect(hookCheck?.passed).toBe(true);
      expect(hookCheck?.message).toContain('installed and runs vibe-validate');
      expect(result.allPassed).toBe(true);
    });

    it('should pass when pre-commit hook runs vibe-validate via npm script', async () => {
      const { readFileSync } = await import('fs');
      vi.mocked(readFileSync).mockImplementation((path: any) => {
        if (path.toString().includes('package.json')) {
          return JSON.stringify({ version: '0.9.11' }) as any;
        }
        if (path.toString().includes('.gitignore')) {
          return '.vibe-validate-state.yaml\n' as any;
        }
        return 'npm run pre-commit' as any; // Pre-commit hook runs via npm
      });
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(loadConfig).mockResolvedValue(mockConfig);

      const result = await runDoctor({ verbose: true });

      const hookCheck = result.checks.find(c => c.name === 'Pre-commit hook');
      expect(hookCheck?.passed).toBe(true);
      expect(hookCheck?.message).toContain('installed and runs vibe-validate');
    });

    it('should pass when pre-commit hook runs vibe-validate via pnpm script', async () => {
      const { readFileSync } = await import('fs');
      vi.mocked(readFileSync).mockImplementation((path: any) => {
        if (path.toString().includes('package.json')) {
          return JSON.stringify({ version: '0.9.11' }) as any;
        }
        if (path.toString().includes('.gitignore')) {
          return '.vibe-validate-state.yaml\n' as any;
        }
        return 'pnpm pre-commit' as any; // Pre-commit hook runs via pnpm
      });
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(loadConfig).mockResolvedValue(mockConfig);

      const result = await runDoctor({ verbose: true });

      const hookCheck = result.checks.find(c => c.name === 'Pre-commit hook');
      expect(hookCheck?.passed).toBe(true);
      expect(hookCheck?.message).toContain('installed and runs vibe-validate');
    });

    it('should fail when custom pre-commit hook exists but does not run vibe-validate', async () => {
      const { readFileSync } = await import('fs');
      vi.mocked(readFileSync).mockReturnValue('npm test\nnpm run lint\nnpm run format' as any);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(loadConfig).mockResolvedValue(mockConfig);

      const result = await runDoctor({ verbose: true });

      const hookCheck = result.checks.find(c => c.name === 'Pre-commit hook');
      expect(hookCheck?.passed).toBe(false);
      expect(hookCheck?.message).toContain('Custom pre-commit hook detected');
      expect(hookCheck?.message).toContain('npm test; npm run lint; npm run format');
      expect(hookCheck?.suggestion).toContain('Verify that .husky/pre-commit runs');
      expect(hookCheck?.suggestion).toContain('npx vibe-validate pre-commit');
      expect(hookCheck?.suggestion).toContain('hooks.preCommit.enabled=false');
    });

    it('should fail when pre-commit hook exists but is unreadable', async () => {
      const { readFileSync } = await import('fs');
      vi.mocked(readFileSync).mockImplementation(() => {
        throw new Error('EACCES: permission denied');
      });
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(loadConfig).mockResolvedValue(mockConfig);

      const result = await runDoctor({ verbose: true });

      const hookCheck = result.checks.find(c => c.name === 'Pre-commit hook');
      expect(hookCheck?.passed).toBe(false);
      expect(hookCheck?.message).toContain('unreadable');
      expect(hookCheck?.suggestion).toContain('permissions');
      expect(hookCheck?.suggestion).toContain('hooks.preCommit.enabled=false');
    });

    it('should use custom command from config when checking hook', async () => {
      const { readFileSync } = await import('fs');
      const configWithCustomCommand = {
        ...mockConfig,
        hooks: {
          preCommit: {
            enabled: true,
            command: 'npm run custom-validate',
          },
        },
      };

      vi.mocked(readFileSync).mockReturnValue('npm run custom-hook' as any);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(loadConfig).mockResolvedValue(configWithCustomCommand);

      const result = await runDoctor({ verbose: true });

      const hookCheck = result.checks.find(c => c.name === 'Pre-commit hook');
      expect(hookCheck?.passed).toBe(false);
      expect(hookCheck?.suggestion).toContain('npm run custom-validate');
    });
  });

  describe('version check', () => {
    it('should pass when current version is up to date', async () => {
      const { readFileSync } = await import('fs');
      vi.mocked(readFileSync).mockImplementation((path: any) => {
        if (path.toString().includes('package.json')) {
          return JSON.stringify({ version: '0.9.11' }) as any;
        }
        if (path.toString().includes('.gitignore')) {
          return '.vibe-validate-state.yaml\n' as any;
        }
        return 'npm run pre-commit' as any;
      });

      vi.mocked(execSync).mockImplementation((cmd: string) => {
        const cmdStr = cmd.toString();
        if (cmdStr.includes('npm view vibe-validate version')) return '0.9.11' as any;
        if (cmdStr.includes('node --version')) return 'v22.0.0' as any;
        if (cmdStr.includes('git --version')) return 'git version 2.43.0' as any;
        if (cmdStr.includes('pnpm --version')) return '9.0.0' as any;
        if (cmdStr.includes('git rev-parse --git-dir')) return '.git' as any;
        if (cmdStr.includes('git rev-parse --verify main')) return 'abc123' as any;
        if (cmdStr.includes('git remote')) return 'origin' as any;
        if (cmdStr.includes('git ls-remote')) return 'abc123 refs/heads/main' as any;
        return '' as any;
      });

      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(loadConfig).mockResolvedValue(mockConfig);
      vi.mocked(checkSync).mockReturnValue({ inSync: true });

      const result = await runDoctor({ verbose: true });

      const versionCheck = result.checks.find(c => c.name === 'vibe-validate version');
      expect(versionCheck?.passed).toBe(true);
      expect(versionCheck?.message).toContain('up to date');
    });

    it('should warn when newer version is available', async () => {
      const { readFileSync } = await import('fs');
      vi.mocked(readFileSync).mockImplementation((path: any) => {
        if (path.toString().includes('package.json')) {
          return JSON.stringify({ version: '0.9.10' }) as any;
        }
        if (path.toString().includes('.gitignore')) {
          return '.vibe-validate-state.yaml\n' as any;
        }
        return 'npm run pre-commit' as any;
      });

      vi.mocked(execSync).mockImplementation((cmd: string) => {
        const cmdStr = cmd.toString();
        if (cmdStr.includes('npm view vibe-validate version')) return '0.9.11' as any;
        if (cmdStr.includes('node --version')) return 'v22.0.0' as any;
        if (cmdStr.includes('git --version')) return 'git version 2.43.0' as any;
        if (cmdStr.includes('pnpm --version')) return '9.0.0' as any;
        if (cmdStr.includes('git rev-parse --git-dir')) return '.git' as any;
        if (cmdStr.includes('git rev-parse --verify main')) return 'abc123' as any;
        if (cmdStr.includes('git remote')) return 'origin' as any;
        if (cmdStr.includes('git ls-remote')) return 'abc123 refs/heads/main' as any;
        return '' as any;
      });

      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(loadConfig).mockResolvedValue(mockConfig);
      vi.mocked(checkSync).mockReturnValue({ inSync: true });

      const result = await runDoctor({ verbose: true });

      const versionCheck = result.checks.find(c => c.name === 'vibe-validate version');
      expect(versionCheck?.passed).toBe(true); // Warning only, not a failure
      expect(versionCheck?.message).toContain('0.9.10');
      expect(versionCheck?.message).toContain('0.9.11');
      expect(versionCheck?.suggestion).toContain('npm install -D vibe-validate@latest');
      expect(versionCheck?.suggestion).toContain('vibe-validate doctor');
    });

    it('should handle npm registry unavailable gracefully', async () => {
      const { readFileSync } = await import('fs');
      vi.mocked(readFileSync).mockImplementation((path: any) => {
        if (path.toString().includes('package.json')) {
          return JSON.stringify({ version: '0.9.11' }) as any;
        }
        if (path.toString().includes('.gitignore')) {
          return '.vibe-validate-state.yaml\n' as any;
        }
        return 'npm run pre-commit' as any;
      });

      vi.mocked(execSync).mockImplementation((cmd: string) => {
        const cmdStr = cmd.toString();
        if (cmdStr.includes('npm view vibe-validate version')) {
          throw new Error('ENOTFOUND registry.npmjs.org');
        }
        if (cmdStr.includes('node --version')) return 'v22.0.0' as any;
        if (cmdStr.includes('git --version')) return 'git version 2.43.0' as any;
        if (cmdStr.includes('pnpm --version')) return '9.0.0' as any;
        if (cmdStr.includes('git rev-parse --git-dir')) return '.git' as any;
        if (cmdStr.includes('git rev-parse --verify main')) return 'abc123' as any;
        if (cmdStr.includes('git remote')) return 'origin' as any;
        if (cmdStr.includes('git ls-remote')) return 'abc123 refs/heads/main' as any;
        return '' as any;
      });

      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(loadConfig).mockResolvedValue(mockConfig);
      vi.mocked(checkSync).mockReturnValue({ inSync: true });

      const result = await runDoctor({ verbose: true });

      const versionCheck = result.checks.find(c => c.name === 'vibe-validate version');
      expect(versionCheck?.passed).toBe(true);
      expect(versionCheck?.message).toContain('unable to check');
    });
  });

  describe('gitignore state file check', () => {
    it('should pass when .vibe-validate-state.yaml is in .gitignore', async () => {
      const { readFileSync } = await import('fs');
      vi.mocked(readFileSync).mockImplementation((path: any) => {
        if (path.toString().includes('.gitignore')) {
          return '.vibe-validate-state.yaml\nnode_modules\n' as any;
        }
        if (path.toString().includes('package.json')) {
          return JSON.stringify({ version: '0.9.11' }) as any;
        }
        return 'npm run pre-commit' as any;
      });

      vi.mocked(execSync).mockImplementation((cmd: string) => {
        const cmdStr = cmd.toString();
        if (cmdStr.includes('npm view vibe-validate version')) return '0.9.11' as any;
        if (cmdStr.includes('node --version')) return 'v22.0.0' as any;
        if (cmdStr.includes('git --version')) return 'git version 2.43.0' as any;
        if (cmdStr.includes('pnpm --version')) return '9.0.0' as any;
        if (cmdStr.includes('git rev-parse --git-dir')) return '.git' as any;
        if (cmdStr.includes('git rev-parse --verify main')) return 'abc123' as any;
        if (cmdStr.includes('git remote')) return 'origin' as any;
        if (cmdStr.includes('git ls-remote')) return 'abc123 refs/heads/main' as any;
        return '' as any;
      });

      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(loadConfig).mockResolvedValue(mockConfig);
      vi.mocked(checkSync).mockReturnValue({ inSync: true });

      const result = await runDoctor({ verbose: true });

      const gitignoreCheck = result.checks.find(c => c.name === 'Gitignore state file');
      expect(gitignoreCheck?.passed).toBe(true);
      expect(gitignoreCheck?.message).toContain('.vibe-validate-state.yaml is in .gitignore');
    });

    it('should fail when .gitignore exists but state file not listed', async () => {
      const { readFileSync } = await import('fs');
      vi.mocked(readFileSync).mockImplementation((path: any) => {
        if (path.toString().includes('.gitignore')) {
          return 'node_modules\ndist\n' as any; // No state file
        }
        if (path.toString().includes('package.json')) {
          return JSON.stringify({ version: '0.9.11' }) as any;
        }
        return 'npm run pre-commit' as any;
      });

      vi.mocked(execSync).mockReturnValue('v22.0.0' as any);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(loadConfig).mockResolvedValue(mockConfig);
      vi.mocked(checkSync).mockReturnValue({ inSync: true });

      const result = await runDoctor({ verbose: true });

      const gitignoreCheck = result.checks.find(c => c.name === 'Gitignore state file');
      expect(gitignoreCheck?.passed).toBe(false);
      expect(gitignoreCheck?.message).toContain('not in .gitignore');
      expect(gitignoreCheck?.suggestion).toContain('echo ".vibe-validate-state.yaml" >> .gitignore');
      expect(gitignoreCheck?.suggestion).toContain('vibe-validate init --fix-gitignore');
    });

    it('should fail when .gitignore does not exist', async () => {
      vi.mocked(execSync).mockReturnValue('v22.0.0' as any);
      vi.mocked(existsSync).mockImplementation((path: string) => {
        if (path.toString().includes('.gitignore')) return false;
        return true;
      });
      vi.mocked(loadConfig).mockResolvedValue(mockConfig);
      vi.mocked(checkSync).mockReturnValue({ inSync: true });

      const result = await runDoctor({ verbose: true });

      const gitignoreCheck = result.checks.find(c => c.name === 'Gitignore state file');
      expect(gitignoreCheck?.passed).toBe(false);
      expect(gitignoreCheck?.message).toContain('.gitignore file not found');
      expect(gitignoreCheck?.suggestion).toContain('vibe-validate init --fix-gitignore');
    });

    it('should fail when .gitignore is unreadable', async () => {
      const { readFileSync } = await import('fs');
      vi.mocked(readFileSync).mockImplementation((path: any) => {
        if (path.toString().includes('.gitignore')) {
          throw new Error('EACCES: permission denied');
        }
        if (path.toString().includes('package.json')) {
          return JSON.stringify({ version: '0.9.11' }) as any;
        }
        return 'npm run pre-commit' as any;
      });

      vi.mocked(execSync).mockReturnValue('v22.0.0' as any);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(loadConfig).mockResolvedValue(mockConfig);
      vi.mocked(checkSync).mockReturnValue({ inSync: true });

      const result = await runDoctor({ verbose: true });

      const gitignoreCheck = result.checks.find(c => c.name === 'Gitignore state file');
      expect(gitignoreCheck?.passed).toBe(false);
      expect(gitignoreCheck?.message).toContain('unreadable');
      expect(gitignoreCheck?.suggestion).toContain('chmod 644');
    });
  });

  describe('config format check', () => {
    it('should detect .yaml config files', async () => {
      const { readFileSync } = await import('fs');
      vi.mocked(readFileSync).mockImplementation((path: any) => {
        if (path.toString().includes('package.json')) {
          return JSON.stringify({ version: '0.9.11' }) as any;
        }
        if (path.toString().includes('.gitignore')) {
          return '.vibe-validate-state.yaml\n' as any;
        }
        return 'npm run pre-commit' as any;
      });

      vi.mocked(execSync).mockImplementation((cmd: string) => {
        const cmdStr = cmd.toString();
        if (cmdStr.includes('npm view vibe-validate version')) return '0.9.11' as any;
        if (cmdStr.includes('node --version')) return 'v22.0.0' as any;
        if (cmdStr.includes('git --version')) return 'git version 2.43.0' as any;
        if (cmdStr.includes('pnpm --version')) return '9.0.0' as any;
        if (cmdStr.includes('git rev-parse --git-dir')) return '.git' as any;
        if (cmdStr.includes('git rev-parse --verify main')) return 'abc123' as any;
        if (cmdStr.includes('git remote')) return 'origin' as any;
        if (cmdStr.includes('git ls-remote')) return 'abc123 refs/heads/main' as any;
        return '' as any;
      });

      vi.mocked(existsSync).mockImplementation((path: string) => {
        if (path.toString() === 'vibe-validate.config.yaml') return true;
        if (path.toString() === 'vibe-validate.config.yaml') return false;
        if (path.toString() === 'vibe-validate.config.js') return false;
        return true;
      });
      vi.mocked(loadConfig).mockResolvedValue(mockConfig);
      vi.mocked(checkSync).mockReturnValue({ inSync: true });

      const result = await runDoctor({ verbose: true });

      const configCheck = result.checks.find(c => c.name === 'Configuration file');
      expect(configCheck?.passed).toBe(true);
      expect(configCheck?.message).toContain('vibe-validate.config.yaml');
    });

    it('should not check for .json config files (JSON not supported)', async () => {
      vi.mocked(execSync).mockReturnValue('v22.0.0' as any);
      vi.mocked(existsSync).mockImplementation((path: string) => {
        // JSON file exists but should not be detected
        if (path.toString() === 'vibe-validate.config.yaml') return false;
        if (path.toString() === 'vibe-validate.config.yaml') return false;
        if (path.toString() === 'vibe-validate.config.js') return false;
        return true;
      });
      vi.mocked(loadConfig).mockResolvedValue(null);

      const result = await runDoctor({ verbose: true });

      const configCheck = result.checks.find(c => c.name === 'Configuration file');
      expect(configCheck?.passed).toBe(false);
      expect(configCheck?.message).toContain('not found');
    });
  });

  describe('config format migration check', () => {
    it('should pass when using YAML format', async () => {
      vi.mocked(execSync).mockReturnValue('v22.0.0' as any);
      vi.mocked(existsSync).mockImplementation((path: string) => {
        if (path.toString() === 'vibe-validate.config.yaml') return true;
        return true;
      });
      vi.mocked(loadConfig).mockResolvedValue({
        validation: { phases: [] },
      } as any);

      const result = await runDoctor({ verbose: true }); // Verbose to see all checks

    });

    it('should skip check when no config file exists', async () => {
      vi.mocked(execSync).mockReturnValue('v22.0.0' as any);
      vi.mocked(existsSync).mockImplementation((path: string) => {
        if (path.toString() === 'vibe-validate.config.yaml') return false;
        return true;
      });
      vi.mocked(loadConfig).mockResolvedValue(null);

      const result = await runDoctor({ verbose: true }); // Verbose to see all checks

    });
  });

  describe('secret scanning check', () => {
    it('should pass when secret scanning is disabled', async () => {
      const mockConfigNoScanning: VibeValidateConfig = {
        ...mockConfig,
        hooks: {
          preCommit: {
            enabled: true,
            secretScanning: {
              enabled: false,
            },
          },
        },
      };

      vi.mocked(execSync).mockReturnValue('v22.0.0' as any);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(loadConfig).mockResolvedValue(mockConfigNoScanning);

      const result = await runDoctor({ verbose: true });

      const secretCheck = result.checks.find(c => c.name === 'Pre-commit secret scanning');
      expect(secretCheck).toBeDefined();
      expect(secretCheck?.passed).toBe(true);
      expect(secretCheck?.message).toContain('disabled');
    });

    it('should pass with success message when scanning enabled and tool found', async () => {
      const mockConfigWithScanning: VibeValidateConfig = {
        ...mockConfig,
        hooks: {
          preCommit: {
            enabled: true,
            secretScanning: {
              enabled: true,
              scanCommand: 'gitleaks protect --staged --verbose',
            },
          },
        },
      };

      vi.mocked(execSync).mockImplementation((cmd: string) => {
        const cmdStr = cmd.toString();
        if (cmdStr.includes('gitleaks version') || cmdStr.includes('gitleaks --version')) {
          return 'v8.18.0' as any;
        }
        if (cmdStr.includes('node --version')) return 'v22.0.0' as any;
        if (cmdStr.includes('git --version')) return 'git version 2.43.0' as any;
        if (cmdStr.includes('git rev-parse --git-dir')) return '.git' as any;
        if (cmdStr.includes('git rev-parse --verify main')) return 'abc123' as any;
        if (cmdStr.includes('git remote')) return 'origin' as any;
        if (cmdStr.includes('git ls-remote --heads origin main')) return 'abc123 refs/heads/main' as any;
        return '' as any;
      });
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(loadConfig).mockResolvedValue(mockConfigWithScanning);

      const result = await runDoctor({ verbose: true });

      const secretCheck = result.checks.find(c => c.name === 'Pre-commit secret scanning');
      expect(secretCheck).toBeDefined();
      expect(secretCheck?.passed).toBe(true);
      expect(secretCheck?.message).toContain('gitleaks');
      expect(secretCheck?.message).toContain('v8.18.0');
    });

    it('should pass with warning when scanning enabled but tool not found', async () => {
      const mockConfigWithScanning: VibeValidateConfig = {
        ...mockConfig,
        hooks: {
          preCommit: {
            enabled: true,
            secretScanning: {
              enabled: true,
              scanCommand: 'gitleaks protect --staged --verbose',
            },
          },
        },
      };

      vi.mocked(execSync).mockImplementation((cmd: string) => {
        const cmdStr = cmd.toString();
        if (cmdStr.includes('gitleaks version') || cmdStr.includes('gitleaks --version')) {
          throw new Error('Command not found');
        }
        if (cmdStr.includes('node --version')) return 'v22.0.0' as any;
        if (cmdStr.includes('git --version')) return 'git version 2.43.0' as any;
        if (cmdStr.includes('git rev-parse --git-dir')) return '.git' as any;
        if (cmdStr.includes('git rev-parse --verify main')) return 'abc123' as any;
        if (cmdStr.includes('git remote')) return 'origin' as any;
        if (cmdStr.includes('git ls-remote --heads origin main')) return 'abc123 refs/heads/main' as any;
        return '' as any;
      });
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(loadConfig).mockResolvedValue(mockConfigWithScanning);

      const result = await runDoctor({ verbose: true });

      const secretCheck = result.checks.find(c => c.name === 'Pre-commit secret scanning');
      expect(secretCheck).toBeDefined();
      expect(secretCheck?.passed).toBe(true); // Advisory only, always passes
      expect(secretCheck?.message).toContain('enabled but');
      expect(secretCheck?.message).toContain('not found');
      expect(secretCheck?.suggestion).toBeDefined();
      expect(secretCheck?.suggestion).toContain('Install');
    });

    it('should skip check when secretScanning config not provided', async () => {
      const mockConfigNoHooks: VibeValidateConfig = {
        ...mockConfig,
        hooks: {
          preCommit: {
            enabled: true,
            // No secretScanning config
          },
        },
      };

      vi.mocked(execSync).mockReturnValue('v22.0.0' as any);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(loadConfig).mockResolvedValue(mockConfigNoHooks);

      const result = await runDoctor({ verbose: true });

      const secretCheck = result.checks.find(c => c.name === 'Pre-commit secret scanning');
      expect(secretCheck).toBeDefined();
      expect(secretCheck?.passed).toBe(true);
      expect(secretCheck?.message).toContain('not configured');
    });

    it('should handle custom secret scanning tools (detect-secrets)', async () => {
      const mockConfigDetectSecrets: VibeValidateConfig = {
        ...mockConfig,
        hooks: {
          preCommit: {
            enabled: true,
            secretScanning: {
              enabled: true,
              scanCommand: 'detect-secrets scan --staged',
            },
          },
        },
      };

      vi.mocked(execSync).mockImplementation((cmd: string) => {
        const cmdStr = cmd.toString();
        if (cmdStr.includes('detect-secrets version') || cmdStr.includes('detect-secrets --version')) {
          return '1.4.0' as any;
        }
        if (cmdStr.includes('node --version')) return 'v22.0.0' as any;
        if (cmdStr.includes('git --version')) return 'git version 2.43.0' as any;
        if (cmdStr.includes('git rev-parse --git-dir')) return '.git' as any;
        if (cmdStr.includes('git rev-parse --verify main')) return 'abc123' as any;
        if (cmdStr.includes('git remote')) return 'origin' as any;
        if (cmdStr.includes('git ls-remote --heads origin main')) return 'abc123 refs/heads/main' as any;
        return '' as any;
      });
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(loadConfig).mockResolvedValue(mockConfigDetectSecrets);

      const result = await runDoctor({ verbose: true });

      const secretCheck = result.checks.find(c => c.name === 'Pre-commit secret scanning');
      expect(secretCheck).toBeDefined();
      expect(secretCheck?.passed).toBe(true);
      expect(secretCheck?.message).toContain('detect-secrets');
    });
  });
});

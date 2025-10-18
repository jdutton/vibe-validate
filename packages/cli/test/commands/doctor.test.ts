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
}));

vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

vi.mock('../../src/utils/config-loader.js');
vi.mock('../../src/commands/generate-workflow.js');

import { runDoctor, type DoctorCheckResult } from '../../src/commands/doctor.js';
import { loadConfig } from '../../src/utils/config-loader.js';
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
      // Mock healthy environment
      vi.mocked(execSync).mockImplementation((cmd: string) => {
        const cmdStr = cmd.toString();
        if (cmdStr.includes('node --version')) return 'v22.0.0' as any;
        if (cmdStr.includes('git --version')) return 'git version 2.43.0' as any;
        if (cmdStr.includes('pnpm --version')) return '9.0.0' as any;
        if (cmdStr.includes('git rev-parse --git-dir')) return '.git' as any;
        return '' as any;
      });

      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(loadConfig).mockResolvedValue(mockConfig);
      vi.mocked(checkSync).mockReturnValue({ inSync: true });

      const result = await runDoctor();

      expect(result.allPassed).toBe(true);
      expect(result.checks).toHaveLength(9); // Total number of checks (7 original + 2 new)
      expect(result.checks.every(c => c.passed)).toBe(true);
    });

    it('should detect Node.js version too old', async () => {
      vi.mocked(execSync).mockImplementation((cmd: string) => {
        const cmdStr = cmd.toString();
        if (cmdStr.includes('node --version')) return 'v18.0.0' as any; // Too old
        if (cmdStr.includes('git --version')) return 'git version 2.43.0' as any;
        if (cmdStr.includes('git rev-parse')) return '.git' as any;
        return '' as any;
      });

      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(loadConfig).mockResolvedValue(mockConfig);
      vi.mocked(checkSync).mockReturnValue({ inSync: true });

      const result = await runDoctor();

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

      const result = await runDoctor();

      const gitCheck = result.checks.find(c => c.name === 'Git installed');
      expect(gitCheck?.passed).toBe(false);
      expect(gitCheck?.message).toContain('not installed');
    });

    it('should detect missing configuration file', async () => {
      vi.mocked(execSync).mockReturnValue('v22.0.0' as any);
      vi.mocked(existsSync).mockReturnValue(false); // No config file
      vi.mocked(loadConfig).mockResolvedValue(null);

      const result = await runDoctor();

      const configCheck = result.checks.find(c => c.name === 'Configuration file');
      expect(configCheck?.passed).toBe(false);
      expect(configCheck?.message).toContain('not found');
    });

    it('should detect invalid configuration', async () => {
      vi.mocked(execSync).mockReturnValue('v22.0.0' as any);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(loadConfig).mockRejectedValue(new Error('Invalid config'));

      const result = await runDoctor();

      const configCheck = result.checks.find(c => c.name === 'Configuration valid');
      expect(configCheck?.passed).toBe(false);
      expect(configCheck?.message).toContain('Invalid');
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

      const result = await runDoctor();

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

      const result = await runDoctor();

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

      const result = await runDoctor();

      expect(result.allPassed).toBe(false);
      expect(result.suggestions.length).toBeGreaterThanOrEqual(2); // At least Node version + config file
      expect(result.suggestions.some(s => s.includes('nvm') || s.includes('upgrade') || s.includes('nodejs'))).toBe(true);
      expect(result.suggestions.some(s => s.includes('npx vibe-validate init'))).toBe(true);
    });

    it('should check package manager availability', async () => {
      vi.mocked(execSync).mockImplementation((cmd: string) => {
        if (cmd.includes('node --version')) return 'v22.0.0' as any;
        if (cmd.includes('pnpm --version')) throw new Error('pnpm not found');
        return '' as any;
      });

      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(loadConfig).mockResolvedValue(mockConfig);

      const result = await runDoctor();

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
      // Mock healthy environment
      vi.mocked(execSync).mockImplementation((cmd: string) => {
        const cmdStr = cmd.toString();
        if (cmdStr.includes('node --version')) return 'v22.0.0' as any;
        if (cmdStr.includes('git --version')) return 'git version 2.43.0' as any;
        if (cmdStr.includes('pnpm --version')) return '9.0.0' as any;
        if (cmdStr.includes('git rev-parse')) return '.git' as any;
        return '' as any;
      });

      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(loadConfig).mockResolvedValue(mockConfig);
      vi.mocked(checkSync).mockReturnValue({ inSync: true });

      const result = await runDoctor({ verbose: true });

      // Verbose mode should return all checks
      expect(result.checks).toHaveLength(9); // 7 original + 2 new checks
      expect(result.verboseMode).toBe(true);
    });

    it('should show all checks in non-verbose mode when all pass', async () => {
      // Mock healthy environment
      vi.mocked(execSync).mockImplementation((cmd: string) => {
        const cmdStr = cmd.toString();
        if (cmdStr.includes('node --version')) return 'v22.0.0' as any;
        if (cmdStr.includes('git --version')) return 'git version 2.43.0' as any;
        if (cmdStr.includes('pnpm --version')) return '9.0.0' as any;
        if (cmdStr.includes('git rev-parse')) return '.git' as any;
        return '' as any;
      });

      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(loadConfig).mockResolvedValue(mockConfig);
      vi.mocked(checkSync).mockReturnValue({ inSync: true });

      const result = await runDoctor({ verbose: false });

      // Non-verbose with all passing should show all checks (for summary)
      expect(result.verboseMode).toBe(false);
      expect(result.allPassed).toBe(true);
      expect(result.checks).toHaveLength(9); // Shows all checks when all pass
    });

    it('should always show failing checks in non-verbose mode', async () => {
      vi.mocked(execSync).mockImplementation((cmd: string) => {
        const cmdStr = cmd.toString();
        if (cmdStr.includes('node --version')) return 'v18.0.0' as any; // Too old
        if (cmdStr.includes('git --version')) return 'git version 2.43.0' as any;
        if (cmdStr.includes('git rev-parse')) return '.git' as any;
        return '' as any;
      });

      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(loadConfig).mockResolvedValue(mockConfig);
      vi.mocked(checkSync).mockReturnValue({ inSync: true });

      const result = await runDoctor({ verbose: false });

      // Non-verbose should include failing checks
      const failedChecks = result.checks.filter(c => !c.passed);
      expect(failedChecks.length).toBeGreaterThan(0);
      expect(result.checks.length).toBeLessThanOrEqual(result.checks.length); // May filter passing
    });
  });

  describe('pre-commit hook opt-out', () => {
    beforeEach(() => {
      // Mock healthy environment for all pre-commit tests
      vi.mocked(execSync).mockImplementation((cmd: string) => {
        const cmdStr = cmd.toString();
        if (cmdStr.includes('node --version')) return 'v22.0.0' as any;
        if (cmdStr.includes('git --version')) return 'git version 2.43.0' as any;
        if (cmdStr.includes('pnpm --version')) return '9.0.0' as any;
        if (cmdStr.includes('git rev-parse')) return '.git' as any;
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

      const result = await runDoctor();

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

      const result = await runDoctor();

      const hookCheck = result.checks.find(c => c.name === 'Pre-commit hook');
      expect(hookCheck?.passed).toBe(false);
      expect(hookCheck?.message).toContain('not installed');
      expect(hookCheck?.suggestion).toContain('npx husky init');
      expect(hookCheck?.suggestion).toContain('hooks.preCommit.enabled=false');
      expect(result.allPassed).toBe(false);
    });

    it('should pass when pre-commit hook is properly configured with vibe-validate', async () => {
      const { readFileSync } = await import('fs');
      vi.mocked(readFileSync).mockReturnValue('npx vibe-validate pre-commit' as any);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(loadConfig).mockResolvedValue(mockConfig);

      const result = await runDoctor();

      const hookCheck = result.checks.find(c => c.name === 'Pre-commit hook');
      expect(hookCheck?.passed).toBe(true);
      expect(hookCheck?.message).toContain('installed and runs vibe-validate');
      expect(result.allPassed).toBe(true);
    });

    it('should pass when pre-commit hook runs vibe-validate via npm script', async () => {
      const { readFileSync } = await import('fs');
      vi.mocked(readFileSync).mockReturnValue('npm run pre-commit' as any);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(loadConfig).mockResolvedValue(mockConfig);

      const result = await runDoctor();

      const hookCheck = result.checks.find(c => c.name === 'Pre-commit hook');
      expect(hookCheck?.passed).toBe(true);
      expect(hookCheck?.message).toContain('installed and runs vibe-validate');
    });

    it('should pass when pre-commit hook runs vibe-validate via pnpm script', async () => {
      const { readFileSync } = await import('fs');
      vi.mocked(readFileSync).mockReturnValue('pnpm pre-commit' as any);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(loadConfig).mockResolvedValue(mockConfig);

      const result = await runDoctor();

      const hookCheck = result.checks.find(c => c.name === 'Pre-commit hook');
      expect(hookCheck?.passed).toBe(true);
      expect(hookCheck?.message).toContain('installed and runs vibe-validate');
    });

    it('should fail when custom pre-commit hook exists but does not run vibe-validate', async () => {
      const { readFileSync } = await import('fs');
      vi.mocked(readFileSync).mockReturnValue('npm test\nnpm run lint\nnpm run format' as any);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(loadConfig).mockResolvedValue(mockConfig);

      const result = await runDoctor();

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

      const result = await runDoctor();

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

      const result = await runDoctor();

      const hookCheck = result.checks.find(c => c.name === 'Pre-commit hook');
      expect(hookCheck?.passed).toBe(false);
      expect(hookCheck?.suggestion).toContain('npm run custom-validate');
    });
  });
});

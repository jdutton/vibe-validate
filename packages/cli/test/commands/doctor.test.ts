/**
 * Tests for doctor command
 *
 * The doctor command diagnoses common issues with vibe-validate setup:
 * - Environment checks (Node.js version, package manager, git)
 * - Configuration validation
 * - Git integration health
 * - CI/CD workflow sync
 */

/* eslint-disable sonarjs/assertions-in-tests -- Using assertCheck() helper which wraps expect() */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

// Mock dependencies
vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(() => 'npm run pre-commit'), // Mock pre-commit hook content
  readdirSync: vi.fn(() => []), // Mock empty directory for template discovery
}));

vi.mock('child_process', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');
  return {
    ...actual,
    execSync: vi.fn(),
    spawnSync: vi.fn(() => ({
      status: 0,
      stdout: Buffer.from(''),
      stderr: Buffer.from(''),
    })),
  };
});

vi.mock('@vibe-validate/git', async () => {
  const actual = await vi.importActual<typeof import('@vibe-validate/git')>('@vibe-validate/git');
  return {
    ...actual,
    verifyRef: vi.fn(() => true), // Default to successful verification
    isGitRepository: vi.fn(() => true),
    listNotesRefs: vi.fn(() => []),
    executeGitCommand: vi.fn((args: string[]) => {
      // Mock git remote command
      if (args[0] === 'remote') {
        return { success: true, stdout: 'origin\n', stderr: '', exitCode: 0 };
      }
      // Default success for other commands (including --version)
      return { success: true, stdout: 'git version 2.43.0', stderr: '', exitCode: 0 };
    }),
  };
});

vi.mock('../../src/utils/config-loader.js');
vi.mock('../../src/commands/generate-workflow.js');

import { runDoctor, type DoctorCheckResult } from '../../src/commands/doctor.js';
import { loadConfig, findConfigPath, loadConfigWithErrors } from '../../src/utils/config-loader.js';
import { checkSync } from '../../src/commands/generate-workflow.js';
import type { VibeValidateConfig } from '@vibe-validate/config';
import {
  mockDoctorEnvironment,
  mockDoctorFileSystem,
  mockDoctorGit,
  findCheck,
  assertCheck
} from '../helpers/doctor-helpers.js';

/** @deprecated State file deprecated in v0.12.0 - validation now uses git notes */
const DEPRECATED_STATE_FILE = '.vibe-validate-state.yaml';

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
    },
    git: {
      mainBranch: 'main',
      autoSync: false,
      warnIfBehind: true,
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
      await mockDoctorFileSystem();
      mockDoctorEnvironment();
      vi.mocked(loadConfig).mockResolvedValue(mockConfig);
      vi.mocked(checkSync).mockReturnValue({ inSync: true });

      const result = await runDoctor({ verbose: true });

      expect(result.allPassed).toBe(true);
      expect(result.checks).toHaveLength(18);
      expect(result.checks.every(c => c.passed)).toBe(true);
    });

    it('should detect Node.js version too old', async () => {
      mockDoctorEnvironment({}, { nodeVersion: 'v18.0.0' });
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(loadConfig).mockResolvedValue(mockConfig);
      vi.mocked(checkSync).mockReturnValue({ inSync: true });

      const result = await runDoctor({ verbose: true });

      assertCheck(result, 'Node.js version', {
        passed: false,
        messageContains: 'Node.js 20+'
      });
    });

    it('should detect missing git', async () => {
      mockDoctorEnvironment({ 'git --version': new Error('git not found') });

      // Override executeGitCommand to simulate git not installed
      const { executeGitCommand } = await import('@vibe-validate/git');
      vi.mocked(executeGitCommand).mockImplementation((args: string[]) => {
        if (args[0] === '--version') {
          // Simulate git not installed
          throw new Error('git not found');
        }
        return { success: true, stdout: '', stderr: '', exitCode: 0 };
      });

      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(loadConfig).mockResolvedValue(mockConfig);

      const result = await runDoctor({ verbose: true });

      assertCheck(result, 'Git installed', {
        passed: false,
        messageContains: 'not installed'
      });
    });

    it('should detect missing configuration file', async () => {
      vi.mocked(execSync).mockReturnValue('v22.0.0' as any);
      vi.mocked(existsSync).mockReturnValue(false); // No config file
      vi.mocked(loadConfig).mockResolvedValue(null);

      const result = await runDoctor({ verbose: true });

      assertCheck(result, 'Configuration file', {
        passed: false,
        messageContains: 'not found'
      });
    });

    it('should detect missing configuration file', async () => {
      vi.mocked(execSync).mockReturnValue('v22.0.0' as any);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(loadConfig).mockResolvedValue(null); // Config failed to load
      vi.mocked(findConfigPath).mockReturnValue(null); // No config file found

      const result = await runDoctor({ verbose: true });

      assertCheck(result, 'Configuration valid', {
        passed: false,
        messageContains: 'No configuration file found',
        suggestionContains: 'Copy a config template from GitHub'
      });
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

      assertCheck(result, 'Configuration valid', {
        passed: false,
        messageContains: 'Found vibe-validate.config.yaml but it contains validation errors',
        suggestionContains: ['configuration docs', 'JSON Schema', 'Example']
      });
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

      assertCheck(result, 'Configuration valid', {
        passed: false,
        messageContains: ['Found vibe-validate.config.yaml but it contains validation errors', 'validation.phases.0.namej', 'Unrecognized key', 'validation.phases.0.name: Required'],
        suggestionContains: ['Fix validation errors shown above', 'https://raw.githubusercontent.com/jdutton/vibe-validate/main/packages/config/config.schema.json', 'https://github.com/jdutton/vibe-validate/tree/main/packages/cli/config-templates']
      });
    });

    it('should run all checks even when config has validation errors', async () => {
      await mockDoctorFileSystem({ packageVersion: '0.10.4' });
      mockDoctorEnvironment({}, { vibeVersion: '0.10.4' });
      vi.mocked(existsSync).mockImplementation((path: string) =>
        path.toString() !== DEPRECATED_STATE_FILE
      );
      vi.mocked(loadConfig).mockResolvedValue(null); // Config failed validation
      vi.mocked(findConfigPath).mockReturnValue('/path/to/vibe-validate.config.yaml');
      vi.mocked(loadConfigWithErrors).mockResolvedValue({
        config: null,
        errors: ['validation.phases.0.name: Required'],
        filePath: '/path/to/vibe-validate.config.yaml'
      });

      // Use verbose mode to see all checks
      const result = await runDoctor({ verbose: true });

      // Verify that all 16 checks ran (not just the config check)
      expect(result.checks).toHaveLength(18);

      // Config check should fail
      assertCheck(result, 'Configuration valid', {
        passed: false,
        messageContains: 'Found vibe-validate.config.yaml but it contains validation errors'
      });

      // But other checks should still run and pass (version, node, git, etc.)
      assertCheck(result, 'vibe-validate version', { passed: true });
      assertCheck(result, 'Node.js version', { passed: true });
      assertCheck(result, 'Git installed', { passed: true });
      assertCheck(result, 'Git repository', { passed: true });

      // Summary should show 17/18 passed (only config check fails)
      expect(result.allPassed).toBe(false);
      expect(result.totalChecks).toBe(18);
      expect(result.passedChecks).toBe(17);
    });

    it('should detect not in git repository', async () => {
      mockDoctorEnvironment({ 'git rev-parse --git-dir': new Error('not a git repository') }, { includeGitCommands: false });

      // Mock isGitRepository to return false for this test
      const { isGitRepository } = await import('@vibe-validate/git');
      vi.mocked(isGitRepository).mockReturnValue(false);

      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(loadConfig).mockResolvedValue(mockConfig);

      const result = await runDoctor({ verbose: true });

      assertCheck(result, 'Git repository', {
        passed: false,
        messageContains: 'not a git repository'
      });
    });

    it('should detect workflow out of sync', async () => {
      vi.mocked(execSync).mockReturnValue('v22.0.0' as any);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(loadConfig).mockResolvedValue(mockConfig);

      // Mock checkSync to return out of sync
      vi.mocked(checkSync).mockReturnValue({ inSync: false, diff: 'Out of sync' });

      const result = await runDoctor({ verbose: true });

      assertCheck(result, 'GitHub Actions workflow', {
        passed: false,
        messageContains: 'out of sync'
      });
    });

    it('should skip workflow sync check when disableWorkflowCheck is true', async () => {
      vi.mocked(execSync).mockReturnValue('v22.0.0' as any);
      vi.mocked(existsSync).mockReturnValue(true);

      // Config with disableWorkflowCheck enabled
      const configWithDisabled = {
        ...mockConfig,
        ci: { disableWorkflowCheck: true }
      };
      vi.mocked(loadConfig).mockResolvedValue(configWithDisabled);

      // Mock checkSync to return out of sync (but should be ignored)
      vi.mocked(checkSync).mockReturnValue({ inSync: false, diff: 'Out of sync' });

      const result = await runDoctor({ verbose: true });

      assertCheck(result, 'GitHub Actions workflow', {
        passed: true,
        messageContains: 'Workflow sync check disabled'
      });
    });

    it('should provide actionable suggestions for failures', async () => {
      // Mock old Node version
      mockDoctorEnvironment({}, { nodeVersion: 'v18.0.0' });

      vi.mocked(existsSync).mockReturnValue(false); // No config
      vi.mocked(loadConfig).mockResolvedValue(null);

      const result = await runDoctor({ verbose: true });

      expect(result.allPassed).toBe(false);
      expect(result.suggestions.length).toBeGreaterThanOrEqual(2); // At least Node version + config file
      expect(result.suggestions.some(s => s.includes('nvm') || s.includes('upgrade') || s.includes('nodejs'))).toBe(true);
      expect(result.suggestions.some(s => s.includes('npx vibe-validate init'))).toBe(true);
    });

    it('should check package manager availability', async () => {
      // Mock pnpm not found
      mockDoctorEnvironment({
        'pnpm --version': new Error('pnpm not found')
      });

      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(loadConfig).mockResolvedValue(mockConfig);

      const result = await runDoctor({ verbose: true });

      assertCheck(result, 'Package manager', {
        passed: false,
        messageContains: 'pnpm not found'
      });
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
      await mockDoctorFileSystem({ gitignoreContent: `${DEPRECATED_STATE_FILE}\n` });
      mockDoctorEnvironment();
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(loadConfig).mockResolvedValue(mockConfig);
      vi.mocked(checkSync).mockReturnValue({ inSync: true });

      const result = await runDoctor({ verbose: true });

      expect(result.checks).toHaveLength(18);
      expect(result.verboseMode).toBe(true);
    });

    it('should show only summary in non-verbose mode when all pass', async () => {
      await mockDoctorFileSystem();
      mockDoctorEnvironment();
      vi.mocked(loadConfig).mockResolvedValue(mockConfig);
      vi.mocked(checkSync).mockReturnValue({ inSync: true });

      const result = await runDoctor({ verbose: false });

      expect(result.verboseMode).toBe(false);
      expect(result.allPassed).toBe(true);
      // Should show secret scanning recommendation (passes but has suggestion)
      expect(result.checks).toHaveLength(1);
      expect(result.checks[0].name).toBe('Pre-commit secret scanning');
      expect(result.checks[0].passed).toBe(true);
      expect(result.checks[0].suggestion).toBeDefined();
    });

    it('should show only failing checks in non-verbose mode', async () => {
      mockDoctorEnvironment({}, { nodeVersion: 'v18.0.0' });
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(loadConfig).mockResolvedValue(mockConfig);
      vi.mocked(checkSync).mockReturnValue({ inSync: true });

      const result = await runDoctor({ verbose: false });

      // Non-verbose should show ONLY failing checks OR checks with suggestions
      const failedChecks = result.checks.filter(c => !c.passed);
      const passingChecksWithSuggestions = result.checks.filter(c => c.passed && c.suggestion);
      expect(failedChecks.length).toBeGreaterThan(0); // At least 1 failure (Node.js version)
      // Should show secret scanning recommendation (passes but has suggestion)
      expect(passingChecksWithSuggestions.length).toBe(1);
      expect(passingChecksWithSuggestions[0].name).toBe('Pre-commit secret scanning');
      expect(result.checks).toHaveLength(failedChecks.length + passingChecksWithSuggestions.length);
    });

    it('should show all checks including passing in verbose mode when failures exist', async () => {
      await mockDoctorFileSystem({ gitignoreContent: `${DEPRECATED_STATE_FILE}\n` });
      mockDoctorEnvironment({}, { nodeVersion: 'v18.0.0' });
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(loadConfig).mockResolvedValue(mockConfig);
      vi.mocked(checkSync).mockReturnValue({ inSync: true });

      const result = await runDoctor({ verbose: true });

      // Verbose mode should show ALL 16 checks (including passing ones)
      expect(result.verboseMode).toBe(true);
      expect(result.checks).toHaveLength(18); // All checks
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
      const { readFileSync } = await import('node:fs');
      vi.mocked(readFileSync).mockImplementation((path: any) => {
        if (path.toString().includes('package.json')) {
          return JSON.stringify({ version: '0.9.11' }) as any;
        }
        if (path.toString().includes('.gitignore')) {
          return `${DEPRECATED_STATE_FILE}\n` as any;
        }
        return 'npx vibe-validate pre-commit' as any;
      });

      // Mock healthy environment for all pre-commit tests
      mockDoctorEnvironment();
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

      await mockDoctorFileSystem();
      mockDoctorEnvironment();
      vi.mocked(loadConfig).mockResolvedValue(configWithDisabledHook);
      vi.mocked(checkSync).mockReturnValue({ inSync: true });

      const result = await runDoctor({ verbose: true });

      assertCheck(result, 'Pre-commit hook', {
        passed: true,
        messageContains: ['disabled in config', 'user preference']
      });
      expect(result.allPassed).toBe(true);
    });

    it('should fail when pre-commit hook is enabled (default) but not installed', async () => {
      vi.mocked(existsSync).mockImplementation((path: string) =>
        !path.toString().includes('.husky/pre-commit')
      );
      vi.mocked(loadConfig).mockResolvedValue(mockConfig); // Default: hooks.preCommit.enabled = true

      const result = await runDoctor({ verbose: true });

      assertCheck(result, 'Pre-commit hook', {
        passed: false,
        messageContains: 'not installed',
        suggestionContains: ['npx husky init', 'hooks.preCommit.enabled=false']
      });
      expect(result.allPassed).toBe(false);
    });

    it('should pass when pre-commit hook is properly configured with vibe-validate', async () => {
      const { readFileSync } = await import('node:fs');
      vi.mocked(readFileSync).mockImplementation((path: any) => {
        if (path.toString().includes('package.json')) {
          return JSON.stringify({ version: '0.9.11' }) as any;
        }
        if (path.toString().includes('.gitignore')) {
          return 'node_modules\ndist\n' as any; // Healthy: no deprecated state file
        }
        return 'npx vibe-validate pre-commit' as any; // Pre-commit hook content
      });
      vi.mocked(existsSync).mockImplementation((path: string) =>
        path.toString() !== DEPRECATED_STATE_FILE
      );
      vi.mocked(findConfigPath).mockReturnValue('vibe-validate.config.yaml');
      vi.mocked(loadConfig).mockResolvedValue(mockConfig);

      const result = await runDoctor({ verbose: true });

      assertCheck(result, 'Pre-commit hook', {
        passed: true,
        messageContains: 'installed and runs vibe-validate'
      });
      expect(result.allPassed).toBe(true);
    });

    it('should pass when pre-commit hook runs vibe-validate via npm script', async () => {
      const { readFileSync } = await import('node:fs');
      vi.mocked(readFileSync).mockImplementation((path: any) => {
        if (path.toString().includes('package.json')) {
          return JSON.stringify({ version: '0.9.11' }) as any;
        }
        if (path.toString().includes('.gitignore')) {
          return `${DEPRECATED_STATE_FILE}\n` as any;
        }
        return 'npm run pre-commit' as any; // Pre-commit hook runs via npm
      });
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(loadConfig).mockResolvedValue(mockConfig);

      const result = await runDoctor({ verbose: true });

      assertCheck(result, 'Pre-commit hook', {
        passed: true,
        messageContains: 'installed and runs vibe-validate'
      });
    });

    it('should pass when pre-commit hook runs vibe-validate via pnpm script', async () => {
      const { readFileSync } = await import('node:fs');
      vi.mocked(readFileSync).mockImplementation((path: any) => {
        if (path.toString().includes('package.json')) {
          return JSON.stringify({ version: '0.9.11' }) as any;
        }
        if (path.toString().includes('.gitignore')) {
          return `${DEPRECATED_STATE_FILE}\n` as any;
        }
        return 'pnpm pre-commit' as any; // Pre-commit hook runs via pnpm
      });
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(loadConfig).mockResolvedValue(mockConfig);

      const result = await runDoctor({ verbose: true });

      assertCheck(result, 'Pre-commit hook', {
        passed: true,
        messageContains: 'installed and runs vibe-validate'
      });
    });

    it('should fail when custom pre-commit hook exists but does not run vibe-validate', async () => {
      const { readFileSync } = await import('node:fs');
      vi.mocked(readFileSync).mockReturnValue('npm test\nnpm run lint\nnpm run format' as any);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(loadConfig).mockResolvedValue(mockConfig);

      const result = await runDoctor({ verbose: true });

      assertCheck(result, 'Pre-commit hook', {
        passed: false,
        messageContains: ['Custom pre-commit hook detected', 'npm test; npm run lint; npm run format'],
        suggestionContains: ['Verify that .husky/pre-commit runs', 'npx vibe-validate pre-commit', 'hooks.preCommit.enabled=false']
      });
    });

    it('should fail when pre-commit hook exists but is unreadable', async () => {
      const { readFileSync } = await import('node:fs');
      vi.mocked(readFileSync).mockImplementation(() => {
        throw new Error('EACCES: permission denied');
      });
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(loadConfig).mockResolvedValue(mockConfig);

      const result = await runDoctor({ verbose: true });

      assertCheck(result, 'Pre-commit hook', {
        passed: false,
        messageContains: 'unreadable',
        suggestionContains: ['permissions', 'hooks.preCommit.enabled=false']
      });
    });

    it('should use custom command from config when checking hook', async () => {
      const { readFileSync } = await import('node:fs');
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

      assertCheck(result, 'Pre-commit hook', {
        passed: false,
        suggestionContains: 'npm run custom-validate'
      });
    });
  });

  describe('version check', () => {
    beforeEach(async () => {
      await mockDoctorFileSystem({ gitignoreContent: `${DEPRECATED_STATE_FILE}\n` });
      mockDoctorEnvironment();
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(loadConfig).mockResolvedValue(mockConfig);
      vi.mocked(checkSync).mockReturnValue({ inSync: true });
    });

    it('should pass when current version is up to date', async () => {
      const result = await runDoctor({ verbose: true });

      assertCheck(result, 'vibe-validate version', {
        passed: true,
        messageContains: 'up to date'
      });
    });

    it('should warn when newer version is available', async () => {
      await mockDoctorFileSystem({ packageVersion: '0.9.10', gitignoreContent: `${DEPRECATED_STATE_FILE}\n` });

      const result = await runDoctor({ verbose: true });

      assertCheck(result, 'vibe-validate version', {
        passed: true, // Warning only, not a failure
        messageContains: ['0.9.10', '0.9.11'],
        suggestionContains: ['npm install', 'vibe-validate@latest', 'vibe-validate doctor']
      });
    });

    it('should handle npm registry unavailable gracefully', async () => {
      mockDoctorEnvironment({ 'npm view vibe-validate version': new Error('ENOTFOUND registry.npmjs.org') });

      const result = await runDoctor({ verbose: true });

      assertCheck(result, 'vibe-validate version', {
        passed: true,
        messageContains: 'unable to check'
      });
    });
  });

  describe('gitignore state file check', () => {
    beforeEach(() => {
      vi.mocked(loadConfig).mockResolvedValue(mockConfig);
      vi.mocked(checkSync).mockReturnValue({ inSync: true });
    });

    it(`should warn when ${DEPRECATED_STATE_FILE} is in .gitignore (deprecated)`, async () => {
      await mockDoctorFileSystem({ gitignoreContent: `${DEPRECATED_STATE_FILE}\nnode_modules\n` });
      mockDoctorEnvironment();
      vi.mocked(existsSync).mockReturnValue(true);

      const result = await runDoctor({ verbose: true });

      assertCheck(result, 'Gitignore state file (deprecated)', {
        passed: false, // Should fail - deprecated entry needs removal
        messageContains: `${DEPRECATED_STATE_FILE} in .gitignore`
      });
    });

    it('should pass when .gitignore exists but state file not listed (state file deprecated)', async () => {
      await mockDoctorFileSystem();
      mockDoctorEnvironment();
      vi.mocked(existsSync).mockReturnValue(true);

      const result = await runDoctor({ verbose: true });

      assertCheck(result, 'Gitignore state file', {
        passed: true,
        messageContains: 'No deprecated state file entries'
      });
    });

    it('should pass when .gitignore does not exist (state file deprecated)', async () => {
      vi.mocked(execSync).mockReturnValue('v22.0.0' as any);
      vi.mocked(existsSync).mockImplementation((path: string) =>
        !path.toString().includes('.gitignore')
      );

      const result = await runDoctor({ verbose: true });

      assertCheck(result, 'Gitignore state file', {
        passed: true,
        messageContains: 'state file deprecated - using git notes'
      });
    });

    it('should fail when .gitignore is unreadable', async () => {
      const { readFileSync } = await import('node:fs');
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

      const result = await runDoctor({ verbose: true });

      assertCheck(result, 'Gitignore state file', {
        passed: false,
        messageContains: 'unreadable',
        suggestionContains: 'chmod 644'
      });
    });
  });

  describe('config format check', () => {
    it('should detect .yaml config files', async () => {
      const { readFileSync } = await import('node:fs');
      vi.mocked(readFileSync).mockImplementation((path: any) => {
        if (path.toString().includes('package.json')) {
          return JSON.stringify({ version: '0.9.11' }) as any;
        }
        if (path.toString().includes('.gitignore')) {
          return `${DEPRECATED_STATE_FILE}\n` as any;
        }
        return 'npm run pre-commit' as any;
      });

      mockDoctorEnvironment();

      vi.mocked(existsSync).mockImplementation((path: string) => {
        if (path.toString() === 'vibe-validate.config.yaml') return true;
        if (path.toString() === 'vibe-validate.config.yaml') return false;
        if (path.toString() === 'vibe-validate.config.js') return false;
        return true;
      });
      vi.mocked(findConfigPath).mockReturnValue('vibe-validate.config.yaml');
      vi.mocked(loadConfig).mockResolvedValue(mockConfig);
      vi.mocked(checkSync).mockReturnValue({ inSync: true });

      const result = await runDoctor({ verbose: true });

      assertCheck(result, 'Configuration file', {
        passed: true,
        messageContains: 'vibe-validate.config.yaml'
      });
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

      assertCheck(result, 'Configuration file', {
        passed: false,
        messageContains: 'not found'
      });
    });
  });

  describe('config format migration check', () => {
    beforeEach(() => {
      vi.mocked(execSync).mockReturnValue('v22.0.0' as any);
    });

    it('should pass when using YAML format', async () => {
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(findConfigPath).mockReturnValue('vibe-validate.config.yaml');
      vi.mocked(loadConfig).mockResolvedValue({
        validation: { phases: [] },
      } as any);

      const result = await runDoctor({ verbose: true });

      expect(result).toBeDefined();
      assertCheck(result, 'Configuration file', {
        passed: true,
        messageContains: 'vibe-validate.config.yaml'
      });
    });

    it('should skip check when no config file exists', async () => {
      vi.mocked(existsSync).mockImplementation((path: string) =>
        path.toString() !== 'vibe-validate.config.yaml'
      );
      vi.mocked(loadConfig).mockResolvedValue(null);

      const result = await runDoctor({ verbose: true });

      expect(result).toBeDefined();
      assertCheck(result, 'Configuration file', {
        passed: false
      });
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

      assertCheck(result, 'Pre-commit secret scanning', {
        passed: true,
        messageContains: 'disabled'
      });
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

      mockDoctorEnvironment({
        'gitleaks version': 'v8.18.0',
        'gitleaks --version': 'v8.18.0'
      });
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(loadConfig).mockResolvedValue(mockConfigWithScanning);

      const result = await runDoctor({ verbose: true });

      assertCheck(result, 'Pre-commit secret scanning', {
        passed: true,
        messageContains: ['Secret scanning enabled', 'gitleaks', 'available']
      });
    });

    it('should pass with warning when scanning enabled but tool not found', async () => {
      // Mock non-CI environment to test local behavior
      const originalCI = process.env.CI;
      delete process.env.CI;

      try {
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

        mockDoctorEnvironment({
          'gitleaks version': new Error('Command not found'),
          'gitleaks --version': new Error('Command not found')
        });
        vi.mocked(existsSync).mockReturnValue(true);
        vi.mocked(loadConfig).mockResolvedValue(mockConfigWithScanning);

        const result = await runDoctor({ verbose: true });

        const secretCheck = findCheck(result, 'Pre-commit secret scanning');
        expect(secretCheck.passed).toBe(true); // Advisory only, always passes
        expect(secretCheck.message).toContain('Secret scanning enabled');
        expect(secretCheck.message).toContain('gitleaks');
        // With explicit scanCommand but tool unavailable, still shows as configured
        expect(secretCheck.message).toContain('configured') || expect(secretCheck.message).toContain('available');
      } finally {
        // Restore original CI value
        if (originalCI !== undefined) {
          process.env.CI = originalCI;
        }
      }
    });

    it('should recommend enabling when secretScanning config not provided', async () => {
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

      assertCheck(result, 'Pre-commit secret scanning', {
        passed: true,
        messageContains: 'not configured',
        suggestionContains: ['Recommended', 'Enable secret scanning']
      });
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

      mockDoctorEnvironment({
        'detect-secrets version': '1.4.0',
        'detect-secrets --version': '1.4.0'
      });
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(loadConfig).mockResolvedValue(mockConfigDetectSecrets);

      const result = await runDoctor({ verbose: true });

      const secretCheck = findCheck(result, 'Pre-commit secret scanning');
      expect(secretCheck.passed).toBe(true);
      // With explicit scanCommand, doctor shows "Secret scanning enabled" with tool info
      // Custom tools (detect-secrets) are categorized as secretlint by autodetect
      expect(secretCheck.message).toContain('Secret scanning enabled');
      expect(secretCheck.message).toMatch(/gitleaks|secretlint/);
    });
  });

  describe('validation history format detection', () => {
    /**
     * TDD Tests for correct validation history format detection
     *
     * CONTEXT: The doctor command checks for legacy validation history format.
     *
     * FORMATS:
     * - PRE-v0.15.0 (OLD/DEPRECATED): refs/notes/vibe-validate/runs/* (plural "runs")
     * - v0.15.0+ (CURRENT): refs/notes/vibe-validate/validate (validation history)
     * - v0.15.0+ (CURRENT): refs/notes/vibe-validate/run/{tree}/{key} (run cache)
     *
     * The doctor should ONLY warn if the OLD "runs" namespace exists.
     * It should NOT warn about the current "validate" or "run" refs.
     */

    beforeEach(async () => {
      // Setup common mocks for all validation history tests
      const { readFileSync } = await import('node:fs');
      vi.mocked(readFileSync).mockImplementation((path: any) => {
        if (path.toString().includes('package.json')) {
          return JSON.stringify({ version: '0.17.0' }) as any;
        }
        if (path.toString().includes('.gitignore')) {
          return 'node_modules\ndist\n' as any;
        }
        return 'npx vibe-validate pre-commit' as any;
      });

      vi.mocked(existsSync).mockImplementation((path: string) => {
        if (path.toString() === DEPRECATED_STATE_FILE) return false;
        if (path.toString() === 'vibe-validate.config.yaml') return true;
        return true;
      });

      vi.mocked(loadConfig).mockResolvedValue(mockConfig);
    });

    it('should PASS when only current validation history format exists (refs/notes/vibe-validate/validate)', async () => {
      // ARRANGE: Mock git commands to show CURRENT format only (no old refs)
      await mockDoctorGit({
        validationHistoryRefs: []  // No old format refs
      });
      mockDoctorEnvironment({}, { vibeVersion: '0.17.0' });

      // ACT
      const result = await runDoctor({ verbose: true });

      // ASSERT
      assertCheck(result, 'Validation history migration', {
        passed: true,
        messageContains: 'Using current validation history format'
      });
      const migrationCheck = findCheck(result, 'Validation history migration');
      expect(migrationCheck.suggestion).toBeUndefined();
    });

    it('should PASS when only run cache exists (refs/notes/vibe-validate/run/*)', async () => {
      // ARRANGE: Mock git commands to show run cache only
      await mockDoctorGit({
        validationHistoryRefs: [],  // No old format refs
        runCacheRefs: ['refs/notes/vibe-validate/run/tree123/key456']
      });
      mockDoctorEnvironment({}, { vibeVersion: '0.17.0' });

      // ACT
      const result = await runDoctor({ verbose: true });

      // ASSERT
      assertCheck(result, 'Validation history migration', {
        passed: true,
        messageContains: 'Using current validation history format'
      });
      const migrationCheck = findCheck(result, 'Validation history migration');
      expect(migrationCheck.suggestion).toBeUndefined();
    });

    it('should automatically clean up OLD format when it exists (refs/notes/vibe-validate/runs)', async () => {
      // Setup git mocks with old validation history refs
      await mockDoctorGit({
        validationHistoryRefs: ['refs/notes/vibe-validate/runs']
      });
      // Setup environment mocks
      mockDoctorEnvironment({}, { vibeVersion: '0.17.0' });

      const result = await runDoctor({ verbose: true });

      assertCheck(result, 'Validation history migration', {
        passed: true,
        messageContains: 'Automatically removed old validation history format (pre-v0.15.0)'
      });
      const migrationCheck = findCheck(result, 'Validation history migration');
      expect(migrationCheck.suggestion).toBeUndefined();
    });

    it('should PASS when no git notes exist at all', async () => {
      // Setup git mocks with no refs
      await mockDoctorGit({
        validationHistoryRefs: []
      });
      mockDoctorEnvironment({}, { vibeVersion: '0.17.0' });

      const result = await runDoctor({ verbose: true });

      assertCheck(result, 'Validation history migration', {
        passed: true,
        messageContains: 'Using current validation history format'
      });
      const migrationCheck = findCheck(result, 'Validation history migration');
      expect(migrationCheck.suggestion).toBeUndefined();
    });

    it('should handle git command errors gracefully', async () => {
      // Setup git mocks to throw errors
      await mockDoctorGit({
        customCommands: {
          'for-each-ref --format=%(refname) refs/notes/vibe-validate/runs': new Error('Git command failed')
        }
      });
      mockDoctorEnvironment({}, { vibeVersion: '0.17.0' });

      const result = await runDoctor({ verbose: true });

      assertCheck(result, 'Validation history migration', {
        passed: true,
        messageContains: 'No validation history to migrate'
      });
      const migrationCheck = findCheck(result, 'Validation history migration');
      expect(migrationCheck.suggestion).toBeUndefined();
    });
  });

  describe('Doctor with mocked version checker (fast tests)', () => {
    // These tests use mock version checker to avoid slow npm registry calls
    const mockVersionChecker = {
      async fetchLatestVersion() {
        return '0.17.2'; // Mock version - no network call
      }
    };

    it('should use mocked version checker when provided', async () => {
      await mockDoctorFileSystem();
      await mockDoctorGit();
      mockDoctorEnvironment();
      vi.mocked(loadConfig).mockResolvedValue(mockConfig);
      vi.mocked(checkSync).mockReturnValue({ inSync: true });

      const result = await runDoctor({ verbose: true, versionChecker: mockVersionChecker });

      expect(result.checks).toHaveLength(18);
      assertCheck(result, 'vibe-validate version', { passed: true });
    });

    it('should show Node.js and Git checks with mock', async () => {
      await mockDoctorFileSystem();
      await mockDoctorGit();
      mockDoctorEnvironment();
      vi.mocked(loadConfig).mockResolvedValue(mockConfig);
      vi.mocked(checkSync).mockReturnValue({ inSync: true });

      const result = await runDoctor({ verbose: true, versionChecker: mockVersionChecker });

      assertCheck(result, 'Node.js version', { passed: true });
      assertCheck(result, 'Git installed', { passed: true });
    });

    it('should be fast with mocked version checker', async () => {
      await mockDoctorFileSystem();
      await mockDoctorGit();
      mockDoctorEnvironment();
      vi.mocked(loadConfig).mockResolvedValue(mockConfig);
      vi.mocked(checkSync).mockReturnValue({ inSync: true });

      const start = Date.now();
      const result = await runDoctor({ verbose: true, versionChecker: mockVersionChecker });
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(5000); // Should be fast (<5s without network)
      assertCheck(result, 'vibe-validate version', { passed: true });
      expect(result.checks).toHaveLength(18);
    });
  });

  // ==========================================================================
  // CLI Build Sync Check (Development Mode)
  // ==========================================================================

  describe('checkCliBuildSync() - Developer build verification', () => {
    it('should skip check when not in vibe-validate source tree', async () => {
      // Mock being in a different project (no packages/cli/package.json)
      vi.mocked(existsSync).mockReturnValue(false);
      vi.mocked(loadConfig).mockResolvedValue(mockConfig);

      const result = await runDoctor({ verbose: true });

      assertCheck(result, 'CLI build status', {
        passed: true,
        messageContains: 'Skipped'
      });
    });

    it('should pass when build is up to date', async () => {
      // Mock being in vibe-validate source tree with matching versions
      const { readFileSync } = await import('node:fs');
      vi.mocked(existsSync).mockImplementation((_path: string) => {
        // Simulate vibe-validate source tree structure where all files exist
        return true;
      });

      vi.mocked(readFileSync).mockImplementation((path: string | URL) => {
        const pathStr = path.toString();
        if (pathStr.includes('package.json')) {
          // Both running and source versions are the same
          return JSON.stringify({ version: '0.17.4' });
        }
        return 'npm run pre-commit';
      });

      vi.mocked(loadConfig).mockResolvedValue(mockConfig);

      const result = await runDoctor({ verbose: true });

      assertCheck(result, 'CLI build status', {
        passed: true,
        messageContains: 'up to date'
      });
    });

    // Note: Testing version mismatch is difficult in unit tests because when running
    // from local dist/, both running and source versions point to the same package.json.
    // The check works correctly in production: when using a globally installed vv and
    // running doctor from within the source tree, it will detect the mismatch.
  });

  // ==========================================================================
  // Exception Handling and Edge Cases
  // ==========================================================================

  describe('checkNodeVersion() - Malformed version output', () => {
    it('should handle malformed node version output', async () => {
      mockDoctorEnvironment({}, { nodeVersion: 'invalid-version' });
      await mockDoctorFileSystem();
      vi.mocked(loadConfig).mockResolvedValue(mockConfig);

      const result = await runDoctor({ verbose: true });

      assertCheck(result, 'Node.js version', {
        passed: false,
        messageContains: 'Failed to detect'
      });
    });

    it('should handle empty node version output', async () => {
      mockDoctorEnvironment({}, { nodeVersion: '' });
      await mockDoctorFileSystem();
      vi.mocked(loadConfig).mockResolvedValue(mockConfig);

      const result = await runDoctor({ verbose: true });

      assertCheck(result, 'Node.js version', {
        passed: false,
        messageContains: 'Failed to detect'
      });
    });

    it('should handle node version without "v" prefix and dots', async () => {
      mockDoctorEnvironment({}, { nodeVersion: '22' });
      await mockDoctorFileSystem();
      vi.mocked(loadConfig).mockResolvedValue(mockConfig);

      const result = await runDoctor({ verbose: true });

      assertCheck(result, 'Node.js version', {
        passed: true
      });
    });
  });

  describe('checkGitRepository() - Exception handling', () => {
    it('should handle git repository check throwing permission error', async () => {
      await mockDoctorFileSystem();
      mockDoctorEnvironment();

      const { isGitRepository } = await import('@vibe-validate/git');
      vi.mocked(isGitRepository).mockImplementation(() => {
        throw new Error('EACCES: permission denied');
      });

      const result = await runDoctor({ verbose: true });

      assertCheck(result, 'Git repository', {
        passed: false,
        messageContains: 'Error checking git repository'
      });
    });

    it('should handle git repository check throwing ENOENT error', async () => {
      await mockDoctorFileSystem();
      mockDoctorEnvironment();

      const { isGitRepository } = await import('@vibe-validate/git');
      vi.mocked(isGitRepository).mockImplementation(() => {
        throw new Error('ENOENT: .git directory not accessible');
      });

      const result = await runDoctor({ verbose: true });

      assertCheck(result, 'Git repository', {
        passed: false,
        messageContains: 'Error checking git repository'
      });
    });
  });

  describe('checkConfigValid() - Exception handling', () => {
    it('should handle unexpected exception during config validation', async () => {
      await mockDoctorFileSystem();
      mockDoctorEnvironment();

      vi.mocked(loadConfig).mockRejectedValue(new Error('YAML parser crashed: unexpected token'));
      vi.mocked(findConfigPath).mockReturnValue('vibe-validate.config.yaml');

      const result = await runDoctor({ verbose: true });

      assertCheck(result, 'Configuration valid', {
        passed: false,
        messageContains: 'Found vibe-validate.config.yaml but it contains validation errors',
        suggestionContains: 'Fix syntax/validation errors'
      });
    });

    it('should handle config validation throwing TypeError', async () => {
      await mockDoctorFileSystem();
      mockDoctorEnvironment();

      vi.mocked(loadConfig).mockRejectedValue(new TypeError('Cannot read property of undefined'));
      vi.mocked(findConfigPath).mockReturnValue('vibe-validate.config.yaml');

      const result = await runDoctor({ verbose: true });

      assertCheck(result, 'Configuration valid', {
        passed: false,
        messageContains: 'Found vibe-validate.config.yaml but it contains validation errors'
      });
    });
  });

  describe('checkPackageManager() - Config check failure', () => {
    it('should gracefully skip package manager check when config processing throws', async () => {
      mockDoctorEnvironment();

      vi.mocked(loadConfig).mockImplementation(() => {
        throw new Error('Config processing crashed');
      });

      const result = await runDoctor({ verbose: true });

      const pmCheck = findCheck(result, 'Package manager');
      expect(pmCheck.passed).toBe(true);
      expect(pmCheck.message).toContain('Skipped');
      expect(pmCheck.message).toContain('no config');
    });
  });

  describe('checkWorkflowSync() - Exception handling', () => {
    it('should handle exception when checking workflow sync', async () => {
      await mockDoctorFileSystem();
      mockDoctorEnvironment();

      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(findConfigPath).mockReturnValue('vibe-validate.config.yaml');
      vi.mocked(loadConfig).mockResolvedValue(mockConfig);
      vi.mocked(checkSync).mockImplementation(() => {
        throw new Error('YAML parse error in workflow file');
      });

      const result = await runDoctor({ verbose: true });

      assertCheck(result, 'GitHub Actions workflow', {
        passed: false,
        messageContains: 'Failed to check workflow sync',
        suggestionContains: 'Verify workflow file syntax'
      });
    });
  });

  describe('checkPreCommitHook() - Alternative command detection', () => {
    it('should recognize pre-commit hook that uses validate command', async () => {
      const { readFileSync } = await import('node:fs');
      vi.mocked(readFileSync).mockImplementation((path: any) => {
        if (path.toString().includes('package.json')) {
          return JSON.stringify({ version: '0.9.11' }) as any;
        }
        if (path.toString().includes('.gitignore')) {
          return 'node_modules\ndist\n' as any;
        }
        return '#!/bin/sh\nnpx vibe-validate validate' as any; // Using validate command
      });

      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(findConfigPath).mockReturnValue('vibe-validate.config.yaml');
      vi.mocked(loadConfig).mockResolvedValue(mockConfig);
      mockDoctorEnvironment();

      const result = await runDoctor({ verbose: true });

      assertCheck(result, 'Pre-commit hook', {
        passed: true,
        messageContains: 'installed and runs vibe-validate'
      });
    });
  });

  describe('checkVersion() - Context environment variables', () => {
    const mockOutdatedChecker = {
      fetchLatestVersion: async () => '0.9.11'  // Return latest version
    };

    afterEach(() => {
      delete process.env.VV_CONTEXT;
    });

    it('should show local install command when VV_CONTEXT=local', async () => {
      process.env.VV_CONTEXT = 'local';
      await mockDoctorFileSystem({ packageVersion: '0.9.10' });
      mockDoctorEnvironment();
      vi.mocked(loadConfig).mockResolvedValue(mockConfig);

      const result = await runDoctor({ verbose: true, versionChecker: mockOutdatedChecker });

      assertCheck(result, 'vibe-validate version', {
        passed: true,
        messageContains: '0.9.10 (local)',
        suggestionContains: 'npm install -D vibe-validate@latest'
      });
      expect(findCheck(result, 'vibe-validate version').suggestion).toContain('pnpm add -D');
    });

    it('should show global install command when VV_CONTEXT=global', async () => {
      process.env.VV_CONTEXT = 'global';
      await mockDoctorFileSystem({ packageVersion: '0.9.10' });
      mockDoctorEnvironment();
      vi.mocked(loadConfig).mockResolvedValue(mockConfig);

      const result = await runDoctor({ verbose: true, versionChecker: mockOutdatedChecker });

      assertCheck(result, 'vibe-validate version', {
        passed: true,
        messageContains: '0.9.10 (global)',
        suggestionContains: 'npm install -g vibe-validate@latest'
      });
    });

    it('should show dev context label when VV_CONTEXT=dev', async () => {
      process.env.VV_CONTEXT = 'dev';
      await mockDoctorFileSystem({ packageVersion: '0.9.10' });
      mockDoctorEnvironment();
      vi.mocked(loadConfig).mockResolvedValue(mockConfig);

      const result = await runDoctor({ verbose: true, versionChecker: mockOutdatedChecker });

      const versionCheck = findCheck(result, 'vibe-validate version');
      expect(versionCheck.message).toContain('(dev)');
    });
  });

  describe('checkVersion() - Package.json read errors', () => {
    it('should handle package.json ENOENT error gracefully', async () => {
      mockDoctorEnvironment();

      const { readFileSync } = await import('node:fs');
      vi.mocked(readFileSync).mockImplementation((path: any) => {
        if (path.toString().includes('package.json')) {
          throw new Error('ENOENT: no such file or directory');
        }
        return 'npm run pre-commit' as any;
      });

      const result = await runDoctor({ verbose: true });

      assertCheck(result, 'vibe-validate version', {
        passed: true,
        messageContains: 'Unable to determine version'
      });
    });

    it('should handle package.json JSON parse error gracefully', async () => {
      mockDoctorEnvironment();

      const { readFileSync } = await import('node:fs');
      vi.mocked(readFileSync).mockImplementation((path: any) => {
        if (path.toString().includes('package.json')) {
          return 'invalid json {{{' as any;
        }
        return 'npm run pre-commit' as any;
      });

      const result = await runDoctor({ verbose: true });

      assertCheck(result, 'vibe-validate version', {
        passed: true,
        messageContains: 'Unable to determine version'
      });
    });
  });

  describe('checkHistoryHealth() - Exception handling', () => {
    it('should handle validation history health check throwing error', async () => {
      await mockDoctorFileSystem();
      mockDoctorEnvironment();
      await mockDoctorGit();
      vi.mocked(loadConfig).mockResolvedValue(mockConfig);

      // Import and mock the history health check function dynamically
      const historyModule = await import('@vibe-validate/history');
      const mockCheckHealth = vi.spyOn(historyModule, 'checkHistoryHealth');
      mockCheckHealth.mockRejectedValue(
        new Error('Git notes corrupted: invalid object format')
      );

      const result = await runDoctor({ verbose: true });

      assertCheck(result, 'Validation history', {
        passed: true,
        messageContains: 'History unavailable'
      });
      expect(findCheck(result, 'Validation history').message).toContain('Git notes corrupted');

      mockCheckHealth.mockRestore();
    });
  });

  describe('checkRemoteMainBranch() - Network failures', () => {
    it('should handle network error when checking remote branch', async () => {
      await mockDoctorFileSystem();
      mockDoctorEnvironment();
      await mockDoctorGit({
        customCommands: {
          'remote': {
            success: true,
            stdout: 'origin\n',
            stderr: '',
            exitCode: 0
          },
          'ls-remote --heads origin main': {
            success: false,
            stdout: '',
            stderr: 'fatal: could not read from remote repository\n\nPlease make sure you have the correct access rights',
            exitCode: 128
          }
        }
      });

      vi.mocked(findConfigPath).mockReturnValue('vibe-validate.config.yaml');
      vi.mocked(loadConfig).mockResolvedValue(mockConfig);

      const result = await runDoctor({ verbose: true });

      assertCheck(result, 'Git remote main branch', {
        passed: false,
        messageContains: 'does not exist on remote'
      });
    });

    it('should handle timeout when checking remote branch', async () => {
      await mockDoctorFileSystem();
      mockDoctorEnvironment();
      await mockDoctorGit({
        customCommands: {
          'remote': {
            success: true,
            stdout: 'origin\n',
            stderr: '',
            exitCode: 0
          },
          'ls-remote --heads origin main': {
            success: false,
            stdout: '',
            stderr: 'fatal: unable to access: Operation timed out',
            exitCode: 128
          }
        }
      });

      vi.mocked(findConfigPath).mockReturnValue('vibe-validate.config.yaml');
      vi.mocked(loadConfig).mockResolvedValue(mockConfig);

      const result = await runDoctor({ verbose: true });

      assertCheck(result, 'Git remote main branch', {
        passed: false
      });
    });
  });

  describe('checkSecretScanning() - Tool detection edge cases', () => {
    it('should suggest installing gitleaks when config exists but tool unavailable', async () => {
      mockDoctorEnvironment({
        'gitleaks version': new Error('command not found'),
        'gitleaks --version': new Error('command not found')
      });

      // eslint-disable-next-line sonarjs/no-invariant-returns -- Test mock always returns true for simplicity
      vi.mocked(existsSync).mockImplementation((path: string) => {
        const pathStr = path.toString();
        if (pathStr.includes('.gitleaks.toml')) return true; // Config exists
        if (pathStr.includes('vibe-validate.config.yaml')) return true;
        return true;
      });

      vi.mocked(findConfigPath).mockReturnValue('vibe-validate.config.yaml');

      const configWithScanning = {
        ...mockConfig,
        hooks: {
          preCommit: {
            enabled: true,
            secretScanning: { enabled: true }
          }
        }
      };
      vi.mocked(loadConfig).mockResolvedValue(configWithScanning);

      const result = await runDoctor({ verbose: true });

      assertCheck(result, 'Pre-commit secret scanning', {
        passed: true,
        suggestionContains: 'Install gitleaks'
      });
    });
  });

  // ==========================================================================
  // INTEGRATION SCENARIOS
  // ==========================================================================

  describe('Integration: Multiple failures at once', () => {
    it('should report multiple independent failures correctly', async () => {
      mockDoctorEnvironment({
        'node --version': 'v18.0.0' // Too old
      }, { nodeVersion: 'v18.0.0' });

      // Mock git to throw error
      const { executeGitCommand } = await import('@vibe-validate/git');
      vi.mocked(executeGitCommand).mockImplementation((args: string[]) => {
        if (args[0] === '--version') {
          throw new Error('git: command not found');
        }
        return { success: true, stdout: '', stderr: '', exitCode: 0 };
      });

      vi.mocked(findConfigPath).mockReturnValue(null); // No config
      vi.mocked(loadConfig).mockResolvedValue(null);

      const result = await runDoctor({ verbose: true });

      expect(result.allPassed).toBe(false);
      expect(result.passedChecks).toBeLessThan(result.totalChecks - 2);

      assertCheck(result, 'Node.js version', { passed: false });
      assertCheck(result, 'Git installed', { passed: false });
      assertCheck(result, 'Configuration file', { passed: false });
    });

    it('should show multiple failure suggestions in order', async () => {
      mockDoctorEnvironment({
        'node --version': 'v18.0.0'
      }, { nodeVersion: 'v18.0.0' });

      // Mock git to throw error
      const { executeGitCommand } = await import('@vibe-validate/git');
      vi.mocked(executeGitCommand).mockImplementation((args: string[]) => {
        if (args[0] === '--version') {
          throw new Error('git: command not found');
        }
        return { success: true, stdout: '', stderr: '', exitCode: 0 };
      });

      vi.mocked(findConfigPath).mockReturnValue(null);
      vi.mocked(loadConfig).mockResolvedValue(null);

      const result = await runDoctor({ verbose: true });

      const failedChecks = result.checks.filter(c => !c.passed);
      expect(failedChecks.length).toBeGreaterThanOrEqual(3);

      // All failed checks should have suggestions
      for (const check of failedChecks) {
        expect(check.suggestion).toBeDefined();
        expect(check.suggestion!.length).toBeGreaterThan(0);
      }
    });
  });

  describe('Integration: Config errors + workflow sync interaction', () => {
    it('should skip workflow check when config is invalid', async () => {
      mockDoctorEnvironment();

      vi.mocked(findConfigPath).mockReturnValue(null);
      vi.mocked(loadConfig).mockResolvedValue(null);
      vi.mocked(existsSync).mockImplementation((path: string) => {
        const pathStr = path.toString();
        if (pathStr.includes('.github/workflows/validate.yml')) return true;
        if (pathStr === 'vibe-validate.config.yaml') return false;
        return true;
      });

      const result = await runDoctor({ verbose: true });

      assertCheck(result, 'Configuration valid', { passed: false });
      assertCheck(result, 'GitHub Actions workflow', {
        passed: true,
        messageContains: 'Skipped (no config)'
      });
    });

    it('should check workflow when config is valid', async () => {
      await mockDoctorFileSystem();
      mockDoctorEnvironment();

      vi.mocked(existsSync).mockImplementation((path: string) => {
        return path.toString().includes('.github/workflows/validate.yml') || true;
      });
      vi.mocked(findConfigPath).mockReturnValue('vibe-validate.config.yaml');
      vi.mocked(loadConfig).mockResolvedValue(mockConfig);
      vi.mocked(checkSync).mockReturnValue({ inSync: true });

      const result = await runDoctor({ verbose: true });

      assertCheck(result, 'Configuration valid', { passed: true });
      assertCheck(result, 'GitHub Actions workflow', {
        passed: true,
        messageContains: 'in sync'
      });
    });
  });

  describe('Integration: Cache migration + history health together', () => {
    it('should handle both legacy cache migration and large history', async () => {
      await mockDoctorFileSystem();
      mockDoctorEnvironment();
      await mockDoctorGit({
        validationHistoryRefs: ['refs/notes/vibe-validate/runs'], // Old format
        runCacheRefs: [] // No new cache
      });
      vi.mocked(loadConfig).mockResolvedValue(mockConfig);

      // Import and mock the history health check function dynamically
      const historyModule = await import('@vibe-validate/history');
      const mockCheckHealth = vi.spyOn(historyModule, 'checkHistoryHealth');
      mockCheckHealth.mockResolvedValue({
        totalNotes: 500,
        oldNotesCount: 450,
        shouldWarn: true,
        message: '500 tree hashes tracked, 450 can be cleaned up'
      } as any);

      const result = await runDoctor({ verbose: true });

      assertCheck(result, 'Validation history migration', {
        passed: true,
        messageContains: 'Automatically removed'
      });

      assertCheck(result, 'Validation history', {
        passed: true,
        messageContains: '500 tree hashes tracked'
      });

      mockCheckHealth.mockRestore();
    });
  });
});

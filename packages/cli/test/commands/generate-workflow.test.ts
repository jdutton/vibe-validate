/**
 * Tests for generate-workflow command
 */

import { readFileSync, existsSync } from 'node:fs';

import type { VibeValidateConfig } from '@vibe-validate/config';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parse as parseYaml } from 'yaml';

import { generateWorkflow, checkSync, toJobId, getAllJobIds, type GenerateWorkflowOptions } from '../../src/commands/generate-workflow.js';


// Mock fs module
vi.mock('fs', () => ({
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

/**
 * Helper to parse workflow YAML, skipping comment header
 */
function parseWorkflowYaml(workflowYaml: string): any {
  const lines = workflowYaml.split('\n');
  const yamlContent = lines.filter(line => !line.trim().startsWith('#') && line.trim() !== '').join('\n');
  return parseYaml(yamlContent);
}

/**
 * Setup mock for package.json with specified packageManager
 */
function mockPackageJson(packageManager?: string, engines?: { node: string }) {
  vi.mocked(readFileSync).mockImplementation((path: any) => {
    if (path.toString().endsWith('package.json')) {
      const pkg: any = { name: 'test-project' };
      if (packageManager) pkg.packageManager = packageManager;
      if (engines) pkg.engines = engines;
      return JSON.stringify(pkg);
    }
    return '';
  });
}

/**
 * Setup mock for lockfile detection
 */
function mockLockfiles(options: {
  hasPackageLock?: boolean;
  hasPnpmLock?: boolean;
  packageJsonExists?: boolean;
}) {
  vi.mocked(existsSync).mockImplementation((path: any) => {
    const pathStr = path.toString();
    if (pathStr.endsWith('package-lock.json')) return options.hasPackageLock ?? false;
    if (pathStr.endsWith('pnpm-lock.yaml')) return options.hasPnpmLock ?? false;
    if (pathStr.endsWith('package.json')) return options.packageJsonExists ?? true;
    return false;
  });
}

/**
 * Find step in job by predicate
 */
function findStep(job: any, predicate: (_step: any) => boolean) {
  return job.steps.find(predicate);
}

/**
 * Expect all-validation-passed gate job with correct dependencies
 */
function expectGateJob(workflow: any, expectedNeeds: string[]) {
  expect(workflow.jobs).toHaveProperty('all-validation-passed');
  expect(workflow.jobs['all-validation-passed'].if).toBe('always()');
  expect(workflow.jobs['all-validation-passed'].needs).toEqual(expectedNeeds);
}

/**
 * Expect step to exist with uses action
 */
function expectStepWithUses(job: any, uses: string) {
  const step = findStep(job, (s: any) => s.uses === uses || s.uses?.includes(uses));
  expect(step).toBeDefined();
  return step;
}

/**
 * Expect step to exist with run command
 */
function expectStepWithRun(job: any, run: string) {
  const step = findStep(job, (s: any) => s.run === run);
  expect(step).toBeDefined();
  return step;
}

/**
 * Expect step NOT to exist
 */
function expectNoStepWithUses(job: any, uses: string) {
  const step = findStep(job, (s: any) => s.uses?.includes(uses));
  expect(step).toBeUndefined();
}

describe('generate-workflow command', () => {
  const mockConfig: VibeValidateConfig = {
    validation: {
      phases: [
        {
          name: 'Pre-Qualification',
          parallel: true,
          steps: [
            {
              name: 'TypeScript Type Check',
              command: 'pnpm -r typecheck',
            },
            {
              name: 'ESLint Code Quality',
              command: 'pnpm lint',
            },
          ],
          timeout: 300000,
          failFast: true,
        },
        {
          name: 'Testing',
          parallel: false,
          steps: [
            {
              name: 'Unit Tests with Coverage',
              command: 'pnpm test:coverage',
            },
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

  /**
   * Generate workflow and parse YAML in one step
   */
  function generateAndParseWorkflow(
    config: VibeValidateConfig = mockConfig,
    options?: GenerateWorkflowOptions
  ) {
    const workflowYaml = generateWorkflow(config, options);
    return parseWorkflowYaml(workflowYaml);
  }

  describe('toJobId', () => {
    it('should convert phase/step names to valid GitHub Actions job IDs', () => {
      expect(toJobId('TypeScript Type Check')).toBe('typescript-type-check');
      expect(toJobId('ESLint Code Quality')).toBe('eslint-code-quality');
      expect(toJobId('Unit Tests with Coverage')).toBe('unit-tests-with-coverage');
    });

    it('should handle special characters', () => {
      expect(toJobId('Test (with parens)')).toBe('test-with-parens');
      expect(toJobId('Test & Build')).toBe('test-build');
      expect(toJobId('Test  Multiple  Spaces')).toBe('test-multiple-spaces');
    });

    it('should handle leading/trailing dashes', () => {
      expect(toJobId('-leading')).toBe('leading');
      expect(toJobId('trailing-')).toBe('trailing');
      expect(toJobId('-both-')).toBe('both');
    });
  });

  describe('getAllJobIds', () => {
    it('should extract all job IDs from phases', () => {
      const jobIds = getAllJobIds(mockConfig.validation.phases);
      expect(jobIds).toEqual([
        'typescript-type-check',
        'eslint-code-quality',
        'testing', // Phase 2 has parallel: false, so job is named after phase
      ]);
    });

    it('should handle empty phases', () => {
      const jobIds = getAllJobIds([]);
      expect(jobIds).toEqual([]);
    });
  });

  describe('generateWorkflow', () => {
    it('should generate valid GitHub Actions workflow YAML', () => {
      const workflow = generateAndParseWorkflow();

      expect(workflow.name).toBe('Validation Pipeline');
      expect(workflow.on.push.branches).toContain('main');
      expect(workflow.on.pull_request.branches).toContain('main');
    });

    it('should generate jobs for each validation step in non-matrix mode', () => {
      const workflow = generateAndParseWorkflow(mockConfig, { useMatrix: false });

      expect(workflow.jobs).toHaveProperty('typescript-type-check');
      expect(workflow.jobs).toHaveProperty('eslint-code-quality');
      expect(workflow.jobs).toHaveProperty('testing'); // Phase 2 has parallel: false
    });

    it('should auto-depend on previous phase in non-matrix mode', () => {
      const workflow = generateAndParseWorkflow(mockConfig, { useMatrix: false });

      // Testing phase (phase 2) auto-depends on Pre-Qualification phase (phase 1)
      expect(workflow.jobs['testing'].needs).toEqual([
        'typescript-type-check',
        'eslint-code-quality',
      ]);
    });

    it('should include checkout and setup-node steps in non-matrix mode', () => {
      const workflow = generateAndParseWorkflow(mockConfig, { useMatrix: false });

      const job = workflow.jobs['typescript-type-check'];
      expect(job.steps[0].uses).toBe('actions/checkout@v4');
      expect(job.steps[1].uses).toBe('actions/setup-node@v4');
    });


    it('should add all-validation-passed gate job in non-matrix mode', () => {
      const workflow = generateAndParseWorkflow(mockConfig, { useMatrix: false });

      expectGateJob(workflow, [
        'typescript-type-check',
        'eslint-code-quality',
        'testing', // Phase 2 job named after phase
      ]);
    });

    it('should detect pnpm and add pnpm installation steps in non-matrix mode', () => {
      const workflow = generateAndParseWorkflow(mockConfig, {
        packageManager: 'pnpm',
        useMatrix: false,
      });

      const job = workflow.jobs['typescript-type-check'];
      const pnpmStep = expectStepWithUses(job, 'pnpm/action-setup');
      expect(pnpmStep.with.version).toBe('8');
      expectStepWithRun(job, 'pnpm install');
    });

    it('should use npm ci when packageManager is npm in non-matrix mode', () => {
      const workflow = generateAndParseWorkflow(mockConfig, {
        packageManager: 'npm',
        useMatrix: false,
      });

      const job = workflow.jobs['typescript-type-check'];
      expectStepWithRun(job, 'npm ci');
    });

    it('should add coverage reporting when enabled in non-matrix mode', () => {
      const workflowYaml = generateWorkflow(mockConfig, {
        enableCoverage: true,
        coverageProvider: 'codecov',
        useMatrix: false,
      });
      const workflow = parseWorkflowYaml(workflowYaml);

      const coverageJob = workflow.jobs['testing']; // Phase 2 job named after phase
      const codecovStep = coverageJob.steps.find(
        (s: any) => s.uses === 'codecov/codecov-action@v3'
      );
      expect(codecovStep).toBeDefined();
    });

    it('should preserve step environment variables in non-matrix mode', () => {
      const configWithEnv: VibeValidateConfig = {
        ...mockConfig,
        validation: {
          ...mockConfig.validation,
          phases: [
            {
              name: 'Test',
              parallel: false,
              steps: [
                {
                  name: 'Test with Env',
                  command: 'npm test',
                  env: {
                    NODE_ENV: 'test',
                    API_KEY: '${{ secrets.API_KEY }}',
                  },
                },
              ],
              timeout: 300000,
              failFast: true,
            },
          ],
        },
      };

      const workflowYaml = generateWorkflow(configWithEnv, { useMatrix: false });
      const workflow = parseWorkflowYaml(workflowYaml);

      const job = workflow.jobs['test']; // Phase has parallel: false, job named after phase
      const testStep = job.steps.find((s: any) => s.run === 'npm test');
      expect(testStep.env.NODE_ENV).toBe('test');
      expect(testStep.env.API_KEY).toBe('${{ secrets.API_KEY }}');
    });

    it('should add working-directory when step has cwd field in non-matrix mode (phase-based)', () => {
      const configWithCwd: VibeValidateConfig = {
        ...mockConfig,
        validation: {
          ...mockConfig.validation,
          phases: [
            {
              name: 'Test Backend',
              parallel: false,
              steps: [
                {
                  name: 'Run backend tests',
                  command: 'npm test',
                  cwd: 'packages/backend',
                },
              ],
              timeout: 300000,
              failFast: true,
            },
          ],
        },
      };

      const workflowYaml = generateWorkflow(configWithCwd, { useMatrix: false });
      const workflow = parseWorkflowYaml(workflowYaml);

      const job = workflow.jobs['test-backend']; // Phase has parallel: false, job named after phase
      const testStep = job.steps.find((s: any) => s.run === 'npm test');
      expect(testStep['working-directory']).toBe('packages/backend');
    });

    it('should add working-directory when step has cwd field in non-matrix mode (step-based)', () => {
      const configWithCwd: VibeValidateConfig = {
        ...mockConfig,
        validation: {
          ...mockConfig.validation,
          phases: [
            {
              name: 'Test',
              parallel: true,
              steps: [
                {
                  name: 'Test Frontend',
                  command: 'npm test',
                  cwd: 'packages/frontend',
                },
                {
                  name: 'Test Backend',
                  command: 'npm test',
                  cwd: 'packages/backend',
                },
              ],
              timeout: 300000,
              failFast: false,
            },
          ],
        },
      };

      const workflowYaml = generateWorkflow(configWithCwd, { useMatrix: false });
      const workflow = parseWorkflowYaml(workflowYaml);

      // In step-based parallelism, each step becomes a separate job
      const frontendJob = workflow.jobs['test-frontend'];
      const frontendStep = frontendJob.steps.find((s: any) => s.run === 'npm test');
      expect(frontendStep['working-directory']).toBe('packages/frontend');

      const backendJob = workflow.jobs['test-backend'];
      const backendStep = backendJob.steps.find((s: any) => s.run === 'npm test');
      expect(backendStep['working-directory']).toBe('packages/backend');
    });

    it('should not add working-directory when step has no cwd field', () => {
      const workflowYaml = generateWorkflow(mockConfig, { useMatrix: false });
      const workflow = parseWorkflowYaml(workflowYaml);

      const job = workflow.jobs['typescript-type-check'];
      const testStep = job.steps.find((s: any) => s.run === 'pnpm -r typecheck');
      expect(testStep['working-directory']).toBeUndefined();
    });

    it('should include header without timestamp', () => {
      const workflowYaml = generateWorkflow(mockConfig);
      expect(workflowYaml).not.toContain('# Generated:'); // No timestamp in v0.9.6+
      expect(workflowYaml).toContain('# Source of truth: vibe-validate.config.yaml');
    });

    it('should use custom main branch from config', () => {
      const configWithCustomBranch: VibeValidateConfig = {
        ...mockConfig,
        git: {
          ...mockConfig.git,
          mainBranch: 'develop',
        },
      };

      const workflowYaml = generateWorkflow(configWithCustomBranch);
      const workflow = parseWorkflowYaml(workflowYaml);

      expect(workflow.on.push.branches).toContain('develop');
      expect(workflow.on.pull_request.branches).toContain('develop');
    });

    it('should support matrix strategy with multiple Node.js versions', () => {
      const workflowYaml = generateWorkflow(mockConfig, {
        nodeVersions: ['20', '22', '24'],
        os: ['ubuntu-latest'],
      });
      const workflow = parseWorkflowYaml(workflowYaml);

      expect(workflow.jobs.validate.strategy.matrix.node).toEqual(['20', '22', '24']);
      expect(workflow.jobs.validate.strategy['fail-fast']).toBe(false);
    });

    it('should support matrix strategy with multiple operating systems', () => {
      const workflowYaml = generateWorkflow(mockConfig, {
        nodeVersions: ['20'],
        os: ['ubuntu-latest', 'macos-latest', 'windows-latest'],
      });
      const workflow = parseWorkflowYaml(workflowYaml);

      expect(workflow.jobs.validate.strategy.matrix.os).toEqual([
        'ubuntu-latest',
        'macos-latest',
        'windows-latest',
      ]);
    });

    it('should support fail-fast in matrix strategy', () => {
      const workflowYaml = generateWorkflow(mockConfig, {
        nodeVersions: ['20', '22'],
        os: ['ubuntu-latest', 'macos-latest'],
        matrixFailFast: true,
      });
      const workflow = parseWorkflowYaml(workflowYaml);

      expect(workflow.jobs.validate.strategy['fail-fast']).toBe(true);
    });

    it('should use non-matrix mode when single node version and single OS', () => {
      const workflowYaml = generateWorkflow(mockConfig, {
        nodeVersions: ['20'],
        os: ['ubuntu-latest'],
        useMatrix: false,
      });
      const workflow = parseWorkflowYaml(workflowYaml);

      // In non-matrix mode, jobs are created per step
      expect(workflow.jobs).toHaveProperty('typescript-type-check');
      expect(workflow.jobs).toHaveProperty('eslint-code-quality');
      expect(workflow.jobs).not.toHaveProperty('validate');
    });

    it('should create validate job in matrix mode', () => {
      const workflowYaml = generateWorkflow(mockConfig, {
        nodeVersions: ['20', '22'],
        os: ['ubuntu-latest'],
        useMatrix: true,
      });
      const workflow = parseWorkflowYaml(workflowYaml);

      // In matrix mode, single validate job with strategy
      expect(workflow.jobs).toHaveProperty('validate');
      expect(workflow.jobs.validate).toHaveProperty('strategy');
      expect(workflow.jobs).not.toHaveProperty('typescript-type-check');
    });

    it('should include checkout and setup steps in matrix mode', () => {
      const workflowYaml = generateWorkflow(mockConfig, {
        nodeVersions: ['20', '22'],
        useMatrix: true,
      });
      const workflow = parseWorkflowYaml(workflowYaml);

      const job = workflow.jobs['validate'];
      expect(job.steps[0].uses).toBe('actions/checkout@v4');
      expect(job.steps.some((s: any) => s.uses === 'actions/setup-node@v4')).toBe(true);
    });

    it('should add pnpm setup in matrix mode', () => {
      const workflowYaml = generateWorkflow(mockConfig, {
        packageManager: 'pnpm',
        nodeVersions: ['20', '22'],
        useMatrix: true,
      });
      const workflow = parseWorkflowYaml(workflowYaml);

      const job = workflow.jobs['validate'];
      const pnpmStep = job.steps.find((s: any) => s.uses === 'pnpm/action-setup@v2');
      expect(pnpmStep).toBeDefined();
      expect(pnpmStep.with.version).toBe('9');
    });


    it('should NOT add validation state upload (deprecated in v0.12.0)', () => {
      const workflowYaml = generateWorkflow(mockConfig, {
        nodeVersions: ['20', '22'],
        os: ['ubuntu-latest', 'macos-latest'],
        useMatrix: true,
      });
      const workflow = parseWorkflowYaml(workflowYaml);

      const job = workflow.jobs['validate'];
      const uploadStep = job.steps.find(
        (s: any) => s.uses === 'actions/upload-artifact@v4'
      );
      // State upload removed in v0.12.0 - validation history now in git notes
      expect(uploadStep).toBeUndefined();
    });

    it('should add separate coverage job in matrix mode when enabled', () => {
      const workflowYaml = generateWorkflow(mockConfig, {
        enableCoverage: true,
        nodeVersions: ['20', '22', '24'],
        os: ['ubuntu-latest', 'macos-latest'],
        useMatrix: true,
      });
      const workflow = parseWorkflowYaml(workflowYaml);

      // Should have validate job with matrix
      expect(workflow.jobs).toHaveProperty('validate');
      expect(workflow.jobs.validate.strategy.matrix.node).toEqual(['20', '22', '24']);

      // Should have separate coverage job (ubuntu only)
      expect(workflow.jobs).toHaveProperty('validate-coverage');
      expect(workflow.jobs['validate-coverage']['runs-on']).toBe('ubuntu-latest');

      const coverageStep = workflow.jobs['validate-coverage'].steps.find(
        (s: any) => s.uses === 'codecov/codecov-action@v4'
      );
      expect(coverageStep).toBeDefined();
    });

    it('should add all-validation-passed gate job in matrix mode', () => {
      const workflowYaml = generateWorkflow(mockConfig, {
        nodeVersions: ['20', '22'],
        useMatrix: true,
      });
      const workflow = parseWorkflowYaml(workflowYaml);

      expect(workflow.jobs).toHaveProperty('all-validation-passed');
      expect(workflow.jobs['all-validation-passed'].if).toBe('always()');
      expect(workflow.jobs['all-validation-passed'].needs).toEqual(['validate']);
    });

    it('should include coverage job in gate dependencies when enabled', () => {
      const workflowYaml = generateWorkflow(mockConfig, {
        enableCoverage: true,
        nodeVersions: ['20', '22'],
        useMatrix: true,
      });
      const workflow = parseWorkflowYaml(workflowYaml);

      expect(workflow.jobs['all-validation-passed'].needs).toEqual([
        'validate',
        'validate-coverage',
      ]);
    });
  });

  describe('checkSync', () => {
    it('should return false if workflow file does not exist', () => {
      vi.mocked(existsSync).mockReturnValue(false);

      const result = checkSync(mockConfig);

      expect(result.inSync).toBe(false);
      expect(result.diff).toContain('does not exist');
    });

    it('should return true if workflow matches config', () => {
      // Generate workflow with fixed options to ensure determinism
      const options: GenerateWorkflowOptions = {
        packageManager: 'pnpm',
        enableCoverage: false,
      };

      const workflow = generateWorkflow(mockConfig, options);
      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(workflow as any);

      const result = checkSync(mockConfig, options);

      expect(result.inSync).toBe(true);
      expect(result.diff).toBeUndefined();
    });

    it('should return false if workflow differs from config', () => {
      const workflow = generateWorkflow(mockConfig);
      const modifiedWorkflow = workflow.replace('main', 'develop');

      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(modifiedWorkflow as any);

      const result = checkSync(mockConfig);

      expect(result.inSync).toBe(false);
      expect(result.diff).toContain('differs from validation config');
    });

    it('should compare workflows byte-for-byte without timestamp normalization', () => {
      const options: GenerateWorkflowOptions = {
        packageManager: 'pnpm',
        enableCoverage: false,
      };

      const workflow1 = generateWorkflow(mockConfig, options);
      const workflow2 = generateWorkflow(mockConfig, options);

      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(workflow2 as any);

      const result = checkSync(mockConfig, options);

      // Should be in sync - workflows are byte-for-byte identical (no timestamp)
      expect(result.inSync).toBe(true);
      expect(workflow1).toBe(workflow2);
    });
  });

  describe('TDD for v0.9.6 improvements', () => {
    describe('Timestamp removal (no timestamp in header)', () => {
      it('should NOT include timestamp in generated workflow header', () => {
        const workflowYaml = generateWorkflow(mockConfig);

        // Should NOT contain timestamp line
        expect(workflowYaml).not.toContain('# Generated:');

        // Should still have other header lines
        expect(workflowYaml).toContain('# THIS FILE IS AUTO-GENERATED');
        expect(workflowYaml).toContain('# Source of truth: vibe-validate.config.yaml');
        expect(workflowYaml).toContain('# Regenerate with: npx vibe-validate generate-workflow');
      });

      it('should NOT have timestamp normalization in checkSync since timestamp is removed', () => {
        // This test ensures we can simplify checkSync after removing timestamp
        const workflow1 = generateWorkflow(mockConfig, { packageManager: 'pnpm' });
        const workflow2 = generateWorkflow(mockConfig, { packageManager: 'pnpm' });

        vi.mocked(existsSync).mockReturnValue(true);
        vi.mocked(readFileSync).mockReturnValue(workflow1 as any);

        const result = checkSync(mockConfig, { packageManager: 'pnpm' });

        // Should be in sync without any timestamp normalization
        expect(result.inSync).toBe(true);

        // Both workflows should be byte-for-byte identical
        expect(workflow1).toBe(workflow2);
      });
    });

    describe('Package manager detection improvements', () => {
      it('should detect pnpm from packageManager field in package.json', () => {
        mockPackageJson('pnpm@9.0.0');
        vi.mocked(existsSync).mockReturnValue(true);

        const workflow = generateAndParseWorkflow();

        // Should use pnpm based on packageManager field
        const job = workflow.jobs['typescript-type-check'] || workflow.jobs['validate'];
        expectStepWithUses(job, 'pnpm/action-setup');
      });

      it('should detect npm from packageManager field in package.json', () => {
        mockPackageJson('npm@10.0.0');
        vi.mocked(existsSync).mockReturnValue(true);

        const workflow = generateAndParseWorkflow(mockConfig, { useMatrix: false });

        // Should use npm based on packageManager field
        const job = workflow.jobs['typescript-type-check'];
        expectStepWithRun(job, 'npm ci');
        expectNoStepWithUses(job, 'pnpm/action-setup');
      });

      it('should prefer npm when both lockfiles exist (more conservative default)', () => {
        mockLockfiles({ hasPackageLock: true, hasPnpmLock: true });
        mockPackageJson(undefined, { node: '>=22.0.0' });

        const workflow = generateAndParseWorkflow(mockConfig, { useMatrix: false });

        // Should default to npm when both exist (more conservative)
        const job = workflow.jobs['typescript-type-check'];
        expectStepWithRun(job, 'npm ci');
        expectNoStepWithUses(job, 'pnpm/action-setup');
      });

      it('should use pnpm when only pnpm-lock.yaml exists', () => {
        mockLockfiles({ hasPackageLock: false, hasPnpmLock: true, packageJsonExists: true });
        mockPackageJson(undefined, { node: '>=22.0.0' });

        const workflow = generateAndParseWorkflow(mockConfig, { useMatrix: false });

        // Should use pnpm when only pnpm-lock exists
        const job = workflow.jobs['typescript-type-check'];
        expectStepWithUses(job, 'pnpm/action-setup');
      });

      it('should use npm when only package-lock.json exists', () => {
        mockLockfiles({ hasPackageLock: true, hasPnpmLock: false, packageJsonExists: true });
        mockPackageJson(undefined, { node: '>=22.0.0' });

        const workflow = generateAndParseWorkflow(mockConfig, { useMatrix: false });

        // Should use npm when only package-lock exists
        const job = workflow.jobs['typescript-type-check'];
        expectStepWithRun(job, 'npm ci');
      });

      it('should prioritize packageManager field over lockfile detection', () => {
        vi.mocked(existsSync).mockReturnValue(true);
        mockPackageJson('pnpm@9.0.0', { node: '>=22.0.0' });

        const workflow = generateAndParseWorkflow(mockConfig, { useMatrix: false });

        // Should use pnpm from packageManager field (not default to npm)
        const job = workflow.jobs['typescript-type-check'];
        expectStepWithUses(job, 'pnpm/action-setup');
      });
    });
  });

  // Note: Subdirectory support tests moved to generate-workflow-subdirectory.system.test.ts
  // The tests require real filesystem operations which conflict with the fs mocking in this file.
  // See generate-workflow-subdirectory.system.test.ts for comprehensive subdirectory testing.
});

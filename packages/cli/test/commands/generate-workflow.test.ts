/**
 * Tests for generate-workflow command
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateWorkflow, checkSync, toJobId, getAllJobIds, type GenerateWorkflowOptions } from '../../src/commands/generate-workflow.js';
import type { VibeValidateConfig } from '@vibe-validate/config';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import yaml from 'js-yaml';

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
  return yaml.load(yamlContent);
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
          dependsOn: ['Pre-Qualification'],
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
        'unit-tests-with-coverage',
      ]);
    });

    it('should handle empty phases', () => {
      const jobIds = getAllJobIds([]);
      expect(jobIds).toEqual([]);
    });
  });

  describe('generateWorkflow', () => {
    it('should generate valid GitHub Actions workflow YAML', () => {
      const workflowYaml = generateWorkflow(mockConfig);
      const workflow = parseWorkflowYaml(workflowYaml);

      expect(workflow.name).toBe('Validation Pipeline');
      expect(workflow.on.push.branches).toContain('main');
      expect(workflow.on.pull_request.branches).toContain('main');
    });

    it('should generate jobs for each validation step in non-matrix mode', () => {
      const workflowYaml = generateWorkflow(mockConfig, { useMatrix: false });
      const workflow = parseWorkflowYaml(workflowYaml);

      expect(workflow.jobs).toHaveProperty('typescript-type-check');
      expect(workflow.jobs).toHaveProperty('eslint-code-quality');
      expect(workflow.jobs).toHaveProperty('unit-tests-with-coverage');
    });

    it('should set up dependencies based on dependsOn in non-matrix mode', () => {
      const workflowYaml = generateWorkflow(mockConfig, { useMatrix: false });
      const workflow = parseWorkflowYaml(workflowYaml);

      // Testing phase depends on Pre-Qualification phase
      expect(workflow.jobs['unit-tests-with-coverage'].needs).toEqual([
        'typescript-type-check',
        'eslint-code-quality',
      ]);
    });

    it('should include checkout and setup-node steps in non-matrix mode', () => {
      const workflowYaml = generateWorkflow(mockConfig, { useMatrix: false });
      const workflow = parseWorkflowYaml(workflowYaml);

      const job = workflow.jobs['typescript-type-check'];
      expect(job.steps[0].uses).toBe('actions/checkout@v4');
      expect(job.steps[1].uses).toBe('actions/setup-node@v4');
    });

    it('should add LLM_OUTPUT=1 environment variable in non-matrix mode', () => {
      const workflowYaml = generateWorkflow(mockConfig, { useMatrix: false });
      const workflow = parseWorkflowYaml(workflowYaml);

      const job = workflow.jobs['typescript-type-check'];
      const commandStep = job.steps.find((s: any) => s.run === 'pnpm -r typecheck');
      expect(commandStep.env.LLM_OUTPUT).toBe('1');
    });

    it('should add all-validation-passed gate job in non-matrix mode', () => {
      const workflowYaml = generateWorkflow(mockConfig, { useMatrix: false });
      const workflow = parseWorkflowYaml(workflowYaml);

      expect(workflow.jobs).toHaveProperty('all-validation-passed');
      expect(workflow.jobs['all-validation-passed'].if).toBe('always()');
      expect(workflow.jobs['all-validation-passed'].needs).toEqual([
        'typescript-type-check',
        'eslint-code-quality',
        'unit-tests-with-coverage',
      ]);
    });

    it('should detect pnpm and add pnpm installation steps in non-matrix mode', () => {
      const workflowYaml = generateWorkflow(mockConfig, {
        packageManager: 'pnpm',
        useMatrix: false,
      });
      const workflow = parseWorkflowYaml(workflowYaml);

      const job = workflow.jobs['typescript-type-check'];
      const pnpmStep = job.steps.find((s: any) => s.uses === 'pnpm/action-setup@v2');
      expect(pnpmStep).toBeDefined();
      expect(pnpmStep.with.version).toBe('8');

      const installStep = job.steps.find((s: any) => s.run === 'pnpm install');
      expect(installStep).toBeDefined();
    });

    it('should use npm ci when packageManager is npm in non-matrix mode', () => {
      const workflowYaml = generateWorkflow(mockConfig, {
        packageManager: 'npm',
        useMatrix: false,
      });
      const workflow = parseWorkflowYaml(workflowYaml);

      const job = workflow.jobs['typescript-type-check'];
      const npmStep = job.steps.find((s: any) => s.run === 'npm ci');
      expect(npmStep).toBeDefined();
    });

    it('should add coverage reporting when enabled in non-matrix mode', () => {
      const workflowYaml = generateWorkflow(mockConfig, {
        enableCoverage: true,
        coverageProvider: 'codecov',
        useMatrix: false,
      });
      const workflow = parseWorkflowYaml(workflowYaml);

      const coverageJob = workflow.jobs['unit-tests-with-coverage'];
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

      const job = workflow.jobs['test-with-env'];
      const testStep = job.steps.find((s: any) => s.run === 'npm test');
      expect(testStep.env.NODE_ENV).toBe('test');
      expect(testStep.env.API_KEY).toBe('${{ secrets.API_KEY }}');
      expect(testStep.env.LLM_OUTPUT).toBe('1'); // Should add LLM_OUTPUT
    });

    it('should include generation timestamp in header', () => {
      const workflowYaml = generateWorkflow(mockConfig);
      expect(workflowYaml).toContain('# Generated:');
      expect(workflowYaml).toContain('# Source of truth: vibe-validate.config.mjs');
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

    it('should add LLM_OUTPUT=1 environment variable in matrix mode', () => {
      const workflowYaml = generateWorkflow(mockConfig, {
        packageManager: 'pnpm',
        nodeVersions: ['20', '22'],
        useMatrix: true,
      });
      const workflow = parseWorkflowYaml(workflowYaml);

      const job = workflow.jobs['validate'];
      const validateStep = job.steps.find((s: any) => s.run === 'pnpm validate');
      expect(validateStep).toBeDefined();
      expect(validateStep.env.LLM_OUTPUT).toBe('1');
    });

    it('should add validation state upload on failure in matrix mode', () => {
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
      expect(uploadStep).toBeDefined();
      expect(uploadStep.if).toBe('failure()');
      expect(uploadStep.with.name).toBe('validation-state-${{ matrix.os }}-node${{ matrix.node }}');
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

    it('should ignore timestamp differences when comparing', () => {
      const options: GenerateWorkflowOptions = {
        packageManager: 'pnpm',
        enableCoverage: false,
      };

      const workflow1 = generateWorkflow(mockConfig, options);
      // Simulate different generation time
      const workflow2 = workflow1.replace(
        /# Generated: .+/,
        '# Generated: 2024-01-01T00:00:00.000Z'
      );

      vi.mocked(existsSync).mockReturnValue(true);
      vi.mocked(readFileSync).mockReturnValue(workflow2 as any);

      const result = checkSync(mockConfig, options);

      expect(result.inSync).toBe(true);
    });
  });
});

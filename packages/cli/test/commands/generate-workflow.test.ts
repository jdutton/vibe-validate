/**
 * Tests for generate-workflow command
 */

import { readFileSync, existsSync } from 'node:fs';

import type { VibeValidateConfig } from '@vibe-validate/config';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parse as parseYaml } from 'yaml';

import { generateWorkflow, checkSync, toJobId, projectHasBuildScript, type GenerateWorkflowOptions } from '../../src/commands/generate-workflow.js';
import { mockConfig as baseMockConfig } from '../helpers/generate-workflow-fixtures.js';


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
function mockPackageJson(packageManager?: string, engines?: { node: string }, scripts?: Record<string, string>) {
  vi.mocked(readFileSync).mockImplementation((path: any) => {
    if (path.toString().endsWith('package.json')) {
      const pkg: any = { name: 'test-project' };
      if (packageManager) pkg.packageManager = packageManager;
      if (engines) pkg.engines = engines;
      if (scripts) pkg.scripts = scripts;
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
  hasYarnLock?: boolean;
  hasBunLock?: boolean;
  packageJsonExists?: boolean;
}) {
  vi.mocked(existsSync).mockImplementation((path: any) => {
    const pathStr = path.toString();
    if (pathStr.endsWith('package-lock.json')) return options.hasPackageLock ?? false;
    if (pathStr.endsWith('pnpm-lock.yaml')) return options.hasPnpmLock ?? false;
    if (pathStr.endsWith('yarn.lock')) return options.hasYarnLock ?? false;
    // Support both bun.lockb (binary) and bun.lock (text) formats
    if (pathStr.endsWith('bun.lockb') || pathStr.endsWith('bun.lock')) return options.hasBunLock ?? false;
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
 * Find step by exact 'uses' value
 */
function findStepByUses(job: any, uses: string) {
  return findStep(job, (s: any) => s.uses === uses);
}

/**
 * Find step by name
 */
function findStepByName(job: any, name: string) {
  return findStep(job, (s: any) => s.name === name);
}

/**
 * Find step index by exact 'uses' value
 */
function findStepIndexByUses(job: any, uses: string): number {
  return job.steps.findIndex((s: any) => s.uses === uses);
}

/**
 * Find step index by name
 */
function findStepIndexByName(job: any, name: string): number {
  return job.steps.findIndex((s: any) => s.name === name);
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

/**
 * Generate workflow and parse YAML in one step
 */
function generateAndParseWorkflow(
  config: VibeValidateConfig = baseMockConfig,
  options?: GenerateWorkflowOptions
) {
  const workflowYaml = generateWorkflow(config, options);
  return parseWorkflowYaml(workflowYaml);
}

/**
 * Test package manager detection from packageManager field (uses validate job)
 */
function testPackageManagerDetection(
  pm: string,
  version: string,
  expectedAction: string | null,
  expectedCommand?: string
) {
  mockPackageJson(`${pm}@${version}`);
  vi.mocked(existsSync).mockReturnValue(true);

  const workflow = generateAndParseWorkflow(baseMockConfig);
  const job = workflow.jobs['validate'];

  if (expectedAction) {
    expectStepWithUses(job, expectedAction);
  }
  if (expectedCommand) {
    expectStepWithRun(job, expectedCommand);
  }
}

/**
 * Test package manager detection from lockfile (uses validate job)
 */
function testLockfileDetection(
  lockfileConfig: {
    hasPackageLock?: boolean;
    hasPnpmLock?: boolean;
    hasYarnLock?: boolean;
    hasBunLock?: boolean;
  },
  expectedAction: string | null,
  expectedCommand: string
) {
  mockLockfiles({ ...lockfileConfig, packageJsonExists: true });
  mockPackageJson(undefined, { node: '>=22.0.0' });

  const workflow = generateAndParseWorkflow(baseMockConfig);
  const job = workflow.jobs['validate'];

  if (expectedAction) {
    expectStepWithUses(job, expectedAction);
  }
  expectStepWithRun(job, expectedCommand);
}

/**
 * Test package manager commands in build workflow (uses validate job)
 */
function testBuildCommands(pm: string, version: string, installCmd: string, buildCmd: string) {
  mockPackageJson(`${pm}@${version}`, undefined, { build: buildCmd });
  vi.mocked(existsSync).mockReturnValue(true);

  const workflow = generateAndParseWorkflow(baseMockConfig);
  const job = workflow.jobs['validate'];
  expectStepWithRun(job, installCmd);
}

/**
 * Generate Bun matrix workflow and return validate job
 * Helper to reduce duplication in Bun matrix tests
 */
function generateBunMatrixWorkflow(options: {
  nodeVersions?: string[];
  os?: string[];
} = {}) {
  mockPackageJson('bun@1.0.0');
  vi.mocked(existsSync).mockReturnValue(true);

  const workflow = generateAndParseWorkflow(baseMockConfig, {
        nodeVersions: options.nodeVersions ?? ['20', '22'],
    os: options.os ?? ['ubuntu-latest', 'windows-latest']
  });

  return workflow.jobs['validate'];
}

describe('generate-workflow command', () => {
  const mockConfig = baseMockConfig;

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

  describe('generateWorkflow', () => {
    it('should generate valid GitHub Actions workflow YAML', () => {
      const workflow = generateAndParseWorkflow();

      expect(workflow.name).toBe('Validation Pipeline');
      expect(workflow.on.push.branches).toContain('main');
      expect(workflow.on.pull_request.branches).toContain('main');
    });

    it('should always generate single validate job', () => {
      const workflow = generateAndParseWorkflow(mockConfig);

      // Always generates a single validate job
      expect(workflow.jobs).toHaveProperty('validate');
      expect(workflow.jobs).not.toHaveProperty('typescript-type-check');
      expect(workflow.jobs).not.toHaveProperty('eslint-code-quality');
      expect(workflow.jobs).not.toHaveProperty('testing');
    });

    it('should include checkout and setup-node steps', () => {
      const workflow = generateAndParseWorkflow(mockConfig);

      const job = workflow.jobs['validate'];
      expect(job.steps[0].uses).toBe('actions/checkout@v6');
      expect(job.steps.some((s: any) => s.uses === 'actions/setup-node@v6')).toBe(true);
    });

    it('should add all-validation-passed gate job', () => {
      const workflow = generateAndParseWorkflow(mockConfig);

      expectGateJob(workflow, ['validate']);
    });

    it('should detect pnpm and add pnpm installation steps', () => {
      const workflow = generateAndParseWorkflow(mockConfig, {
        packageManager: 'pnpm',
      });

      const job = workflow.jobs['validate'];
      const pnpmStep = expectStepWithUses(job, 'pnpm/action-setup');
      expect(pnpmStep.with.version).toBe('9');
      expectStepWithRun(job, 'pnpm install --frozen-lockfile');
    });

    it('should use npm ci when packageManager is npm', () => {
      const workflow = generateAndParseWorkflow(mockConfig, {
        packageManager: 'npm',
      });

      const job = workflow.jobs['validate'];
      expectStepWithRun(job, 'npm ci');
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

    it('should always use single validate job even with single node version and OS', () => {
      const workflowYaml = generateWorkflow(mockConfig, {
        nodeVersions: ['20'],
        os: ['ubuntu-latest'],
      });
      const workflow = parseWorkflowYaml(workflowYaml);

      // Always generates a single validate job with matrix strategy
      expect(workflow.jobs).toHaveProperty('validate');
      expect(workflow.jobs.validate).toHaveProperty('strategy');
      expect(workflow.jobs.validate.strategy.matrix.node).toEqual(['20']);
      expect(workflow.jobs.validate.strategy.matrix.os).toEqual(['ubuntu-latest']);
    });

    it('should NOT add validation state upload (deprecated in v0.12.0)', () => {
      const workflowYaml = generateWorkflow(mockConfig, {
        nodeVersions: ['20', '22'],
        os: ['ubuntu-latest', 'macos-latest'],
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
        testPackageManagerDetection('pnpm', '9.0.0', 'pnpm/action-setup', 'pnpm install --frozen-lockfile');
      });

      it('should detect npm from packageManager field in package.json', () => {
        mockPackageJson('npm@10.0.0');
        vi.mocked(existsSync).mockReturnValue(true);

        const workflow = generateAndParseWorkflow(mockConfig);
        const job = workflow.jobs['validate'];
        expectStepWithRun(job, 'npm ci');
        expectNoStepWithUses(job, 'pnpm/action-setup');
      });

      it('should prefer npm when both lockfiles exist (more conservative default)', () => {
        mockLockfiles({ hasPackageLock: true, hasPnpmLock: true });
        mockPackageJson(undefined, { node: '>=22.0.0' });

        const workflow = generateAndParseWorkflow(mockConfig);

        // Should default to npm when both exist (more conservative)
        const job = workflow.jobs['validate'];
        expectStepWithRun(job, 'npm ci');
        expectNoStepWithUses(job, 'pnpm/action-setup');
      });

      it('should use pnpm when only pnpm-lock.yaml exists', () => {
        mockLockfiles({ hasPackageLock: false, hasPnpmLock: true, packageJsonExists: true });
        mockPackageJson(undefined, { node: '>=22.0.0' });

        const workflow = generateAndParseWorkflow(mockConfig);

        // Should use pnpm when only pnpm-lock exists
        const job = workflow.jobs['validate'];
        expectStepWithUses(job, 'pnpm/action-setup');
      });

      it('should use npm when only package-lock.json exists', () => {
        mockLockfiles({ hasPackageLock: true, hasPnpmLock: false, packageJsonExists: true });
        mockPackageJson(undefined, { node: '>=22.0.0' });

        const workflow = generateAndParseWorkflow(mockConfig);

        // Should use npm when only package-lock exists
        const job = workflow.jobs['validate'];
        expectStepWithRun(job, 'npm ci');
      });

      it('should prioritize packageManager field over lockfile detection', () => {
        vi.mocked(existsSync).mockReturnValue(true);
        mockPackageJson('pnpm@9.0.0', { node: '>=22.0.0' });

        const workflow = generateAndParseWorkflow(mockConfig);

        // Should use pnpm from packageManager field (not default to npm)
        const job = workflow.jobs['validate'];
        expectStepWithUses(job, 'pnpm/action-setup');
      });

      it('should detect bun from packageManager field in package.json', () => {
        testPackageManagerDetection('bun', '1.0.0', 'oven-sh/setup-bun@v2', 'bun install');
      });

      it('should detect yarn from packageManager field in package.json', () => {
        testPackageManagerDetection('yarn', '4.0.0', null, 'yarn install --frozen-lockfile');
      });

      it('should use bun when only bun.lockb exists', () => {
        testLockfileDetection(
          { hasBunLock: true, hasPackageLock: false, hasPnpmLock: false, hasYarnLock: false },
          'oven-sh/setup-bun@v2',
          'bun install'
        );
      });

      it('should use yarn when only yarn.lock exists', () => {
        testLockfileDetection(
          { hasYarnLock: true, hasPackageLock: false, hasPnpmLock: false, hasBunLock: false },
          null,
          'yarn install --frozen-lockfile'
        );
      });

      it('should prioritize bun over other lockfiles when multiple exist', () => {
        testLockfileDetection(
          { hasBunLock: true, hasPackageLock: true, hasPnpmLock: true, hasYarnLock: true },
          'oven-sh/setup-bun@v2',
          'bun install'
        );
      });

      it('should prioritize yarn over npm when both exist', () => {
        testLockfileDetection(
          { hasYarnLock: true, hasPackageLock: true, hasPnpmLock: false, hasBunLock: false },
          null,
          'yarn install --frozen-lockfile'
        );
      });

      it('should use bun commands for build and validate', () => {
        testBuildCommands('bun', '1.0.0', 'bun install', 'bun run build');
      });

      it('should use yarn commands for build and validate', () => {
        testBuildCommands('yarn', '4.0.0', 'yarn install --frozen-lockfile', 'yarn run build');
      });

      it('should use bun with validate job', () => {
        const job = generateBunMatrixWorkflow();

        expect(job.strategy.matrix.node).toEqual(['20', '22']);
        expect(job.strategy.matrix.os).toEqual(['ubuntu-latest', 'windows-latest']);
        expectStepWithUses(job, 'oven-sh/setup-bun@v2');
        expectStepWithRun(job, 'bun install');
        expectStepWithRun(job, 'bun run validate');
      });

      it('should include Node.js setup for Bun projects for compatibility testing', () => {
        const job = generateBunMatrixWorkflow();

        // Should have BOTH Bun and Node.js setup
        const bunStep = expectStepWithUses(job, 'oven-sh/setup-bun@v2');
        const nodeStep = expectStepWithUses(job, 'actions/setup-node@v6');

        // Verify Node.js setup uses matrix variable
        expect(nodeStep.with['node-version']).toBe('${{ matrix.node }}');

        // Verify Node.js setup does NOT have cache for Bun (Bun doesn't use Node's cache)
        expect(nodeStep.with.cache).toBeUndefined();

        // Bun setup should come before Node.js setup
        const bunIndex = job.steps.indexOf(bunStep);
        const nodeIndex = job.steps.indexOf(nodeStep);
        expect(bunIndex).toBeLessThan(nodeIndex);
      });

      it('should include Node.js setup for Bun projects detected from bun.lock (new format)', () => {
        mockLockfiles({ hasBunLock: true, hasPackageLock: false, hasPnpmLock: false, hasYarnLock: false });
        mockPackageJson(undefined, { node: '>=22.0.0' });

        const workflow = generateAndParseWorkflow(mockConfig, {
                    nodeVersions: ['22', '24'],
        });

        const job = workflow.jobs['validate'];

        // Should detect Bun and include both setups
        expectStepWithUses(job, 'oven-sh/setup-bun@v2');
        const nodeStep = expectStepWithUses(job, 'actions/setup-node@v6');

        // Node.js setup should use matrix variable and not have cache
        expect(nodeStep.with['node-version']).toBe('${{ matrix.node }}');
        expect(nodeStep.with.cache).toBeUndefined();
      });

      it('should use yarn with validate job', () => {
        mockPackageJson('yarn@4.0.0');
        vi.mocked(existsSync).mockReturnValue(true);

        const workflow = generateAndParseWorkflow(mockConfig, {
                    nodeVersions: ['20', '22'],
          os: ['ubuntu-latest']
        });

        const job = workflow.jobs['validate'];
        expectStepWithRun(job, 'yarn install --frozen-lockfile');
        expectStepWithRun(job, 'yarn run validate');
        expectNoStepWithUses(job, 'pnpm/action-setup');
        expectNoStepWithUses(job, 'oven-sh/setup-bun');
      });
    });
  });

  describe('Phase 2A: CI config enhancements', () => {
    describe('F1: registry-url on setup-node', () => {
      it('should add registry-url to setup-node when ci.registryUrl is set', () => {
        const config: VibeValidateConfig = {
          ...baseMockConfig,
          ci: { registryUrl: 'https://npm.pkg.github.com' },
        };

        const workflow = generateAndParseWorkflow(config, { packageManager: 'pnpm' });
        const job = workflow.jobs['validate'];
        const nodeStep = findStepByUses(job, 'actions/setup-node@v6');

        expect(nodeStep.with['registry-url']).toBe('https://npm.pkg.github.com');
      });

      it('should add registry-url to coverage job setup-node when ci.registryUrl is set', () => {
        const config: VibeValidateConfig = {
          ...baseMockConfig,
          ci: { registryUrl: 'https://npm.pkg.github.com' },
        };

        const workflow = generateAndParseWorkflow(config, {
          packageManager: 'pnpm',
          enableCoverage: true,
        });
        const coverageJob = workflow.jobs['validate-coverage'];
        const nodeStep = findStepByUses(coverageJob, 'actions/setup-node@v6');

        expect(nodeStep.with['registry-url']).toBe('https://npm.pkg.github.com');
      });

      it('should NOT add registry-url when ci.registryUrl is not set', () => {
        const workflow = generateAndParseWorkflow(baseMockConfig, { packageManager: 'pnpm' });
        const job = workflow.jobs['validate'];
        const nodeStep = findStepByUses(job, 'actions/setup-node@v6');

        expect(nodeStep.with['registry-url']).toBeUndefined();
      });
    });

    describe('F2: job-level env', () => {
      it('should add env to validate job when ci.env is set', () => {
        const config: VibeValidateConfig = {
          ...baseMockConfig,
          ci: { env: { NODE_AUTH_TOKEN: '${{ secrets.NPM_TOKEN }}', CI: 'true' } },
        };

        const workflow = generateAndParseWorkflow(config, { packageManager: 'pnpm' });

        // env should be on the validate job, not at workflow level
        expect(workflow.env).toBeUndefined();
        expect(workflow.jobs['validate'].env).toEqual({
          NODE_AUTH_TOKEN: '${{ secrets.NPM_TOKEN }}',
          CI: 'true',
        });
      });

      it('should NOT add env to gate job', () => {
        const config: VibeValidateConfig = {
          ...baseMockConfig,
          ci: { env: { NODE_AUTH_TOKEN: '${{ secrets.NPM_TOKEN }}' } },
        };

        const workflow = generateAndParseWorkflow(config, { packageManager: 'pnpm' });

        expect(workflow.jobs['all-validation-passed'].env).toBeUndefined();
      });

      it('should NOT add env block when ci.env is not set', () => {
        const workflow = generateAndParseWorkflow(baseMockConfig, { packageManager: 'pnpm' });

        expect(workflow.env).toBeUndefined();
        expect(workflow.jobs['validate'].env).toBeUndefined();
      });
    });

    describe('F3: permissions block (job-level)', () => {
      it('should add permissions to validate job when ci.permissions is set', () => {
        const config: VibeValidateConfig = {
          ...baseMockConfig,
          ci: { permissions: { packages: 'write' } },
        };

        const workflow = generateAndParseWorkflow(config, { packageManager: 'pnpm' });

        // permissions should be on the validate job, not at workflow level
        expect(workflow.permissions).toBeUndefined();
        expect(workflow.jobs['validate'].permissions).toEqual({ contents: 'read', packages: 'write' });
      });

      it('should auto-inject contents:read for actions/checkout', () => {
        const config: VibeValidateConfig = {
          ...baseMockConfig,
          ci: { permissions: { packages: 'read' } },
        };

        const workflow = generateAndParseWorkflow(config, { packageManager: 'pnpm' });

        // contents:read is required for actions/checkout and must always be present
        expect(workflow.jobs['validate'].permissions).toEqual({ contents: 'read', packages: 'read' });
      });

      it('should not override explicit contents permission', () => {
        const config: VibeValidateConfig = {
          ...baseMockConfig,
          ci: { permissions: { contents: 'write', packages: 'read' } },
        };

        const workflow = generateAndParseWorkflow(config, { packageManager: 'pnpm' });

        // User-specified contents:write should take precedence over the default
        expect(workflow.jobs['validate'].permissions).toEqual({ contents: 'write', packages: 'read' });
      });

      it('should NOT add permissions to gate job', () => {
        const config: VibeValidateConfig = {
          ...baseMockConfig,
          ci: { permissions: { packages: 'read' } },
        };

        const workflow = generateAndParseWorkflow(config, { packageManager: 'pnpm' });

        expect(workflow.jobs['all-validation-passed'].permissions).toBeUndefined();
      });

      it('should add permissions to coverage job when enabled', () => {
        const config: VibeValidateConfig = {
          ...baseMockConfig,
          ci: { permissions: { packages: 'read' } },
        };

        const workflow = generateAndParseWorkflow(config, {
          packageManager: 'pnpm',
          enableCoverage: true,
        });

        expect(workflow.jobs['validate-coverage'].permissions).toEqual({ contents: 'read', packages: 'read' });
      });

      it('should NOT add permissions block when ci.permissions is not set', () => {
        const workflow = generateAndParseWorkflow(baseMockConfig, { packageManager: 'pnpm' });

        expect(workflow.permissions).toBeUndefined();
        expect(workflow.jobs['validate'].permissions).toBeUndefined();
      });
    });

    describe('F4: concurrency block', () => {
      it('should add concurrency block when ci.concurrency is set', () => {
        const config: VibeValidateConfig = {
          ...baseMockConfig,
          ci: {
            concurrency: {
              group: '${{ github.workflow }}-${{ github.ref }}',
              cancelInProgress: true,
            },
          },
        };

        const workflow = generateAndParseWorkflow(config, { packageManager: 'pnpm' });

        expect(workflow.concurrency).toEqual({
          group: '${{ github.workflow }}-${{ github.ref }}',
          'cancel-in-progress': true,
        });
      });

      it('should map cancelInProgress to cancel-in-progress in YAML', () => {
        const config: VibeValidateConfig = {
          ...baseMockConfig,
          ci: {
            concurrency: {
              group: 'ci-${{ github.ref }}',
              cancelInProgress: false,
            },
          },
        };

        const workflow = generateAndParseWorkflow(config, { packageManager: 'pnpm' });

        expect(workflow.concurrency['cancel-in-progress']).toBe(false);
      });

      it('should omit cancel-in-progress when cancelInProgress is not set', () => {
        const config: VibeValidateConfig = {
          ...baseMockConfig,
          ci: {
            concurrency: {
              group: 'ci-${{ github.ref }}',
            },
          },
        };

        const workflow = generateAndParseWorkflow(config, { packageManager: 'pnpm' });

        expect(workflow.concurrency.group).toBe('ci-${{ github.ref }}');
        expect(workflow.concurrency).not.toHaveProperty('cancel-in-progress');
      });

      it('should NOT add concurrency block when ci.concurrency is not set', () => {
        const workflow = generateAndParseWorkflow(baseMockConfig, { packageManager: 'pnpm' });

        expect(workflow.concurrency).toBeUndefined();
      });
    });

    describe('F5: setupSteps injection', () => {
      it('should inject setupSteps after checkout but before package manager setup', () => {
        const config: VibeValidateConfig = {
          ...baseMockConfig,
          ci: {
            setupSteps: [
              { name: 'Setup Java', uses: 'actions/setup-java@v4', with: { 'java-version': '17' } },
            ],
          },
        };

        const workflow = generateAndParseWorkflow(config, { packageManager: 'pnpm' });
        const job = workflow.jobs['validate'];

        // Find step indices
        const checkoutIdx = findStepIndexByUses(job, 'actions/checkout@v6');
        const javaIdx = findStepIndexByName(job, 'Setup Java');
        const pnpmIdx = findStepIndexByName(job, 'Setup pnpm');
        const nodeIdx = findStepIndexByUses(job, 'actions/setup-node@v6');

        expect(javaIdx).toBeGreaterThan(checkoutIdx);
        expect(javaIdx).toBeLessThan(pnpmIdx);
        expect(javaIdx).toBeLessThan(nodeIdx);
      });

      it('should inject setupSteps into coverage job', () => {
        const config: VibeValidateConfig = {
          ...baseMockConfig,
          ci: {
            setupSteps: [
              { name: 'Custom setup', run: 'echo "custom"' },
            ],
          },
        };

        const workflow = generateAndParseWorkflow(config, {
          packageManager: 'pnpm',
          enableCoverage: true,
        });

        const coverageJob = workflow.jobs['validate-coverage'];
        const checkoutIdx = findStepIndexByUses(coverageJob, 'actions/checkout@v6');
        const customIdx = findStepIndexByName(coverageJob, 'Custom setup');
        const pnpmIdx = findStepIndexByName(coverageJob, 'Setup pnpm');

        expect(customIdx).toBeGreaterThan(checkoutIdx);
        expect(customIdx).toBeLessThan(pnpmIdx);
      });

      it('should NOT inject setupSteps when ci.setupSteps is not set', () => {
        const workflow = generateAndParseWorkflow(baseMockConfig, { packageManager: 'pnpm' });
        const job = workflow.jobs['validate'];

        // Should go directly from checkout to pnpm setup
        expect(job.steps[0].uses).toBe('actions/checkout@v6');
        expect(job.steps[1].name).toBe('Setup pnpm');
      });

      it('should inject multiple setupSteps in order', () => {
        const config: VibeValidateConfig = {
          ...baseMockConfig,
          ci: {
            setupSteps: [
              { name: 'Step A', run: 'echo a' },
              { name: 'Step B', run: 'echo b' },
            ],
          },
        };

        const workflow = generateAndParseWorkflow(config, { packageManager: 'pnpm' });
        const job = workflow.jobs['validate'];

        const stepAIdx = findStepIndexByName(job, 'Step A');
        const stepBIdx = findStepIndexByName(job, 'Step B');

        expect(stepAIdx).toBe(1); // Right after checkout
        expect(stepBIdx).toBe(2); // After Step A
      });
    });

    describe('B2: generateCheckScript indentation fix', () => {
      it('should use standard 2-space indentation in check script', () => {
        const workflow = generateAndParseWorkflow(baseMockConfig, { packageManager: 'pnpm' });
        const gateJob = workflow.jobs['all-validation-passed'];
        const checkStep = gateJob.steps[0];

        // Should use 2-space indentation, not excessive whitespace
        expect(checkStep.run).toContain('if ');
        expect(checkStep.run).toContain('\n  echo');
        expect(checkStep.run).toContain('\n  exit 1');
        expect(checkStep.run).toContain('\nfi');
        expect(checkStep.run).not.toContain('            echo');
      });
    });

    describe('B3: build auto-detection from package.json', () => {
      it('should add build step when package.json has scripts.build', () => {
        mockPackageJson('pnpm@9.0.0', undefined, { build: 'turbo run build' });
        vi.mocked(existsSync).mockReturnValue(true);

        const workflow = generateAndParseWorkflow(baseMockConfig);
        const job = workflow.jobs['validate'];

        const buildStep = findStepByName(job, 'Build packages');
        expect(buildStep).toBeDefined();
        expect(buildStep.run).toBe('pnpm -r build');
      });

      it('should NOT add build step when package.json has no scripts.build', () => {
        mockPackageJson('pnpm@9.0.0');
        vi.mocked(existsSync).mockReturnValue(true);

        const workflow = generateAndParseWorkflow(baseMockConfig);
        const job = workflow.jobs['validate'];

        const buildStep = findStepByName(job, 'Build packages');
        expect(buildStep).toBeUndefined();
      });

      it('should NOT add build step when package.json does not exist', () => {
        vi.mocked(existsSync).mockReturnValue(false);

        const workflow = generateAndParseWorkflow(baseMockConfig, { packageManager: 'pnpm' });
        const job = workflow.jobs['validate'];

        const buildStep = findStepByName(job, 'Build packages');
        expect(buildStep).toBeUndefined();
      });

      it('projectHasBuildScript should return true when scripts.build exists', () => {
        mockPackageJson(undefined, undefined, { build: 'tsc' });
        vi.mocked(existsSync).mockReturnValue(true);

        expect(projectHasBuildScript('/test')).toBe(true);
      });

      it('projectHasBuildScript should return false when scripts.build is missing', () => {
        mockPackageJson(undefined, undefined, { test: 'vitest' });
        vi.mocked(existsSync).mockReturnValue(true);

        expect(projectHasBuildScript('/test')).toBe(false);
      });
    });

    describe('YAML property ordering', () => {
      it('should output workflow properties in order: name, on, concurrency, jobs', () => {
        const config: VibeValidateConfig = {
          ...baseMockConfig,
          ci: {
            permissions: { contents: 'read' },
            concurrency: { group: 'ci-${{ github.ref }}', cancelInProgress: true },
            env: { CI: 'true' },
          },
        };

        const workflowYaml = generateWorkflow(config, { packageManager: 'pnpm' });

        // Find positions of top-level keys in the YAML output
        const namePos = workflowYaml.indexOf('\nname:');
        const onPos = workflowYaml.includes('\n"on":') ? workflowYaml.indexOf('\n"on":') : workflowYaml.indexOf('\non:');
        const concurrencyPos = workflowYaml.indexOf('\nconcurrency:');
        const jobsPos = workflowYaml.indexOf('\njobs:');

        expect(namePos).toBeLessThan(onPos);
        expect(onPos).toBeLessThan(concurrencyPos);
        expect(concurrencyPos).toBeLessThan(jobsPos);

        // permissions and env should NOT appear at workflow level
        // (they are on the validate job instead)
        expect(workflowYaml).not.toMatch(/^permissions:/m);
        expect(workflowYaml).not.toMatch(/^env:/m);
      });
    });
  });

  // Note: Subdirectory support tests moved to generate-workflow-subdirectory.system.test.ts
  // The tests require real filesystem operations which conflict with the fs mocking in this file.
  // See generate-workflow-subdirectory.system.test.ts for comprehensive subdirectory testing.
});

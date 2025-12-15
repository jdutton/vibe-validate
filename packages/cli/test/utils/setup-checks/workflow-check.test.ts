/**
 * Tests for workflow setup check
 *
 * Following TDD: These tests are written BEFORE the implementation.
 */

import { existsSync } from 'node:fs';
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { WorkflowSetupCheck } from '../../../src/utils/setup-checks/workflow-check.js';

describe('WorkflowSetupCheck', () => {
  let testDir: string;
  let workflowCheck: WorkflowSetupCheck;

  beforeEach(async () => {
    // Create unique temp directory for each test
    // eslint-disable-next-line sonarjs/pseudo-random -- Safe for test directory uniqueness
    testDir = join(tmpdir(), `vibe-validate-test-${Date.now()}-${Math.random()}`);
    await mkdir(testDir, { recursive: true });
    workflowCheck = new WorkflowSetupCheck();

    // Create minimal config file for workflow generation
    const configContent = `validation:
  phases:
    - name: Test Phase
      steps:
        - name: Test Step
          command: echo "test"
git:
  mainBranch: main
`;
    await writeFile(join(testDir, 'vibe-validate.config.yaml'), configContent);
  });

  afterEach(async () => {
    // Clean up test directory
    await rm(testDir, { recursive: true, force: true });
  });

  describe('check()', () => {
    it('should pass when .github/workflows/validate.yml exists', async () => {
      const workflowDir = join(testDir, '.github', 'workflows');
      const workflowPath = join(workflowDir, 'validate.yml');
      await mkdir(workflowDir, { recursive: true });
      await writeFile(workflowPath, 'name: Validate\non: [push]\njobs:\n  validate:\n    runs-on: ubuntu-latest\n');

      const result = await workflowCheck.check({ cwd: testDir });

      expect(result.passed).toBe(true);
      expect(result.message).toContain('workflow');
      expect(result.message).toContain('exists');
    });

    it('should fail when .github directory does not exist', async () => {
      const result = await workflowCheck.check({ cwd: testDir });

      expect(result.passed).toBe(false);
      expect(result.message).toContain('.github');
      expect(result.message).toContain('not found');
      expect(result.suggestion).toBeDefined();
    });

    it('should fail when .github/workflows directory does not exist', async () => {
      const githubDir = join(testDir, '.github');
      await mkdir(githubDir, { recursive: true });

      const result = await workflowCheck.check({ cwd: testDir });

      expect(result.passed).toBe(false);
      expect(result.message).toContain('workflows');
      expect(result.suggestion).toBeDefined();
    });

    it('should fail when validate.yml does not exist', async () => {
      const workflowDir = join(testDir, '.github', 'workflows');
      await mkdir(workflowDir, { recursive: true });

      const result = await workflowCheck.check({ cwd: testDir });

      expect(result.passed).toBe(false);
      expect(result.message).toContain('validate.yml');
      expect(result.message).toContain('not found');
      expect(result.suggestion).toBeDefined();
    });

    it('should use process.cwd() when no cwd option provided', async () => {
      const result = await workflowCheck.check();

      expect(result).toBeDefined();
      expect(typeof result.passed).toBe('boolean');
    });
  });

  describe('preview()', () => {
    it('should show creation of workflow file when not set up', async () => {
      const preview = await workflowCheck.preview({ cwd: testDir });

      expect(preview.description).toContain('Create');
      expect(preview.description).toContain('workflow');
      expect(preview.filesAffected).toContain('.github/workflows/validate.yml');
      expect(preview.changes).toBeDefined();
      expect(preview.changes?.[0].action).toBe('create');
      expect(preview.changes?.[0].content).toContain('vibe-validate');
    });

    it('should show no changes when workflow already exists', async () => {
      const workflowDir = join(testDir, '.github', 'workflows');
      const workflowPath = join(workflowDir, 'validate.yml');
      await mkdir(workflowDir, { recursive: true });
      await writeFile(workflowPath, 'name: Validate\n');

      const preview = await workflowCheck.preview({ cwd: testDir });

      expect(preview.description).toContain('already');
      expect(preview.filesAffected).toHaveLength(0);
      expect(preview.changes).toHaveLength(0);
    });
  });

  describe('fix()', () => {
    it('should create .github/workflows/validate.yml when not set up', async () => {
      const workflowPath = join(testDir, '.github', 'workflows', 'validate.yml');

      const result = await workflowCheck.fix({ cwd: testDir });

      expect(result.success).toBe(true);
      expect(result.message).toContain('Created');
      expect(result.filesChanged).toContain('.github/workflows/validate.yml');

      // Verify file was created with valid YAML content
      expect(existsSync(workflowPath)).toBe(true);
      const content = await readFile(workflowPath, 'utf-8');
      expect(content).toContain('name:');
      expect(content).toContain('on:');
      expect(content).toContain('jobs:');
      expect(content).toContain('vibe-validate');
    });

    it('should be idempotent - running twice produces same result', async () => {
      const workflowPath = join(testDir, '.github', 'workflows', 'validate.yml');

      // First run
      const result1 = await workflowCheck.fix({ cwd: testDir });
      expect(result1.success).toBe(true);

      const content1 = await readFile(workflowPath, 'utf-8');

      // Second run
      const result2 = await workflowCheck.fix({ cwd: testDir });
      expect(result2.success).toBe(true);

      const content2 = await readFile(workflowPath, 'utf-8');

      // Content should be identical
      expect(content2).toBe(content1);
    });

    it('should not overwrite existing workflow file', async () => {
      const workflowDir = join(testDir, '.github', 'workflows');
      const workflowPath = join(workflowDir, 'validate.yml');
      await mkdir(workflowDir, { recursive: true });
      const existingContent = 'name: Custom Validate\non: [push]\n';
      await writeFile(workflowPath, existingContent);

      const result = await workflowCheck.fix({ cwd: testDir });

      expect(result.success).toBe(true);
      expect(result.message).toContain('already');
      expect(result.filesChanged).toHaveLength(0);

      // Content should be unchanged
      const content = await readFile(workflowPath, 'utf-8');
      expect(content).toBe(existingContent);
    });

    it('should handle force option to overwrite existing workflow', async () => {
      const workflowDir = join(testDir, '.github', 'workflows');
      const workflowPath = join(workflowDir, 'validate.yml');
      await mkdir(workflowDir, { recursive: true });
      await writeFile(workflowPath, 'name: Old Workflow\n');

      const result = await workflowCheck.fix({ cwd: testDir, force: true });

      expect(result.success).toBe(true);
      expect(result.filesChanged).toContain('.github/workflows/validate.yml');

      // Content should be replaced with new workflow
      const content = await readFile(workflowPath, 'utf-8');
      expect(content).not.toContain('Old Workflow');
      expect(content).toContain('vibe-validate');
    });

    it('should handle dryRun option - no files modified', async () => {
      const workflowPath = join(testDir, '.github', 'workflows', 'validate.yml');

      const result = await workflowCheck.fix({ cwd: testDir, dryRun: true });

      expect(result.success).toBe(true);
      expect(result.message).toContain('dry-run');
      expect(result.filesChanged).toHaveLength(0);

      // File should not be created
      expect(existsSync(workflowPath)).toBe(false);
    });

    it('should generate valid GitHub Actions workflow YAML', async () => {
      const workflowPath = join(testDir, '.github', 'workflows', 'validate.yml');

      await workflowCheck.fix({ cwd: testDir });

      const content = await readFile(workflowPath, 'utf-8');

      // Basic structure checks
      expect(content).toContain('name:');
      expect(content).toContain('on:');
      expect(content).toContain('push:');
      expect(content).toContain('pull_request:');
      expect(content).toContain('jobs:');
      expect(content).toContain('runs-on:');
      expect(content).toContain('steps:');
      expect(content).toContain('actions/checkout');
      expect(content).toContain('actions/setup-node');
      expect(content).toContain('vibe-validate');
    });
  });

  describe('metadata', () => {
    it('should have correct id and name', () => {
      expect(workflowCheck.id).toBe('workflow');
      expect(workflowCheck.name).toBe('GitHub Actions Workflow Setup');
    });
  });
});

/**
 * Tests for init command focused modes
 *
 * Following TDD: These tests are written BEFORE the implementation.
 *
 * Tests cover the new focused init flags:
 * - --dry-run: Preview changes without writing files
 * - --setup-hooks: Install pre-commit hook only
 * - --setup-workflow: Create GitHub Actions workflow only
 * - --fix-gitignore: Add state file to .gitignore only
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { safeExecFromString } from '@vibe-validate/git';

describe('init command - focused modes', () => {
  let testDir: string;
  let cliPath: string;

  beforeEach(async () => {
    // Create unique temp directory for each test
    // eslint-disable-next-line sonarjs/pseudo-random -- Safe for test directory uniqueness
    testDir = join(tmpdir(), `vibe-validate-test-${Date.now()}-${Math.random()}`);
    await mkdir(testDir, { recursive: true });
    cliPath = join(__dirname, '../../dist/bin.js');
  });

  afterEach(async () => {
    // Clean up test directory
    await rm(testDir, { recursive: true, force: true });
  });

  describe('--dry-run', () => {
    it('should preview config creation without writing files', () => {
      const result = safeExecFromString(`node ${cliPath} init --dry-run`, {
        cwd: testDir,
        encoding: 'utf8',
      });

      // Should show preview
      expect(result).toContain('dry-run');
      expect(result).toContain('preview');

      // Should NOT create config file
      expect(existsSync(join(testDir, 'vibe-validate.config.yaml'))).toBe(false);
      expect(existsSync(join(testDir, 'vibe-validate.config.yaml'))).toBe(false);
    });

    it('should show what would be created in dry-run mode', () => {
      const result = safeExecFromString(`node ${cliPath} init --dry-run`, {
        cwd: testDir,
        encoding: 'utf8',
      });

      expect(result).toContain('Would create:');
      expect(result).toContain('vibe-validate.config.yaml');
    });
  });

  describe('--setup-hooks', () => {
    it('should create .husky/pre-commit hook', async () => {
      safeExecFromString(`node ${cliPath} init --setup-hooks`, {
        cwd: testDir,
      });

      const preCommitPath = join(testDir, '.husky', 'pre-commit');
      expect(existsSync(preCommitPath)).toBe(true);

      const content = await readFile(preCommitPath, 'utf-8');
      expect(content).toContain('vibe-validate pre-commit');
    });

    it('should be idempotent - running twice produces same result', async () => {
      // First run
      safeExecFromString(`node ${cliPath} init --setup-hooks`, {
        cwd: testDir,
      });

      const preCommitPath = join(testDir, '.husky', 'pre-commit');
      const content1 = await readFile(preCommitPath, 'utf-8');

      // Second run
      safeExecFromString(`node ${cliPath} init --setup-hooks`, {
        cwd: testDir,
      });

      const content2 = await readFile(preCommitPath, 'utf-8');

      // Content should be identical (no duplicates)
      expect(content2).toBe(content1);
    });

    it('should not create config file when only setting up hooks', () => {
      safeExecFromString(`node ${cliPath} init --setup-hooks`, {
        cwd: testDir,
      });

      // Config files should NOT be created
      expect(existsSync(join(testDir, 'vibe-validate.config.yaml'))).toBe(false);
      expect(existsSync(join(testDir, 'vibe-validate.config.yaml'))).toBe(false);
    });
  });

  describe('--setup-workflow', () => {
    it('should create .github/workflows/validate.yml', async () => {
      // Create minimal config first (required for workflow generation)
      await writeFile(
        join(testDir, 'vibe-validate.config.yaml'),
        'validation:\n  phases:\n    - name: Test\n      steps:\n        - name: Test\n          command: echo test\ngit:\n  mainBranch: main\n'
      );

      safeExecFromString(`node ${cliPath} init --setup-workflow`, {
        cwd: testDir,
      });

      const workflowPath = join(testDir, '.github', 'workflows', 'validate.yml');
      expect(existsSync(workflowPath)).toBe(true);

      const content = await readFile(workflowPath, 'utf-8');
      expect(content).toContain('vibe-validate');
      expect(content).toContain('name:');
      expect(content).toContain('on:');
    });

    it('should be idempotent - not overwrite existing workflow', async () => {
      await writeFile(
        join(testDir, 'vibe-validate.config.yaml'),
        'validation:\n  phases:\n    - name: Test\n      steps:\n        - name: Test\n          command: echo test\ngit:\n  mainBranch: main\n'
      );

      // First run
      safeExecFromString(`node ${cliPath} init --setup-workflow`, {
        cwd: testDir,
      });

      const workflowPath = join(testDir, '.github', 'workflows', 'validate.yml');
      const content1 = await readFile(workflowPath, 'utf-8');

      // Modify workflow
      await writeFile(workflowPath, '# Custom workflow\n' + content1);

      // Second run should NOT overwrite
      safeExecFromString(`node ${cliPath} init --setup-workflow`, {
        cwd: testDir,
      });

      const content2 = await readFile(workflowPath, 'utf-8');
      expect(content2).toContain('# Custom workflow');
    });

    it('should require config file to exist', () => {
      expect(() => {
        safeExecFromString(`node ${cliPath} init --setup-workflow`, {
          cwd: testDir,
          stdio: 'pipe',
        });
      }).toThrow();
    });
  });

  describe('--fix-gitignore (deprecated)', () => {
    it('should not create .gitignore (deprecated in v0.12.0)', async () => {
      safeExecFromString(`node ${cliPath} init --fix-gitignore`, {
        cwd: testDir,
      });

      // Should not create .gitignore (deprecated operation)
      const gitignorePath = join(testDir, '.gitignore');
      expect(existsSync(gitignorePath)).toBe(false);
    });

    it('should not modify existing .gitignore (deprecated in v0.12.0)', async () => {
      const gitignorePath = join(testDir, '.gitignore');
      const originalContent = 'node_modules/\n.env\n';
      await writeFile(gitignorePath, originalContent);

      safeExecFromString(`node ${cliPath} init --fix-gitignore`, {
        cwd: testDir,
      });

      // Content should remain unchanged
      const content = await readFile(gitignorePath, 'utf-8');
      expect(content).toBe(originalContent);
      expect(content).not.toContain('.vibe-validate-state.yaml');
    });
  });

  describe('combined flags', () => {
    it('should support multiple focused modes together', async () => {
      safeExecFromString(`node ${cliPath} init --setup-hooks --fix-gitignore`, {
        cwd: testDir,
      });

      // Hooks should be created
      expect(existsSync(join(testDir, '.husky', 'pre-commit'))).toBe(true);

      // .gitignore should NOT be created (--fix-gitignore deprecated in v0.12.0)
      expect(existsSync(join(testDir, '.gitignore'))).toBe(false);
    });

    it('should support dry-run with focused modes', () => {
      const result = safeExecFromString(`node ${cliPath} init --setup-hooks --dry-run`, {
        cwd: testDir,
        encoding: 'utf8',
      });

      expect(result).toContain('dry-run');

      // Should NOT create files
      expect(existsSync(join(testDir, '.husky', 'pre-commit'))).toBe(false);
    });
  });

});


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
import { mkdir, rm, writeFile, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { execSync } from 'child_process';

describe('init command - focused modes', () => {
  let testDir: string;
  let cliPath: string;

  beforeEach(async () => {
    // Create unique temp directory for each test
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
      const result = execSync(`node ${cliPath} init --dry-run`, {
        cwd: testDir,
        encoding: 'utf8',
      });

      // Should show preview
      expect(result).toContain('dry-run');
      expect(result).toContain('preview');

      // Should NOT create config file
      expect(existsSync(join(testDir, 'vibe-validate.config.yaml'))).toBe(false);
      expect(existsSync(join(testDir, 'vibe-validate.config.ts'))).toBe(false);
    });

    it('should show what would be created in dry-run mode', () => {
      const result = execSync(`node ${cliPath} init --dry-run`, {
        cwd: testDir,
        encoding: 'utf8',
      });

      expect(result).toContain('Would create:');
      expect(result).toContain('vibe-validate.config.yaml');
    });
  });

  describe('--setup-hooks', () => {
    it('should create .husky/pre-commit hook', async () => {
      execSync(`node ${cliPath} init --setup-hooks`, {
        cwd: testDir,
      });

      const preCommitPath = join(testDir, '.husky', 'pre-commit');
      expect(existsSync(preCommitPath)).toBe(true);

      const content = await readFile(preCommitPath, 'utf-8');
      expect(content).toContain('vibe-validate pre-commit');
    });

    it('should be idempotent - running twice produces same result', async () => {
      // First run
      execSync(`node ${cliPath} init --setup-hooks`, {
        cwd: testDir,
      });

      const preCommitPath = join(testDir, '.husky', 'pre-commit');
      const content1 = await readFile(preCommitPath, 'utf-8');

      // Second run
      execSync(`node ${cliPath} init --setup-hooks`, {
        cwd: testDir,
      });

      const content2 = await readFile(preCommitPath, 'utf-8');

      // Content should be identical (no duplicates)
      expect(content2).toBe(content1);
    });

    it('should not create config file when only setting up hooks', () => {
      execSync(`node ${cliPath} init --setup-hooks`, {
        cwd: testDir,
      });

      // Config files should NOT be created
      expect(existsSync(join(testDir, 'vibe-validate.config.yaml'))).toBe(false);
      expect(existsSync(join(testDir, 'vibe-validate.config.ts'))).toBe(false);
    });
  });

  describe('--setup-workflow', () => {
    it('should create .github/workflows/validate.yml', async () => {
      // Create minimal config first (required for workflow generation)
      await writeFile(
        join(testDir, 'vibe-validate.config.yaml'),
        'validation:\n  phases:\n    - name: Test\n      steps:\n        - name: Test\n          command: echo test\ngit:\n  mainBranch: main\n'
      );

      execSync(`node ${cliPath} init --setup-workflow`, {
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
      execSync(`node ${cliPath} init --setup-workflow`, {
        cwd: testDir,
      });

      const workflowPath = join(testDir, '.github', 'workflows', 'validate.yml');
      const content1 = await readFile(workflowPath, 'utf-8');

      // Modify workflow
      await writeFile(workflowPath, '# Custom workflow\n' + content1);

      // Second run should NOT overwrite
      execSync(`node ${cliPath} init --setup-workflow`, {
        cwd: testDir,
      });

      const content2 = await readFile(workflowPath, 'utf-8');
      expect(content2).toContain('# Custom workflow');
    });

    it('should require config file to exist', () => {
      expect(() => {
        execSync(`node ${cliPath} init --setup-workflow`, {
          cwd: testDir,
          stdio: 'pipe',
        });
      }).toThrow();
    });
  });

  describe('--fix-gitignore', () => {
    it('should create .gitignore with state file entry', async () => {
      execSync(`node ${cliPath} init --fix-gitignore`, {
        cwd: testDir,
      });

      const gitignorePath = join(testDir, '.gitignore');
      expect(existsSync(gitignorePath)).toBe(true);

      const content = await readFile(gitignorePath, 'utf-8');
      expect(content).toContain('.vibe-validate-state.yaml');
    });

    it('should add to existing .gitignore without duplicates', async () => {
      const gitignorePath = join(testDir, '.gitignore');
      await writeFile(gitignorePath, 'node_modules/\n.env\n');

      // First run
      execSync(`node ${cliPath} init --fix-gitignore`, {
        cwd: testDir,
      });

      let content = await readFile(gitignorePath, 'utf-8');
      expect(content).toContain('.vibe-validate-state.yaml');
      expect(content).toContain('node_modules/');

      // Second run should not add duplicate
      execSync(`node ${cliPath} init --fix-gitignore`, {
        cwd: testDir,
      });

      content = await readFile(gitignorePath, 'utf-8');
      const matches = content.match(/\.vibe-validate-state\.yaml/g);
      expect(matches?.length).toBe(1);
    });
  });

  describe('combined flags', () => {
    it('should support multiple focused modes together', async () => {
      execSync(`node ${cliPath} init --setup-hooks --fix-gitignore`, {
        cwd: testDir,
      });

      // Both should be created
      expect(existsSync(join(testDir, '.husky', 'pre-commit'))).toBe(true);
      expect(existsSync(join(testDir, '.gitignore'))).toBe(true);
    });

    it('should support dry-run with focused modes', () => {
      const result = execSync(`node ${cliPath} init --setup-hooks --dry-run`, {
        cwd: testDir,
        encoding: 'utf8',
      });

      expect(result).toContain('dry-run');

      // Should NOT create files
      expect(existsSync(join(testDir, '.husky', 'pre-commit'))).toBe(false);
    });
  });

});


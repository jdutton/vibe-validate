/**
 * Tests for gitignore setup check
 *
 * Following TDD: These tests are written BEFORE the implementation.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, readFile, rm } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { GitignoreSetupCheck } from '../../../src/utils/setup-checks/gitignore-check.js';

describe('GitignoreSetupCheck', () => {
  let testDir: string;
  let gitignoreCheck: GitignoreSetupCheck;

  beforeEach(async () => {
    // Create unique temp directory for each test
    testDir = join(tmpdir(), `vibe-validate-test-${Date.now()}-${Math.random()}`);
    await mkdir(testDir, { recursive: true });
    gitignoreCheck = new GitignoreSetupCheck();
  });

  afterEach(async () => {
    // Clean up test directory
    await rm(testDir, { recursive: true, force: true });
  });

  describe('check()', () => {
    it('should pass when .gitignore exists with state file entry', async () => {
      const gitignorePath = join(testDir, '.gitignore');
      await writeFile(gitignorePath, '.vibe-validate-state.yaml\nnode_modules/\n');

      const result = await gitignoreCheck.check({ cwd: testDir });

      expect(result.passed).toBe(true);
      expect(result.message).toContain('.gitignore');
      expect(result.message).toContain('state file');
    });

    it('should fail when .gitignore exists but missing state file entry', async () => {
      const gitignorePath = join(testDir, '.gitignore');
      await writeFile(gitignorePath, 'node_modules/\n.env\n');

      const result = await gitignoreCheck.check({ cwd: testDir });

      expect(result.passed).toBe(false);
      expect(result.message).toContain('missing');
      expect(result.suggestion).toBeDefined();
      expect(result.suggestion).toContain('.vibe-validate-state.yaml');
    });

    it('should fail when .gitignore does not exist', async () => {
      const result = await gitignoreCheck.check({ cwd: testDir });

      expect(result.passed).toBe(false);
      expect(result.message).toContain('.gitignore');
      expect(result.message).toContain('not found');
      expect(result.suggestion).toBeDefined();
    });

    it('should pass when state file entry exists with comments', async () => {
      const gitignorePath = join(testDir, '.gitignore');
      const content = `
# Node.js
node_modules/

# vibe-validate
.vibe-validate-state.yaml

# Environment
.env
`;
      await writeFile(gitignorePath, content);

      const result = await gitignoreCheck.check({ cwd: testDir });

      expect(result.passed).toBe(true);
    });

    it('should pass when state file entry has trailing whitespace', async () => {
      const gitignorePath = join(testDir, '.gitignore');
      await writeFile(gitignorePath, '.vibe-validate-state.yaml   \nnode_modules/\n');

      const result = await gitignoreCheck.check({ cwd: testDir });

      expect(result.passed).toBe(true);
    });

    it('should use process.cwd() when no cwd option provided', async () => {
      // This test verifies default behavior
      const result = await gitignoreCheck.check();

      // Should return a result (not throw)
      expect(result).toBeDefined();
      expect(typeof result.passed).toBe('boolean');
    });
  });

  describe('preview()', () => {
    it('should show creation of new .gitignore when file does not exist', async () => {
      const preview = await gitignoreCheck.preview({ cwd: testDir });

      expect(preview.description).toContain('Create');
      expect(preview.description).toContain('.gitignore');
      expect(preview.filesAffected).toContain('.gitignore');
      expect(preview.changes).toBeDefined();
      expect(preview.changes?.length).toBe(1);
      expect(preview.changes?.[0].action).toBe('create');
      expect(preview.changes?.[0].file).toBe('.gitignore');
      expect(preview.changes?.[0].content).toContain('.vibe-validate-state.yaml');
    });

    it('should show modification when .gitignore exists but missing entry', async () => {
      const gitignorePath = join(testDir, '.gitignore');
      const existingContent = 'node_modules/\n.env\n';
      await writeFile(gitignorePath, existingContent);

      const preview = await gitignoreCheck.preview({ cwd: testDir });

      expect(preview.description).toContain('Add');
      expect(preview.description).toContain('.vibe-validate-state.yaml');
      expect(preview.filesAffected).toContain('.gitignore');
      expect(preview.changes).toBeDefined();
      expect(preview.changes?.length).toBe(1);
      expect(preview.changes?.[0].action).toBe('modify');
      expect(preview.changes?.[0].file).toBe('.gitignore');
    });

    it('should show no changes needed when already configured', async () => {
      const gitignorePath = join(testDir, '.gitignore');
      await writeFile(gitignorePath, '.vibe-validate-state.yaml\nnode_modules/\n');

      const preview = await gitignoreCheck.preview({ cwd: testDir });

      expect(preview.description).toContain('already');
      expect(preview.filesAffected).toHaveLength(0);
      expect(preview.changes).toHaveLength(0);
    });
  });

  describe('fix()', () => {
    it('should create .gitignore with state file entry when file does not exist', async () => {
      const gitignorePath = join(testDir, '.gitignore');

      const result = await gitignoreCheck.fix({ cwd: testDir });

      expect(result.success).toBe(true);
      expect(result.message).toContain('Created');
      expect(result.filesChanged).toContain('.gitignore');

      // Verify file was created with correct content
      expect(existsSync(gitignorePath)).toBe(true);
      const content = await readFile(gitignorePath, 'utf-8');
      expect(content).toContain('.vibe-validate-state.yaml');
    });

    it('should add state file entry to existing .gitignore', async () => {
      const gitignorePath = join(testDir, '.gitignore');
      const existingContent = 'node_modules/\n.env\n';
      await writeFile(gitignorePath, existingContent);

      const result = await gitignoreCheck.fix({ cwd: testDir });

      expect(result.success).toBe(true);
      expect(result.message).toContain('Added');
      expect(result.filesChanged).toContain('.gitignore');

      // Verify entry was added while preserving existing content
      const content = await readFile(gitignorePath, 'utf-8');
      expect(content).toContain('.vibe-validate-state.yaml');
      expect(content).toContain('node_modules/');
      expect(content).toContain('.env');
    });

    it('should be idempotent - running twice produces same result', async () => {
      const gitignorePath = join(testDir, '.gitignore');

      // First run
      const result1 = await gitignoreCheck.fix({ cwd: testDir });
      expect(result1.success).toBe(true);

      const content1 = await readFile(gitignorePath, 'utf-8');

      // Second run
      const result2 = await gitignoreCheck.fix({ cwd: testDir });
      expect(result2.success).toBe(true);

      const content2 = await readFile(gitignorePath, 'utf-8');

      // Content should be identical
      expect(content2).toBe(content1);

      // Entry should only appear once
      const matches = content2.match(/\.vibe-validate-state\.yaml/g);
      expect(matches?.length).toBe(1);
    });

    it('should preserve existing content and formatting', async () => {
      const gitignorePath = join(testDir, '.gitignore');
      const existingContent = `# Node.js
node_modules/
npm-debug.log

# Environment
.env
.env.local
`;
      await writeFile(gitignorePath, existingContent);

      await gitignoreCheck.fix({ cwd: testDir });

      const content = await readFile(gitignorePath, 'utf-8');

      // Should preserve all existing content
      expect(content).toContain('# Node.js');
      expect(content).toContain('node_modules/');
      expect(content).toContain('npm-debug.log');
      expect(content).toContain('# Environment');
      expect(content).toContain('.env');
      expect(content).toContain('.env.local');

      // Should add state file entry
      expect(content).toContain('.vibe-validate-state.yaml');
    });

    it('should not modify file when entry already exists', async () => {
      const gitignorePath = join(testDir, '.gitignore');
      const existingContent = '.vibe-validate-state.yaml\nnode_modules/\n';
      await writeFile(gitignorePath, existingContent);

      const result = await gitignoreCheck.fix({ cwd: testDir });

      expect(result.success).toBe(true);
      expect(result.message).toContain('already');
      expect(result.filesChanged).toHaveLength(0);

      // Content should be unchanged
      const content = await readFile(gitignorePath, 'utf-8');
      expect(content).toBe(existingContent);
    });

    it('should handle force option when entry already exists', async () => {
      const gitignorePath = join(testDir, '.gitignore');
      await writeFile(gitignorePath, '.vibe-validate-state.yaml\nnode_modules/\n');

      const result = await gitignoreCheck.fix({ cwd: testDir, force: true });

      expect(result.success).toBe(true);
      // Force should still be idempotent - no duplicate entries
      const content = await readFile(gitignorePath, 'utf-8');
      const matches = content.match(/\.vibe-validate-state\.yaml/g);
      expect(matches?.length).toBe(1);
    });

    it('should handle dryRun option - no files modified', async () => {
      const gitignorePath = join(testDir, '.gitignore');

      const result = await gitignoreCheck.fix({ cwd: testDir, dryRun: true });

      expect(result.success).toBe(true);
      expect(result.message).toContain('dry-run');
      expect(result.filesChanged).toHaveLength(0);

      // File should not be created
      expect(existsSync(gitignorePath)).toBe(false);
    });
  });

  describe('metadata', () => {
    it('should have correct id and name', () => {
      expect(gitignoreCheck.id).toBe('gitignore');
      expect(gitignoreCheck.name).toBe('Gitignore Setup');
    });
  });
});

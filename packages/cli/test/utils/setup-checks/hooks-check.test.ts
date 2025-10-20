/**
 * Tests for hooks setup check
 *
 * Following TDD: These tests are written BEFORE the implementation.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdir, writeFile, readFile, rm, chmod } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { HooksSetupCheck } from '../../../src/utils/setup-checks/hooks-check.js';

describe('HooksSetupCheck', () => {
  let testDir: string;
  let hooksCheck: HooksSetupCheck;

  beforeEach(async () => {
    // Create unique temp directory for each test
    testDir = join(tmpdir(), `vibe-validate-test-${Date.now()}-${Math.random()}`);
    await mkdir(testDir, { recursive: true });
    hooksCheck = new HooksSetupCheck();
  });

  afterEach(async () => {
    // Clean up test directory
    await rm(testDir, { recursive: true, force: true });
  });

  describe('check()', () => {
    it('should pass when .husky/pre-commit exists with vibe-validate command', async () => {
      const huskyDir = join(testDir, '.husky');
      const preCommitPath = join(huskyDir, 'pre-commit');
      await mkdir(huskyDir, { recursive: true });
      await writeFile(preCommitPath, '#!/bin/sh\nnpx vibe-validate pre-commit\n');

      const result = await hooksCheck.check({ cwd: testDir });

      expect(result.passed).toBe(true);
      expect(result.message).toContain('pre-commit');
      expect(result.message).toContain('configured');
    });

    it('should fail when .husky directory does not exist', async () => {
      const result = await hooksCheck.check({ cwd: testDir });

      expect(result.passed).toBe(false);
      expect(result.message).toContain('.husky');
      expect(result.message).toContain('not found');
      expect(result.suggestion).toBeDefined();
      expect(result.suggestion).toContain('husky');
    });

    it('should fail when .husky/pre-commit does not exist', async () => {
      const huskyDir = join(testDir, '.husky');
      await mkdir(huskyDir, { recursive: true });

      const result = await hooksCheck.check({ cwd: testDir });

      expect(result.passed).toBe(false);
      expect(result.message).toContain('pre-commit');
      expect(result.message).toContain('not found');
      expect(result.suggestion).toBeDefined();
    });

    it('should fail when pre-commit exists but missing vibe-validate command', async () => {
      const huskyDir = join(testDir, '.husky');
      const preCommitPath = join(huskyDir, 'pre-commit');
      await mkdir(huskyDir, { recursive: true });
      await writeFile(preCommitPath, '#!/bin/sh\nnpm test\n');

      const result = await hooksCheck.check({ cwd: testDir });

      expect(result.passed).toBe(false);
      expect(result.message).toContain('missing');
      expect(result.message).toContain('vibe-validate');
      expect(result.suggestion).toBeDefined();
    });

    it('should pass when pre-commit has vibe-validate command with comments', async () => {
      const huskyDir = join(testDir, '.husky');
      const preCommitPath = join(huskyDir, 'pre-commit');
      await mkdir(huskyDir, { recursive: true });
      const content = `#!/bin/sh
# Pre-commit hook

# Run vibe-validate
npx vibe-validate pre-commit
`;
      await writeFile(preCommitPath, content);

      const result = await hooksCheck.check({ cwd: testDir });

      expect(result.passed).toBe(true);
    });

    it('should use process.cwd() when no cwd option provided', async () => {
      const result = await hooksCheck.check();

      expect(result).toBeDefined();
      expect(typeof result.passed).toBe('boolean');
    });
  });

  describe('preview()', () => {
    it('should show creation of .husky/pre-commit when not set up', async () => {
      const preview = await hooksCheck.preview({ cwd: testDir });

      expect(preview.description).toContain('Install');
      expect(preview.description).toContain('husky');
      expect(preview.description).toContain('pre-commit');
      expect(preview.filesAffected).toContain('.husky/pre-commit');
      expect(preview.changes).toBeDefined();
      expect(preview.changes?.[0].action).toBe('create');
      expect(preview.changes?.[0].content).toContain('vibe-validate pre-commit');
    });

    it('should show modification when pre-commit exists without vibe-validate', async () => {
      const huskyDir = join(testDir, '.husky');
      const preCommitPath = join(huskyDir, 'pre-commit');
      await mkdir(huskyDir, { recursive: true });
      await writeFile(preCommitPath, '#!/bin/sh\nnpm test\n');

      const preview = await hooksCheck.preview({ cwd: testDir });

      expect(preview.description).toContain('Add');
      expect(preview.description).toContain('vibe-validate');
      expect(preview.filesAffected).toContain('.husky/pre-commit');
      expect(preview.changes?.[0].action).toBe('modify');
    });

    it('should show no changes when already configured', async () => {
      const huskyDir = join(testDir, '.husky');
      const preCommitPath = join(huskyDir, 'pre-commit');
      await mkdir(huskyDir, { recursive: true });
      await writeFile(preCommitPath, '#!/bin/sh\nnpx vibe-validate pre-commit\n');

      const preview = await hooksCheck.preview({ cwd: testDir });

      expect(preview.description).toContain('already');
      expect(preview.filesAffected).toHaveLength(0);
      expect(preview.changes).toHaveLength(0);
    });

    it('should show package.json modification for husky installation', async () => {
      const preview = await hooksCheck.preview({ cwd: testDir });

      expect(preview.description).toContain('husky');
      // Note: We don't actually modify package.json, user should install husky manually
      // This is shown in the description
    });
  });

  describe('fix()', () => {
    it('should create .husky/pre-commit when directory does not exist', async () => {
      const huskyDir = join(testDir, '.husky');
      const preCommitPath = join(huskyDir, 'pre-commit');

      const result = await hooksCheck.fix({ cwd: testDir });

      expect(result.success).toBe(true);
      expect(result.message).toContain('Created');
      expect(result.filesChanged).toContain('.husky/pre-commit');

      // Verify file was created with correct content
      expect(existsSync(preCommitPath)).toBe(true);
      const content = await readFile(preCommitPath, 'utf-8');
      expect(content).toContain('vibe-validate pre-commit');
      expect(content).toContain('#!/bin/sh');
    });

    it('should add vibe-validate command to existing pre-commit hook', async () => {
      const huskyDir = join(testDir, '.husky');
      const preCommitPath = join(huskyDir, 'pre-commit');
      await mkdir(huskyDir, { recursive: true });
      const existingContent = '#!/bin/sh\nnpm test\n';
      await writeFile(preCommitPath, existingContent);

      const result = await hooksCheck.fix({ cwd: testDir });

      expect(result.success).toBe(true);
      expect(result.message).toContain('Added');
      expect(result.filesChanged).toContain('.husky/pre-commit');

      // Verify command was added while preserving existing content
      const content = await readFile(preCommitPath, 'utf-8');
      expect(content).toContain('vibe-validate pre-commit');
      expect(content).toContain('npm test');
    });

    it('should be idempotent - running twice produces same result', async () => {
      const preCommitPath = join(testDir, '.husky', 'pre-commit');

      // First run
      const result1 = await hooksCheck.fix({ cwd: testDir });
      expect(result1.success).toBe(true);

      const content1 = await readFile(preCommitPath, 'utf-8');

      // Second run
      const result2 = await hooksCheck.fix({ cwd: testDir });
      expect(result2.success).toBe(true);

      const content2 = await readFile(preCommitPath, 'utf-8');

      // Content should be identical
      expect(content2).toBe(content1);

      // Command should appear exactly twice (once in comment, once in actual command)
      const matches = content2.match(/vibe-validate pre-commit/g);
      expect(matches?.length).toBe(2);
    });

    it('should preserve existing hook content and formatting', async () => {
      const huskyDir = join(testDir, '.husky');
      const preCommitPath = join(huskyDir, 'pre-commit');
      await mkdir(huskyDir, { recursive: true });
      const existingContent = `#!/bin/sh
# Husky pre-commit hook

# Run linter
npm run lint

# Run tests
npm test
`;
      await writeFile(preCommitPath, existingContent);

      await hooksCheck.fix({ cwd: testDir });

      const content = await readFile(preCommitPath, 'utf-8');

      // Should preserve all existing content
      expect(content).toContain('# Husky pre-commit hook');
      expect(content).toContain('npm run lint');
      expect(content).toContain('npm test');

      // Should add vibe-validate command
      expect(content).toContain('vibe-validate pre-commit');
    });

    it('should not modify file when command already exists', async () => {
      const huskyDir = join(testDir, '.husky');
      const preCommitPath = join(huskyDir, 'pre-commit');
      await mkdir(huskyDir, { recursive: true });
      const existingContent = '#!/bin/sh\nnpx vibe-validate pre-commit\n';
      await writeFile(preCommitPath, existingContent);

      const result = await hooksCheck.fix({ cwd: testDir });

      expect(result.success).toBe(true);
      expect(result.message).toContain('already');
      expect(result.filesChanged).toHaveLength(0);

      // Content should be unchanged
      const content = await readFile(preCommitPath, 'utf-8');
      expect(content).toBe(existingContent);
    });

    it.skipIf(process.platform === 'win32')('should make pre-commit file executable (Unix only)', async () => {
      const preCommitPath = join(testDir, '.husky', 'pre-commit');

      await hooksCheck.fix({ cwd: testDir });

      // Check file permissions (should be executable)
      // Note: This test is skipped on Windows (no Unix permission bits)
      const stats = await import('fs/promises').then(fs => fs.stat(preCommitPath));
      const isExecutable = (stats.mode & 0o111) !== 0;
      expect(isExecutable).toBe(true);
    });

    it('should handle dryRun option - no files modified', async () => {
      const preCommitPath = join(testDir, '.husky', 'pre-commit');

      const result = await hooksCheck.fix({ cwd: testDir, dryRun: true });

      expect(result.success).toBe(true);
      expect(result.message).toContain('dry-run');
      expect(result.filesChanged).toHaveLength(0);

      // File should not be created
      expect(existsSync(preCommitPath)).toBe(false);
    });

    it('should show warning about installing husky as dependency', async () => {
      const result = await hooksCheck.fix({ cwd: testDir });

      expect(result.success).toBe(true);
      // Message should mention husky installation
      expect(result.message.toLowerCase()).toContain('husky');
    });
  });

  describe('metadata', () => {
    it('should have correct id and name', () => {
      expect(hooksCheck.id).toBe('hooks');
      expect(hooksCheck.name).toBe('Pre-commit Hook Setup');
    });
  });
});

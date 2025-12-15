/**
 * Tests for gitignore setup check (DEPRECATED)
 *
 * The state file (.vibe-validate-state.yaml) is deprecated in v0.12.0.
 * Validation history is now stored in git notes instead.
 * This check always passes and does not modify .gitignore.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import { GitignoreSetupCheck } from '../../../src/utils/setup-checks/gitignore-check.js';

describe('GitignoreSetupCheck (deprecated)', () => {
  let gitignoreCheck: GitignoreSetupCheck;

  beforeEach(() => {
    gitignoreCheck = new GitignoreSetupCheck();
  });

  describe('check()', () => {
    it('should always pass (deprecated check)', async () => {
      const result = await gitignoreCheck.check();

      expect(result.passed).toBe(true);
      expect(result.message).toContain('deprecated');
    });

    it('should pass regardless of cwd option', async () => {
      const result = await gitignoreCheck.check({ cwd: '/some/path' });

      expect(result.passed).toBe(true);
      expect(result.message).toContain('deprecated');
    });
  });

  describe('preview()', () => {
    it('should show no changes needed (deprecated)', async () => {
      const preview = await gitignoreCheck.preview();

      expect(preview.description).toContain('deprecated');
      expect(preview.filesAffected).toHaveLength(0);
      expect(preview.changes).toHaveLength(0);
    });

    it('should show no changes regardless of cwd', async () => {
      const preview = await gitignoreCheck.preview({ cwd: '/some/path' });

      expect(preview.description).toContain('deprecated');
      expect(preview.filesAffected).toHaveLength(0);
    });
  });

  describe('fix()', () => {
    it('should not modify any files (deprecated)', async () => {
      const result = await gitignoreCheck.fix();

      expect(result.success).toBe(true);
      expect(result.message).toContain('deprecated');
      expect(result.filesChanged).toHaveLength(0);
    });

    it('should not modify files even with force option', async () => {
      const result = await gitignoreCheck.fix({ force: true });

      expect(result.success).toBe(true);
      expect(result.filesChanged).toHaveLength(0);
    });

    it('should not modify files with dryRun option', async () => {
      const result = await gitignoreCheck.fix({ dryRun: true });

      expect(result.success).toBe(true);
      expect(result.filesChanged).toHaveLength(0);
    });
  });

  describe('metadata', () => {
    it('should have correct id', () => {
      expect(gitignoreCheck.id).toBe('gitignore');
    });

    it('should indicate deprecation in name', () => {
      expect(gitignoreCheck.name).toContain('deprecated');
    });
  });
});

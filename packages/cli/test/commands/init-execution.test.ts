/**
 * Tests for init command execution (dry-run and actual)
 *
 * Regression tests to ensure init command works correctly after
 * template location changes.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
  executeVibeValidateCombined as execCLI,
  executeVibeValidateWithError as execCLIWithError,
  setupTestDir,
  cleanupTestDir
} from '../helpers/cli-execution-helpers.js';

describe('init command execution (regression tests)', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = setupTestDir('vibe-validate-init-exec');
  });

  afterEach(() => {
    cleanupTestDir(testDir);
  });

  describe('dry-run mode', () => {
    it('should preview config creation without writing files (minimal template)', async () => {
      const output = await execCLI(['init', '--dry-run'], {
        cwd: testDir,
      });

      // Should show preview message
      expect(output).toContain('Configuration preview');
      expect(output).toContain('Would create');
      expect(output).toContain('vibe-validate.config.yaml');
      expect(output).toContain('minimal');

      // Should NOT actually create file
      expect(existsSync(join(testDir, 'vibe-validate.config.yaml'))).toBe(false);
    });

    it('should preview with typescript-library template', async () => {
      const output = await execCLI(['init', '--template', 'typescript-library', '--dry-run'], {
        cwd: testDir,
      });

      expect(output).toContain('typescript-library');
      expect(output).toContain('Would create');
      expect(existsSync(join(testDir, 'vibe-validate.config.yaml'))).toBe(false);
    });

    it('should preview with typescript-nodejs template', async () => {
      const output = await execCLI(['init', '--template', 'typescript-nodejs', '--dry-run'], {
        cwd: testDir,
      });

      expect(output).toContain('typescript-nodejs');
      expect(existsSync(join(testDir, 'vibe-validate.config.yaml'))).toBe(false);
    });

    it('should preview with typescript-react template', async () => {
      const output = await execCLI(['init', '--template', 'typescript-react', '--dry-run'], {
        cwd: testDir,
      });

      expect(output).toContain('typescript-react');
      expect(existsSync(join(testDir, 'vibe-validate.config.yaml'))).toBe(false);
    });

    it('should fail with clear error for non-existent template', async () => {
      const result = await execCLIWithError(['init', '--template', 'nonexistent', '--dry-run'], {
        cwd: testDir,
      });

      const output = result.stderr + result.stdout;
      expect(output).toContain('not found');
      expect(result.exitCode).toBe(1);
    });
  });

  describe('actual execution', () => {
    it('should create config file with minimal template', async () => {
      const output = await execCLI(['init'], {
        cwd: testDir,
      });

      // Should show success message
      expect(output).toContain('Created');
      expect(output).toContain('vibe-validate.config.yaml');

      // Should actually create file
      const configPath = join(testDir, 'vibe-validate.config.yaml');
      expect(existsSync(configPath)).toBe(true);

      // Config should be valid YAML
      const content = readFileSync(configPath, 'utf-8');
      expect(content).toContain('validation:');
      expect(content).toContain('phases:');
    });

    it.each([
      'typescript-library',
      'typescript-nodejs',
      'typescript-react'
    ])('should create valid config from %s template', async (template) => {
      await execCLI(['init', '--template', template], {
        cwd: testDir,
      });

      const configPath = join(testDir, 'vibe-validate.config.yaml');
      expect(existsSync(configPath)).toBe(true);

      // Validate the created config
      const validateOutput = await execCLI(['config', '--validate'], {
        cwd: testDir,
      });

      expect(validateOutput).toContain('Configuration is valid');
    });

    it('should not overwrite existing config without --force', async () => {
      // Create config first time
      await execCLI(['init'], {
        cwd: testDir,
      });

      // Try to create again without --force
      const result = await execCLIWithError(['init'], {
        cwd: testDir,
      });

      const output = result.stderr + result.stdout;
      expect(output).toContain('already exists');
      expect(result.exitCode).toBe(1);
    });

    it('should overwrite existing config with --force', async () => {
      // Create config first time
      await execCLI(['init', '--template', 'minimal'], {
        cwd: testDir,
      });

      // Overwrite with different template using --force
      const output = await execCLI(['init', '--template', 'typescript-library', '--force'], {
        cwd: testDir,
      });

      expect(output).toContain('Created');

      // Verify it was overwritten (should have library-specific content)
      const content = readFileSync(join(testDir, 'vibe-validate.config.yaml'), 'utf-8');
      // TypeScript library template has specific phases that minimal doesn't
      expect(content.length).toBeGreaterThan(500); // Library template is more comprehensive
    });
  });

  describe('template discovery', () => {
    it('should list available templates in error message for invalid template', async () => {
      const result = await execCLIWithError(['init', '--template', 'invalid', '--dry-run'], {
        cwd: testDir,
      });

      // Combine both stderr and stdout as some messages may go to either
      const output = result.stderr + result.stdout;

      // Should show available templates
      expect(output).toContain('Available templates');
      expect(output).toContain('minimal');
      expect(output).toContain('typescript-library');
      expect(output).toContain('typescript-nodejs');
      expect(output).toContain('typescript-react');
    });

    it('should show template list in help output', async () => {
      const output = await execCLI(['init', '--help'], {
        cwd: testDir,
      });

      // Should list available templates
      expect(output).toContain('minimal');
      expect(output).toContain('typescript-library');
      expect(output).toContain('typescript-nodejs');
      expect(output).toContain('typescript-react');
    });
  });
});

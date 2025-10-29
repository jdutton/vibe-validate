/**
 * Tests for init command execution (dry-run and actual)
 *
 * Regression tests to ensure init command works correctly after
 * template location changes.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

describe('init command execution (regression tests)', () => {
  let testDir: string;
  const cliPath = join(__dirname, '../../dist/bin.js');

  beforeEach(() => {
    // Create temp directory for test
    testDir = join(tmpdir(), `vibe-validate-init-exec-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    // Clean up test files
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('dry-run mode', () => {
    it('should preview config creation without writing files (minimal template)', () => {
      const output = execSync(`node "${cliPath}" init --dry-run`, {
        cwd: testDir,
        encoding: 'utf-8',
      });

      // Should show preview message
      expect(output).toContain('Configuration preview');
      expect(output).toContain('Would create');
      expect(output).toContain('vibe-validate.config.yaml');
      expect(output).toContain('minimal');

      // Should NOT actually create file
      expect(existsSync(join(testDir, 'vibe-validate.config.yaml'))).toBe(false);
    });

    it('should preview with typescript-library template', () => {
      const output = execSync(`node "${cliPath}" init --template typescript-library --dry-run`, {
        cwd: testDir,
        encoding: 'utf-8',
      });

      expect(output).toContain('typescript-library');
      expect(output).toContain('Would create');
      expect(existsSync(join(testDir, 'vibe-validate.config.yaml'))).toBe(false);
    });

    it('should preview with typescript-nodejs template', () => {
      const output = execSync(`node "${cliPath}" init --template typescript-nodejs --dry-run`, {
        cwd: testDir,
        encoding: 'utf-8',
      });

      expect(output).toContain('typescript-nodejs');
      expect(existsSync(join(testDir, 'vibe-validate.config.yaml'))).toBe(false);
    });

    it('should preview with typescript-react template', () => {
      const output = execSync(`node "${cliPath}" init --template typescript-react --dry-run`, {
        cwd: testDir,
        encoding: 'utf-8',
      });

      expect(output).toContain('typescript-react');
      expect(existsSync(join(testDir, 'vibe-validate.config.yaml'))).toBe(false);
    });

    it('should fail with clear error for non-existent template', () => {
      try {
        execSync(`node "${cliPath}" init --template nonexistent --dry-run`, {
          cwd: testDir,
          encoding: 'utf-8',
          stdio: 'pipe',
        });
        expect.fail('Should have thrown error for non-existent template');
      } catch (error: any) {
        const output = error.stderr || error.stdout || '';
        expect(output).toContain('not found');
        expect(error.status).toBe(1);
      }
    });
  });

  describe('actual execution', () => {
    it('should create config file with minimal template', () => {
      const output = execSync(`node "${cliPath}" init`, {
        cwd: testDir,
        encoding: 'utf-8',
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

    it('should create valid config from typescript-library template', () => {
      execSync(`node "${cliPath}" init --template typescript-library`, {
        cwd: testDir,
        encoding: 'utf-8',
      });

      const configPath = join(testDir, 'vibe-validate.config.yaml');
      expect(existsSync(configPath)).toBe(true);

      // Validate the created config
      const validateOutput = execSync(`node "${cliPath}" config --validate`, {
        cwd: testDir,
        encoding: 'utf-8',
      });

      expect(validateOutput).toContain('Configuration is valid');
    });

    it('should create valid config from typescript-nodejs template', () => {
      execSync(`node "${cliPath}" init --template typescript-nodejs`, {
        cwd: testDir,
        encoding: 'utf-8',
      });

      const configPath = join(testDir, 'vibe-validate.config.yaml');
      expect(existsSync(configPath)).toBe(true);

      // Validate the created config
      const validateOutput = execSync(`node "${cliPath}" config --validate`, {
        cwd: testDir,
        encoding: 'utf-8',
      });

      expect(validateOutput).toContain('Configuration is valid');
    });

    it('should create valid config from typescript-react template', () => {
      execSync(`node "${cliPath}" init --template typescript-react`, {
        cwd: testDir,
        encoding: 'utf-8',
      });

      const configPath = join(testDir, 'vibe-validate.config.yaml');
      expect(existsSync(configPath)).toBe(true);

      // Validate the created config
      const validateOutput = execSync(`node "${cliPath}" config --validate`, {
        cwd: testDir,
        encoding: 'utf-8',
      });

      expect(validateOutput).toContain('Configuration is valid');
    });

    it('should not overwrite existing config without --force', () => {
      // Create config first time
      execSync(`node "${cliPath}" init`, {
        cwd: testDir,
        encoding: 'utf-8',
      });

      // Try to create again without --force
      try {
        execSync(`node "${cliPath}" init`, {
          cwd: testDir,
          encoding: 'utf-8',
          stdio: 'pipe',
        });
        expect.fail('Should have thrown error for existing config');
      } catch (error: any) {
        const output = error.stderr || error.stdout || '';
        expect(output).toContain('already exists');
        expect(error.status).toBe(1);
      }
    });

    it('should overwrite existing config with --force', () => {
      // Create config first time
      execSync(`node "${cliPath}" init --template minimal`, {
        cwd: testDir,
        encoding: 'utf-8',
      });

      // Overwrite with different template using --force
      const output = execSync(`node "${cliPath}" init --template typescript-library --force`, {
        cwd: testDir,
        encoding: 'utf-8',
      });

      expect(output).toContain('Created');

      // Verify it was overwritten (should have library-specific content)
      const content = readFileSync(join(testDir, 'vibe-validate.config.yaml'), 'utf-8');
      // TypeScript library template has specific phases that minimal doesn't
      expect(content.length).toBeGreaterThan(500); // Library template is more comprehensive
    });
  });

  describe('template discovery', () => {
    it('should list available templates in error message for invalid template', () => {
      try {
        execSync(`node "${cliPath}" init --template invalid --dry-run`, {
          cwd: testDir,
          encoding: 'utf-8',
          stdio: 'pipe',
        });
        expect.fail('Should have thrown error');
      } catch (error: any) {
        // Combine both stderr and stdout as some messages may go to either
        const output = (error.stderr || '') + (error.stdout || '');

        // Should show available templates
        expect(output).toContain('Available templates');
        expect(output).toContain('minimal');
        expect(output).toContain('typescript-library');
        expect(output).toContain('typescript-nodejs');
        expect(output).toContain('typescript-react');
      }
    });

    it('should show template list in help output', () => {
      const output = execSync(`node "${cliPath}" init --help`, {
        cwd: testDir,
        encoding: 'utf-8',
      });

      // Should list available templates
      expect(output).toContain('minimal');
      expect(output).toContain('typescript-library');
      expect(output).toContain('typescript-nodejs');
      expect(output).toContain('typescript-react');
    });
  });
});

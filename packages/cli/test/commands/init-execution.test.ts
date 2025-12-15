/**
 * Tests for init command execution (dry-run and actual)
 *
 * Regression tests to ensure init command works correctly after
 * template location changes.
 */

import { mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { safeExecSync, safeExecResult } from '@vibe-validate/utils';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

/**
 * Execute CLI command and return combined output
 * @throws Error with status, stdout, stderr for failures
 */
function execCLI(cliPath: string, args: string[], options?: { cwd?: string; encoding?: BufferEncoding }): string {
  try {
    return safeExecSync('node', [cliPath, ...args], { encoding: 'utf-8', ...options }) as string;
  } catch (err: any) {
    // For successful non-zero exits (like help commands), return output
    if (err.stdout || err.stderr) {
      return (err.stdout || '') + (err.stderr || '');
    }
    throw err;
  }
}

/**
 * Execute CLI command and return separated stdout/stderr
 * Used for testing error handling
 */
function execCLIWithError(cliPath: string, args: string[], options?: { cwd?: string; encoding?: BufferEncoding }): { stdout: string; stderr: string; status: number | null } {
  const result = safeExecResult('node', [cliPath, ...args], { encoding: 'utf-8', ...options });
  return {
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
    status: result.status ?? null
  };
}

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
      const output = execCLI(cliPath, ['init', '--dry-run'], {
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

    it('should preview with typescript-library template', () => {
      const output = execCLI(cliPath, ['init', '--template', 'typescript-library', '--dry-run'], {
        cwd: testDir,
      });

      expect(output).toContain('typescript-library');
      expect(output).toContain('Would create');
      expect(existsSync(join(testDir, 'vibe-validate.config.yaml'))).toBe(false);
    });

    it('should preview with typescript-nodejs template', () => {
      const output = execCLI(cliPath, ['init', '--template', 'typescript-nodejs', '--dry-run'], {
        cwd: testDir,
      });

      expect(output).toContain('typescript-nodejs');
      expect(existsSync(join(testDir, 'vibe-validate.config.yaml'))).toBe(false);
    });

    it('should preview with typescript-react template', () => {
      const output = execCLI(cliPath, ['init', '--template', 'typescript-react', '--dry-run'], {
        cwd: testDir,
      });

      expect(output).toContain('typescript-react');
      expect(existsSync(join(testDir, 'vibe-validate.config.yaml'))).toBe(false);
    });

    it('should fail with clear error for non-existent template', () => {
      const result = execCLIWithError(cliPath, ['init', '--template', 'nonexistent', '--dry-run'], {
        cwd: testDir,
      });

      const output = result.stderr + result.stdout;
      expect(output).toContain('not found');
      expect(result.status).toBe(1);
    });
  });

  describe('actual execution', () => {
    it('should create config file with minimal template', () => {
      const output = execCLI(cliPath, ['init'], {
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

    it('should create valid config from typescript-library template', () => {
      execCLI(cliPath, ['init', '--template', 'typescript-library'], {
        cwd: testDir,
      });

      const configPath = join(testDir, 'vibe-validate.config.yaml');
      expect(existsSync(configPath)).toBe(true);

      // Validate the created config
      const validateOutput = execCLI(cliPath, ['config', '--validate'], {
        cwd: testDir,
      });

      expect(validateOutput).toContain('Configuration is valid');
    });

    it('should create valid config from typescript-nodejs template', () => {
      execCLI(cliPath, ['init', '--template', 'typescript-nodejs'], {
        cwd: testDir,
      });

      const configPath = join(testDir, 'vibe-validate.config.yaml');
      expect(existsSync(configPath)).toBe(true);

      // Validate the created config
      const validateOutput = execCLI(cliPath, ['config', '--validate'], {
        cwd: testDir,
      });

      expect(validateOutput).toContain('Configuration is valid');
    });

    it('should create valid config from typescript-react template', () => {
      execCLI(cliPath, ['init', '--template', 'typescript-react'], {
        cwd: testDir,
      });

      const configPath = join(testDir, 'vibe-validate.config.yaml');
      expect(existsSync(configPath)).toBe(true);

      // Validate the created config
      const validateOutput = execCLI(cliPath, ['config', '--validate'], {
        cwd: testDir,
      });

      expect(validateOutput).toContain('Configuration is valid');
    });

    it('should not overwrite existing config without --force', () => {
      // Create config first time
      execCLI(cliPath, ['init'], {
        cwd: testDir,
      });

      // Try to create again without --force
      const result = execCLIWithError(cliPath, ['init'], {
        cwd: testDir,
      });

      const output = result.stderr + result.stdout;
      expect(output).toContain('already exists');
      expect(result.status).toBe(1);
    });

    it('should overwrite existing config with --force', () => {
      // Create config first time
      execCLI(cliPath, ['init', '--template', 'minimal'], {
        cwd: testDir,
      });

      // Overwrite with different template using --force
      const output = execCLI(cliPath, ['init', '--template', 'typescript-library', '--force'], {
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
    it('should list available templates in error message for invalid template', () => {
      const result = execCLIWithError(cliPath, ['init', '--template', 'invalid', '--dry-run'], {
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

    it('should show template list in help output', () => {
      const output = execCLI(cliPath, ['init', '--help'], {
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

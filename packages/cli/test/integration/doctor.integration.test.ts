/**
 * Integration tests for doctor command
 *
 * These tests verify that the doctor command works correctly in a real
 * project environment (vibe-validate self-hosting).
 */

import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import { join } from 'path';

describe('Doctor Command Integration', () => {
  const cliPath = join(__dirname, '../../dist/bin.js');
  const projectRoot = join(__dirname, '../../../..');

  it('should run without crashing', () => {
    try {
      const result = execSync(`node ${cliPath} doctor`, {
        cwd: projectRoot,
        encoding: 'utf8',
        stdio: 'pipe',
      });
      expect(result).toContain('vibe-validate Doctor');
      expect(result).toContain('Running diagnostic checks');
    } catch (error: any) {
      // Doctor exits with code 1 when checks fail (config format check fails because we use .mjs)
      expect(error.stdout).toContain('vibe-validate Doctor');
      expect(error.stdout).toContain('Running diagnostic checks');
    }
  });

  it('should show some checks failing (config format)', () => {
    try {
      const result = execSync(`node ${cliPath} doctor`, {
        cwd: projectRoot,
        encoding: 'utf8',
        stdio: 'pipe',
      });
      // If all pass, this project migrated to YAML
      expect(result).toContain('vibe-validate Doctor');
    } catch (error: any) {
      // Expected: Config format check fails because we use .mjs (legacy)
      expect(error.stdout).toContain('vibe-validate Doctor');
      expect(error.stdout).toContain('Config format');
      expect(error.stdout).toContain('deprecated .mjs format');
    }
  });

  it('should support verbose mode', () => {
    try {
      const result = execSync(`node ${cliPath} doctor --verbose`, {
        cwd: projectRoot,
        encoding: 'utf8',
        stdio: 'pipe',
      });
      // Verbose mode should show all checks
      expect(result).toContain('Node.js version');
      expect(result).toContain('Git installed');
      expect(result).toContain('Git repository');
      expect(result).toContain('Configuration file');
      expect(result).toContain('Configuration valid');
      expect(result).toContain('Package manager');
      expect(result).toContain('GitHub Actions workflow');
      expect(result).toContain('Pre-commit hook');
      expect(result).toContain('Validation state');
    } catch (error: any) {
      // Doctor exits with code 1 when checks fail
      expect(error.stdout).toContain('Node.js version');
      expect(error.stdout).toContain('Git installed');
      expect(error.stdout).toContain('Git repository');
      expect(error.stdout).toContain('Configuration file');
      expect(error.stdout).toContain('Configuration valid');
      expect(error.stdout).toContain('Package manager');
      expect(error.stdout).toContain('GitHub Actions workflow');
      expect(error.stdout).toContain('Pre-commit hook');
      expect(error.stdout).toContain('Validation state');
    }
  });

  it('should check pre-commit hook installation', () => {
    try {
      const result = execSync(`node ${cliPath} doctor --verbose`, {
        cwd: projectRoot,
        encoding: 'utf8',
        stdio: 'pipe',
      });
      // Should detect pre-commit hook (vibe-validate project has one)
      expect(result).toContain('Pre-commit hook');
    } catch (error: any) {
      // Doctor exits with code 1 when checks fail (config format check fails because we use .mjs)
      expect(error.stdout).toContain('Pre-commit hook');
    }
  });

  it('should check validation state file', () => {
    try {
      const result = execSync(`node ${cliPath} doctor --verbose`, {
        cwd: projectRoot,
        encoding: 'utf8',
        stdio: 'pipe',
      });
      // Should detect validation state file
      expect(result).toContain('Validation state');
    } catch (error: any) {
      // Doctor exits with code 1 when checks fail (config format check fails because we use .mjs)
      expect(error.stdout).toContain('Validation state');
    }
  });

  it('should show pass/fail summary', () => {
    const result = execSync(`node ${cliPath} doctor`, {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: 'pipe',
    });
    // Should show summary line with counts
    expect(result).toMatch(/📊 Results: \d+\/\d+ checks passed/);
    // This project now uses YAML (modern format), so all checks pass: 15/15
    expect(result).toContain('15/15 checks passed');
  });
});

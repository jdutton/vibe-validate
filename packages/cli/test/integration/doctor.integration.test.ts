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
    const result = execSync(`node ${cliPath} doctor`, {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: 'pipe',
    });

    expect(result).toContain('vibe-validate Doctor');
    expect(result).toContain('Running diagnostic checks');
  });

  it('should pass all checks', () => {
    const result = execSync(`node ${cliPath} doctor`, {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: 'pipe',
    });

    expect(result).toContain('vibe-validate Doctor');
    expect(result).toContain('All checks passed');
  });

  it('should support verbose mode', () => {
    const result = execSync(`node ${cliPath} doctor --verbose`, {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: 'pipe',
    });

    // Verbose mode should show all checks
    expect(result).toContain('verbose mode');
    expect(result).toContain('Node.js version');
    expect(result).toContain('Git installed');
    expect(result).toContain('Git repository');
    expect(result).toContain('Configuration file');
    expect(result).toContain('Configuration valid');
    expect(result).toContain('Package manager');
    expect(result).toContain('GitHub Actions workflow');
    expect(result).toContain('Pre-commit hook');
    expect(result).toContain('Validation state');
  });

  it('should check pre-commit hook installation', () => {
    const result = execSync(`node ${cliPath} doctor`, {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: 'pipe',
    });

    // Should detect pre-commit hook (vibe-validate project has one)
    expect(result).toContain('Pre-commit hook');
  });

  it('should check validation state file', () => {
    const result = execSync(`node ${cliPath} doctor`, {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: 'pipe',
    });

    // Should detect validation state file
    expect(result).toContain('Validation state');
  });

  it('should show pass/fail summary', () => {
    const result = execSync(`node ${cliPath} doctor`, {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: 'pipe',
    });

    // Should show summary line with counts
    expect(result).toMatch(/📊 Results: \d+\/\d+ checks passed/);
    expect(result).toContain('9/9 checks passed');
  });
});

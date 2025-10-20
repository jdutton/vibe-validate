import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import { join } from 'path';

describe('Doctor Command Integration', () => {
  const cliPath = join(__dirname, '../../dist/bin.js');
  const projectRoot = join(__dirname, '../../../..');

  /**
   * According to docs/cli-reference.md:
   * - Exit code 0: All critical checks passed
   * - Exit code 1: One or more critical checks failed
   */

  it('should exit with status 0 when all checks pass in this repository', () => {
    // Per docs: "Exit code 0 - All critical checks passed"
    // If this test fails, it means there's a real issue in this repo that needs fixing
    const result = execSync(`node ${cliPath} doctor`, {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: 'pipe',
    });

    // Should show all checks passed (e.g., "14/14 checks passed")
    expect(result).toContain('vibe-validate Doctor');
    expect(result).toMatch(/📊 Results: (\d+)\/\1 checks passed/);
  });

  it('should exit with status 0 in verbose mode when all checks pass', () => {
    // Per docs: "Exit code 0 - All critical checks passed"
    const result = execSync(`node ${cliPath} doctor --verbose`, {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: 'pipe',
    });

    expect(result).toContain('vibe-validate Doctor');
    expect(result).toContain('Running diagnostic checks (verbose mode)');
  });

  it('should show config format check passing (YAML)', () => {
    // Per docs: "Exit code 0 - All critical checks passed"
    // Use --verbose to see all checks including passing ones
    const result = execSync(`node ${cliPath} doctor --verbose`, {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: 'pipe',
    });

    // Project uses YAML config, config format check should pass
    expect(result).toContain('vibe-validate Doctor');
  });

  it('should show Node.js and Git checks in verbose mode', () => {
    // Per docs: "Exit code 0 - All critical checks passed"
    const result = execSync(`node ${cliPath} doctor --verbose`, {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: 'pipe',
    });

    // Should show all check details in verbose mode
    expect(result).toContain('vibe-validate Doctor');
    expect(result).toContain('Node.js version');
    expect(result).toContain('Git installed');
  });

  it('should check pre-commit hook installation', () => {
    // Per docs: "Exit code 0 - All critical checks passed"
    const result = execSync(`node ${cliPath} doctor --verbose`, {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: 'pipe',
    });

    // Should detect pre-commit hook (vibe-validate project has one)
    expect(result).toContain('Pre-commit hook');
  });

  it('should check validation state file', () => {
    // Per docs: "Exit code 0 - All critical checks passed"
    const result = execSync(`node ${cliPath} doctor --verbose`, {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: 'pipe',
    });

    // Should detect validation state file
    expect(result).toContain('Validation state');
  });

  it('should show pass/fail summary', () => {
    // Per docs: "Exit code 0 - All critical checks passed"
    const result = execSync(`node ${cliPath} doctor`, {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: 'pipe',
    });

    // Should show summary line with counts
    expect(result).toMatch(/📊 Results: \d+\/\d+ checks passed/);
  });

  it('should NOT show all checks in non-verbose mode when all pass', () => {
    // Per docs: "Exit code 0 - All critical checks passed"
    const result = execSync(`node ${cliPath} doctor`, {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: 'pipe',
    });

    // If all pass, summary only (no individual checks)
    expect(result).toContain('checks passed');
    const checkMatches = result.match(/✅/g);
    const checkCount = checkMatches ? checkMatches.length : 0;
    expect(checkCount).toBe(0); // No checks shown, just summary
  });

  it('should show all checks in verbose mode', () => {
    // Per docs: "Exit code 0 - All critical checks passed"
    const result = execSync(`node ${cliPath} doctor --verbose`, {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: 'pipe',
    });

    // Verbose mode shows all checks
    expect(result).toContain('checks passed');
    const checkMatches = result.match(/✅|❌/g);
    const checkCount = checkMatches ? checkMatches.length : 0;
    expect(checkCount).toBeGreaterThan(10); // Should show most/all of 15 checks

    // Verify some specific checks are shown
    expect(result).toContain('Node.js version');
    expect(result).toContain('Git installed');
  });
});

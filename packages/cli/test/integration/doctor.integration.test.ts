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

  /**
   * Helper to execute CLI and capture output/errors
   */
  function executeCLI(args: string[]): { stdout: string; stderr: string; exitCode: number } {
    try {
      const stdout = execSync(`node "${cliPath}" ${args.join(' ')}`, {
        cwd: projectRoot,
        encoding: 'utf8',
        stdio: 'pipe',
      });
      return { stdout, stderr: '', exitCode: 0 };
    } catch (error: any) {
      // execSync throws on non-zero exit, but we want to see the output
      return {
        stdout: error.stdout || '',
        stderr: error.stderr || '',
        exitCode: error.status || 1,
      };
    }
  }

  /**
   * Helper to run doctor command and assert successful execution
   */
  function expectDoctorSuccess(args: string[] = []): string {
    const result = executeCLI(['doctor', ...args]);

    // Debug output if test fails
    if (result.exitCode !== 0) {
      console.error('Doctor command failed!');
      console.error('Exit code:', result.exitCode);
      console.error('STDOUT:', result.stdout);
      console.error('STDERR:', result.stderr);
    }

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('vibe-validate Doctor');

    return result.stdout;
  }

  it('should exit with status 0 when all checks pass in this repository', () => {
    // Per docs: "Exit code 0 - All critical checks passed"
    // If this test fails, it means there's a real issue in this repo that needs fixing
    const stdout = expectDoctorSuccess();

    // Should show all checks passed (e.g., "14/14 checks passed")
    expect(stdout).toMatch(/📊 Results: (\d+)\/\1 checks passed/);
  }, 100); // DELIBERATE BUG: Reduced timeout to test watch-pr failure detection

  it('should exit with status 0 in verbose mode when all checks pass', () => {
    // Per docs: "Exit code 0 - All critical checks passed"
    const stdout = expectDoctorSuccess(['--verbose']);

    expect(stdout).toContain('Running diagnostic checks (verbose mode)');
  }, 30000);

  it('should show config format check passing (YAML)', () => {
    // Per docs: "Exit code 0 - All critical checks passed"
    // Use --verbose to see all checks including passing ones
    // Project uses YAML config, config format check should pass
    expectDoctorSuccess(['--verbose']);
  }, 30000);

  it('should show Node.js and Git checks in verbose mode', () => {
    // Per docs: "Exit code 0 - All critical checks passed"
    const stdout = expectDoctorSuccess(['--verbose']);

    // Should show all check details in verbose mode
    expect(stdout).toContain('Node.js version');
    expect(stdout).toContain('Git installed');
  }, 30000);

  it('should check pre-commit hook installation', () => {
    // Per docs: "Exit code 0 - All critical checks passed"
    const stdout = expectDoctorSuccess(['--verbose']);

    // Should detect pre-commit hook (vibe-validate project has one)
    expect(stdout).toContain('Pre-commit hook');
  }, 30000);

  it('should check validation state file', () => {
    // Per docs: "Exit code 0 - All critical checks passed"
    const stdout = expectDoctorSuccess(['--verbose']);

    // Should detect validation state file
    expect(stdout).toContain('Validation state');
  }, 30000);

  it('should show pass/fail summary', () => {
    // Per docs: "Exit code 0 - All critical checks passed"
    const stdout = expectDoctorSuccess();

    // Should show summary line with counts
    expect(stdout).toMatch(/📊 Results: \d+\/\d+ checks passed/);
  }, 30000);

  it('should NOT show all checks in non-verbose mode when all pass', () => {
    // Per docs: "Exit code 0 - All critical checks passed"
    const stdout = expectDoctorSuccess();

    // If all pass, summary only (no individual checks)
    expect(stdout).toContain('checks passed');
    const checkMatches = stdout.match(/✅/g);
    const checkCount = checkMatches ? checkMatches.length : 0;
    expect(checkCount).toBe(0); // No checks shown, just summary
  }, 30000);

  it('should show all checks in verbose mode', () => {
    // Per docs: "Exit code 0 - All critical checks passed"
    const stdout = expectDoctorSuccess(['--verbose']);

    // Verbose mode shows all checks
    expect(stdout).toContain('checks passed');
    const checkMatches = stdout.match(/✅|❌/g);
    const checkCount = checkMatches ? checkMatches.length : 0;
    expect(checkCount).toBeGreaterThan(10); // Should show most/all of 15 checks

    // Verify some specific checks are shown
    expect(stdout).toContain('Node.js version');
    expect(stdout).toContain('Git installed');
  }, 30000);
});

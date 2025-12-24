import { join } from 'node:path';

import { describe, it, expect } from 'vitest';

import { executeVibeValidateWithError } from '../helpers/cli-execution-helpers.js';

// Doctor integration tests - verifies CLI works end-to-end with real npm registry
// IMPORTANT: Only ONE test to avoid network calls (7-8s each). Other tests moved to unit tests.
describe('Doctor Command Integration', () => {
  const projectRoot = join(__dirname, '../../../..');

  /**
   * According to docs/cli-reference.md:
   * - Exit code 0: All critical checks passed
   * - Exit code 1: One or more critical checks failed
   */

  /**
   * Helper to run doctor command and assert successful execution
   */
  async function expectDoctorSuccess(args: string[] = []): Promise<string> {
    const result = await executeVibeValidateWithError(['doctor', ...args], {
      cwd: projectRoot,
      timeout: 15000, // 15s timeout - prevents hung processes
    });

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

  it('should exit with status 0 when all checks pass (real npm check)', async () => {
    // Per docs: "Exit code 0 - All critical checks passed"
    // This is the ONLY integration test that hits real npm registry
    // Other tests moved to unit tests with mocked version checker (see doctor.test.ts)
    const stdout = await expectDoctorSuccess(['--verbose']); // Use --verbose to see version check

    // Should show all checks passed (e.g., "17/17 checks passed")
    expect(stdout).toMatch(/📊 Results: (\d+)\/\1 checks passed/);

    // Verify it actually checked npm version (proves it's not mocked)
    expect(stdout).toContain('vibe-validate version');
  }, 15000); // 15s timeout - includes network call to npm registry (~7s)
});

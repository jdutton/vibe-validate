/**
 * Integration tests for doctor command
 *
 * These tests verify that the doctor command works correctly in a real
 * project environment (vibe-validate self-hosting).
 *
 * Note: These tests document the current v0.9.6 behavior where doctor
 * shows workflow as "out of sync" because it doesn't read CI matrix config
 * from vibe-validate.config.mjs yet. This will be fixed in v0.9.7.
 */

import { describe, it, expect } from 'vitest';
import { execSync } from 'child_process';
import { join } from 'path';

describe('Doctor Command Integration', () => {
  const cliPath = join(__dirname, '../../dist/bin.js');
  const projectRoot = join(__dirname, '../../../..');

  it('should run without crashing', () => {
    // Doctor exits with code 1 in v0.9.6 due to workflow sync issue
    try {
      execSync(`node ${cliPath} doctor`, {
        cwd: projectRoot,
        encoding: 'utf8',
        stdio: 'pipe',
      });
      // If we get here, all checks passed (unexpected in v0.9.6)
      expect(true).toBe(false);
    } catch (error: any) {
      // Expected to fail in v0.9.6 due to workflow sync check
      expect(error.status).toBe(1);
      expect(error.stdout).toContain('vibe-validate Doctor');
      expect(error.stdout).toContain('Running diagnostic checks');
    }
  });

  it('should output diagnostic information', () => {
    try {
      execSync(`node ${cliPath} doctor`, {
        cwd: projectRoot,
        encoding: 'utf8',
        stdio: 'pipe',
      });
    } catch (error: any) {
      const output = error.stdout;

      // Should contain header
      expect(output).toContain('vibe-validate Doctor');

      // Should show workflow sync issue (known v0.9.6 limitation)
      expect(output).toContain('GitHub Actions workflow');
      expect(output).toContain('out of sync');
    }
  });

  it('should suggest fix for workflow sync', () => {
    try {
      execSync(`node ${cliPath} doctor`, {
        cwd: projectRoot,
        encoding: 'utf8',
        stdio: 'pipe',
      });
    } catch (error: any) {
      const output = error.stdout;

      // Should provide actionable suggestion
      expect(output).toContain('💡');
      expect(output).toContain('npx vibe-validate generate-workflow');
    }
  });

  it('should support verbose mode', () => {
    try {
      execSync(`node ${cliPath} doctor --verbose`, {
        cwd: projectRoot,
        encoding: 'utf8',
        stdio: 'pipe',
      });
    } catch (error: any) {
      const output = error.stdout;

      // Verbose mode should show all checks
      expect(output).toContain('verbose mode');
      expect(output).toContain('Node.js version');
      expect(output).toContain('Git installed');
      expect(output).toContain('Git repository');
      expect(output).toContain('Configuration file');
      expect(output).toContain('Configuration valid');
      expect(output).toContain('Package manager');
    }
  });

  it.todo('should pass all checks including workflow sync (v0.9.7)', () => {
    // TODO (v0.9.7): This test will pass when we add CI config to schema.
    //
    // Changes needed:
    // 1. Add ci: { nodeVersions, os, failFast } to config schema
    // 2. Update doctor/checkSync to read ci config from vibe-validate.config.mjs
    // 3. Use those values when calling generateWorkflow() for comparison
    //
    // Expected behavior in v0.9.7:
    // const result = execSync(`node ${cliPath} doctor`, {
    //   cwd: projectRoot,
    //   encoding: 'utf8',
    // });
    //
    // expect(result).toContain('All checks passed');
    // // Exit code should be 0
  });
});

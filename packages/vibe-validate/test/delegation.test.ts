/**
 * Tests for meta-package delegation to CLI
 *
 * Ensures that the vibe-validate package wrappers correctly delegate to
 * @vibe-validate/cli and maintain single source of truth.
 */
 

import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { safeExecSync } from '@vibe-validate/utils';
import { describe, it, expect } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Path to the meta-package bin directory
const binDir = join(__dirname, '../bin');

/**
 * Execute CLI command and return output
 */
function execCLI(binPath: string, args: string[], options?: { cwd?: string }): string {
  try {
    // eslint-disable-next-line local/no-direct-cli-bin-execution -- Meta-package can't import CLI test helpers (circular dependency)
    return safeExecSync('node', [binPath, ...args], { encoding: 'utf-8', ...options }) as string;
  } catch (err: unknown) {
    // For successful non-zero exits, return output
    const error = err as { stdout?: string; stderr?: string };
    if (error.stdout ?? error.stderr) {
      return (error.stdout ?? '') + (error.stderr ?? '');
    }
    throw err;
  }
}

describe('vibe-validate meta-package delegation', () => {
  it('should delegate vv wrapper to CLI', () => {
    const result = execCLI(join(binDir, 'vv'), ['--version'], {
      cwd: __dirname,
    });

    // Should return version string
    expect(result.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('should delegate vibe-validate wrapper to CLI', () => {
    const result = execCLI(join(binDir, 'vibe-validate'), ['--version'], {
      cwd: __dirname,
    });

    // Should return version string
    expect(result.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('should show version string (with or without -dev depending on context)', () => {
    const result = execCLI(join(binDir, 'vv'), ['--version'], {
      cwd: join(__dirname, '../../../..'), // workspace root
    });

    // Should return valid version string (may have -dev suffix in dev context)
    expect(result.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('should show context in debug mode', () => {
    const result = spawnSync('node', [join(binDir, 'vv'), '--version'], {
      encoding: 'utf-8',
      cwd: join(__dirname, '../../../..'), // workspace root
      env: {
        ...process.env,
        VV_DEBUG: '1',
      },
    });

    // Combine stdout and stderr since debug goes to stderr
    const output = result.stdout + result.stderr;

    // Should show debug output indicating context (dev, local, or global)
    expect(output).toMatch(/Context: (dev|local|global)/);
  });

  it('should pass through command line arguments', () => {
    const result = execCLI(join(binDir, 'vv'), ['doctor', '--help'], {
      cwd: __dirname,
    });

    // Should show doctor command help
    expect(result).toContain('doctor');
    expect(result).toContain('Diagnose');
  });
});

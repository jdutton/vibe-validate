/**
 * Tests for meta-package delegation to CLI
 *
 * Ensures that the vibe-validate package wrappers correctly delegate to
 * @vibe-validate/cli and maintain single source of truth.
 */

import { describe, it, expect } from 'vitest';
import { execSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Path to the meta-package bin directory
const binDir = join(__dirname, '../bin');

describe('vibe-validate meta-package delegation', () => {
  it('should delegate vv wrapper to CLI', () => {
    const result = execSync(`node ${join(binDir, 'vv')} --version`, {
      encoding: 'utf-8',
      cwd: __dirname,
    });

    // Should return version string
    expect(result.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('should delegate vibe-validate wrapper to CLI', () => {
    const result = execSync(`node ${join(binDir, 'vibe-validate')} --version`, {
      encoding: 'utf-8',
      cwd: __dirname,
    });

    // Should return version string
    expect(result.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('should show version string (with or without -dev depending on context)', () => {
    const result = execSync(`node ${join(binDir, 'vv')} --version`, {
      encoding: 'utf-8',
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
    const result = execSync(`node ${join(binDir, 'vv')} doctor --help`, {
      encoding: 'utf-8',
      cwd: __dirname,
    });

    // Should show doctor command help
    expect(result).toContain('doctor');
    expect(result).toContain('Diagnose');
  });
});

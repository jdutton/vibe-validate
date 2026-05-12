/**
 * Tests for meta-package delegation to CLI
 *
 * Ensures that the vibe-validate package wrappers correctly delegate to
 * @vibe-validate/cli and maintain single source of truth.
 */
 

import { copyFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  mkdirSyncReal,
  normalizedTmpdir,
  safeExecResult,
  safeExecSync,
} from '@vibe-validate/utils';
import { afterEach, beforeEach, describe, it, expect } from 'vitest';

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
    // eslint-disable-next-line local/no-direct-cli-bin-execution -- Meta-package can't import CLI test helpers (circular dependency)
    const result = safeExecResult('node', [join(binDir, 'vv'), '--version'], {
      encoding: 'utf-8',
      cwd: join(__dirname, '../../../..'), // workspace root
      env: {
        ...process.env,
        VV_DEBUG: '1',
      },
    });

    // Combine stdout and stderr since debug goes to stderr
    const output = String(result.stdout) + String(result.stderr);

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

/**
 * Regression: bin wrappers must resolve @vibe-validate/cli via Node's module
 * algorithm, not via a hardcoded relative `../node_modules/...` path.
 *
 * Under pnpm strict isolation (the default), pnpm publishes the package into
 *   node_modules/.pnpm/vibe-validate@x.y.z/node_modules/vibe-validate/
 * and places @vibe-validate/cli as a SIBLING (not nested), so the old
 * `__dirname/../node_modules/@vibe-validate/cli/...` path doesn't exist.
 *
 * See: https://github.com/jdutton/vibe-validate/issues/161
 */
function runStagedWrapper(stage: string, wrapper: 'vv' | 'vibe-validate'): string {
  // Strip VV_ROOT_DIR so the wrapper uses the published-path branch, which is
  // what pnpm consumers actually hit. (Local dev usually sets VV_ROOT_DIR.)
  const env = { ...process.env };
  delete env.VV_ROOT_DIR;
  // eslint-disable-next-line local/no-direct-cli-bin-execution -- Meta-package regression test for issue #161
  const result = safeExecResult(
    'node',
    [join(stage, 'node_modules', 'vibe-validate', 'bin', wrapper)],
    { encoding: 'utf-8', cwd: stage, env },
  );
  return String(result.stdout) + String(result.stderr);
}

describe('bin wrappers under pnpm-style isolated layout (issue #161)', () => {
  let stage: string;

  beforeEach(() => {
    // eslint-disable-next-line sonarjs/pseudo-random -- Safe for test directory uniqueness
    const uniqueName = `vv-wrapper-iso-${Date.now()}-${Math.random()}`;
    stage = mkdirSyncReal(join(normalizedTmpdir(), uniqueName), { recursive: true });

    // Layout where @vibe-validate/cli is a sibling, NOT nested:
    //   <stage>/node_modules/vibe-validate/bin/{vv,vibe-validate}
    //   <stage>/node_modules/@vibe-validate/cli/{package.json,dist/bin/vibe-validate.js}
    const pkgDir = join(stage, 'node_modules', 'vibe-validate');
    const pkgBin = join(pkgDir, 'bin');
    const cliDir = join(stage, 'node_modules', '@vibe-validate', 'cli');
    const cliBinDir = join(cliDir, 'dist', 'bin');

    mkdirSyncReal(pkgBin, { recursive: true });
    mkdirSyncReal(cliBinDir, { recursive: true });

    copyFileSync(join(binDir, 'vv'), join(pkgBin, 'vv'));
    copyFileSync(join(binDir, 'vibe-validate'), join(pkgBin, 'vibe-validate'));
    writeFileSync(
      join(pkgDir, 'package.json'),
      JSON.stringify({ name: 'vibe-validate', type: 'module' }),
    );

    writeFileSync(
      join(cliDir, 'package.json'),
      JSON.stringify({
        name: '@vibe-validate/cli',
        type: 'module',
        exports: {
          '.': './dist/index.js',
          './package.json': './package.json',
        },
      }),
    );
    writeFileSync(
      join(cliBinDir, 'vibe-validate.js'),
      `console.log('FAKE_CLI_RESOLVED');\n`,
    );
  });

  afterEach(() => {
    rmSync(stage, { recursive: true, force: true });
  });

  it('vv resolves cli through Node module algorithm (not hardcoded relative path)', () => {
    expect(runStagedWrapper(stage, 'vv')).toContain('FAKE_CLI_RESOLVED');
  });

  it('vibe-validate resolves cli through Node module algorithm (not hardcoded relative path)', () => {
    expect(runStagedWrapper(stage, 'vibe-validate')).toContain('FAKE_CLI_RESOLVED');
  });
});

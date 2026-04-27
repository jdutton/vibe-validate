/**
 * Pass-through mode tests for `vv run`.
 *
 * When VV_PARENT_CONTEXT is set with capturing=true (i.e. the parent vibe-validate
 * is already capturing output), `vv run` must skip ALL of its own logic — no cache
 * lookup, no extraction, no YAML emit, no output files — and just exec the inner
 * command with inherited stdio, propagating the exit code.
 *
 * These are integration tests that spawn the real built CLI (no spawn mock).
 *
 * NOTE on shell quoting: `vv run` invokes the inner command via `spawnCommand`
 * with `shell: true`, so the inner command string is parsed by the host shell
 * (cmd.exe on Windows, /bin/sh elsewhere). cmd.exe does NOT treat single quotes
 * as quoting characters, so we use ONLY double quotes around `node -e "..."`
 * arguments and write JS that does not need any nested string quoting (using
 * `process.stdout.write(String.fromCharCode(...))` for literal text and
 * `process.exit(N)` / `process.stdout.write(process.env.X || ...)` patterns
 * for everything else).
 */

import { join } from 'node:path';

import { PARENT_CONTEXT_ENV } from '@vibe-validate/core';
import { normalizedTmpdir } from '@vibe-validate/utils';
import { describe, it, expect } from 'vitest';

import { executeVibeValidateCommand } from '../helpers/cli-execution-helpers.js';

const passthroughCtx = {
  runId: 'test-run',
  treeHash: 'abc12345',
  depth: 1,
  stepName: 'test-step',
  outputDir: join(normalizedTmpdir(), 'vv-passthrough-test'),
  capturing: true,
  caching: true,
  extracting: true,
  verbose: false,
  forceExecution: false,
};

function withParentCtx(ctx: object | null): Record<string, string> {
  if (ctx === null) return {};
  return { [PARENT_CONTEXT_ENV]: JSON.stringify(ctx) };
}

/**
 * Build a `node -e` command that emits the given ASCII text via
 * `String.fromCharCode(...)`. This avoids ALL nested quoting (single OR
 * double), so it parses identically under cmd.exe and POSIX shells.
 */
function nodePrintCommand(text: string, stream: 'stdout' | 'stderr' = 'stdout'): string {
  const charCodes = [...text].map(c => c.codePointAt(0)).join(',');
  return `node -e "process.${stream}.write(String.fromCharCode(${charCodes}))"`;
}

describe('vv run: pass-through mode (VV_PARENT_CONTEXT.capturing=true)', () => {
  it('forwards stdout from the inner command without YAML wrapping', async () => {
    const result = await executeVibeValidateCommand(
      ['run', nodePrintCommand('HELLO')],
      { env: withParentCtx(passthroughCtx) }
    );
    expect(result.stdout).toContain('HELLO');
    expect(result.stdout).not.toContain('exitCode:'); // No YAML
    expect(result.stdout).not.toContain('extraction:');
    expect(result.exitCode).toBe(0);
  });

  it('propagates non-zero exit codes', async () => {
    const result = await executeVibeValidateCommand(
      ['run', 'node -e "process.exit(7)"'],
      { env: withParentCtx(passthroughCtx) }
    );
    expect(result.exitCode).toBe(7);
  });

  it('forwards stderr from the inner command', async () => {
    const result = await executeVibeValidateCommand(
      ['run', nodePrintCommand('OOPS', 'stderr')],
      { env: withParentCtx(passthroughCtx) }
    );
    expect(result.stderr).toContain('OOPS');
  });

  it('does NOT pass through when no parent context (normal mode)', async () => {
    const result = await executeVibeValidateCommand(
      ['run', nodePrintCommand('HI')],
      {} // no env override → no VV_PARENT_CONTEXT
    );
    // Normal mode emits YAML on stdout
    expect(result.stdout).toContain('exitCode:');
  });

  it('errors loudly when depth would exceed MAX_NESTED_DEPTH', async () => {
    // depth=3 → child depth would be 4 → exceeds MAX_NESTED_DEPTH=3
    const tooDeepCtx = { ...passthroughCtx, depth: 3 };
    const result = await executeVibeValidateCommand(
      ['run', nodePrintCommand('X')],
      { env: withParentCtx(tooDeepCtx) }
    );
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/depth exceeded/);
  });

  it('re-exports VV_PARENT_CONTEXT with depth+1 to children', async () => {
    // Inner command prints its own VV_PARENT_CONTEXT env var to stdout.
    // The pass-through should hand the grandchild a context with depth=2.
    // Use process.env.VV_PARENT_CONTEXT (no quoting needed) and a literal
    // fallback "NONE" built via String.fromCharCode to avoid shell-quote issues.
    const fallbackChars = [...'NONE'].map(c => c.codePointAt(0)).join(',');
    const innerCmd =
      `node -e "process.stdout.write(process.env.VV_PARENT_CONTEXT || String.fromCharCode(${fallbackChars}))"`;
    const result = await executeVibeValidateCommand(
      ['run', innerCmd],
      { env: withParentCtx(passthroughCtx) } // depth=1
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).not.toBe('NONE');
    const grandchildCtx = JSON.parse(result.stdout);
    expect(grandchildCtx.depth).toBe(2);
    expect(grandchildCtx.stepName).toBe(passthroughCtx.stepName);
    expect(grandchildCtx.runId).toBe(passthroughCtx.runId);
    expect(grandchildCtx.capturing).toBe(true);
  });
});

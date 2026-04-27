/**
 * Pass-through mode tests for `vv run`.
 *
 * When VV_PARENT_CONTEXT is set with capturing=true (i.e. the parent vibe-validate
 * is already capturing output), `vv run` must skip ALL of its own logic — no cache
 * lookup, no extraction, no YAML emit, no output files — and just exec the inner
 * command with inherited stdio, propagating the exit code.
 *
 * These are integration tests that spawn the real built CLI (no spawn mock).
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

describe('vv run: pass-through mode (VV_PARENT_CONTEXT.capturing=true)', () => {
  it('forwards stdout from the inner command without YAML wrapping', async () => {
    const result = await executeVibeValidateCommand(
      ['run', `node -e "console.log('HELLO')"`],
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
      ['run', `node -e "console.error('OOPS')"`],
      { env: withParentCtx(passthroughCtx) }
    );
    expect(result.stderr).toContain('OOPS');
  });

  it('does NOT pass through when no parent context (normal mode)', async () => {
    const result = await executeVibeValidateCommand(
      ['run', `node -e "console.log('HI')"`],
      {} // no env override → no VV_PARENT_CONTEXT
    );
    // Normal mode emits YAML on stdout
    expect(result.stdout).toContain('exitCode:');
  });

  it('errors loudly when depth would exceed MAX_NESTED_DEPTH', async () => {
    // depth=3 → child depth would be 4 → exceeds MAX_NESTED_DEPTH=3
    const tooDeepCtx = { ...passthroughCtx, depth: 3 };
    const result = await executeVibeValidateCommand(
      ['run', `node -e "console.log('X')"`],
      { env: withParentCtx(tooDeepCtx) }
    );
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/depth exceeded/);
  });
});

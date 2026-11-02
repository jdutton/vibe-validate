/**
 * Tests for resolving a command's --level against the config
 */

import type { VibeValidateConfig } from '@vibe-validate/config';
import { describe, it, expect, vi, afterEach } from 'vitest';

import { resolveLevelOrExit } from '../../src/utils/level-option.js';

const EXIT_1 = { code: 1, yaml: false } as const;

const TWO_LEVELS: VibeValidateConfig = {
  validation: { levels: ['commit', 'full'], phases: [] },
};

/** Stub process.exit to throw its code; returns what was written to stderr so far */
function stubExit(): () => string {
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    throw new Error(`process.exit(${code ?? 0})`);
  }) as never);
  return () => errorSpy.mock.calls.map(call => call.join(' ')).join('\n');
}

describe('resolveLevelOrExit', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the requested level when the config declares it', async () => {
    expect(await resolveLevelOrExit(TWO_LEVELS, 'commit', 'full', EXIT_1)).toBe('commit');
  });

  it('falls back to the command default when none is requested', async () => {
    expect(await resolveLevelOrExit(TWO_LEVELS, undefined, 'full', EXIT_1)).toBe('full');
  });

  it('exits with the command\'s startup code naming the declared levels when the level is unknown', async () => {
    const stderr = stubExit();

    await expect(resolveLevelOrExit(TWO_LEVELS, 'push', 'full', EXIT_1)).rejects.toThrow('process.exit(1)');
    await expect(resolveLevelOrExit(TWO_LEVELS, 'push', 'full', { code: 2, yaml: false })).rejects.toThrow('process.exit(2)');
    const printed = stderr();
    expect(printed).toContain('Unknown level "push"');
    expect(printed).toContain('commit, full');
  });

  it('with no levels declared, names the implicit level rather than a declaration', async () => {
    const stderr = stubExit();

    await expect(resolveLevelOrExit({ validation: { phases: [] } }, 'commit', 'full', EXIT_1)).rejects.toThrow('process.exit(1)');
    const printed = stderr();
    expect(printed).toContain('Unknown level "commit". No validation.levels declared; the only level is full');
    expect(printed).not.toContain('Declared levels');
  });
});

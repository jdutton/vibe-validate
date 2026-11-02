/**
 * Tests for resolving a command's --level against the config
 */

import type { VibeValidateConfig } from '@vibe-validate/config';
import { describe, it, expect, vi, afterEach } from 'vitest';

import { resolveLevelOrExit } from '../../src/utils/level-option.js';

const TWO_LEVELS: VibeValidateConfig = {
  validation: { levels: ['commit', 'full'], phases: [] },
};

describe('resolveLevelOrExit', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the requested level when the config declares it', () => {
    expect(resolveLevelOrExit(TWO_LEVELS, 'commit', 'full')).toBe('commit');
  });

  it('falls back to the command default when none is requested', () => {
    expect(resolveLevelOrExit(TWO_LEVELS, undefined, 'full')).toBe('full');
  });

  it('exits 1 naming the declared levels when the level is unknown', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code ?? 0})`);
    }) as never);

    expect(() => resolveLevelOrExit(TWO_LEVELS, 'push', 'full')).toThrow('process.exit(1)');
    const printed = errorSpy.mock.calls.map(call => call.join(' ')).join('\n');
    expect(printed).toContain('Unknown level "push"');
    expect(printed).toContain('commit, full');
  });
});

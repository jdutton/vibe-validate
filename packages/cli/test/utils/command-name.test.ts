import { describe, expect, it, beforeEach, afterEach } from 'vitest';

import { getCommandName } from '../../src/utils/command-name.js';

describe('getCommandName', () => {
  let originalArgv: string[];
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    // Save original argv and env
    originalArgv = [...process.argv];
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    // Restore original argv and env
    process.argv = originalArgv;
    process.env = originalEnv;
  });

  describe('via VV_COMMAND_NAME environment variable (wrapper mode)', () => {
    it('should use VV_COMMAND_NAME=vv when set by wrapper', () => {
      process.env.VV_COMMAND_NAME = 'vv';
      process.argv = ['node', '/path/to/bin.js', 'watch-pr'];
      expect(getCommandName()).toBe('vv');
    });

    it('should use VV_COMMAND_NAME=vibe-validate when set by wrapper', () => {
      process.env.VV_COMMAND_NAME = 'vibe-validate';
      process.argv = ['node', '/path/to/bin.js', 'watch-pr'];
      expect(getCommandName()).toBe('vibe-validate');
    });
  });

  describe('via process.argv (direct invocation)', () => {
    it('should detect "vv" command name from argv', () => {
      delete process.env.VV_COMMAND_NAME;
      process.argv = ['node', '/usr/local/bin/vv', 'watch-pr'];
      expect(getCommandName()).toBe('vv');
    });

    it('should detect "vibe-validate" command name from argv', () => {
      delete process.env.VV_COMMAND_NAME;
      process.argv = ['node', '/usr/local/bin/vibe-validate', 'watch-pr'];
      expect(getCommandName()).toBe('vibe-validate');
    });

    it('should handle paths with directories', () => {
      delete process.env.VV_COMMAND_NAME;
      process.argv = ['node', '/opt/homebrew/bin/vv', 'state'];
      expect(getCommandName()).toBe('vv');
    });

    it('should fall back to "vibe-validate" for dev mode (bin.js)', () => {
      delete process.env.VV_COMMAND_NAME;
      process.argv = ['node', '/path/to/vibe-validate/packages/cli/dist/bin.js', 'doctor'];
      expect(getCommandName()).toBe('vibe-validate');
    });

    it('should fall back to "vibe-validate" when argv[1] is undefined', () => {
      delete process.env.VV_COMMAND_NAME;
      process.argv = ['node'];
      expect(getCommandName()).toBe('vibe-validate');
    });

    it('should fall back to "vibe-validate" for unknown command names', () => {
      delete process.env.VV_COMMAND_NAME;
      process.argv = ['node', '/some/path/weird-name', 'state'];
      expect(getCommandName()).toBe('vibe-validate');
    });
  });
});

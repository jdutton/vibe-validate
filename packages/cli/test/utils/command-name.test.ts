import { describe, expect, it, beforeEach, afterEach } from 'vitest';

import { getCommandName } from '../../src/utils/command-name.js';

/**
 * Helper function to test command name detection
 */
function testCommandName(options: {
	envVar?: string;
	argv: string[];
	expected: string;
}): void {
	if (options.envVar) {
		process.env.VV_COMMAND_NAME = options.envVar;
	} else {
		delete process.env.VV_COMMAND_NAME;
	}
	process.argv = options.argv;
	expect(getCommandName()).toBe(options.expected);
}

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
      testCommandName({
        envVar: 'vv',
        argv: ['node', '/path/to/bin.js', 'watch-pr'],
        expected: 'vv',
      });
    });

    it('should use VV_COMMAND_NAME=vibe-validate when set by wrapper', () => {
      testCommandName({
        envVar: 'vibe-validate',
        argv: ['node', '/path/to/bin.js', 'watch-pr'],
        expected: 'vibe-validate',
      });
    });
  });

  describe('via process.argv (direct invocation)', () => {
    it('should detect "vv" command name from argv', () => {
      testCommandName({
        argv: ['node', '/usr/local/bin/vv', 'watch-pr'],
        expected: 'vv',
      });
    });

    it('should detect "vibe-validate" command name from argv', () => {
      testCommandName({
        argv: ['node', '/usr/local/bin/vibe-validate', 'watch-pr'],
        expected: 'vibe-validate',
      });
    });

    it('should handle paths with directories', () => {
      testCommandName({
        argv: ['node', '/opt/homebrew/bin/vv', 'state'],
        expected: 'vv',
      });
    });

    it('should fall back to "vibe-validate" for dev mode (bin.js)', () => {
      testCommandName({
        argv: ['node', '/path/to/vibe-validate/packages/cli/dist/bin.js', 'doctor'],
        expected: 'vibe-validate',
      });
    });

    it('should fall back to "vibe-validate" when argv[1] is undefined', () => {
      testCommandName({
        argv: ['node'],
        expected: 'vibe-validate',
      });
    });

    it('should fall back to "vibe-validate" for unknown command names', () => {
      testCommandName({
        argv: ['node', '/some/path/weird-name', 'state'],
        expected: 'vibe-validate',
      });
    });
  });
});

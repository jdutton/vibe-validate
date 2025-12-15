/**
 * Tests for run command cache key encoding
 *
 * Cache keys are SHA256 hashes used to store run command results in git notes.
 * They must be deterministic, handle special characters safely, and be git-ref-safe.
 *
 * Normalization rules:
 * - Always trim leading/trailing whitespace from command and workdir
 * - For simple commands (no quotes/escapes/shell metacharacters): collapse multiple spaces
 * - For complex commands (has quotes, escapes, etc.): preserve internal spacing
 * - Hash format: SHA256(normalizedCommand + '__' + workdir).substring(0, 16)
 */

/* eslint-disable sonarjs/assertions-in-tests */
// Note: This rule is disabled because we use helper functions that contain assertions.
// SonarJS cannot detect assertions inside helper functions, resulting in false positives.

import { describe, it, expect } from 'vitest';

import { encodeRunCacheKey } from '../src/cache-key.js';

import {
  expectCacheKey,
  expectValidHashFormat,
  expectGitRefSafe,
  expectSameKey,
  expectDifferentKeys,
  expectTrimmed,
  expectPreservedSpacing,
  expectDeterministic,
} from './helpers/cache-key-test-helpers.js';

describe('encodeRunCacheKey', () => {
  describe('basic encoding', () => {
    it('should encode simple command at root', () => {
      expectCacheKey('npm test', '', { validateLength: true }); // NOSONAR - helper contains assertions
    });

    it('should encode command with workdir', () => {
      expectCacheKey('npm test', 'packages/cli', { validateLength: true }); // NOSONAR - helper contains assertions
    });

    it('should handle empty workdir as root', () => {
      expectCacheKey('cargo test', '', { validateLength: true }); // NOSONAR - helper contains assertions
    });
  });

  describe('whitespace normalization', () => {
    it('should trim leading whitespace from command', () => {
      expectTrimmed('  npm test', 'npm test'); // NOSONAR - helper contains assertions
    });

    it('should trim trailing whitespace from command', () => {
      expectTrimmed('npm test  ', 'npm test'); // NOSONAR - helper contains assertions
    });

    it('should trim leading and trailing whitespace from command', () => {
      expectTrimmed('  npm test  ', 'npm test'); // NOSONAR - helper contains assertions
    });

    it('should trim leading whitespace from workdir', () => {
      expectTrimmed('npm test', 'npm test', '  packages/cli', 'packages/cli'); // NOSONAR - helper contains assertions
    });

    it('should trim trailing whitespace from workdir', () => {
      expectTrimmed('npm test', 'npm test', 'packages/cli  ', 'packages/cli'); // NOSONAR - helper contains assertions
    });

    it('should collapse multiple spaces in simple command', () => {
      expectTrimmed('npm  test', 'npm test'); // NOSONAR - helper contains assertions
    });

    it('should collapse many spaces in simple command', () => {
      expectTrimmed('npm    run    test', 'npm run test'); // NOSONAR - helper contains assertions
    });

    it('should collapse tabs to single space in simple command', () => {
      expectTrimmed('npm\t\ttest', 'npm test'); // NOSONAR - helper contains assertions
    });
  });

  describe('complex command handling - preserve internal spacing', () => {
    it('should preserve spacing in commands with double quotes', () => {
      expectPreservedSpacing('echo "hello  world"'); // NOSONAR - helper contains assertions
    });

    it('should preserve spacing in commands with single quotes', () => {
      expectPreservedSpacing("echo 'hello  world'"); // NOSONAR - helper contains assertions
    });

    it('should preserve spacing in commands with backticks', () => {
      expectPreservedSpacing('echo `hello  world`'); // NOSONAR - helper contains assertions
    });

    it('should preserve spacing in commands with backslash escapes', () => {
      expectPreservedSpacing(String.raw`npm test\ \ foo`); // NOSONAR - helper contains assertions
    });

    it('should preserve spacing in commands with pipes', () => {
      expectPreservedSpacing('cat  file | grep  test'); // NOSONAR - helper contains assertions
    });

    it('should preserve spacing in commands with redirects', () => {
      expectPreservedSpacing('echo  test > file'); // NOSONAR - helper contains assertions
    });

    it('should preserve spacing in commands with ampersands', () => {
      expectPreservedSpacing('cmd1  &&  cmd2'); // NOSONAR - helper contains assertions
    });

    it('should preserve spacing in commands with semicolons', () => {
      expectPreservedSpacing('cmd1 ;  cmd2'); // NOSONAR - helper contains assertions
    });

    it('should preserve spacing in commands with dollar signs', () => {
      expectPreservedSpacing('echo  $VAR'); // NOSONAR - helper contains assertions
    });

    it('should still trim leading/trailing in complex commands', () => {
      expectTrimmed('  echo "hello  world"  ', 'echo "hello  world"'); // NOSONAR - helper contains assertions
    });
  });

  describe('hash properties', () => {
    it('should produce 16-character hex hashes', () => {
      const result = encodeRunCacheKey('npm test', '');
      expectValidHashFormat(result);
    });

    it('should be git-ref-safe (no special chars)', () => {
      const result = encodeRunCacheKey('npm run test:coverage', 'packages/cli');
      expectGitRefSafe(result);
    });

    it('should handle special characters without producing invalid git refs', () => {
      const commands = [
        'npm run test:coverage',
        'echo "hello world"',
        'pnpm --filter @pkg/name test',
        'pytest tests/ -v --cov',
      ];

      for (const cmd of commands) {
        const result = encodeRunCacheKey(cmd, '');
        expectValidHashFormat(result);
      }
    });
  });

  describe('determinism and cache hit optimization', () => {
    it('should be deterministic - same input produces same output', () => {
      expectDeterministic('npm test', 'packages/cli'); // NOSONAR - helper contains assertions
    });

    it('should normalize variations of same simple command to same key', () => {
      expectSameKey('npm test', '  npm  test  '); // NOSONAR - helper contains assertions
      expectSameKey('npm test', 'npm\ttest'); // NOSONAR - helper contains assertions
    });

    it('should NOT normalize complex commands with different spacing', () => {
      expectDifferentKeys('echo "hello  world"', 'echo "hello world"'); // NOSONAR - helper contains assertions
    });

    it('should produce different keys for different commands', () => {
      expectDifferentKeys('npm test', 'npm build'); // NOSONAR - helper contains assertions
    });

    it('should produce different keys for different workdirs', () => {
      expectDifferentKeys(['npm test', ''], ['npm test', 'packages/cli']); // NOSONAR - helper contains assertions
    });
  });

  describe('real-world commands', () => {
    it('should handle vitest command', () => {
      expectCacheKey('npx vitest tests/vitest/comprehensive-failures.test.ts --run', 'packages/extractors-test-bed', { validateLength: true }); // NOSONAR - helper contains assertions
    });

    it('should handle jest command with extra spaces', () => {
      expectTrimmed('  npm  run  test:coverage  ', 'npm run test:coverage'); // NOSONAR - helper contains assertions
    });

    it('should handle cargo test', () => {
      expectCacheKey('cargo test --all-features', 'crates/core'); // NOSONAR - helper contains assertions
    });

    it('should handle pytest with complex args', () => {
      expectCacheKey('pytest tests/ -v --cov', 'src/python'); // NOSONAR - helper contains assertions
    });

    it('should handle go test', () => {
      expectCacheKey('go test ./...', 'pkg/validator'); // NOSONAR - helper contains assertions
    });

    it('should handle eslint command', () => {
      expectPreservedSpacing('npx eslint --max-warnings=0 "packages/**/*.ts"'); // NOSONAR - helper contains assertions
    });
  });

  describe('edge cases', () => {
    it('should handle very long commands', () => {
      const longCommand = 'npm test -- --testPathPattern="very/long/path/to/test/file/that/has/many/segments.test.ts" --verbose --coverage';
      expectCacheKey(longCommand, '', { validateLength: true }); // NOSONAR - helper contains assertions
    });

    it('should handle unicode characters in command', () => {
      expectPreservedSpacing('echo "🚀 test"'); // NOSONAR - helper contains assertions
    });

    it('should handle empty command', () => {
      const result = encodeRunCacheKey('', '');
      expect(result).toBe('');
    });

    it('should handle command that is only whitespace', () => {
      const result = encodeRunCacheKey('   ', '');
      expect(result).toBe('');
    });

    it('should handle workdir that is only whitespace', () => {
      expectTrimmed('npm test', 'npm test', '   ', ''); // NOSONAR - helper contains assertions
    });
  });
});

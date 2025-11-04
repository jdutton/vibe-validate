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

import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { encodeRunCacheKey } from '../src/cache-key.js';

/**
 * Helper to compute expected cache key
 */
function expectedCacheKey(command: string, workdir: string): string {
  const input = `${command}__${workdir}`;
  return createHash('sha256').update(input).digest('hex').substring(0, 16);
}

describe('encodeRunCacheKey', () => {
  describe('basic encoding', () => {
    it('should encode simple command at root', () => {
      const result = encodeRunCacheKey('npm test', '');
      expect(result).toBe(expectedCacheKey('npm test', ''));
      expect(result).toHaveLength(16); // First 16 chars of SHA256
    });

    it('should encode command with workdir', () => {
      const result = encodeRunCacheKey('npm test', 'packages/cli');
      expect(result).toBe(expectedCacheKey('npm test', 'packages/cli'));
      expect(result).toHaveLength(16);
    });

    it('should handle empty workdir as root', () => {
      const result = encodeRunCacheKey('cargo test', '');
      expect(result).toBe(expectedCacheKey('cargo test', ''));
      expect(result).toHaveLength(16);
    });
  });

  describe('whitespace normalization', () => {
    it('should trim leading whitespace from command', () => {
      const result = encodeRunCacheKey('  npm test', '');
      expect(result).toBe(expectedCacheKey('npm test', ''));
    });

    it('should trim trailing whitespace from command', () => {
      const result = encodeRunCacheKey('npm test  ', '');
      expect(result).toBe(expectedCacheKey('npm test', ''));
    });

    it('should trim leading and trailing whitespace from command', () => {
      const result = encodeRunCacheKey('  npm test  ', '');
      expect(result).toBe(expectedCacheKey('npm test', ''));
    });

    it('should trim leading whitespace from workdir', () => {
      const result = encodeRunCacheKey('npm test', '  packages/cli');
      expect(result).toBe(expectedCacheKey('npm test', 'packages/cli'));
    });

    it('should trim trailing whitespace from workdir', () => {
      const result = encodeRunCacheKey('npm test', 'packages/cli  ');
      expect(result).toBe(expectedCacheKey('npm test', 'packages/cli'));
    });

    it('should collapse multiple spaces in simple command', () => {
      const result = encodeRunCacheKey('npm  test', '');
      expect(result).toBe(expectedCacheKey('npm test', ''));
    });

    it('should collapse many spaces in simple command', () => {
      const result = encodeRunCacheKey('npm    run    test', '');
      expect(result).toBe(expectedCacheKey('npm run test', ''));
    });

    it('should collapse tabs to single space in simple command', () => {
      const result = encodeRunCacheKey('npm\t\ttest', '');
      expect(result).toBe(expectedCacheKey('npm test', ''));
    });
  });

  describe('complex command handling - preserve internal spacing', () => {
    it('should preserve spacing in commands with double quotes', () => {
      const result = encodeRunCacheKey('echo "hello  world"', '');
      expect(result).toBe(expectedCacheKey('echo "hello  world"', ''));
    });

    it('should preserve spacing in commands with single quotes', () => {
      const result = encodeRunCacheKey("echo 'hello  world'", '');
      expect(result).toBe(expectedCacheKey("echo 'hello  world'", ''));
    });

    it('should preserve spacing in commands with backticks', () => {
      const result = encodeRunCacheKey('echo `hello  world`', '');
      expect(result).toBe(expectedCacheKey('echo `hello  world`', ''));
    });

    it('should preserve spacing in commands with backslash escapes', () => {
      const result = encodeRunCacheKey(String.raw`npm test\ \ foo`, '');
      expect(result).toBe(expectedCacheKey(String.raw`npm test\ \ foo`, ''));
    });

    it('should preserve spacing in commands with pipes', () => {
      const result = encodeRunCacheKey('cat  file | grep  test', '');
      expect(result).toBe(expectedCacheKey('cat  file | grep  test', ''));
    });

    it('should preserve spacing in commands with redirects', () => {
      const result = encodeRunCacheKey('echo  test > file', '');
      expect(result).toBe(expectedCacheKey('echo  test > file', ''));
    });

    it('should preserve spacing in commands with ampersands', () => {
      const result = encodeRunCacheKey('cmd1  &&  cmd2', '');
      expect(result).toBe(expectedCacheKey('cmd1  &&  cmd2', ''));
    });

    it('should preserve spacing in commands with semicolons', () => {
      const result = encodeRunCacheKey('cmd1 ;  cmd2', '');
      expect(result).toBe(expectedCacheKey('cmd1 ;  cmd2', ''));
    });

    it('should preserve spacing in commands with dollar signs', () => {
      const result = encodeRunCacheKey('echo  $VAR', '');
      expect(result).toBe(expectedCacheKey('echo  $VAR', ''));
    });

    it('should still trim leading/trailing in complex commands', () => {
      const result = encodeRunCacheKey('  echo "hello  world"  ', '');
      expect(result).toBe(expectedCacheKey('echo "hello  world"', ''));
    });
  });

  describe('hash properties', () => {
    it('should produce 16-character hex hashes', () => {
      const result = encodeRunCacheKey('npm test', '');
      expect(result).toMatch(/^[0-9a-f]{16}$/);
    });

    it('should be git-ref-safe (no special chars)', () => {
      const result = encodeRunCacheKey('npm run test:coverage', 'packages/cli');
      expect(result).toMatch(/^[0-9a-f]{16}$/);
      expect(result).not.toContain('%'); // No URL encoding
      expect(result).not.toContain(':'); // No colons
      expect(result).not.toContain('/'); // No slashes
      expect(result).not.toContain(' '); // No spaces
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
        expect(result).toMatch(/^[0-9a-f]{16}$/);
      }
    });
  });

  describe('determinism and cache hit optimization', () => {
    it('should be deterministic - same input produces same output', () => {
      const result1 = encodeRunCacheKey('npm test', 'packages/cli');
      const result2 = encodeRunCacheKey('npm test', 'packages/cli');
      expect(result1).toBe(result2);
    });

    it('should normalize variations of same simple command to same key', () => {
      const result1 = encodeRunCacheKey('npm test', '');
      const result2 = encodeRunCacheKey('  npm  test  ', '');
      const result3 = encodeRunCacheKey('npm\ttest', '');
      expect(result1).toBe(result2);
      expect(result2).toBe(result3);
    });

    it('should NOT normalize complex commands with different spacing', () => {
      const result1 = encodeRunCacheKey('echo "hello  world"', '');
      const result2 = encodeRunCacheKey('echo "hello world"', '');
      expect(result1).not.toBe(result2); // Different content inside quotes
    });

    it('should produce different keys for different commands', () => {
      const result1 = encodeRunCacheKey('npm test', '');
      const result2 = encodeRunCacheKey('npm build', '');
      expect(result1).not.toBe(result2);
    });

    it('should produce different keys for different workdirs', () => {
      const result1 = encodeRunCacheKey('npm test', '');
      const result2 = encodeRunCacheKey('npm test', 'packages/cli');
      expect(result1).not.toBe(result2);
    });
  });

  describe('real-world commands', () => {
    it('should handle vitest command', () => {
      const result = encodeRunCacheKey('npx vitest tests/vitest/comprehensive-failures.test.ts --run', 'packages/extractors-test-bed');
      expect(result).toBe(expectedCacheKey('npx vitest tests/vitest/comprehensive-failures.test.ts --run', 'packages/extractors-test-bed'));
      expect(result).toHaveLength(16);
    });

    it('should handle jest command with extra spaces', () => {
      const result = encodeRunCacheKey('  npm  run  test:coverage  ', '');
      expect(result).toBe(expectedCacheKey('npm run test:coverage', ''));
    });

    it('should handle cargo test', () => {
      const result = encodeRunCacheKey('cargo test --all-features', 'crates/core');
      expect(result).toBe(expectedCacheKey('cargo test --all-features', 'crates/core'));
    });

    it('should handle pytest with complex args', () => {
      const result = encodeRunCacheKey('pytest tests/ -v --cov', 'src/python');
      expect(result).toBe(expectedCacheKey('pytest tests/ -v --cov', 'src/python'));
    });

    it('should handle go test', () => {
      const result = encodeRunCacheKey('go test ./...', 'pkg/validator');
      expect(result).toBe(expectedCacheKey('go test ./...', 'pkg/validator'));
    });

    it('should handle eslint command', () => {
      const result = encodeRunCacheKey('npx eslint --max-warnings=0 "packages/**/*.ts"', '');
      expect(result).toBe(expectedCacheKey('npx eslint --max-warnings=0 "packages/**/*.ts"', ''));
    });
  });

  describe('edge cases', () => {
    it('should handle very long commands', () => {
      const longCommand = 'npm test -- --testPathPattern="very/long/path/to/test/file/that/has/many/segments.test.ts" --verbose --coverage';
      const result = encodeRunCacheKey(longCommand, '');
      expect(result).toBe(expectedCacheKey(longCommand, ''));
      expect(result).toHaveLength(16);
    });

    it('should handle unicode characters in command', () => {
      const result = encodeRunCacheKey('echo "🚀 test"', '');
      expect(result).toBe(expectedCacheKey('echo "🚀 test"', ''));
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
      const result = encodeRunCacheKey('npm test', '   ');
      expect(result).toBe(expectedCacheKey('npm test', ''));
    });
  });
});

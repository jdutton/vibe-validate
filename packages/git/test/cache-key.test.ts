/**
 * Tests for run command cache key encoding
 *
 * Cache keys are used to store run command results in git notes.
 * They must handle special characters, spaces, and colons safely.
 *
 * Normalization rules:
 * - Always trim leading/trailing whitespace from command and workdir
 * - For simple commands (no quotes/escapes/shell metacharacters): collapse multiple spaces
 * - For complex commands (has quotes, escapes, etc.): preserve internal spacing
 */

import { describe, it, expect } from 'vitest';
import { encodeRunCacheKey } from '../src/cache-key.js';

describe('encodeRunCacheKey', () => {
  describe('basic encoding', () => {
    it('should encode simple command at root', () => {
      const result = encodeRunCacheKey('npm test', '');
      expect(result).toBe(encodeURIComponent('npm test'));
    });

    it('should encode command with workdir', () => {
      const result = encodeRunCacheKey('npm test', 'packages/cli');
      expect(result).toBe(encodeURIComponent('packages/cli:npm test'));
    });

    it('should handle empty workdir as root', () => {
      const result = encodeRunCacheKey('cargo test', '');
      expect(result).toBe(encodeURIComponent('cargo test'));
    });
  });

  describe('whitespace normalization', () => {
    it('should trim leading whitespace from command', () => {
      const result = encodeRunCacheKey('  npm test', '');
      expect(result).toBe(encodeURIComponent('npm test'));
    });

    it('should trim trailing whitespace from command', () => {
      const result = encodeRunCacheKey('npm test  ', '');
      expect(result).toBe(encodeURIComponent('npm test'));
    });

    it('should trim leading and trailing whitespace from command', () => {
      const result = encodeRunCacheKey('  npm test  ', '');
      expect(result).toBe(encodeURIComponent('npm test'));
    });

    it('should trim leading whitespace from workdir', () => {
      const result = encodeRunCacheKey('npm test', '  packages/cli');
      expect(result).toBe(encodeURIComponent('packages/cli:npm test'));
    });

    it('should trim trailing whitespace from workdir', () => {
      const result = encodeRunCacheKey('npm test', 'packages/cli  ');
      expect(result).toBe(encodeURIComponent('packages/cli:npm test'));
    });

    it('should collapse multiple spaces in simple command', () => {
      const result = encodeRunCacheKey('npm  test', '');
      expect(result).toBe(encodeURIComponent('npm test'));
    });

    it('should collapse many spaces in simple command', () => {
      const result = encodeRunCacheKey('npm    run    test', '');
      expect(result).toBe(encodeURIComponent('npm run test'));
    });

    it('should collapse tabs to single space in simple command', () => {
      const result = encodeRunCacheKey('npm\t\ttest', '');
      expect(result).toBe(encodeURIComponent('npm test'));
    });
  });

  describe('complex command handling - preserve internal spacing', () => {
    it('should preserve spacing in commands with double quotes', () => {
      const result = encodeRunCacheKey('echo "hello  world"', '');
      const decoded = decodeURIComponent(result);
      expect(decoded).toBe('echo "hello  world"'); // Preserve double spaces inside quotes
    });

    it('should preserve spacing in commands with single quotes', () => {
      const result = encodeRunCacheKey("echo 'hello  world'", '');
      const decoded = decodeURIComponent(result);
      expect(decoded).toBe("echo 'hello  world'");
    });

    it('should preserve spacing in commands with backticks', () => {
      const result = encodeRunCacheKey('echo `hello  world`', '');
      const decoded = decodeURIComponent(result);
      expect(decoded).toBe('echo `hello  world`');
    });

    it('should preserve spacing in commands with backslash escapes', () => {
      const result = encodeRunCacheKey(String.raw`npm test\ \ foo`, '');
      const decoded = decodeURIComponent(result);
      expect(decoded).toBe(String.raw`npm test\ \ foo`);
    });

    it('should preserve spacing in commands with pipes', () => {
      const result = encodeRunCacheKey('cat  file | grep  test', '');
      const decoded = decodeURIComponent(result);
      expect(decoded).toBe('cat  file | grep  test');
    });

    it('should preserve spacing in commands with redirects', () => {
      const result = encodeRunCacheKey('echo  test > file', '');
      const decoded = decodeURIComponent(result);
      expect(decoded).toBe('echo  test > file');
    });

    it('should preserve spacing in commands with ampersands', () => {
      const result = encodeRunCacheKey('cmd1  &&  cmd2', '');
      const decoded = decodeURIComponent(result);
      expect(decoded).toBe('cmd1  &&  cmd2');
    });

    it('should preserve spacing in commands with semicolons', () => {
      const result = encodeRunCacheKey('cmd1 ;  cmd2', '');
      const decoded = decodeURIComponent(result);
      expect(decoded).toBe('cmd1 ;  cmd2');
    });

    it('should preserve spacing in commands with dollar signs', () => {
      const result = encodeRunCacheKey('echo  $VAR', '');
      const decoded = decodeURIComponent(result);
      expect(decoded).toBe('echo  $VAR');
    });

    it('should still trim leading/trailing in complex commands', () => {
      const result = encodeRunCacheKey('  echo "hello  world"  ', '');
      const decoded = decodeURIComponent(result);
      expect(decoded).toBe('echo "hello  world"'); // Trimmed, but preserved internal
    });
  });

  describe('special character handling', () => {
    it('should encode spaces in command', () => {
      const result = encodeRunCacheKey('npm run test:unit', '');
      expect(result).toBe(encodeURIComponent('npm run test:unit'));
      expect(result).toContain('%20'); // Space encoded
    });

    it('should encode colons in command', () => {
      const result = encodeRunCacheKey('pnpm test:coverage', '');
      expect(result).toBe(encodeURIComponent('pnpm test:coverage'));
      expect(result).toContain('%3A'); // Colon encoded
    });

    it('should encode slashes in workdir', () => {
      const result = encodeRunCacheKey('pytest', 'packages/python/tests');
      expect(result).toBe(encodeURIComponent('packages/python/tests:pytest'));
      expect(result).toContain('%2F'); // Slash encoded
    });
  });

  describe('workdir separator handling', () => {
    it('should use colon as separator between workdir and command', () => {
      const result = encodeRunCacheKey('npm test', 'packages/core');
      const decoded = decodeURIComponent(result);
      expect(decoded).toBe('packages/core:npm test');
    });

    it('should handle colon in both workdir and command', () => {
      const result = encodeRunCacheKey('pnpm test:unit', 'packages/cli');
      const decoded = decodeURIComponent(result);
      expect(decoded).toBe('packages/cli:pnpm test:unit');
    });
  });

  describe('real-world commands', () => {
    it('should handle vitest command', () => {
      const result = encodeRunCacheKey('npx vitest tests/vitest/comprehensive-failures.test.ts --run', 'packages/extractors-test-bed');
      const decoded = decodeURIComponent(result);
      expect(decoded).toBe('packages/extractors-test-bed:npx vitest tests/vitest/comprehensive-failures.test.ts --run');
    });

    it('should handle jest command with extra spaces', () => {
      const result = encodeRunCacheKey('  npm  run  test:coverage  ', '');
      const decoded = decodeURIComponent(result);
      expect(decoded).toBe('npm run test:coverage'); // Normalized
    });

    it('should handle cargo test', () => {
      const result = encodeRunCacheKey('cargo test --all-features', 'crates/core');
      const decoded = decodeURIComponent(result);
      expect(decoded).toBe('crates/core:cargo test --all-features');
    });

    it('should handle pytest with complex args', () => {
      const result = encodeRunCacheKey('pytest tests/ -v --cov', 'src/python');
      const decoded = decodeURIComponent(result);
      expect(decoded).toBe('src/python:pytest tests/ -v --cov');
    });

    it('should handle go test', () => {
      const result = encodeRunCacheKey('go test ./...', 'pkg/validator');
      const decoded = decodeURIComponent(result);
      expect(decoded).toBe('pkg/validator:go test ./...');
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
  });

  describe('edge cases', () => {
    it('should handle very long commands', () => {
      const longCommand = 'npm test -- --testPathPattern="very/long/path/to/test/file/that/has/many/segments.test.ts" --verbose --coverage';
      const result = encodeRunCacheKey(longCommand, '');
      const decoded = decodeURIComponent(result);
      expect(decoded).toBe(longCommand);
    });

    it('should handle unicode characters in command', () => {
      const result = encodeRunCacheKey('echo "🚀 test"', '');
      const decoded = decodeURIComponent(result);
      expect(decoded).toBe('echo "🚀 test"');
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
      const decoded = decodeURIComponent(result);
      expect(decoded).toBe('npm test');
    });
  });
});

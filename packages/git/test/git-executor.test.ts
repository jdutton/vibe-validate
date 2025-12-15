/**
 * Tests for secure git command execution
 */

import { describe, it, expect } from 'vitest';

import {
  validateGitRef,
  validateNotesRef,
  validateTreeHash,
} from '../src/git-executor.js';

describe('git-executor - validateGitRef - valid refs', () => {
  it('should accept simple branch names', () => {
    expect(() => validateGitRef('main')).not.toThrow();
    expect(() => validateGitRef('feature/new-feature')).not.toThrow();
    expect(() => validateGitRef('bugfix123')).not.toThrow();
  });

  it('should accept full ref paths', () => {
    expect(() => validateGitRef('refs/heads/main')).not.toThrow();
    expect(() => validateGitRef('refs/notes/vibe-validate/validate')).not.toThrow();
    expect(() => validateGitRef('refs/tags/v1.0.0')).not.toThrow();
  });

  it('should accept commit SHAs', () => {
    expect(() => validateGitRef('abc123')).not.toThrow();
    expect(() => validateGitRef('0123456789abcdef0123456789abcdef01234567')).not.toThrow();
  });
});

describe('git-executor - validateGitRef - command injection prevention', () => {
  it('should reject shell special characters', () => {
    expect(() => validateGitRef('main; rm -rf /')).toThrow('shell special characters');
    expect(() => validateGitRef('main | cat /etc/passwd')).toThrow('shell special characters');
    expect(() => validateGitRef('main && malicious')).toThrow('shell special characters');
    expect(() => validateGitRef('main`whoami`')).toThrow('shell special characters');
    expect(() => validateGitRef('main$(whoami)')).toThrow('shell special characters');
    expect(() => validateGitRef('main${var}')).toThrow('shell special characters');
    expect(() => validateGitRef('main{branch}')).toThrow('shell special characters');
    expect(() => validateGitRef('main<file')).toThrow('shell special characters');
    expect(() => validateGitRef('main>file')).toThrow('shell special characters');
    expect(() => validateGitRef('main!test')).toThrow('shell special characters');
    expect(() => validateGitRef('main"test')).toThrow('shell special characters');
    expect(() => validateGitRef(String.raw`main\test`)).toThrow('shell special characters');
  });

  it('should reject refs starting with dash (option injection)', () => {
    expect(() => validateGitRef('-main')).toThrow('starts with dash');
    expect(() => validateGitRef('--help')).toThrow('starts with dash');
  });

  it('should reject path traversal sequences', () => {
    expect(() => validateGitRef('../../../etc/passwd')).toThrow('path traversal');
    expect(() => validateGitRef('main/../other')).toThrow('path traversal');
    expect(() => validateGitRef('refs//notes')).toThrow('path traversal');
  });

  it('should reject null bytes', () => {
    expect(() => validateGitRef('main\0')).toThrow('null byte');
  });

  it('should reject newlines', () => {
    expect(() => validateGitRef('main\n')).toThrow('newline');
    expect(() => validateGitRef('main\r')).toThrow('newline');
    expect(() => validateGitRef('main\r\n')).toThrow('newline');
  });

  it('should reject empty refs', () => {
    expect(() => validateGitRef('')).toThrow('non-empty string');
  });
});

describe('git-executor - validateNotesRef - valid refs', () => {
  it('should accept standard notes ref format', () => {
    expect(() => validateNotesRef('refs/notes/vibe-validate/validate')).not.toThrow();
    expect(() => validateNotesRef('refs/notes/custom')).not.toThrow();
  });

  it('should accept short form notes refs', () => {
    expect(() => validateNotesRef('vibe-validate/validate')).not.toThrow();
    expect(() => validateNotesRef('custom-notes')).not.toThrow();
  });
});

describe('git-executor - validateNotesRef - invalid refs', () => {
  it('should reject notes refs with whitespace in short form', () => {
    expect(() => validateNotesRef('vibe validate/test')).toThrow('whitespace');
  });

  it('should inherit all git ref validations', () => {
    expect(() => validateNotesRef('main; rm -rf /')).toThrow('shell special characters');
    expect(() => validateNotesRef('-malicious')).toThrow('starts with dash');
  });
});

describe('git-executor - validateTreeHash - valid hashes', () => {
  it('should accept full SHA-1 hashes', () => {
    expect(() => validateTreeHash('0123456789abcdef0123456789abcdef01234567')).not.toThrow();
    expect(() => validateTreeHash('abcdefabcdefabcdefabcdefabcdefabcdefabcd')).not.toThrow();
  });

  it('should accept abbreviated hashes', () => {
    expect(() => validateTreeHash('abc123')).not.toThrow();
    expect(() => validateTreeHash('0123abcd')).not.toThrow();
  });
});

describe('git-executor - validateTreeHash - symbolic refs rejection', () => {
  it('should reject HEAD', () => {
    expect(() => validateTreeHash('HEAD')).toThrow('must be hexadecimal');
  });

  it('should reject branch names', () => {
    expect(() => validateTreeHash('main')).toThrow('must be hexadecimal');
    expect(() => validateTreeHash('feature/foo')).toThrow('must be hexadecimal');
    expect(() => validateTreeHash('bugfix-123')).toThrow('must be hexadecimal');
  });

  it('should reject remote refs', () => {
    expect(() => validateTreeHash('origin/main')).toThrow('must be hexadecimal');
    expect(() => validateTreeHash('upstream/develop')).toThrow('must be hexadecimal');
  });

  it('should reject tag names', () => {
    expect(() => validateTreeHash('v1.0.0')).toThrow('must be hexadecimal');
    expect(() => validateTreeHash('release-2024')).toThrow('must be hexadecimal');
  });

  it('should accept valid full hash', () => {
    expect(() => validateTreeHash('abc123def456789012345678901234567890abcd')).not.toThrow();
  });

  it('should accept valid abbreviated hash', () => {
    expect(() => validateTreeHash('abc123')).not.toThrow();
    expect(() => validateTreeHash('0123abcd')).not.toThrow();
  });
});

describe('git-executor - validateTreeHash - command injection prevention', () => {
  it('should reject non-hexadecimal characters', () => {
    expect(() => validateTreeHash('not-a-hash')).toThrow('must be hexadecimal');
    expect(() => validateTreeHash('abc123xyz')).toThrow('must be hexadecimal');
    expect(() => validateTreeHash('ABCDEF')).toThrow('must be hexadecimal'); // uppercase not allowed
    expect(() => validateTreeHash('abc 123')).toThrow('must be hexadecimal'); // space
  });

  it('should reject hashes with shell special characters', () => {
    expect(() => validateTreeHash('abc123; rm -rf /')).toThrow('must be hexadecimal');
    expect(() => validateTreeHash('abc123`whoami`')).toThrow('must be hexadecimal');
  });

  it('should reject invalid lengths', () => {
    expect(() => validateTreeHash('abc')).toThrow('invalid length'); // too short
    expect(() => validateTreeHash('a'.repeat(41))).toThrow('invalid length'); // too long
  });

  it('should reject empty hashes', () => {
    expect(() => validateTreeHash('')).toThrow('non-empty string');
  });
});

/**
 * Tests for formatWorktreeDisplay utility
 */

import type { TreeHashResult } from '@vibe-validate/git';
import { describe, expect, it } from 'vitest';

import { formatWorktreeDisplay } from '../../src/utils/format-worktree.js';

describe('formatWorktreeDisplay', () => {
  it('should format parent-only tree hash', () => {
    const treeHashResult: TreeHashResult = {
      hash: 'abc123def456ghi789jkl012mno345pqr678stu901',
    };

    const output = formatWorktreeDisplay(treeHashResult);

    // Should show truncated hash
    expect(output).toContain('abc123def456');
    expect(output).toContain('🌳 Working tree:');
    // Should NOT show submodule lines
    expect(output).not.toContain('└─');
  });

  it('should format tree hash with single submodule', () => {
    const treeHashResult: TreeHashResult = {
      hash: 'abc123def456ghi789jkl012mno345pqr678stu901',
      submoduleHashes: {
        'vendor/lib': 'def456ghi789jkl012mno345pqr678stu901vwx234',
      },
    };

    const output = formatWorktreeDisplay(treeHashResult);

    // Should show parent hash
    expect(output).toContain('abc123def456');
    expect(output).toContain('🌳 Working tree:');
    // Should show submodule with tree structure
    expect(output).toContain('└─ vendor/lib: def456ghi789');
  });

  it('should format tree hash with multiple submodules', () => {
    const treeHashResult: TreeHashResult = {
      hash: 'abc123def456ghi789jkl012mno345pqr678stu901',
      submoduleHashes: {
        'vendor/lib': 'def456ghi789jkl012mno345pqr678stu901vwx234',
        'themes/default': 'ghi789jkl012mno345pqr678stu901vwx234yz567',
      },
    };

    const output = formatWorktreeDisplay(treeHashResult);

    // Should show parent hash
    expect(output).toContain('abc123def456');
    expect(output).toContain('🌳 Working tree:');
    // Should show both submodules
    expect(output).toContain('└─ vendor/lib: def456ghi789');
    expect(output).toContain('└─ themes/default: ghi789jkl012');
  });
});

/**
 * Format worktree display for human-readable output
 */

import type { TreeHashResult } from '@vibe-validate/git';
import chalk from 'chalk';

/**
 * Format tree hash result for display (with submodule tree structure)
 *
 * @param treeHashResult - Tree hash result from getGitTreeHash
 * @param level - The validation level about to run
 * @returns Formatted string with tree structure
 *
 * @example
 * // Parent only:
 * // 🌳 Working tree: abc123def456... (level: commit)
 *
 * // With submodules:
 * // 🌳 Working tree: abc123def456... (level: full)
 * //    └─ submodule/path: def456ghi789...
 * //    └─ another/sub: ghi789jkl012...
 */
export function formatWorktreeDisplay(treeHashResult: TreeHashResult, level: string): string {
  const lines: string[] = [];

  // Parent tree hash (always present)
  lines.push(chalk.gray(`🌳 Working tree: ${treeHashResult.hash.slice(0, 12)}... (level: ${level})`));

  // Submodules (if present)
  if (treeHashResult.submoduleHashes) {
    for (const [path, treeHash] of Object.entries(treeHashResult.submoduleHashes)) {
      lines.push(chalk.gray(`   └─ ${path}: ${treeHash.slice(0, 12)}...`));
    }
  }

  return lines.join('\n');
}

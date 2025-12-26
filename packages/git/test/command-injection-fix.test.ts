/**
 * Security Test: Command Injection Prevention
 *
 * Verifies that git operations use spawn/spawnSync with array arguments
 * to prevent command injection attacks.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { describe, it, expect } from 'vitest';

describe('Command Injection Prevention', () => {
  it('should use spawnSync with array arguments in post-merge-cleanup', () => {
    const filePath = path.join(__dirname, '../src/post-merge-cleanup.ts');
    const content = fs.readFileSync(filePath, 'utf8');

    // Verify import uses spawnSync (not execSync)
    expect(content).toContain('import { spawnSync }');
    expect(content).not.toMatch(/import.*execSync.*from.*'child_process'/);

    // Verify no template literal git commands (would allow injection)
    expect(content).not.toMatch(/execSync\(`git/);
    expect(content).not.toMatch(/execSync\("git/);

    // Verify spawnSync is called with array arguments
    expect(content).toContain("spawnSync('git', args,");
  });

  it('should use centralized git-executor in branch-sync', () => {
    const filePath = path.join(__dirname, '../src/branch-sync.ts');
    const content = fs.readFileSync(filePath, 'utf8');

    // Verify import uses centralized git-executor (architectural mandate)
    expect(content).toContain("import { executeGitCommand } from './git-executor.js'");

    // Verify no direct spawn import (should use git-executor)
    expect(content).not.toContain("import { spawn }");

    // Verify no direct execSync usage (security)
    expect(content).not.toMatch(/import.*execSync.*from.*'child_process'/);

    // Verify executeGitCommand is called with array arguments
    expect(content).toContain('executeGitCommand(args,');

    // Verify no template literal git commands
    expect(content).not.toMatch(/executeGitCommand\(`/);
  });

  it('should not have shell injection vulnerabilities in git commands', () => {
    const filePath = path.join(__dirname, '../src/post-merge-cleanup.ts');
    const content = fs.readFileSync(filePath, 'utf8');

    // These patterns would indicate command injection vulnerabilities
    const vulnerablePatterns = [
      /git checkout \${/,
      /git branch -d "\${/,
      /git branch -D "\${/,
      /git fetch \${/,
      /git merge \${/,
      /git remote prune \${/,
    ];

    for (const pattern of vulnerablePatterns) {
      expect(content).not.toMatch(pattern);
    }
  });
});

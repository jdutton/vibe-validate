/**
 * Security Test: Command Injection Prevention
 *
 * Verifies that git operations use spawn/spawnSync with array arguments
 * to prevent command injection attacks.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

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

  it('should use spawn with array arguments in branch-sync', () => {
    const filePath = path.join(__dirname, '../src/branch-sync.ts');
    const content = fs.readFileSync(filePath, 'utf8');

    // Verify import uses spawn (not execSync)
    expect(content).toContain("import { spawn }");

    // Verify spawn is called with array arguments
    expect(content).toContain("spawn('git', args,");

    // Verify no template literal git commands
    expect(content).not.toMatch(/spawn\(`git/);
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

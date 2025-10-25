/**
 * Project ID Detection
 *
 * Detects a unique project identifier for lock scoping.
 * Used when locking.concurrencyScope=project to ensure
 * multiple directories (worktrees, clones) share the same lock.
 */

import { execSync } from 'child_process';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

/**
 * Extract project name from git remote URL
 *
 * Supports common formats:
 * - https://github.com/user/repo.git → repo
 * - git@github.com:user/repo.git → repo
 * - https://github.com/user/repo → repo
 *
 * @param remoteUrl - Git remote URL
 * @returns Project name or null
 */
function extractProjectFromGitUrl(remoteUrl: string): string | null {
  // Remove .git suffix if present
  const cleaned = remoteUrl.replace(/\.git$/, '');

  // Extract repo name from various formats
  // HTTPS: https://github.com/user/repo
  // SSH: git@github.com:user/repo
  const match = cleaned.match(/[/:]([^/]+)$/);

  return match ? match[1] : null;
}

/**
 * Get project ID from git remote
 *
 * Tries to extract project name from git remote URL.
 * Works for GitHub, GitLab, Bitbucket, and other git hosts.
 *
 * @param cwd - Directory to check (defaults to process.cwd())
 * @returns Project ID or null
 */
export function getProjectIdFromGit(cwd: string = process.cwd()): string | null {
  try {
    // Get remote URL for origin
    const remoteUrl = execSync('git config --get remote.origin.url', {
      cwd,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();

    if (!remoteUrl) {
      return null;
    }

    return extractProjectFromGitUrl(remoteUrl);
  } catch (_err) {
    // Not a git repo or no remote configured
    return null;
  }
}

/**
 * Get project ID from package.json
 *
 * Extracts the "name" field from package.json.
 * Removes scope prefix (e.g., @scope/package → package).
 *
 * @param cwd - Directory to check (defaults to process.cwd())
 * @returns Project ID or null
 */
export function getProjectIdFromPackageJson(cwd: string = process.cwd()): string | null {
  try {
    const packageJsonPath = join(cwd, 'package.json');

    if (!existsSync(packageJsonPath)) {
      return null;
    }

    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
    const name = packageJson.name;

    if (!name || typeof name !== 'string') {
      return null;
    }

    // Remove scope prefix (@scope/package → package)
    return name.replace(/^@[^/]+\//, '');
  } catch (_err) {
    return null;
  }
}

/**
 * Detect project ID with fallback chain
 *
 * Detection priority:
 * 1. Git remote URL (e.g., github.com/user/repo → repo)
 * 2. package.json name field (removes scope prefix)
 * 3. null (no detection possible)
 *
 * @param cwd - Directory to check (defaults to process.cwd())
 * @returns Detected project ID or null
 */
export function detectProjectId(cwd: string = process.cwd()): string | null {
  // Try git remote first (most reliable for worktrees/clones)
  const gitProject = getProjectIdFromGit(cwd);
  if (gitProject) {
    return gitProject;
  }

  // Fall back to package.json
  const packageProject = getProjectIdFromPackageJson(cwd);
  if (packageProject) {
    return packageProject;
  }

  // No detection possible
  return null;
}

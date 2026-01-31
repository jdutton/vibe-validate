#!/usr/bin/env tsx
/**
 * Pre-Publish Validation Check
 *
 * This script ensures the repository is in a publishable state:
 * 1. Git repository exists
 * 2. On main branch (or explicitly allow other branches)
 * 3. No uncommitted changes (clean working tree)
 * 4. No untracked files (except allowed patterns)
 * 5. All validation checks pass
 * 6. Package list synchronized with publish script
 * 7. All packages are built
 * 8. Workspace dependencies are correct
 * 9. All packages have proper "files" field
 * 10. All packages have required metadata (repository, author, license)
 * 11. CHANGELOG.md has entry for current version (publish mode only)
 *
 * Usage:
 *   tsx packages/dev-tools/src/pre-publish-check.ts [--allow-branch BRANCH] [--skip-git-checks]
 *   pnpm pre-publish [--allow-branch BRANCH] [--skip-git-checks]
 *
 * Exit codes:
 *   0 - Ready to publish
 *   1 - Not ready (with explanation)
 */

 
// File paths derived from PROJECT_ROOT and packagesDir constants (controlled, not user input)

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { executeGitCommand } from '../../git/dist/git-executor.js';
import { safeExecSync } from '../../utils/dist/safe-exec.js';


import { PROJECT_ROOT, log } from './common.js';
import { getMissingPackages } from './validate-package-list.js';

/**
 * Detect if running in CI environment
 */
function isCI(): boolean {
  // Using || for boolean coercion of env vars (empty string should be falsy)
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
  return !!(process.env['CI'] || process.env['GITHUB_ACTIONS'] || process.env['GITLAB_CI'] || process.env['CIRCLECI'] || process.env['TRAVIS'] || process.env['JENKINS_URL']);
}

/**
 * Get all publishable packages (non-private packages in packages/)
 */
function getPublishablePackages(packagesDir: string): Array<{ name: string; pkgJson: Record<string, unknown> }> {
  const result: Array<{ name: string; pkgJson: Record<string, unknown> }> = [];

  if (!existsSync(packagesDir)) {
    return result;
  }

  const packages = readdirSync(packagesDir, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name);

  for (const pkg of packages) {
    const pkgJsonPath = join(packagesDir, pkg, 'package.json');
    if (existsSync(pkgJsonPath)) {
      const pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf8')) as Record<string, unknown>;

      // Skip private packages
      if (pkgJson['private']) {
        continue;
      }

      result.push({ name: pkg, pkgJson });
    }
  }

  return result;
}

const IS_CI = isCI();

// Parse command-line arguments
const args = process.argv.slice(2);
let allowedBranch = 'main';
let allowCustomBranch = false;
let skipGitChecks = false;

let i = 0;
while (i < args.length) {
  const nextArg = args[i + 1];
  if (args[i] === '--allow-branch' && nextArg) {
    allowedBranch = nextArg;
    allowCustomBranch = true;
    i += 2;
  } else if (args[i] === '--skip-git-checks') {
    skipGitChecks = true;
    i += 1;
  } else if (args[i] === '--help' || args[i] === '-h') {
    console.log(`
Pre-Publish Validation Check

Usage:
  tsx packages/dev-tools/src/pre-publish-check.ts [OPTIONS]
  pnpm pre-publish [OPTIONS]

Options:
  --allow-branch BRANCH  Allow publishing from a specific branch (default: main)
  --skip-git-checks      Skip git-related checks (branch, uncommitted changes, untracked files)
                         Use this when running in vibe-validate during development
  --help, -h             Show this help message

Exit codes:
  0 - Ready to publish
  1 - Not ready (with explanation)
    `);
    process.exit(0);
  } else {
    console.error(`Unknown option: ${args[i]}`);
    console.error('Usage: tsx packages/dev-tools/src/pre-publish-check.ts [OPTIONS]');
    process.exit(1);
  }
  i++;
}

console.log(IS_CI ? '🔍 Pre-Publish Validation Check (CI Mode)' : '🔍 Pre-Publish Validation Check');
console.log('==========================================');
console.log('');

// Check 1: Git repository exists
try {
  const result = executeGitCommand(['rev-parse', '--git-dir']);
  if (!result.success) {
    throw new Error('Not a git repository');
  }
  log('✓ Git repository detected', 'green');
} catch (error) {
  log('✗ Not a git repository', 'red');
  if (error instanceof Error && error.message.includes('ENOENT')) {
    console.log('  Git executable not found. Please install git.');
  }
  process.exit(1);
}

// Check 2: Current branch (skip in CI - uses detached HEAD on tag checkout)
if (IS_CI || skipGitChecks) {
  log('⊘ Branch check skipped (CI mode or --skip-git-checks)', 'yellow');
} else {
  let currentBranch: string;
  try {
    const result = executeGitCommand(['rev-parse', '--abbrev-ref', 'HEAD'], {
      encoding: 'utf8',
    });
    if (!result.success) {
      throw new Error('Failed to determine current branch');
    }
    currentBranch = result.stdout;
  } catch (error) {
    log('✗ Failed to determine current branch', 'red');
    if (error instanceof Error && error.message.includes('HEAD')) {
      console.log('  You may be in a detached HEAD state. Check git status.');
    }
    process.exit(1);
  }

  if (currentBranch !== allowedBranch) {
    log(`✗ Not on ${allowedBranch} branch (current: ${currentBranch})`, 'red');
    console.log(`  Tip: Run 'git checkout ${allowedBranch}' or use --allow-branch flag`);
    process.exit(1);
  }

  if (allowCustomBranch && currentBranch !== 'main') {
    log(`⚠ On branch: ${currentBranch} (explicitly allowed)`, 'yellow');
  } else {
    log('✓ On main branch', 'green');
  }
}

// Check 3: Working tree is clean (skip in CI - always starts with clean checkout)
if (IS_CI || skipGitChecks) {
  log('⊘ Uncommitted changes check skipped (CI mode or --skip-git-checks)', 'yellow');
} else {
  let hasUncommittedChanges = false;
  const result = executeGitCommand(['diff-index', '--quiet', 'HEAD', '--'], {
    ignoreErrors: true,
  });

  if (!result.success) {
    // Expected failure: uncommitted changes detected (non-zero exit from diff-index)
    // This is normal operation - the command exits non-zero when changes exist
    hasUncommittedChanges = true;
  }

  if (hasUncommittedChanges) {
    log('✗ Uncommitted changes detected', 'red');
    console.log('');

    const statusResult = executeGitCommand(['status', '--short'], {
      encoding: 'utf8',
      ignoreErrors: true,
    });

    if (statusResult.success) {
      console.log(statusResult.stdout);
    } else {
      // Non-critical: git status display failed, but we already know changes exist
      // Continue with generic error message below
      console.log('  (Unable to show git status details)');
      if (statusResult.stderr) {
        console.error(`  Debug: ${statusResult.stderr}`);
      }
    }

    console.log('  Please commit or stash your changes before publishing');
    process.exit(1);
  }
  log('✓ No uncommitted changes', 'green');
}

// Check 4: No untracked files (skip in CI - not applicable)
if (IS_CI || skipGitChecks) {
  log('⊘ Untracked files check skipped (CI mode or --skip-git-checks)', 'yellow');
} else {
  let untracked = '';
  const untrackedResult = executeGitCommand(['ls-files', '--others', '--exclude-standard'], {
    encoding: 'utf8',
    ignoreErrors: true,
  });

  if (untrackedResult.success) {
    untracked = untrackedResult.stdout;
  } else {
    // Non-critical: untracked files check is optional (best-effort)
    // Continue with empty untracked list if git command fails
    log('⚠ Warning: Could not check untracked files (git not available)', 'yellow');
    // Continue with empty untracked string (no files to check)
  }

  if (untracked) {
    // Filter out allowed patterns
    const allowedPatterns = [
      /node_modules/,
      /dist/,
      /\.DS_Store/,
      /TODO\.md/,
    ];

    const untrackedLines = untracked.split('\n').filter(line => line.trim());
    const filteredUntracked = untrackedLines.filter(line => {
      return !allowedPatterns.some(pattern => pattern.test(line));
    });

    if (filteredUntracked.length > 0) {
      log('✗ Untracked files detected', 'red');
      console.log('');
      for (const file of filteredUntracked) {
        console.log(file);
      }
      console.log('');
      console.log('  Please add these files to git or .gitignore before publishing');
      process.exit(1);
    }
  }
  log('✓ No untracked files', 'green');
}

// Check 5: Run validation (skip when called from within vibe-validate)
if (skipGitChecks) {
  log('⊘ Validation check skipped (already running in vibe-validate)', 'yellow');
} else {
  console.log('');
  console.log('Running validation checks...');

  try {
    safeExecSync('pnpm', ['validate'], { stdio: ['inherit', 'inherit', 'inherit'], cwd: PROJECT_ROOT });
    log('✓ All validation checks passed', 'green');
  } catch (error) {
    console.log('');
    log('✗ Validation failed', 'red');
    console.log('  Check the output above and fix all issues before publishing');
    const message = error instanceof Error ? error.message : '';
    if (message.includes('ENOENT')) {
      console.log('  (pnpm not found - install pnpm to run validation)');
    }
    process.exit(1);
  }
}

// Check 6: Package list synchronization
console.log('');
console.log('Checking package list synchronization...');

const packagesDir = join(PROJECT_ROOT, 'packages');

try {
  const missingPackages = getMissingPackages(PROJECT_ROOT);

  if (missingPackages.length > 0) {
    log('✗ Package list out of sync!', 'red');
    console.log('');
    console.log('  The following packages exist in packages/ but are not declared:');
    for (const pkg of missingPackages) {
      console.log(`    ${pkg}`);
    }
    console.log('');
    console.log('  Update packages/dev-tools/src/package-lists.ts:');
    console.log('    - Add to PUBLISHED_PACKAGES array if it should be published');
    console.log('    - Add to SKIP_PACKAGES array if it should not be published');
    process.exit(1);
  }

  log('✓ All packages accounted for', 'green');
} catch (error) {
  log('✗ Failed to check package list', 'red');
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
}

// Check 7: Packages are built
console.log('');
console.log('Checking package builds...');

const missingBuilds: string[] = [];

try {
  const publishablePackages = getPublishablePackages(packagesDir);

  for (const { name: pkg, pkgJson } of publishablePackages) {
    // Only check for dist/ if package has a build script
    const scripts = pkgJson['scripts'] as Record<string, string> | undefined;
    const hasBuildScript = scripts?.['build'];
    if (!hasBuildScript) {
      continue;
    }

    const distDir = join(packagesDir, pkg, 'dist');
    if (!existsSync(distDir)) {
      missingBuilds.push(join('packages', pkg, ''));
    }
  }
} catch (error) {
  log('✗ Failed to check package builds', 'red');
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
}

if (missingBuilds.length > 0) {
  log('✗ Missing build outputs', 'red');
  for (const pkg of missingBuilds) {
    console.log(pkg);
  }
  console.log('  Run \'pnpm build\' to build all packages');
  process.exit(1);
}
log('✓ All packages built', 'green');

// Check 8: Workspace dependencies (workspace:* is expected and handled by pnpm during publish)
console.log('');
console.log('Checking workspace dependencies...');

try {
  const publishablePackages = getPublishablePackages(packagesDir);
  let workspaceCount = 0;

  for (const { pkgJson } of publishablePackages) {
    const allDeps = {
      ...(pkgJson['dependencies'] as Record<string, string> | undefined),
      ...(pkgJson['devDependencies'] as Record<string, string> | undefined),
      ...(pkgJson['peerDependencies'] as Record<string, string> | undefined),
    };

    for (const depVersion of Object.values(allDeps)) {
      if (typeof depVersion === 'string' && depVersion.startsWith('workspace:')) {
        workspaceCount++;
      }
    }
  }

  if (workspaceCount > 0) {
    log(`✓ Found ${workspaceCount} workspace dependencies (pnpm will resolve during publish)`, 'green');
  } else {
    log('✓ No workspace dependencies', 'green');
  }
} catch (error) {
  log('✗ Failed to check workspace dependencies', 'red');
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
}

// Check 9: Packages have proper "files" field for npm publish
console.log('');
console.log('Checking package "files" fields...');

try {
  const publishablePackages = getPublishablePackages(packagesDir);
  const missingFiles: string[] = [];
  const missingDist: string[] = [];

  for (const { name: pkg, pkgJson } of publishablePackages) {
    const files = pkgJson['files'] as string[] | undefined;

    // Check if files field exists
    if (!files || files.length === 0) {
      missingFiles.push(pkg);
      continue;
    }

    // For packages with build scripts, verify dist is included
    const scripts = pkgJson['scripts'] as Record<string, string> | undefined;
    const hasBuildScript = scripts?.['build'];
    if (hasBuildScript) {
      const hasDistEntry = files.some(f => f === 'dist' || f === 'dist/');
      if (!hasDistEntry) {
        missingDist.push(pkg);
      }
    }

    // For packages with bin field, verify bin path is covered by files array
    const bin = pkgJson['bin'];
    if (bin) {
      const binPaths = typeof bin === 'string' ? [bin] : Object.values(bin);
      for (const binPath of binPaths) {
        // Check if bin path is covered by any entry in files array
        const isCovered = files.some(fileEntry => {
          // Normalize paths (remove leading ./)
          const normalizedBin = binPath.replace(/^\.\//, '');
          const normalizedFile = fileEntry.replace(/^\.\//, '');
          return normalizedBin.startsWith(normalizedFile + '/');
        });

        if (!isCovered && !files.includes('bin')) {
          missingFiles.push(`${pkg} (bin "${binPath}" not covered by files array)`);
          break; // Only report once per package
        }
      }
    }
  }

  if (missingFiles.length > 0 || missingDist.length > 0) {
    log('✗ Some packages missing "files" configuration', 'red');
    if (missingFiles.length > 0) {
      console.log('\nPackages without "files" field:');
      for (const pkg of missingFiles) {
        console.log(`  ${pkg}`);
      }
    }
    if (missingDist.length > 0) {
      console.log('\nPackages missing "dist" in files field:');
      for (const pkg of missingDist) {
        console.log(`  ${pkg}`);
      }
    }
    console.log('\nAdd "files" field to package.json:');
    console.log('  "files": ["dist", "README.md"]');
    process.exit(1);
  }

  log('✓ All packages have proper "files" configuration', 'green');
} catch (error) {
  log('✗ Failed to check package files configuration', 'red');
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
}

// Check 10: Required package metadata (repository, author, license)
console.log('');
console.log('Checking required package metadata...');

try {
  const publishablePackages = getPublishablePackages(packagesDir);
  const missingMetadata: Array<{ pkg: string; missing: string[] }> = [];

  for (const { name: pkg, pkgJson } of publishablePackages) {
    const missing: string[] = [];

    // Check for repository field
    const repository = pkgJson['repository'];
    if (!repository) {
      missing.push('repository');
    } else if (typeof repository === 'object') {
      const repoObj = repository as Record<string, unknown>;
      if (!repoObj['url']) {
        missing.push('repository.url');
      }
    }

    // Check for author field
    if (!pkgJson['author']) {
      missing.push('author');
    }

    // Check for license field
    if (!pkgJson['license']) {
      missing.push('license');
    }

    if (missing.length > 0) {
      missingMetadata.push({ pkg, missing });
    }
  }

  if (missingMetadata.length > 0) {
    log('✗ Some packages missing required metadata', 'red');
    console.log('');
    console.log('  Packages with missing fields:');
    for (const { pkg, missing } of missingMetadata) {
      console.log(`    ${pkg}:`);
      for (const field of missing) {
        console.log(`      - ${field}`);
      }
    }
    console.log('');
    console.log('  Add these fields to package.json:');
    console.log('    "repository": {');
    console.log('      "type": "git",');
    console.log('      "url": "https://github.com/jdutton/vibe-validate.git",');
    console.log('      "directory": "packages/PACKAGE_NAME"');
    console.log('    },');
    console.log('    "author": "Jeff Dutton",');
    console.log('    "license": "MIT"');
    process.exit(1);
  }

  log('✓ All packages have required metadata', 'green');
} catch (error) {
  log('✗ Failed to check package metadata', 'red');
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
}

// Check 11: CHANGELOG.md has entry for current version (skip in development mode)
if (skipGitChecks) {
  log('⊘ CHANGELOG check skipped (development mode)', 'yellow');
} else {
  console.log('');
  console.log('Checking CHANGELOG.md...');

  try {
    // Read version from core package (monorepo canonical version)
    const corePkgJsonPath = join(packagesDir, 'core', 'package.json');
    if (!existsSync(corePkgJsonPath)) {
      throw new Error('Core package.json not found');
    }

    const corePkgJson = JSON.parse(readFileSync(corePkgJsonPath, 'utf8')) as Record<string, unknown>;
    const version = corePkgJson['version'];
    if (typeof version !== 'string') {
      throw new Error('Version not found in core package.json');
    }

    // Read CHANGELOG.md
    const changelogPath = join(PROJECT_ROOT, 'CHANGELOG.md');
    if (!existsSync(changelogPath)) {
      log('✗ CHANGELOG.md not found', 'red');
      console.log('  Create CHANGELOG.md to document releases');
      process.exit(1);
    }

    const changelogContent = readFileSync(changelogPath, 'utf8');

    // Look for version entry: ## [X.Y.Z] - YYYY-MM-DD or ## [X.Y.Z-rc.N] - YYYY-MM-DD
    // Escape dots in version string for regex matching
    const escapedVersion = version.replaceAll('.', String.raw`\.`);
    // eslint-disable-next-line security/detect-non-literal-regexp -- version from package.json is trusted
    const versionPattern = new RegExp(String.raw`^## \[${escapedVersion}\] - \d{4}-\d{2}-\d{2}`, 'm');

    if (!versionPattern.test(changelogContent)) {
      log(`✗ CHANGELOG.md missing entry for version ${version}`, 'red');
      console.log('');
      console.log('  Recovery instructions:');
      console.log(`  1. Add version entry to CHANGELOG.md:`);
      console.log(`     ## [${version}] - ${new Date().toISOString().split('T')[0]}`);
      console.log('  2. Document changes under the version header');
      console.log('  3. Run pre-publish-check again');
      console.log('');
      process.exit(1);
    }

    log(`✓ CHANGELOG.md has entry for version ${version}`, 'green');
  } catch (error) {
    log('✗ Failed to check CHANGELOG.md', 'red');
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  }
}

// Success!
console.log('');
log('✅ Repository is ready to publish!', 'green');
console.log('');
console.log('Next steps:');
console.log('  1. Update package versions: pnpm bump-version patch (or minor/major)');
console.log('  2. Commit version changes: git commit -am \'chore: Release vX.Y.Z\'');
console.log('  3. Create git tag: git tag -a vX.Y.Z -m \'Release vX.Y.Z\'');
console.log('  4. Push to GitHub: git push origin main --tags');
console.log('  5. GitHub Actions will automatically publish to npm');
console.log('');

process.exit(0);

/**
 * Shared package list validation logic
 *
 * Used by both pre-publish-check.ts and publish-with-rollback.ts
 * to ensure all packages in packages/ are accounted for.
 */

 
// File paths derived from PROJECT_ROOT and 'packages' constants (controlled, not user input)

import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { PUBLISHED_PACKAGES, SKIP_PACKAGES } from './package-lists.js';

/**
 * Validate that all packages in packages/ are declared in either
 * PUBLISHED_PACKAGES or SKIP_PACKAGES.
 *
 * @param projectRoot - Root directory of the project
 * @returns Array of missing package names (empty if all accounted for)
 */
export function getMissingPackages(projectRoot: string): string[] {
  const packagesPath = join(projectRoot, 'packages');

  if (!existsSync(packagesPath)) {
    throw new Error('packages/ directory not found');
  }

  const actualPackages = readdirSync(packagesPath, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name);

  const declaredPackages = new Set<string>([...PUBLISHED_PACKAGES, ...SKIP_PACKAGES]);
  const missingPackages: string[] = [];

  for (const pkg of actualPackages) {
    if (!declaredPackages.has(pkg)) {
      missingPackages.push(pkg);
    }
  }

  return missingPackages;
}

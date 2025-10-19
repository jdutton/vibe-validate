/**
 * Configuration Loader
 *
 * Loads and validates vibe-validate configuration from project root.
 */

import { join } from 'path';
import { existsSync } from 'fs';
import { findAndLoadConfig } from '@vibe-validate/config';
import type { VibeValidateConfig } from '@vibe-validate/config';
import chalk from 'chalk';

/**
 * Load vibe-validate configuration from project root
 *
 * Searches for configuration files:
 * - vibe-validate.config.yaml (primary format)
 * - vibe-validate.config.mjs (deprecated, legacy support only)
 *
 * @param cwd Current working directory (defaults to process.cwd())
 * @returns Configuration object or null if not found
 */
export async function loadConfig(cwd?: string): Promise<VibeValidateConfig | null> {
  const searchDir = cwd ?? process.cwd();

  try {
    // Use the config package's finder which searches for config files in the directory
    const config = await findAndLoadConfig(searchDir);
    return config ?? null;
  } catch (error) {
    if (error instanceof Error) {
      console.error(chalk.red(`❌ Failed to load configuration: ${error.message}`));
    }
    return null;
  }
}

/**
 * Check if a config file exists in the given directory
 *
 * @param cwd Current working directory
 * @returns True if config file exists
 */
export function configExists(cwd?: string): boolean {
  const searchDir = cwd ?? process.cwd();
  const configPaths = [
    'vibe-validate.config.yaml',
    'vibe-validate.config.mjs', // Legacy (deprecated)
  ];

  return configPaths.some(path => existsSync(join(searchDir, path)));
}

/**
 * Find config file path if it exists
 *
 * @param cwd Current working directory
 * @returns Config file path or null if not found
 */
export function findConfigPath(cwd?: string): string | null {
  const searchDir = cwd ?? process.cwd();
  const configPaths = [
    'vibe-validate.config.yaml',
    'vibe-validate.config.mjs', // Legacy (deprecated)
  ];

  for (const path of configPaths) {
    const fullPath = join(searchDir, path);
    if (existsSync(fullPath)) {
      return fullPath;
    }
  }

  return null;
}

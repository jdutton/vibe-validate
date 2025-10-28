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
 * Searches for vibe-validate.config.yaml in the current directory.
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
  const configPath = 'vibe-validate.config.yaml';

  return existsSync(join(searchDir, configPath));
}

/**
 * Find config file path if it exists
 *
 * @param cwd Current working directory
 * @returns Config file path or null if not found
 */
export function findConfigPath(cwd?: string): string | null {
  const searchDir = cwd ?? process.cwd();
  const configPath = 'vibe-validate.config.yaml';
  const fullPath = join(searchDir, configPath);

  return existsSync(fullPath) ? fullPath : null;
}

/**
 * Load configuration with detailed validation errors
 *
 * When config loading fails, this function attempts to parse the file
 * and validate it to provide specific error messages.
 *
 * @param cwd Current working directory (defaults to process.cwd())
 * @returns Object with config, errors, and file path
 */
export async function loadConfigWithErrors(cwd?: string): Promise<{
  config: VibeValidateConfig | null;
  errors: string[] | null;
  filePath: string | null;
}> {
  const searchDir = cwd ?? process.cwd();
  const configPath = findConfigPath(searchDir);

  if (!configPath) {
    return { config: null, errors: null, filePath: null };
  }

  // Always parse and validate to get detailed errors
  try {
    const { readFileSync } = await import('fs');
    const { parse: parseYaml } = await import('yaml');
    const { safeValidateConfig } = await import('@vibe-validate/config');

    const content = readFileSync(configPath, 'utf-8');
    const raw = parseYaml(content);

    // Remove $schema property if present (used for IDE support only)
    if (raw && typeof raw === 'object' && '$schema' in raw) {
      delete (raw as Record<string, unknown>)['$schema'];
    }

    const validation = safeValidateConfig(raw);
    if (!validation.success) {
      return {
        config: null,
        errors: validation.errors ?? ['Unknown validation error'],
        filePath: configPath
      };
    }

    // Validation succeeded
    return {
      config: validation.data ?? null,
      errors: null,
      filePath: configPath
    };
  } catch (parseError) {
    // YAML parsing failed
    if (parseError instanceof Error) {
      return {
        config: null,
        errors: [`YAML syntax error: ${parseError.message}`],
        filePath: configPath
      };
    }
    return {
      config: null,
      errors: ['YAML syntax error - check for missing colons, indentation, or invalid characters'],
      filePath: configPath
    };
  }
}

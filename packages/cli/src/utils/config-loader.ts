/**
 * Configuration Loader
 *
 * Loads and validates vibe-validate configuration from project root.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';

import { findAndLoadConfig, parseConfigContent } from '@vibe-validate/config';
import type { VibeValidateConfig } from '@vibe-validate/config';
import chalk from 'chalk';

// Constants (extracted to avoid duplication warnings)
const CONFIG_FILENAME = 'vibe-validate.config.yaml';

/**
 * Find configuration file by walking up directory tree
 *
 * Searches for vibe-validate.config.yaml starting from cwd and walking up
 * to the root directory, similar to how ESLint/Prettier find their config files.
 *
 * @param startDir Directory to start searching from
 * @returns Path to config file or null if not found
 */
export function findConfigUp(startDir: string): string | null {
  let currentDir = resolve(startDir);
  const root = resolve('/');

  // Walk up directory tree until we find config or reach root
  while (currentDir !== root) {
    const configPath = join(currentDir, CONFIG_FILENAME);
    if (existsSync(configPath)) {
      return currentDir;
    }

    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) {
      // Reached root (shouldn't happen, but safety check)
      break;
    }
    currentDir = parentDir;
  }

  // Check root directory as final attempt
  const rootConfigPath = join(root, CONFIG_FILENAME);
  if (existsSync(rootConfigPath)) {
    return root;
  }

  return null;
}

/**
 * Load vibe-validate configuration from project root
 *
 * Searches for vibe-validate.config.yaml by walking up the directory tree
 * from the current working directory to the root.
 *
 * @param cwd Current working directory (defaults to process.cwd())
 * @returns Configuration object or null if not found
 */
export async function loadConfig(cwd?: string): Promise<VibeValidateConfig | null> {
  const searchDir = cwd ?? process.cwd();

  try {
    // Walk up directory tree to find config
    const configDir = findConfigUp(searchDir);
    if (!configDir) {
      return null;
    }

    // Use the config package's finder to load from the found directory
    const config = await findAndLoadConfig(configDir);
    return config ?? null;
  } catch (error) {
    if (error instanceof Error) {
      console.error(chalk.red(`❌ Failed to load configuration: ${error.message}`));
    }
    return null;
  }
}

/** The config file a configuration was parsed from, and the exact text parsed */
export interface ConfigSource {
  path: string;
  text: string;
}

/**
 * Load configuration and return both config and the directory where it was found
 *
 * Useful for features that need to know the project root (like locking). The
 * configuration is parsed from `source.text`, read once, so a caller can tell
 * whether the file still holds what it runs (`configFileHolds`).
 *
 * @param cwd Current working directory (defaults to process.cwd())
 * @returns Object with config, configDir and source, or null if not found or invalid
 */
export async function loadConfigWithDir(cwd?: string): Promise<{
  config: VibeValidateConfig;
  configDir: string;
  source: ConfigSource;
} | null> {
  const searchDir = cwd ?? process.cwd();

  // Walk up directory tree to find config
  const configDir = findConfigUp(searchDir);
  if (!configDir) {
    return null;
  }
  const path = join(configDir, CONFIG_FILENAME);

  try {
    const text = readFileSync(path, 'utf-8');
    const config = await parseConfigContent(text, configDir);
    return { config, configDir, source: { path, text } };
  } catch {
    // Invalid or unreadable: loadConfigWithErrors reports why
    return null;
  }
}

/**
 * Whether the config file still holds the text a configuration was parsed from
 *
 * @param source - Where the configuration came from (from `loadConfigWithDir`)
 * @returns false if the file changed or cannot be read
 */
export function configFileHolds(source: ConfigSource): boolean {
  try {
    return readFileSync(source.path, 'utf-8') === source.text;
  } catch {
    return false;
  }
}

/**
 * Check if a config file exists (searches up directory tree)
 *
 * @param cwd Current working directory
 * @returns True if config file exists
 */
export function configExists(cwd?: string): boolean {
  const searchDir = cwd ?? process.cwd();
  return findConfigUp(searchDir) !== null;
}

/**
 * Find config file path if it exists (searches up directory tree)
 *
 * @param cwd Current working directory
 * @returns Config file path or null if not found
 */
export function findConfigPath(cwd?: string): string | null {
  const searchDir = cwd ?? process.cwd();
  const configDir = findConfigUp(searchDir);

  if (!configDir) {
    return null;
  }

  return join(configDir, CONFIG_FILENAME);
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
    const { readFileSync } = await import('node:fs');
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

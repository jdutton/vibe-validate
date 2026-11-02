/**
 * Configuration Loader
 *
 * Loads and resolves vibe-validate configuration from YAML files.
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

import { parse as parseYaml } from 'yaml';

import { validateConfig, type VibeValidateConfig } from './schema.js';

/**
 * Configuration file name
 *
 * Only YAML format is supported.
 */
export const CONFIG_FILE_NAME = 'vibe-validate.config.yaml';

/**
 * Load configuration from a file path
 *
 * @param configPath - Absolute path to config file (must be .yaml)
 * @returns Loaded and validated configuration
 * @throws Error if file cannot be loaded or is invalid
 */
export async function loadConfigFromFile(
  configPath: string
): Promise<VibeValidateConfig> {
  const absolutePath = resolve(configPath);

  // Only YAML files supported
  if (!absolutePath.endsWith('.yaml')) {
    throw new Error(
      `Unsupported config file format: ${absolutePath}\n` +
      `Only .yaml format is supported.\n` +
      `Please use vibe-validate.config.yaml`
    );
  }

  return await parseConfigContent(readFileSync(absolutePath, 'utf-8'), dirname(absolutePath));
}

/**
 * Parse and validate configuration file content
 *
 * For a caller that must know which text the configuration came from.
 *
 * @param content - The YAML text of a config file
 * @param basePath - Directory of the config file
 * @returns Validated configuration
 * @throws Error if the content is not a valid configuration
 */
export async function parseConfigContent(
  content: string,
  basePath: string
): Promise<VibeValidateConfig> {
  const raw = parseYaml(content);

  // Remove $schema property if present (used for IDE support only)
  if (raw && typeof raw === 'object' && '$schema' in raw) {
    delete (raw as Record<string, unknown>)['$schema'];
  }

  return await resolveConfig(raw, basePath);
}

/**
 * Find and load configuration from current working directory
 *
 * Searches for vibe-validate.config.yaml and loads it if found.
 *
 * @param cwd - Working directory to search (default: process.cwd())
 * @returns Loaded configuration or undefined if no config found
 */
export async function findAndLoadConfig(
  cwd: string = process.cwd()
): Promise<VibeValidateConfig | undefined> {
  const configPath = resolve(cwd, CONFIG_FILE_NAME);

  try {
    return await loadConfigFromFile(configPath);
  } catch {
    // Config file doesn't exist or failed to load - return undefined
    return undefined;
  }
}

/**
 * Resolve and validate configuration
 *
 * @param raw - Raw configuration object
 * @param _basePath - Base directory (unused, kept for compatibility)
 * @returns Validated configuration
 */
async function resolveConfig(
  raw: unknown,
  _basePath: string
): Promise<VibeValidateConfig> {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('Configuration must be an object');
  }

  // Validate configuration
  return validateConfig(raw);
}

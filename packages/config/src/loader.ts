/**
 * Configuration Loader
 *
 * Loads and resolves vibe-validate configuration from files,
 * including preset resolution and config extension.
 */

import { resolve, dirname } from 'path';
import { readFileSync } from 'fs';
import { pathToFileURL } from 'url';
import { validateConfig, type VibeValidateConfig } from './schema.js';
import { mergeConfig } from './define-config.js';
import { getPreset } from './presets/index.js';

/**
 * Configuration file names to search for (in order)
 */
export const CONFIG_FILE_NAMES = [
  'vibe-validate.config.ts',
  'vibe-validate.config.mts',
  'vibe-validate.config.js',
  'vibe-validate.config.mjs',
  'vibe-validate.config.json',
  '.vibe-validate.json',
];

/**
 * Load configuration from a file path
 *
 * @param configPath - Absolute path to config file
 * @returns Loaded and validated configuration
 * @throws Error if file cannot be loaded or is invalid
 */
export async function loadConfigFromFile(
  configPath: string
): Promise<VibeValidateConfig> {
  const absolutePath = resolve(configPath);

  // JSON files
  if (absolutePath.endsWith('.json')) {
    const content = readFileSync(absolutePath, 'utf-8');
    const raw = JSON.parse(content);
    return await resolveConfig(raw, dirname(absolutePath));
  }

  // TypeScript files - use tsx for loading
  if (absolutePath.endsWith('.ts') || absolutePath.endsWith('.mts')) {
    // Use tsx to load TypeScript files
    const { register } = await import('tsx/esm/api');
    const unregister = register();

    try {
      // Add cache-busting timestamp to force fresh load
      const fileUrl = pathToFileURL(absolutePath).href + '?t=' + Date.now();
      const module = await import(fileUrl);
      const raw = module.default || module;
      return await resolveConfig(raw, dirname(absolutePath));
    } finally {
      unregister();
    }
  }

  // JavaScript files (ES modules)
  const fileUrl = pathToFileURL(absolutePath).href;
  const module = await import(fileUrl);
  const raw = module.default || module;

  return await resolveConfig(raw, dirname(absolutePath));
}

/**
 * Find and load configuration from current working directory
 *
 * Searches for config files in order and loads the first one found.
 *
 * @param cwd - Working directory to search (default: process.cwd())
 * @returns Loaded configuration or undefined if no config found
 */
export async function findAndLoadConfig(
  cwd: string = process.cwd()
): Promise<VibeValidateConfig | undefined> {
  for (const fileName of CONFIG_FILE_NAMES) {
    const configPath = resolve(cwd, fileName);

    try {
      return await loadConfigFromFile(configPath);
    } catch (_err) {
      // File doesn't exist or can't be loaded - try next
      continue;
    }
  }

  return undefined;
}

/**
 * Resolve configuration with preset and extends support
 *
 * @param raw - Raw configuration object
 * @param basePath - Base directory for resolving extends paths
 * @returns Resolved and validated configuration
 */
async function resolveConfig(
  raw: unknown,
  basePath: string
): Promise<VibeValidateConfig> {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('Configuration must be an object');
  }

  const config = raw as Partial<VibeValidateConfig>;

  // Step 1: Resolve preset if specified
  let baseConfig: VibeValidateConfig | undefined;

  if (config.preset) {
    baseConfig = getPreset(config.preset);
    if (!baseConfig) {
      throw new Error(`Unknown preset: ${config.preset}`);
    }
  }

  // Step 2: Resolve extends if specified
  if (config.extends) {
    // Check if extends is a preset name or a file path
    const extendedConfig = getPreset(config.extends);

    if (extendedConfig) {
      // It's a preset name
      baseConfig = baseConfig
        ? mergeConfig(baseConfig, extendedConfig)
        : extendedConfig;
    } else {
      // It's a file path - resolve relative to basePath
      const extendsPath = resolve(basePath, config.extends);
      const fileConfig = await loadConfigFromFile(extendsPath);
      baseConfig = baseConfig
        ? mergeConfig(baseConfig, fileConfig)
        : fileConfig;
    }
  }

  // Step 3: Merge user config with base
  const finalConfig = baseConfig
    ? mergeConfig(baseConfig, config)
    : (config as VibeValidateConfig);

  // Step 4: Validate final configuration
  return validateConfig(finalConfig);
}

/**
 * Load configuration with fallback to default preset
 *
 * Searches for config file, falls back to typescript-library preset if not found.
 *
 * @param cwd - Working directory (default: process.cwd())
 * @returns Configuration (user config or default preset)
 */
export async function loadConfigWithFallback(
  cwd: string = process.cwd()
): Promise<VibeValidateConfig> {
  const config = await findAndLoadConfig(cwd);

  if (config) {
    return config;
  }

  // Fallback to default preset
  const defaultPreset = getPreset('typescript-library');
  if (!defaultPreset) {
    throw new Error('Default preset not found');
  }

  return defaultPreset;
}

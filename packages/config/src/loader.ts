/**
 * Configuration Loader
 *
 * Loads and resolves vibe-validate configuration from files,
 * including preset resolution and config extension.
 *
 * SECURITY MODEL:
 *
 * This loader executes user-provided configuration files as code (TypeScript/JavaScript)
 * or parses them as data (JSON). This is intentional and necessary for flexibility,
 * but has security implications:
 *
 * **Trust Boundary**: Configuration files are treated as TRUSTED CODE.
 * - Config files can execute arbitrary JavaScript/TypeScript
 * - Config files define shell commands that will be executed during validation
 * - Users MUST only use config files from trusted sources
 *
 * **No Sandboxing**: Configuration files run with full process permissions.
 * - They have access to the file system, network, environment variables
 * - They can import arbitrary npm packages
 * - They can modify process.env or global state
 *
 * **Security Responsibilities**:
 * - **Users**: Only use configs from trusted sources (own code, official presets)
 * - **Preset Authors**: Ensure presets don't execute untrusted commands
 * - **This Package**: Validate config schema, but cannot prevent malicious code execution
 *
 * **Mitigations**:
 * - Configuration schema validation (Zod) ensures structure is correct
 * - Git command injection prevention (array-based spawn, no shell)
 * - No automatic config downloads from remote sources
 * - Presets are vetted and included in this package
 *
 * See SECURITY.md for complete security considerations.
 */

import { resolve, dirname } from 'path';
import { readFileSync } from 'fs';
import { pathToFileURL } from 'url';
import { load as parseYaml } from 'js-yaml';
import { validateConfig, type VibeValidateConfig } from './schema.js';
import { mergeConfig } from './define-config.js';
import { getPreset } from './presets/index.js';

/**
 * Configuration file names to search for (in order)
 *
 * YAML is the primary and recommended format.
 * .mjs is legacy (deprecated) - supported for migration only.
 */
export const CONFIG_FILE_NAMES = [
  'vibe-validate.config.yaml',
  'vibe-validate.config.mjs', // DEPRECATED: Legacy format, will be removed in v1.0
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

  // YAML files (primary format)
  if (absolutePath.endsWith('.yaml')) {
    const content = readFileSync(absolutePath, 'utf-8');
    const raw = parseYaml(content);

    // Remove $schema property if present (used for IDE support only)
    if (raw && typeof raw === 'object' && '$schema' in raw) {
      delete (raw as Record<string, unknown>)['$schema'];
    }

    return await resolveConfig(raw, dirname(absolutePath));
  }

  // Legacy .mjs files (DEPRECATED - will be removed in v1.0)
  if (absolutePath.endsWith('.mjs')) {
    console.warn('⚠️  WARNING: .mjs config format is deprecated and will be removed in v1.0');
    console.warn('   Please migrate to vibe-validate.config.yaml');
    console.warn('   Run: vibe-validate doctor for migration guidance\n');

    const fileUrl = pathToFileURL(absolutePath).href;
    const module = await import(fileUrl);
    const raw = module.default || module;

    return await resolveConfig(raw, dirname(absolutePath));
  }

  throw new Error(
    `Unsupported config file format: ${absolutePath}\n` +
    `Only .yaml and .mjs (deprecated) formats are supported.\n` +
    `Please use vibe-validate.config.yaml`
  );
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

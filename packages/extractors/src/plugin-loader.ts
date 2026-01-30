/**
 * Plugin Loader
 *
 * Discovers and loads external extractor plugins from filesystem and npm packages.
 * Provides security validation and interface compliance checking.
 *
 * @package @vibe-validate/extractors
 */

import { access, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import type { ExtractorPlugin } from './types.js';

/**
 * Plugin source configuration
 */
export type PluginSource =
  | { type: 'path'; path: string }
  | { type: 'package'; package: string };

/**
 * Plugin discovery configuration
 */
export interface PluginDiscoveryConfig {
  /** Explicit plugin sources from config */
  extractors?: PluginSource[];
  /** Base directory for auto-discovery (default: process.cwd()) */
  baseDir?: string;
}

/**
 * Plugin validation error
 */
export class PluginValidationError extends Error {
  constructor(
    message: string,
    public readonly _pluginSource: string
  ) {
    super(message);
    this.name = 'PluginValidationError';
  }
}

/**
 * Load a single plugin from a source
 *
 * @param source - Plugin source (file path or npm package)
 * @returns Validated extractor plugin
 * @throws PluginValidationError if plugin is invalid
 */
export async function loadPlugin(source: PluginSource): Promise<ExtractorPlugin> {
  let plugin: unknown;
  let pluginPath: string;

  try {
    if (source.type === 'path') {
      // Load from file path
      pluginPath = resolve(source.path);
      const fileUrl = pathToFileURL(pluginPath).href;
      const module = await import(fileUrl);
      plugin = module.default ?? module;
    } else {
      // Load from npm package
      pluginPath = source.package;
      const module = await import(source.package);
      plugin = module.default ?? module;
    }
  } catch (error) {
    throw new PluginValidationError(
      `Failed to load plugin: ${error instanceof Error ? error.message : String(error)}`,
      source.type === 'path' ? source.path : source.package
    );
  }

  // Validate plugin interface
  validatePluginInterface(plugin, pluginPath);

  return plugin;
}

/**
 * Discover and load all plugins
 *
 * - Loads explicitly configured plugins from config
 * - Auto-discovers plugins from vibe-validate-local-plugins/ directory
 * - Skips invalid plugins with warnings (fail-safe)
 *
 * @param config - Plugin discovery configuration
 * @returns Array of validated plugins
 */
export async function discoverPlugins(config: PluginDiscoveryConfig = {}): Promise<ExtractorPlugin[]> {
  const plugins: ExtractorPlugin[] = [];
  const errors: Array<{ source: string; error: string }> = [];

  // 1. Load explicitly configured plugins
  await loadConfiguredPlugins(config, plugins, errors);

  // 2. Auto-discover from local plugins directory
  await autoDiscoverLocalPlugins(config, plugins, errors);

  // Log warnings for failed plugins (fail-safe behavior)
  logPluginErrors(errors);

  return plugins;
}

/**
 * Load plugins explicitly configured in config
 */
async function loadConfiguredPlugins(
  config: PluginDiscoveryConfig,
  plugins: ExtractorPlugin[],
  errors: Array<{ source: string; error: string }>
): Promise<void> {
  if (!config.extractors || config.extractors.length === 0) {
    return;
  }

  for (const source of config.extractors) {
    try {
      const plugin = await loadPlugin(source);
      plugins.push(plugin);
    } catch (error) {
      const sourceStr = source.type === 'path' ? source.path : source.package;
      errors.push({
        source: sourceStr,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

/**
 * Auto-discover plugins from local plugins directory
 */
async function autoDiscoverLocalPlugins(
  config: PluginDiscoveryConfig,
  plugins: ExtractorPlugin[],
  errors: Array<{ source: string; error: string }>
): Promise<void> {
  const baseDir = config.baseDir ?? process.cwd();
  const localPluginsDir = join(baseDir, 'vibe-validate-local-plugins');

  try {
    await access(localPluginsDir);
     
    const entries = await readdir(localPluginsDir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isFile() && (entry.name.endsWith('.js') || entry.name.endsWith('.mjs'))) {
        const pluginPath = join(localPluginsDir, entry.name);
        try {
          const plugin = await loadPlugin({ type: 'path', path: pluginPath });
          plugins.push(plugin);
        } catch (error) {
          errors.push({
            source: pluginPath,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
  } catch {
    // Directory doesn't exist - that's fine, just skip auto-discovery
  }
}

/**
 * Log plugin loading errors
 */
function logPluginErrors(errors: Array<{ source: string; error: string }>): void {
  if (errors.length === 0) {
    return;
  }

  console.warn('⚠️  Some plugins failed to load:');
  for (const { source, error } of errors) {
    console.warn(`   - ${source}: ${error}`);
  }
}

/**
 * Validate that an object conforms to ExtractorPlugin interface
 *
 * @param plugin - Object to validate
 * @param source - Plugin source (for error messages)
 * @throws PluginValidationError if validation fails
 */
export function validatePluginInterface(plugin: unknown, source: string): asserts plugin is ExtractorPlugin {
  if (!plugin || typeof plugin !== 'object') {
    throw new PluginValidationError('Plugin must be an object', source);
  }

  const p = plugin as Record<string, unknown>;

  // Validate metadata
  if (!p.metadata || typeof p.metadata !== 'object') {
    throw new PluginValidationError('Plugin missing required metadata field', source);
  }

  const metadata = p.metadata as Record<string, unknown>;
  if (!metadata.name || typeof metadata.name !== 'string') {
    throw new PluginValidationError('Plugin metadata missing name', source);
  }
  if (!metadata.version || typeof metadata.version !== 'string') {
    throw new PluginValidationError('Plugin metadata missing version', source);
  }
  if (!metadata.description || typeof metadata.description !== 'string') {
    throw new PluginValidationError('Plugin metadata missing description', source);
  }

  // Validate required functions
  if (typeof p.detect !== 'function') {
    throw new PluginValidationError('Plugin missing required detect function', source);
  }
  if (typeof p.extract !== 'function') {
    throw new PluginValidationError('Plugin missing required extract function', source);
  }

  // Validate priority
  if (typeof p.priority !== 'number') {
    throw new PluginValidationError('Plugin missing required priority field', source);
  }
  if (p.priority < 0 || p.priority > 100) {
    throw new PluginValidationError('Priority must be between 0 and 100', source);
  }

  // Validate samples array
  if (!Array.isArray(p.samples)) {
    throw new PluginValidationError('Plugin missing required samples array', source);
  }
}

/**
 * Register plugins dynamically with the extractor registry
 *
 * This function will be used to add external plugins to EXTRACTOR_REGISTRY
 * at runtime after discovery.
 *
 * @param plugins - Array of validated plugins to register
 * @returns Array of extractor descriptors added to registry
 */
export function registerPlugins(plugins: ExtractorPlugin[]): Array<{
  name: string;
  priority: number;
  detect: (_output: string) => { confidence: number; patterns: string[]; reason: string };
  extract: (_output: string) => unknown;
}> {
  return plugins.map(plugin => ({
    name: plugin.metadata.name,
    priority: plugin.priority,
    detect: plugin.detect,
    extract: plugin.extract,
  }));
}

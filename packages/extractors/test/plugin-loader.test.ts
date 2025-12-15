/**
 * Plugin Loader Tests
 *
 * Test-driven development for external extractor plugin loading.
 * These tests define the expected behavior before implementation.
 *
 * @package @vibe-validate/extractors
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect, vi } from 'vitest';

import { loadPlugin, discoverPlugins, validatePluginInterface } from '../src/plugin-loader.js';
import type { ExtractorPlugin } from '../src/types.js';

// Get test fixtures directory
const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, '../src/__test-fixtures__');

describe('Plugin Loader', () => {
  describe('loadPlugin', () => {
    it('should load a valid plugin from a file path', async () => {
      const plugin = await loadPlugin({
        type: 'path',
        path: join(fixturesDir, 'valid-plugin.js'),
      });

      expect(plugin).toBeDefined();
      expect(plugin.metadata).toBeDefined();
      expect(plugin.metadata.name).toBe('test-plugin');
      expect(plugin.detect).toBeInstanceOf(Function);
      expect(plugin.extract).toBeInstanceOf(Function);
    });

    it('should load a plugin from npm package', async () => {
      // Mock the npm package import using vi.doMock
      const mockPlugin: ExtractorPlugin = {
        metadata: {
          name: 'example-extractor',
          version: '1.0.0',
          author: 'Test Author',
          description: 'Example extractor for testing',
          tags: ['test'],
        },
        priority: 50,
        detect: vi.fn(() => ({ confidence: 50, patterns: ['test'], reason: 'test' })),
        extract: vi.fn(() => ({
          errors: [],
          summary: 'test',
          totalErrors: 0,
        })),
        samples: [
          {
            name: 'test-sample',
            description: 'Test sample',
            input: 'test input',
            expected: { totalErrors: 0 },
          },
        ],
      };

      // Mock the dynamic import for this specific package
      vi.doMock('@vibe-validate/extractor-example', () => ({
        default: mockPlugin,
      }));

      const plugin = await loadPlugin({
        type: 'package',
        package: '@vibe-validate/extractor-example',
      });

      expect(plugin).toBeDefined();
      expect(plugin.metadata.name).toBe('example-extractor');
      expect(plugin.detect).toBeInstanceOf(Function);
      expect(plugin.extract).toBeInstanceOf(Function);

      // Clean up mock
      vi.doUnmock('@vibe-validate/extractor-example');
    });

    it('should reject plugin with missing metadata', async () => {
      await expect(
        loadPlugin({
          type: 'path',
          path: join(fixturesDir, 'no-metadata-plugin.js'),
        })
      ).rejects.toThrow('Plugin missing required metadata field');
    });

    it('should reject plugin with missing detect function', async () => {
      await expect(
        loadPlugin({
          type: 'path',
          path: join(fixturesDir, 'no-detect-plugin.js'),
        })
      ).rejects.toThrow('Plugin missing required detect function');
    });

    it('should reject plugin with missing extract function', async () => {
      await expect(
        loadPlugin({
          type: 'path',
          path: join(fixturesDir, 'no-extract-plugin.js'),
        })
      ).rejects.toThrow('Plugin missing required extract function');
    });

    it('should validate plugin metadata schema', async () => {
      await expect(
        loadPlugin({
          type: 'path',
          path: join(fixturesDir, 'invalid-metadata-plugin.js'),
        })
      ).rejects.toThrow('Plugin metadata missing version');
    });
  });

  describe('discoverPlugins', () => {
    it('should discover plugins from config', async () => {
      const config = {
        extractors: [
          { type: 'path' as const, path: join(fixturesDir, 'valid-plugin.js') },
        ],
      };

      const plugins = await discoverPlugins(config);

      expect(plugins).toHaveLength(1);
      expect(plugins[0].metadata.name).toBe('test-plugin');
    });

    it('should return empty array when no local plugins directory exists', async () => {
      // eslint-disable-next-line sonarjs/publicly-writable-directories -- Safe: test-only, non-existent directory
      const plugins = await discoverPlugins({ baseDir: '/tmp/vibe-validate-test-nonexistent' });

      // No error thrown, just empty array
      expect(plugins).toEqual([]);
    });

    it('should skip invalid plugins and continue loading others', async () => {
      const config = {
        extractors: [
          { type: 'path' as const, path: join(fixturesDir, 'valid-plugin.js') },
          { type: 'path' as const, path: join(fixturesDir, 'no-detect-plugin.js') }, // This will fail
        ],
      };

      const plugins = await discoverPlugins(config);

      // Should load 1 valid plugin and skip the invalid one
      expect(plugins).toHaveLength(1);
      expect(plugins[0].metadata.name).toBe('test-plugin');
    });

    it('should return empty array when no plugins configured', async () => {
      // eslint-disable-next-line sonarjs/publicly-writable-directories -- Safe: test-only, non-existent directory
      const plugins = await discoverPlugins({ baseDir: '/tmp/vibe-validate-test-nonexistent' });

      expect(plugins).toEqual([]);
    });
  });

  describe('Plugin Validation', () => {
    it('should validate ExtractorPlugin interface completeness', () => {
      const validPlugin: ExtractorPlugin = {
        metadata: {
          name: 'test-plugin',
          version: '1.0.0',
          description: 'Test plugin',
        },
        priority: 50,
        detect: (_output: string) => ({
          confidence: 0,
          patterns: [],
          reason: '',
        }),
        extract: (_output: string) => ({
          totalErrors: 0,
          errors: [],
          guidance: '',
          metadata: {
            confidence: 100,
            completeness: 100,
            issues: [],
          },
        }),
        samples: [],
      };

      // Should not throw
      expect(() => validatePluginInterface(validPlugin, 'test-source')).not.toThrow();
    });

    it('should reject plugin with invalid priority', () => {
      const invalidPlugin = {
        metadata: { name: 'test', version: '1.0.0', description: 'test' },
        priority: -1, // Invalid
        detect: vi.fn(),
        extract: vi.fn(),
        samples: [],
      };

      expect(() => validatePluginInterface(invalidPlugin as ExtractorPlugin, 'test-source')).toThrow(
        'Priority must be between 0 and 100'
      );
    });
  });
});

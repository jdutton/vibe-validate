/**
 * Tests for configuration loader
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  loadConfigFromFile,
  findAndLoadConfig,
  loadConfigWithFallback,
  CONFIG_FILE_NAMES,
} from '../src/loader.js';
import type { VibeValidateConfig } from '../src/schema.js';

describe('loader', () => {
  let testDir: string;

  beforeEach(async () => {
    // Create unique temp directory for each test
    testDir = join(tmpdir(), `vibe-validate-test-${Date.now()}-${Math.random()}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    // Clean up test directory
    await rm(testDir, { recursive: true, force: true });
  });

  describe('loadConfigFromFile', () => {
    it('should load JSON config file', async () => {
      const configPath = join(testDir, 'vibe-validate.config.json');
      const config = {
        validation: {
          phases: [
            {
              name: 'Test Phase',
              parallel: false,
              steps: [
                { name: 'Test Step', command: 'echo test' },
              ],
            },
          ],
          caching: {
            strategy: 'git-tree-hash' as const,
            enabled: true,
          },
        },
        git: {
          mainBranch: 'main',
          autoSync: false,
        },
        output: {
          format: 'auto' as const,
        },
      };

      await writeFile(configPath, JSON.stringify(config, null, 2));

      const loaded = await loadConfigFromFile(configPath);

      // Verify key fields (defaults will be added by schema validation)
      expect(loaded.validation.phases).toHaveLength(1);
      expect(loaded.validation.phases[0].name).toBe('Test Phase');
      expect(loaded.git.mainBranch).toBe('main');
      // format field removed - state files are always YAML
    });

    it('should load TypeScript config file with ES module', async () => {
      const configPath = join(testDir, 'vibe-validate.config.ts');
      const configContent = `
export default {
  validation: {
    phases: [
      {
        name: 'TypeScript Phase',
        parallel: true,
        steps: [
          { name: 'TypeScript', command: 'tsc --noEmit' },
        ],
      },
    ],
    caching: {
      strategy: 'git-tree-hash',
      enabled: true,
    },
  },
  git: {
    mainBranch: 'main',
    autoSync: false,
  },
  output: {
    format: 'auto',
  },
};
`;

      await writeFile(configPath, configContent);

      const loaded = await loadConfigFromFile(configPath);
      expect(loaded.validation.phases).toHaveLength(1);
      expect(loaded.validation.phases[0].name).toBe('TypeScript Phase');
      expect(loaded.validation.phases[0].parallel).toBe(true);
    });

    it('should load config with preset', async () => {
      const configPath = join(testDir, 'vibe-validate.config.json');
      const config = {
        preset: 'typescript-library',
      };

      await writeFile(configPath, JSON.stringify(config, null, 2));

      const loaded = await loadConfigFromFile(configPath);
      expect(loaded.validation.phases.length).toBeGreaterThan(0);
      expect(loaded.git.mainBranch).toBe('main');
    });

    it('should merge config with preset', async () => {
      const configPath = join(testDir, 'vibe-validate.config.json');
      const config = {
        preset: 'typescript-library',
        git: {
          mainBranch: 'develop', // Override preset value
        },
      };

      await writeFile(configPath, JSON.stringify(config, null, 2));

      const loaded = await loadConfigFromFile(configPath);
      expect(loaded.git.mainBranch).toBe('develop'); // User override
      expect(loaded.validation.phases.length).toBeGreaterThan(0); // From preset
    });

    it('should throw error for unknown preset', async () => {
      const configPath = join(testDir, 'vibe-validate.config.json');
      const config = {
        preset: 'unknown-preset',
      };

      await writeFile(configPath, JSON.stringify(config, null, 2));

      await expect(loadConfigFromFile(configPath)).rejects.toThrow('Unknown preset: unknown-preset');
    });

    it('should support config extends', async () => {
      // Create base config
      const baseConfigPath = join(testDir, 'base.config.json');
      const baseConfig: VibeValidateConfig = {
        validation: {
          phases: [
            {
              name: 'Base Phase',
              parallel: false,
              steps: [
                { name: 'Base Step', command: 'echo base' },
              ],
            },
          ],
          caching: {
            strategy: 'git-tree-hash',
            enabled: true,
          },
        },
        git: {
          mainBranch: 'main',
          autoSync: false,
        },
        output: {
          format: 'auto',
        },
      };
      await writeFile(baseConfigPath, JSON.stringify(baseConfig, null, 2));

      // Create extending config
      const configPath = join(testDir, 'vibe-validate.config.json');
      const config = {
        extends: './base.config.json',
        git: {
          mainBranch: 'develop', // Override base value
        },
      };
      await writeFile(configPath, JSON.stringify(config, null, 2));

      const loaded = await loadConfigFromFile(configPath);
      expect(loaded.validation.phases).toHaveLength(1);
      expect(loaded.validation.phases[0].name).toBe('Base Phase'); // From base
      expect(loaded.git.mainBranch).toBe('develop'); // User override
    });

    it('should support preset + extends combination', async () => {
      // Create extending config with preset
      const baseConfigPath = join(testDir, 'base.config.json');
      const baseConfig = {
        preset: 'typescript-library',
        git: {
          mainBranch: 'staging',
        },
      };
      await writeFile(baseConfigPath, JSON.stringify(baseConfig, null, 2));

      // Create config that extends the preset-based config
      const configPath = join(testDir, 'vibe-validate.config.json');
      const config = {
        extends: './base.config.json',
        git: {
          mainBranch: 'production', // Final override
        },
      };
      await writeFile(configPath, JSON.stringify(config, null, 2));

      const loaded = await loadConfigFromFile(configPath);
      expect(loaded.validation.phases.length).toBeGreaterThan(0); // From preset
      expect(loaded.git.mainBranch).toBe('production'); // Final override
    });

    it('should throw error for invalid JSON', async () => {
      const configPath = join(testDir, 'vibe-validate.config.json');
      await writeFile(configPath, '{ invalid json }');

      await expect(loadConfigFromFile(configPath)).rejects.toThrow();
    });

    it('should throw error for non-object config', async () => {
      const configPath = join(testDir, 'vibe-validate.config.json');
      await writeFile(configPath, JSON.stringify(['not', 'an', 'object']));

      await expect(loadConfigFromFile(configPath)).rejects.toThrow();
    });

    it('should validate config after loading', async () => {
      const configPath = join(testDir, 'vibe-validate.config.json');
      const invalidConfig = {
        validation: {
          phases: [
            {
              // Missing required fields
              parallel: false,
            },
          ],
        },
      };

      await writeFile(configPath, JSON.stringify(invalidConfig, null, 2));

      await expect(loadConfigFromFile(configPath)).rejects.toThrow();
    });
  });

  describe('findAndLoadConfig', () => {
    it('should find first available config file', async () => {
      const config: VibeValidateConfig = {
        validation: {
          phases: [
            {
              name: 'Found Phase',
              parallel: false,
              steps: [
                { name: 'Found Step', command: 'echo found' },
              ],
            },
          ],
          caching: {
            strategy: 'git-tree-hash',
            enabled: true,
          },
        },
        git: {
          mainBranch: 'main',
          autoSync: false,
        },
        output: {
          format: 'auto',
        },
      };

      // Create config with second priority name
      const configPath = join(testDir, CONFIG_FILE_NAMES[1]);
      await writeFile(configPath, `export default ${JSON.stringify(config)};`);

      const loaded = await findAndLoadConfig(testDir);
      expect(loaded).toBeDefined();
      expect(loaded?.validation.phases[0].name).toBe('Found Phase');
    });

    it('should prioritize config files in order', async () => {
      // Create two config files with different priority
      const firstConfig: VibeValidateConfig = {
        validation: {
          phases: [
            {
              name: 'First Priority',
              parallel: false,
              steps: [{ name: 'Step', command: 'echo first' }],
            },
          ],
          caching: { strategy: 'git-tree-hash', enabled: true },
        },
        git: { mainBranch: 'main', autoSync: false },
        output: { format: 'auto' },
      };

      const secondConfig: VibeValidateConfig = {
        validation: {
          phases: [
            {
              name: 'Second Priority',
              parallel: false,
              steps: [{ name: 'Step', command: 'echo second' }],
            },
          ],
          caching: { strategy: 'git-tree-hash', enabled: true },
        },
        git: { mainBranch: 'main', autoSync: false },
        output: { format: 'auto' },
      };

      // Create higher priority config
      await writeFile(
        join(testDir, CONFIG_FILE_NAMES[0]),
        `export default ${JSON.stringify(firstConfig)};`
      );

      // Create lower priority config
      await writeFile(
        join(testDir, CONFIG_FILE_NAMES[2]),
        `export default ${JSON.stringify(secondConfig)};`
      );

      const loaded = await findAndLoadConfig(testDir);
      expect(loaded?.validation.phases[0].name).toBe('First Priority');
    });

    it('should return undefined if no config found', async () => {
      const loaded = await findAndLoadConfig(testDir);
      expect(loaded).toBeUndefined();
    });

    it('should use process.cwd() by default', async () => {
      // Just verify it doesn't throw
      const loaded = await findAndLoadConfig();
      // May or may not find a config depending on where test runs from
      expect(loaded === undefined || typeof loaded === 'object').toBe(true);
    });
  });

  describe('loadConfigWithFallback', () => {
    it('should load user config if found', async () => {
      const config: VibeValidateConfig = {
        validation: {
          phases: [
            {
              name: 'User Config',
              parallel: false,
              steps: [{ name: 'Step', command: 'echo user' }],
            },
          ],
          caching: { strategy: 'git-tree-hash', enabled: true },
        },
        git: { mainBranch: 'main', autoSync: false },
        output: { format: 'auto' },
      };

      await writeFile(
        join(testDir, 'vibe-validate.config.json'),
        JSON.stringify(config, null, 2)
      );

      const loaded = await loadConfigWithFallback(testDir);
      expect(loaded.validation.phases[0].name).toBe('User Config');
    });

    it('should fallback to default preset if no config found', async () => {
      const loaded = await loadConfigWithFallback(testDir);
      expect(loaded).toBeDefined();
      expect(loaded.validation.phases.length).toBeGreaterThan(0);
      expect(loaded.git.mainBranch).toBe('main');
    });

    it('should use process.cwd() by default', async () => {
      const loaded = await loadConfigWithFallback();
      expect(loaded).toBeDefined();
      expect(loaded.validation.phases.length).toBeGreaterThan(0);
    });
  });

  describe('CONFIG_FILE_NAMES', () => {
    it('should export config file names in priority order', () => {
      expect(CONFIG_FILE_NAMES).toEqual([
        'vibe-validate.config.ts',
        'vibe-validate.config.mts',
        'vibe-validate.config.js',
        'vibe-validate.config.mjs',
        'vibe-validate.config.json',
        '.vibe-validate.json',
      ]);
    });
  });
});

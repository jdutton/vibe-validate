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
    it('should load legacy .mjs config file with deprecation warning', async () => {
      const configPath = join(testDir, 'vibe-validate.config.mjs');
      const configContent = `
export default {
  validation: {
    phases: [
      {
        name: 'Legacy Phase',
        parallel: false,
        steps: [
          { name: 'Legacy Step', command: 'echo legacy' },
        ],
      },
    ],
  },
};
`;

      await writeFile(configPath, configContent);

      const loaded = await loadConfigFromFile(configPath);

      // Verify config loads correctly
      expect(loaded.validation.phases).toHaveLength(1);
      expect(loaded.validation.phases[0].name).toBe('Legacy Phase');
      // Note: Deprecation warning is logged to console, not tested here
    });

    it('should throw error for unsupported config format', async () => {
      const configPath = join(testDir, 'vibe-validate.config.json');
      await writeFile(configPath, '{}');

      await expect(loadConfigFromFile(configPath)).rejects.toThrow('Unsupported config file format');
    });

    // YAML Config Tests
    it('should load YAML config file (.yaml)', async () => {
      const configPath = join(testDir, 'vibe-validate.config.yaml');
      const yamlContent = `
validation:
  phases:
    - name: YAML Phase
      parallel: false
      steps:
        - name: YAML Step
          command: echo yaml
  caching:
    strategy: git-tree-hash
    enabled: true
git:
  mainBranch: main
  autoSync: false
`;

      await writeFile(configPath, yamlContent);

      const loaded = await loadConfigFromFile(configPath);

      expect(loaded.validation.phases).toHaveLength(1);
      expect(loaded.validation.phases[0].name).toBe('YAML Phase');
      expect(loaded.git.mainBranch).toBe('main');
    });


    it('should load YAML config with preset', async () => {
      const configPath = join(testDir, 'vibe-validate.config.yaml');
      const yamlContent = `
preset: typescript-nodejs
git:
  mainBranch: develop
`;

      await writeFile(configPath, yamlContent);

      const loaded = await loadConfigFromFile(configPath);

      expect(loaded.validation.phases.length).toBeGreaterThan(0);
      expect(loaded.git.mainBranch).toBe('develop');
    });

    it('should load YAML config with extends (preset name)', async () => {
      const configPath = join(testDir, 'vibe-validate.config.yaml');
      const yamlContent = `
extends: typescript-library
git:
  mainBranch: staging
`;

      await writeFile(configPath, yamlContent);

      const loaded = await loadConfigFromFile(configPath);

      expect(loaded.validation.phases.length).toBeGreaterThan(0);
      expect(loaded.git.mainBranch).toBe('staging');
    });

    it('should load YAML config with extends (file path)', async () => {
      // Create base YAML config
      const baseConfigPath = join(testDir, 'base.config.yaml');
      const baseYaml = `
validation:
  phases:
    - name: Base YAML Phase
      steps:
        - name: Base Step
          command: echo base
git:
  mainBranch: main
`;
      await writeFile(baseConfigPath, baseYaml);

      // Create extending YAML config
      const configPath = join(testDir, 'vibe-validate.config.yaml');
      const extendingYaml = `
extends: ./base.config.yaml
git:
  mainBranch: production
`;
      await writeFile(configPath, extendingYaml);

      const loaded = await loadConfigFromFile(configPath);

      expect(loaded.validation.phases).toHaveLength(1);
      expect(loaded.validation.phases[0].name).toBe('Base YAML Phase');
      expect(loaded.git.mainBranch).toBe('production');
    });

    it('should throw error for invalid YAML syntax', async () => {
      const configPath = join(testDir, 'vibe-validate.config.yaml');
      const invalidYaml = `
validation:
  phases:
    - name: Invalid
      steps:
      - name: Missing indent
    command: broken
`;

      await writeFile(configPath, invalidYaml);

      await expect(loadConfigFromFile(configPath)).rejects.toThrow();
    });

    it('should throw error for YAML with invalid schema', async () => {
      const configPath = join(testDir, 'vibe-validate.config.yaml');
      const invalidSchemaYaml = `
validation:
  phases:
    - name: ''  # Empty name (invalid)
      steps:
        - name: Step
          command: echo test
`;

      await writeFile(configPath, invalidSchemaYaml);

      await expect(loadConfigFromFile(configPath)).rejects.toThrow();
    });

    it('should ignore $schema property in YAML config', async () => {
      const configPath = join(testDir, 'vibe-validate.config.yaml');
      const yamlWithSchema = `
$schema: ./node_modules/@vibe-validate/config/vibe-validate.schema.json
validation:
  phases:
    - name: Schema Phase
      steps:
        - name: Step
          command: echo test
`;

      await writeFile(configPath, yamlWithSchema);

      const loaded = await loadConfigFromFile(configPath);

      expect(loaded.validation.phases).toHaveLength(1);
      expect(loaded.validation.phases[0].name).toBe('Schema Phase');
      // $schema should be ignored/removed during processing
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
      // YAML has priority over .mjs
      const yamlContent = `
validation:
  phases:
    - name: YAML Priority
      steps:
        - name: Step
          command: echo yaml
`;

      const mjsContent = `
export default {
  validation: {
    phases: [
      {
        name: 'MJS Priority',
        steps: [{ name: 'Step', command: 'echo mjs' }],
      },
    ],
  },
};
`;

      // Create both configs (YAML should win)
      await writeFile(join(testDir, CONFIG_FILE_NAMES[0]), yamlContent);
      await writeFile(join(testDir, CONFIG_FILE_NAMES[1]), mjsContent);

      const loaded = await findAndLoadConfig(testDir);
      expect(loaded?.validation.phases[0].name).toBe('YAML Priority');
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

    it('should NOT show .mjs deprecation warning when only invalid YAML exists', async () => {
      // Bug scenario: User has invalid YAML config during setup
      // Should NOT trigger .mjs deprecation warning when .mjs file doesn't exist
      const invalidYaml = `
validation:
  phases:
    - name: ''  # Invalid: empty name
      steps:
        - name: Step
          command: echo test
`;

      await writeFile(join(testDir, 'vibe-validate.config.yaml'), invalidYaml);

      // Capture console.warn calls to verify NO .mjs warning is shown
      const originalWarn = console.warn;
      const warnCalls: string[] = [];
      console.warn = (...args: unknown[]) => {
        warnCalls.push(args.join(' '));
      };

      try {
        await findAndLoadConfig(testDir);
      } catch (_err) {
        // Expected to fail due to invalid YAML
      }

      console.warn = originalWarn;

      // Verify NO .mjs deprecation warning was shown
      const hasDeprecationWarning = warnCalls.some(call =>
        call.includes('.mjs config format is deprecated')
      );
      expect(hasDeprecationWarning).toBe(false);
    });
  });

  describe('loadConfigWithFallback', () => {
    it('should load user config if found', async () => {
      const yamlContent = `
validation:
  phases:
    - name: User Config
      steps:
        - name: Step
          command: echo user
`;

      await writeFile(
        join(testDir, 'vibe-validate.config.yaml'),
        yamlContent
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
        'vibe-validate.config.yaml',
        'vibe-validate.config.mjs', // Legacy (deprecated)
      ]);
    });
  });
});

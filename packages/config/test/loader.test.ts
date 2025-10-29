/**
 * Tests for configuration loader
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  loadConfigFromFile,
  findAndLoadConfig,
  CONFIG_FILE_NAME,
} from '../src/loader.js';

describe('loader', () => {
  let testDir: string;

  beforeEach(async () => {
    // Create unique temp directory for each test
    // eslint-disable-next-line sonarjs/pseudo-random -- Safe for test directory uniqueness
    testDir = join(tmpdir(), `vibe-validate-test-${Date.now()}-${Math.random()}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    // Clean up test directory
    await rm(testDir, { recursive: true, force: true });
  });

  describe('loadConfigFromFile', () => {
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
    it('should find vibe-validate.config.yaml', async () => {
      const yamlContent = `
validation:
  phases:
    - name: Found Phase
      parallel: false
      steps:
        - name: Found Step
          command: echo found
git:
  mainBranch: main
  autoSync: false
`;

      const configPath = join(testDir, CONFIG_FILE_NAME);
      await writeFile(configPath, yamlContent);

      const loaded = await findAndLoadConfig(testDir);
      expect(loaded).toBeDefined();
      expect(loaded?.validation.phases[0].name).toBe('Found Phase');
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
});

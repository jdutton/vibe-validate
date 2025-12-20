/**
 * Tests for init command schema URL validation
 *
 * Ensures that generated configs reference the correct schema URL
 * and that the schema file exists in all expected locations.
 */

import { existsSync, readFileSync } from 'node:fs';
import { mkdir, rm, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { safeExecFromString, normalizedTmpdir } from '@vibe-validate/utils';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { parse as parseYaml } from 'yaml';

describe('init command - schema validation', () => {
  let testDir: string;
  let cliPath: string;

  beforeEach(async () => {
    // Create unique temp directory for each test
    // eslint-disable-next-line sonarjs/pseudo-random -- Safe for test directory uniqueness
    testDir = join(normalizedTmpdir(), `vibe-validate-schema-test-${Date.now()}-${Math.random()}`);
    await mkdir(testDir, { recursive: true });
    cliPath = join(__dirname, '../../dist/bin.js');
  });

  afterEach(async () => {
    // Clean up test directory
    await rm(testDir, { recursive: true, force: true });
  });

  describe('schema URL in generated configs', () => {
    it('should generate config with version-pinned unpkg schema URL', async () => {
      // Run init command
      safeExecFromString(`node ${cliPath} init --template typescript-library`, {
        cwd: testDir,
      });

      const configPath = join(testDir, 'vibe-validate.config.yaml');
      expect(existsSync(configPath)).toBe(true);

      // Read and parse YAML
      const configContent = await readFile(configPath, 'utf-8');
      const config = parseYaml(configContent) as Record<string, unknown>;

      // Verify schema URL uses unpkg with version pinning
      expect(config.$schema).toBeDefined();
      // Matches version formats: 0.15.0, 0.15.0-rc.1, 0.15.0-beta.2, etc.
      expect(config.$schema).toMatch(/^https:\/\/unpkg\.com\/@vibe-validate\/config@[\w.-]+\/config\.schema\.json$/);
      // Verify it includes the CLI version (e.g., @0.15.0-rc.1)
      expect(config.$schema).toContain('@vibe-validate/config@');
      expect(config.$schema).toContain('/config.schema.json');
    });

    it('should reference schema file with correct filename', () => {
      safeExecFromString(`node ${cliPath} init --template typescript-library`, {
        cwd: testDir,
      });

      const configPath = join(testDir, 'vibe-validate.config.yaml');
      const configContent = readFileSync(configPath, 'utf-8');

      // Verify the schema URL contains the correct filename
      expect(configContent).toContain('config.schema.json');
      expect(configContent).not.toContain('/schema.json'); // Old incorrect URL
    });
  });

  describe('schema file existence', () => {
    it('should have schema file in config package', () => {
      const schemaPath = resolve(__dirname, '../../../config/config.schema.json');
      expect(existsSync(schemaPath)).toBe(true);
    });

    it('should generate valid JSON schema file', async () => {
      const schemaPath = resolve(__dirname, '../../../config/config.schema.json');
      const schemaContent = await readFile(schemaPath, 'utf-8');

      // Should be valid JSON
      expect(() => JSON.parse(schemaContent)).not.toThrow();

      const schema = JSON.parse(schemaContent);

      // Should have JSON Schema properties
      expect(schema).toHaveProperty('definitions');
      expect(schema).toHaveProperty('$ref');
    });

    it('should include schema in npm package files', async () => {
      const packageJsonPath = resolve(__dirname, '../../../config/package.json');
      const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf-8'));

      expect(packageJson.files).toContain('config.schema.json');
    });
  });

  describe('schema discoverability', () => {
    it('should be accessible via local node_modules path', () => {
      // Verify the schema exists in our monorepo structure
      // (Would be at: node_modules/@vibe-validate/config/config.schema.json in installed package)
      const actualSchemaPath = resolve(__dirname, '../../../config/config.schema.json');
      expect(existsSync(actualSchemaPath)).toBe(true);
    });

    it('should be accessible via unpkg CDN URL', () => {
      // Generate config and verify it references the unpkg URL
      safeExecFromString(`node ${cliPath} init --template typescript-library`, {
        cwd: testDir,
      });

      const configPath = join(testDir, 'vibe-validate.config.yaml');
      const configContent = readFileSync(configPath, 'utf-8');

      // Should reference unpkg CDN URL for IDE support with version pinning
      expect(configContent).toContain('https://unpkg.com');
      expect(configContent).toContain('@vibe-validate/config@');
      expect(configContent).toContain('/config.schema.json');
    });
  });

  describe('schema content validation', () => {
    it('should define VibeValidateConfig schema', async () => {
      const schemaPath = resolve(__dirname, '../../../config/config.schema.json');
      const schema = JSON.parse(await readFile(schemaPath, 'utf-8'));

      expect(schema.definitions).toHaveProperty('VibeValidateConfig');
    });

    it('should define validation config properties', async () => {
      const schemaPath = resolve(__dirname, '../../../config/config.schema.json');
      const schema = JSON.parse(await readFile(schemaPath, 'utf-8'));

      const vibeConfig = schema.definitions.VibeValidateConfig;
      expect(vibeConfig.properties).toHaveProperty('validation');
      expect(vibeConfig.properties).toHaveProperty('git');
    });

    it('should define phase and step structures', async () => {
      const schemaPath = resolve(__dirname, '../../../config/config.schema.json');
      const schema = JSON.parse(await readFile(schemaPath, 'utf-8'));

      // Should have VibeValidateConfig definition with validation properties
      const vibeConfig = schema.definitions.VibeValidateConfig;
      expect(vibeConfig).toBeDefined();
      expect(vibeConfig.properties.validation).toBeDefined();
      expect(vibeConfig.properties.validation.properties).toHaveProperty('phases');
    });
  });

  describe('multiple config formats', () => {
    it('should use same schema URL for all templates', async () => {
      const templates = ['typescript-library', 'typescript-nodejs', 'typescript-react'];
      const schemaUrls: string[] = [];

      for (const template of templates) {
        const dir = join(testDir, template);
        await mkdir(dir, { recursive: true });

        safeExecFromString(`node ${cliPath} init --template ${template}`, {
          cwd: dir,
        });

        const configPath = join(dir, 'vibe-validate.config.yaml');
        const configContent = await readFile(configPath, 'utf-8');
        const config = parseYaml(configContent) as Record<string, unknown>;

        schemaUrls.push(config.$schema as string);
      }

      // All templates should use the same schema URL
      expect(new Set(schemaUrls).size).toBe(1);
      expect(schemaUrls[0]).toContain('config.schema.json');
    });
  });
});

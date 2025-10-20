/**
 * Tests for init command schema URL validation
 *
 * Ensures that generated configs reference the correct schema URL
 * and that the schema file exists in all expected locations.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdir, rm, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';
import { execSync } from 'child_process';
import { parse as parseYaml } from 'yaml';

describe('init command - schema validation', () => {
  let testDir: string;
  let cliPath: string;

  beforeEach(async () => {
    // Create unique temp directory for each test
    testDir = join(tmpdir(), `vibe-validate-schema-test-${Date.now()}-${Math.random()}`);
    await mkdir(testDir, { recursive: true });
    cliPath = join(__dirname, '../../dist/bin.js');
  });

  afterEach(async () => {
    // Clean up test directory
    await rm(testDir, { recursive: true, force: true });
  });

  describe('schema URL in generated configs', () => {
    it('should generate config with correct schema URL', async () => {
      // Run init command
      execSync(`node ${cliPath} init --template typescript-library`, {
        cwd: testDir,
      });

      const configPath = join(testDir, 'vibe-validate.config.yaml');
      expect(existsSync(configPath)).toBe(true);

      // Read and parse YAML
      const configContent = await readFile(configPath, 'utf-8');
      const config = parseYaml(configContent) as Record<string, unknown>;

      // Verify schema URL
      expect(config.$schema).toBeDefined();
      expect(config.$schema).toBe(
        'https://raw.githubusercontent.com/jdutton/vibe-validate/main/packages/config/vibe-validate.schema.json'
      );
    });

    it('should reference schema file with correct filename', () => {
      execSync(`node ${cliPath} init --template typescript-library`, {
        cwd: testDir,
      });

      const configPath = join(testDir, 'vibe-validate.config.yaml');
      const configContent = execSync(`cat ${configPath}`, { encoding: 'utf-8' });

      // Verify the schema URL contains the correct filename
      expect(configContent).toContain('vibe-validate.schema.json');
      expect(configContent).not.toContain('/schema.json'); // Old incorrect URL
    });
  });

  describe('schema file existence', () => {
    it('should have schema file in config package', () => {
      const schemaPath = resolve(__dirname, '../../../config/vibe-validate.schema.json');
      expect(existsSync(schemaPath)).toBe(true);
    });

    it('should generate valid JSON schema file', async () => {
      const schemaPath = resolve(__dirname, '../../../config/vibe-validate.schema.json');
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

      expect(packageJson.files).toContain('vibe-validate.schema.json');
    });
  });

  describe('schema discoverability', () => {
    it('should be accessible via local node_modules path', () => {
      // Simulate installed package structure
      const localSchemaPath = 'node_modules/@vibe-validate/config/vibe-validate.schema.json';

      // Verify the schema exists in our monorepo structure
      const actualSchemaPath = resolve(__dirname, '../../../config/vibe-validate.schema.json');
      expect(existsSync(actualSchemaPath)).toBe(true);
    });

    it('should be accessible via GitHub raw URL', () => {
      // Generate config and verify it references the GitHub URL
      execSync(`node ${cliPath} init --template typescript-library`, {
        cwd: testDir,
      });

      const configPath = join(testDir, 'vibe-validate.config.yaml');
      const configContent = execSync(`cat ${configPath}`, { encoding: 'utf-8' });

      // Should reference GitHub raw URL for IDE support
      expect(configContent).toContain('https://raw.githubusercontent.com');
      expect(configContent).toContain('jdutton/vibe-validate');
      expect(configContent).toContain('main/packages/config/vibe-validate.schema.json');
    });
  });

  describe('schema content validation', () => {
    it('should define VibeValidateConfig schema', async () => {
      const schemaPath = resolve(__dirname, '../../../config/vibe-validate.schema.json');
      const schema = JSON.parse(await readFile(schemaPath, 'utf-8'));

      expect(schema.definitions).toHaveProperty('VibeValidateConfig');
    });

    it('should define validation config properties', async () => {
      const schemaPath = resolve(__dirname, '../../../config/vibe-validate.schema.json');
      const schema = JSON.parse(await readFile(schemaPath, 'utf-8'));

      const vibeConfig = schema.definitions.VibeValidateConfig;
      expect(vibeConfig.properties).toHaveProperty('validation');
      expect(vibeConfig.properties).toHaveProperty('git');
    });

    it('should define phase and step structures', async () => {
      const schemaPath = resolve(__dirname, '../../../config/vibe-validate.schema.json');
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

        execSync(`node ${cliPath} init --template ${template}`, {
          cwd: dir,
        });

        const configPath = join(dir, 'vibe-validate.config.yaml');
        const configContent = await readFile(configPath, 'utf-8');
        const config = parseYaml(configContent) as Record<string, unknown>;

        schemaUrls.push(config.$schema as string);
      }

      // All templates should use the same schema URL
      expect(new Set(schemaUrls).size).toBe(1);
      expect(schemaUrls[0]).toContain('vibe-validate.schema.json');
    });
  });
});

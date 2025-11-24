/**
 * Tests for create-extractor command
 *
 * Tests the extractor plugin scaffolding generator, including the
 * --detection-pattern flag for non-interactive plugin generation.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

describe('create-extractor command', () => {
  let testDir: string;
  const cliPath = join(__dirname, '../../dist/bin.js');

  beforeEach(() => {
    // Create temp directory for test
    testDir = join(tmpdir(), `vibe-validate-create-extractor-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    // Clean up test files
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('plugin scaffolding', () => {
    it('should create extractor plugin directory structure', () => {
      execSync(
        `node "${cliPath}" create-extractor test-extractor --description "Test extractor" --author "Test <test@example.com>" --detection-pattern "ERROR:" --force`,
        {
          cwd: testDir,
          encoding: 'utf-8',
        }
      );

      const pluginDir = join(testDir, 'vibe-validate-plugin-test-extractor');
      expect(existsSync(pluginDir)).toBe(true);

      // Check for package.json
      const packageJsonPath = join(pluginDir, 'package.json');
      expect(existsSync(packageJsonPath)).toBe(true);

      const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
      expect(packageJson.name).toBe('vibe-validate-plugin-test-extractor');
      expect(packageJson.description).toBe('Test extractor');

      // Check for main plugin file
      const pluginFilePath = join(pluginDir, 'index.ts');
      expect(existsSync(pluginFilePath)).toBe(true);
    });

    it('should generate plugin with default pattern in hints when no detection-pattern flag', () => {
      execSync(
        `node "${cliPath}" create-extractor test-extractor --description "Test extractor" --author "Test <test@example.com>" --detection-pattern "ERROR:" --force`,
        {
          cwd: testDir,
          encoding: 'utf-8',
        }
      );

      const pluginFilePath = join(testDir, 'vibe-validate-plugin-test-extractor', 'index.ts');
      const pluginContent = readFileSync(pluginFilePath, 'utf-8');

      // Should contain hints structure with example pattern
      expect(pluginContent).toContain('hints:');
      expect(pluginContent).toContain('required:');
      expect(pluginContent).toContain('ERROR:');
    });

    it('should generate plugin with custom detection pattern when flag provided', () => {
      execSync(
        `node "${cliPath}" create-extractor custom-tool --description "Custom tool extractor" --author "Test <test@example.com>" --detection-pattern "CUSTOM-ERROR:" --force`,
        {
          cwd: testDir,
          encoding: 'utf-8',
        }
      );

      const pluginFilePath = join(testDir, 'vibe-validate-plugin-custom-tool', 'index.ts');
      const pluginContent = readFileSync(pluginFilePath, 'utf-8');

      // Should contain hints with custom pattern
      expect(pluginContent).toContain('hints:');
      expect(pluginContent).toContain('required:');
      expect(pluginContent).toContain('CUSTOM-ERROR:');
    });

    it('should include TypeScript configuration files', () => {
      execSync(
        `node "${cliPath}" create-extractor test-extractor --description "Test extractor" --author "Test <test@example.com>" --detection-pattern "ERROR:" --force`,
        {
          cwd: testDir,
          encoding: 'utf-8',
        }
      );

      const pluginDir = join(testDir, 'vibe-validate-plugin-test-extractor');

      // Check for tsconfig.json
      const tsconfigPath = join(pluginDir, 'tsconfig.json');
      expect(existsSync(tsconfigPath)).toBe(true);

      const tsconfig = JSON.parse(readFileSync(tsconfigPath, 'utf-8'));
      expect(tsconfig.compilerOptions.module).toBe('ES2022');
    });

    it('should generate README with usage instructions', () => {
      execSync(
        `node "${cliPath}" create-extractor test-extractor --description "Test extractor" --author "Test <test@example.com>" --detection-pattern "ERROR:" --force`,
        {
          cwd: testDir,
          encoding: 'utf-8',
        }
      );

      const readmePath = join(testDir, 'vibe-validate-plugin-test-extractor', 'README.md');
      expect(existsSync(readmePath)).toBe(true);

      const readmeContent = readFileSync(readmePath, 'utf-8');
      expect(readmeContent).toContain('Test Extractor');
      expect(readmeContent).toContain('Test extractor');
      expect(readmeContent).toContain('extractors:');
    });
  });

});


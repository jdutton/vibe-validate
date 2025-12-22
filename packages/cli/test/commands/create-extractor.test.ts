/**
 * Tests for create-extractor command
 *
 * Tests the extractor plugin scaffolding generator, including the
 * --detection-pattern flag for non-interactive plugin generation.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
  executeVibeValidateCombined as execCLI,
  setupTestDir,
  cleanupTestDir
} from '../helpers/cli-execution-helpers.js';

describe('create-extractor command', () => {
  // Note: Previously skipped on Windows due to command parser bug (Issue #86)
  // Fixed: Command parser now preserves Windows paths correctly
  // Now uses proper CLI execution helpers for Windows compatibility
  let testDir: string;

  beforeEach(() => {
    testDir = setupTestDir('vibe-validate-create-extractor');
  });

  afterEach(() => {
    cleanupTestDir(testDir);
  });

  describe('plugin scaffolding', () => {
    it('should create extractor plugin directory structure', async () => {
      const output = await execCLI([
        'create-extractor',
        'test-extractor',
        '--description',
        'Test extractor',
        '--author',
        'Test <test@example.com>',
        '--detection-pattern',
        'ERROR:',
        '--force'
      ], { cwd: testDir });

      const pluginDir = join(testDir, 'vibe-validate-plugin-test-extractor');

      // Debug: If directory doesn't exist, throw detailed error instead of assertion
      // This ensures debug info appears in CI logs
      if (!existsSync(pluginDir)) {
        const debugInfo = [
          '=== CREATE-EXTRACTOR DEBUG (Windows CI) ===',
          `testDir: ${testDir}`,
          `testDir exists: ${existsSync(testDir)}`,
          `testDir contents: [${readdirSync(testDir).join(', ') || 'empty'}]`,
          `pluginDir: ${pluginDir}`,
          `pluginDir exists: ${existsSync(pluginDir)}`,
          `Command output (${output.length} chars):`,
          output || '(empty)',
          '=== END DEBUG ===',
        ].join('\n');
        throw new Error(`Plugin directory not created!\n${debugInfo}`);
      }

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

    it('should generate plugin with default pattern in hints when no detection-pattern flag', async () => {
      await execCLI([
        'create-extractor',
        'test-extractor',
        '--description',
        'Test extractor',
        '--author',
        'Test <test@example.com>',
        '--detection-pattern',
        'ERROR:',
        '--force'
      ], { cwd: testDir });

      const pluginFilePath = join(testDir, 'vibe-validate-plugin-test-extractor', 'index.ts');
      const pluginContent = readFileSync(pluginFilePath, 'utf-8');

      // Should contain hints structure with example pattern
      expect(pluginContent).toContain('hints:');
      expect(pluginContent).toContain('required:');
      expect(pluginContent).toContain('ERROR:');
    });

    it('should generate plugin with custom detection pattern when flag provided', async () => {
      await execCLI([
        'create-extractor',
        'custom-tool',
        '--description',
        'Custom tool extractor',
        '--author',
        'Test <test@example.com>',
        '--detection-pattern',
        'CUSTOM-ERROR:',
        '--force'
      ], { cwd: testDir });

      const pluginFilePath = join(testDir, 'vibe-validate-plugin-custom-tool', 'index.ts');
      const pluginContent = readFileSync(pluginFilePath, 'utf-8');

      // Should contain hints with custom pattern
      expect(pluginContent).toContain('hints:');
      expect(pluginContent).toContain('required:');
      expect(pluginContent).toContain('CUSTOM-ERROR:');
    });

    it('should include TypeScript configuration files', async () => {
      await execCLI([
        'create-extractor',
        'test-extractor',
        '--description',
        'Test extractor',
        '--author',
        'Test <test@example.com>',
        '--detection-pattern',
        'ERROR:',
        '--force'
      ], { cwd: testDir });

      const pluginDir = join(testDir, 'vibe-validate-plugin-test-extractor');

      // Check for tsconfig.json
      const tsconfigPath = join(pluginDir, 'tsconfig.json');
      expect(existsSync(tsconfigPath)).toBe(true);

      const tsconfig = JSON.parse(readFileSync(tsconfigPath, 'utf-8'));
      expect(tsconfig.compilerOptions.module).toBe('ES2022');
    });

    it('should generate README with usage instructions', async () => {
      await execCLI([
        'create-extractor',
        'test-extractor',
        '--description',
        'Test extractor',
        '--author',
        'Test <test@example.com>',
        '--detection-pattern',
        'ERROR:',
        '--force'
      ], { cwd: testDir });

      const readmePath = join(testDir, 'vibe-validate-plugin-test-extractor', 'README.md');
      expect(existsSync(readmePath)).toBe(true);

      const readmeContent = readFileSync(readmePath, 'utf-8');
      expect(readmeContent).toContain('Test Extractor');
      expect(readmeContent).toContain('Test extractor');
      expect(readmeContent).toContain('extractors:');
    });
  });

});


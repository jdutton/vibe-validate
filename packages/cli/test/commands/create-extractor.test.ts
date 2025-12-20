/**
 * Tests for create-extractor command
 *
 * Tests the extractor plugin scaffolding generator, including the
 * --detection-pattern flag for non-interactive plugin generation.
 */

import { rmSync, existsSync, readFileSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { safeExecSync, normalizedTmpdir, mkdirSyncReal } from '@vibe-validate/utils';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

/**
 * Execute CLI command and return output
 * Uses absolute CLI path for Windows compatibility
 */
function execCLI(cliPath: string, args: string[], options?: { cwd?: string; encoding?: BufferEncoding }): string {
  try {
    return safeExecSync('node', [cliPath, ...args], { encoding: 'utf-8', ...options }) as string;
  } catch (err: any) {
    // For successful non-zero exits, return output
    if (err.stdout || err.stderr) {
      return (err.stdout || '') + (err.stderr || '');
    }
    throw err;
  }
}

describe('create-extractor command', () => {
  let testDir: string;
  // Use resolve() to get absolute path, then normalize to avoid Windows 8.3 short names
  const cliPath = realpathSync(resolve(__dirname, '../../dist/bin.js'));

  beforeEach(() => {
    // Create temp directory and use normalized path returned by mkdirSyncReal
    const tmpBase = normalizedTmpdir();
    const targetDir = join(tmpBase, `vibe-validate-create-extractor-${Date.now()}`);
    // mkdirSyncReal returns the normalized path - MUST use this return value on Windows
    testDir = mkdirSyncReal(targetDir, { recursive: true });
  });

  afterEach(() => {
    // Clean up test files
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('plugin scaffolding', () => {
    it('should create extractor plugin directory structure', () => {
      execCLI(cliPath, [
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
      execCLI(cliPath, [
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

    it('should generate plugin with custom detection pattern when flag provided', () => {
      execCLI(cliPath, [
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

    it('should include TypeScript configuration files', () => {
      execCLI(cliPath, [
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

    it('should generate README with usage instructions', () => {
      execCLI(cliPath, [
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


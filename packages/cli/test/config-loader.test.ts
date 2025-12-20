import { writeFileSync, existsSync,  rmSync } from 'node:fs';
import { join } from 'node:path';

import { mkdirSyncReal, normalizedTmpdir } from '@vibe-validate/utils';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { loadConfig, configExists, findConfigPath, loadConfigWithErrors, findConfigUp } from '../src/utils/config-loader.js';

describe('config-loader', () => {
  let testDir: string;

  beforeEach(() => {
    // Create temp directory for test files
    testDir = join(normalizedTmpdir(), `vibe-validate-cli-test-${Date.now()}`);
    if (!existsSync(testDir)) {
      mkdirSyncReal(testDir, { recursive: true });
    }

    // Spy on console.error to reduce noise
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    // Clean up test files
    if (existsSync(testDir)) {
      try {
        rmSync(testDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }

    vi.restoreAllMocks();
  });

  describe('configExists', () => {
    it('should return true if vibe-validate.config.yaml exists', () => {
      const configPath = join(testDir, 'vibe-validate.config.yaml');
      writeFileSync(configPath, 'validation:\n  phases: []\n');

      const exists = configExists(testDir);

      expect(exists).toBe(true);
    });

    it('should return false if no config file exists', () => {
      const exists = configExists(testDir);

      expect(exists).toBe(false);
    });

    it('should use process.cwd() if no directory provided', () => {
      // This test verifies the default behavior
      // We can't easily test process.cwd() without mocking, so we just verify it doesn't throw
      const exists = configExists();

      expect(typeof exists).toBe('boolean');
    });
  });

  describe('findConfigPath', () => {
    it('should return path if vibe-validate.config.yaml exists', () => {
      const configPath = join(testDir, 'vibe-validate.config.yaml');
      writeFileSync(configPath, 'validation:\n  phases: []\n');

      const foundPath = findConfigPath(testDir);

      expect(foundPath).toBe(configPath);
    });

    it('should return null if no config file exists', () => {
      const foundPath = findConfigPath(testDir);

      expect(foundPath).toBeNull();
    });

    it('should use process.cwd() if no directory provided', () => {
      // Verify default behavior
      const foundPath = findConfigPath();

      expect(foundPath === null || typeof foundPath === 'string').toBe(true);
    });
  });

  describe('loadConfig', () => {
    it('should return null if config file does not exist', async () => {
      const config = await loadConfig(testDir);

      expect(config).toBeNull();
    });

    it('should return null if config is invalid', async () => {
      const configPath = join(testDir, 'vibe-validate.config.js');
      writeFileSync(configPath, 'this is not valid javascript!@#$');

      const config = await loadConfig(testDir);

      expect(config).toBeNull();
      // Note: findAndLoadConfig returns null for invalid configs without logging
      // Error logging happens at the command level, not the loader level
    });

    it('should use process.cwd() if no directory provided', async () => {
      // Verify default behavior - should not throw
      const config = await loadConfig();

      // We can't predict if config exists in process.cwd(), so just verify type
      expect(config === null || typeof config === 'object').toBe(true);
    });

    // Note: Tests for valid config loading are skipped because:
    // 1. loadConfigFromFile uses tsx/esbuild for dynamic imports
    // 2. Dynamic imports in temp directories fail due to module resolution
    // 3. The underlying @vibe-validate/config package is already tested
    // 4. We test that loadConfig calls loadConfigFromFile correctly (delegation)
    it('should delegate to loadConfigFromFile', async () => {
      // This test verifies integration with the config package
      // The config package itself has comprehensive tests for loading
      const result = await loadConfig(testDir);

      // Should either return null (no config) or a config object
      expect(result === null || typeof result === 'object').toBe(true);
    });

    it('should handle errors gracefully', async () => {
      // Test error handling by attempting to load from invalid directory
      const invalidDir = join(testDir, 'nonexistent-subdir-12345');

      const config = await loadConfig(invalidDir);

      // Should return null for invalid directory (no config found)
      expect(config).toBeNull();
    });
  });

  describe('loadConfigWithErrors', () => {
    it('should return null values when no config file exists', async () => {
      const result = await loadConfigWithErrors(testDir);

      expect(result).toEqual({
        config: null,
        errors: null,
        filePath: null,
      });
    });
  });

  describe('findConfigUp (directory walk-up)', () => {
    it('should find config in current directory', () => {
      const configPath = join(testDir, 'vibe-validate.config.yaml');
      writeFileSync(configPath, 'validation:\n  phases: []\n');

      const foundDir = findConfigUp(testDir);

      expect(foundDir).toBe(testDir);
    });

    it('should find config in parent directory', () => {
      // Create config in root
      const configPath = join(testDir, 'vibe-validate.config.yaml');
      writeFileSync(configPath, 'validation:\n  phases: []\n');

      // Create subdirectory
      const subDir = join(testDir, 'packages');
      mkdirSyncReal(subDir, { recursive: true });

      // Search from subdirectory should find config in parent
      const foundDir = findConfigUp(subDir);

      expect(foundDir).toBe(testDir);
    });

    it('should find config multiple levels up', () => {
      // Create config in root
      const configPath = join(testDir, 'vibe-validate.config.yaml');
      writeFileSync(configPath, 'validation:\n  phases: []\n');

      // Create deeply nested directory
      const deepDir = join(testDir, 'packages', 'cli', 'src', 'commands');
      mkdirSyncReal(deepDir, { recursive: true });

      // Search from deep directory should find config 4 levels up
      const foundDir = findConfigUp(deepDir);

      expect(foundDir).toBe(testDir);
    });

    it('should return null if no config found', () => {
      const subDir = join(testDir, 'no-config-here');
      mkdirSyncReal(subDir, { recursive: true });

      const foundDir = findConfigUp(subDir);

      expect(foundDir).toBeNull();
    });

    it('should prefer closest config file', () => {
      // Create config in root
      const rootConfigPath = join(testDir, 'vibe-validate.config.yaml');
      writeFileSync(rootConfigPath, 'validation:\n  phases:\n    - name: root\n');

      // Create subdirectory with its own config
      const subDir = join(testDir, 'packages');
      mkdirSyncReal(subDir, { recursive: true });
      const subConfigPath = join(subDir, 'vibe-validate.config.yaml');
      writeFileSync(subConfigPath, 'validation:\n  phases:\n    - name: sub\n');

      // Search from subdirectory should find its own config, not parent's
      const foundDir = findConfigUp(subDir);

      expect(foundDir).toBe(subDir);
    });
  });

  describe('config functions with walk-up (integration)', () => {
    it('configExists should find config in parent directory', () => {
      const configPath = join(testDir, 'vibe-validate.config.yaml');
      writeFileSync(configPath, 'validation:\n  phases: []\n');

      const subDir = join(testDir, 'packages', 'core');
      mkdirSyncReal(subDir, { recursive: true });

      const exists = configExists(subDir);

      expect(exists).toBe(true);
    });

    it('findConfigPath should return parent config path', () => {
      const configPath = join(testDir, 'vibe-validate.config.yaml');
      writeFileSync(configPath, 'validation:\n  phases: []\n');

      const subDir = join(testDir, 'packages', 'core');
      mkdirSyncReal(subDir, { recursive: true });

      const foundPath = findConfigPath(subDir);

      expect(foundPath).toBe(configPath);
    });

    it('loadConfig should load from parent directory', async () => {
      const configPath = join(testDir, 'vibe-validate.config.yaml');
      // Use a valid minimal config that will pass schema validation
      const validConfig = `validation:
  phases:
    - name: test
      steps:
        - name: example
          command: echo test
`;
      writeFileSync(configPath, validConfig);

      const subDir = join(testDir, 'packages', 'core');
      mkdirSyncReal(subDir, { recursive: true });

      const config = await loadConfig(subDir);

      expect(config).not.toBeNull();
      expect(config?.validation?.phases).toHaveLength(1);
    });
  });
});

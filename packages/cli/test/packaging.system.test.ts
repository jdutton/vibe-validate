/**
 * System test for npm package integrity
 *
 * This test verifies that the published npm package contains all required files
 * by actually creating a tarball and inspecting its contents.
 *
 * Run with: pnpm test:system
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { safeExecFromString } from '@vibe-validate/git';
import { mkdtempSync, rmSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('npm package tarball (system test)', () => {
  let tempDir: string;
  let tarballPath: string;
  let extractDir: string;

  beforeAll(() => {
    // Create temp directory
    tempDir = mkdtempSync(join(tmpdir(), 'vibe-validate-pack-test-'));
    extractDir = join(tempDir, 'extracted');

    // Run pnpm pack in packages/cli (resolves workspace:* dependencies)
    const cliDir = join(__dirname, '..');
    const output = safeExecFromString('pnpm pack --pack-destination ' + tempDir, {
      cwd: cliDir,
      encoding: 'utf-8',
    });

    // Extract tarball filename from pnpm pack output
    // pnpm outputs the full path on the last line
    const lines = output.trim().split('\n');
    const tarballFullPath = lines[lines.length - 1].trim();

    // Get just the filename
    const tarballName = tarballFullPath.split('/').pop() || '';
    if (!tarballName) {
      throw new Error('Failed to get tarball name from pnpm pack output');
    }

    tarballPath = join(tempDir, tarballName);

    // Extract tarball
    safeExecFromString(`tar -xzf "${tarballPath}" -C "${tempDir}"`, { encoding: 'utf-8' });

    // pnpm pack creates a "package/" subdirectory
    const packageDir = join(tempDir, 'package');
    if (existsSync(packageDir)) {
      extractDir = packageDir;
    }
  });

  afterAll(() => {
    // Cleanup temp directory
    if (tempDir && existsSync(tempDir)) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('critical files', () => {
    it('should include config-templates directory', () => {
      const templatesDir = join(extractDir, 'config-templates');
      expect(
        existsSync(templatesDir),
        'config-templates/ must be included in npm package'
      ).toBe(true);
    });

    it('should include all required template files', () => {
      const templatesDir = join(extractDir, 'config-templates');
      const files = readdirSync(templatesDir);

      const requiredTemplates = [
        'minimal.yaml',
        'typescript-library.yaml',
        'typescript-nodejs.yaml',
        'typescript-react.yaml',
        'README.md',
      ];

      for (const required of requiredTemplates) {
        expect(
          files.includes(required),
          `Template ${required} must be in npm package`
        ).toBe(true);
      }
    });

    it('should include dist directory', () => {
      const distDir = join(extractDir, 'dist');
      expect(existsSync(distDir), 'dist/ must be included in npm package').toBe(true);
    });

    it('should include watch-pr-result.schema.json', () => {
      const schemaPath = join(extractDir, 'watch-pr-result.schema.json');
      expect(
        existsSync(schemaPath),
        'watch-pr-result.schema.json must be included in npm package'
      ).toBe(true);
    });

    it('should include package.json', () => {
      const packageJsonPath = join(extractDir, 'package.json');
      expect(
        existsSync(packageJsonPath),
        'package.json must be included in npm package'
      ).toBe(true);
    });

    it('should include README.md', () => {
      const readmePath = join(extractDir, 'README.md');
      expect(existsSync(readmePath), 'README.md must be included in npm package').toBe(
        true
      );
    });
  });

  describe('excluded files', () => {
    it('should NOT include test files', () => {
      const testDir = join(extractDir, 'test');
      expect(
        existsSync(testDir),
        'test/ directory should NOT be in npm package'
      ).toBe(false);
    });

    it('should NOT include src files', () => {
      const srcDir = join(extractDir, 'src');
      expect(existsSync(srcDir), 'src/ directory should NOT be in npm package').toBe(
        false
      );
    });

    it('should NOT include tsconfig.json', () => {
      const tsconfigPath = join(extractDir, 'tsconfig.json');
      expect(
        existsSync(tsconfigPath),
        'tsconfig.json should NOT be in npm package'
      ).toBe(false);
    });

    it('should NOT include vitest.config.ts', () => {
      const vitestConfigPath = join(extractDir, 'vitest.config.ts');
      expect(
        existsSync(vitestConfigPath),
        'vitest.config.ts should NOT be in npm package'
      ).toBe(false);
    });
  });

  describe('tarball verification', () => {
    it('should create a tarball', () => {
      expect(existsSync(tarballPath), 'npm pack should create a tarball').toBe(true);
    });

    it('should have reasonable tarball size (< 5MB)', () => {
      const { size } = require('node:fs').statSync(tarballPath);
      const sizeMB = size / (1024 * 1024);
      expect(sizeMB, 'Tarball should be < 5MB').toBeLessThan(5);
    });
  });

  describe('end-to-end init command (runtime path resolution)', () => {
    let installDir: string;

    beforeAll(() => {
      // Create a fresh temp directory to simulate a user install
      installDir = mkdtempSync(join(tmpdir(), 'vibe-validate-e2e-test-'));

      // Initialize a package.json
      safeExecFromString('npm init -y', {
        cwd: installDir,
        stdio: 'ignore',
      });

      // Install the tarball
      safeExecFromString(`npm install "${tarballPath}"`, {
        cwd: installDir,
        stdio: 'ignore',
      });
    });

    afterAll(() => {
      // Cleanup install directory
      if (installDir && existsSync(installDir)) {
        rmSync(installDir, { recursive: true, force: true });
      }
    });

    it('should be able to run init command without errors', () => {
      // Run init with --dry-run to test template discovery
      // This is the critical test: can the init command FIND the templates at runtime?
      const output = safeExecFromString('npx vibe-validate init --dry-run', {
        cwd: installDir,
        encoding: 'utf-8',
      });

      // Should not contain error message
      expect(
        output.includes('Template') && output.includes('not found'),
        'Init command should not report template not found'
      ).toBe(false);

      // Should show successful preview
      expect(
        output.includes('Configuration preview') || output.includes('Would create'),
        'Init command should show configuration preview'
      ).toBe(true);
    });

    it('should discover templates from installed package location', () => {
      // Run init with --help to list available templates
      const output = safeExecFromString('npx vibe-validate init --help', {
        cwd: installDir,
        encoding: 'utf-8',
      });

      // Should list templates
      expect(
        output.includes('minimal') ||
          output.includes('typescript-library') ||
          output.includes('typescript-nodejs'),
        'Init help should list available templates'
      ).toBe(true);
    });
  });
});

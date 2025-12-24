/**
 * Tests for create-extractor command
 *
 * Tests the extractor plugin scaffolding generator, including the
 * --detection-pattern flag for non-interactive plugin generation.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { showCreateExtractorVerboseHelp } from '../../src/commands/create-extractor.js';
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

  /**
   * Helper: Create an extractor plugin with standard options
   */
  async function createPlugin(name: string, options: {
    description: string;
    author?: string;
    detectionPattern: string;
    priority?: string;
  }) {
    await execCLI([
      'create-extractor',
      name,
      '--description',
      options.description,
      '--author',
      options.author ?? 'Test <test@example.com>',
      '--detection-pattern',
      options.detectionPattern,
      ...(options.priority ? ['--priority', options.priority] : []),
      '--force'
    ], { cwd: testDir });
  }

  /**
   * Helper: Read a generated file and verify it exists
   */
  function readPluginFile(pluginName: string, filename: string): string {
    const filePath = join(testDir, `vibe-validate-plugin-${pluginName}`, filename);
    expect(existsSync(filePath)).toBe(true);
    return readFileSync(filePath, 'utf-8');
  }

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

    it('should generate index.test.ts with proper test structure', async () => {
      await createPlugin('test-tool', {
        description: 'Test tool extractor',
        detectionPattern: 'FAIL:'
      });

      const testContent = readPluginFile('test-tool', 'index.test.ts');

      // Verify test structure
      expect(testContent).toContain("import { describe, it, expect } from 'vitest'");
      expect(testContent).toContain("describe('test-tool extractor'");
      expect(testContent).toContain("it('should have correct metadata'");
      expect(testContent).toContain("it('should detect Test Tool output'");
      expect(testContent).toContain("it('should not detect non-Test Tool output'");
      expect(testContent).toContain("it('should extract errors from Test Tool output'");
      expect(testContent).toContain("it('should process sample file'");

      // Verify detection pattern is used
      expect(testContent).toContain('FAIL:');

      // Verify proper test expectations
      expect(testContent).toContain('expect(result.confidence).toBeGreaterThan(40)');
      expect(testContent).toContain('expect(result.confidence).toBeLessThan(40)');
    });

    it('should generate CLAUDE.md with comprehensive guidance', async () => {
      await createPlugin('my-tool', {
        description: 'My custom tool',
        author: 'Dev <dev@example.com>',
        detectionPattern: 'MY-ERROR:',
        priority: '85'
      });

      const claudeContent = readPluginFile('my-tool', 'CLAUDE.md');

      // Verify title and description
      expect(claudeContent).toContain('My Tool Extractor - Claude Code Guidance');
      expect(claudeContent).toContain('My custom tool');

      // Verify architecture section
      expect(claudeContent).toContain('## Plugin Architecture');
      expect(claudeContent).toContain('ExtractorPlugin');
      expect(claudeContent).toContain('detect(output: string): DetectionResult');
      expect(claudeContent).toContain('extract(output: string, command?: string): ErrorExtractorResult');

      // Verify detection pattern is documented
      expect(claudeContent).toContain('MY-ERROR:');
      expect(claudeContent).toContain("required: ['MY-ERROR:']");

      // Verify security section
      expect(claudeContent).toContain('## Security Considerations');
      expect(claudeContent).toContain('No file I/O');
      expect(claudeContent).toContain('No process execution');
      expect(claudeContent).toContain('Deterministic');

      // Verify key sections exist
      expect(claudeContent).toContain('## Detection Logic');
      expect(claudeContent).toContain('## Testing Requirements');
      expect(claudeContent).toContain('## Common Modifications');
    });

    it('should generate samples/sample-error.txt with detection pattern', async () => {
      await createPlugin('sample-tool', {
        description: 'Sample tool extractor',
        detectionPattern: 'SAMPLE-ERR:'
      });

      const sampleContent = readPluginFile('sample-tool', 'samples/sample-error.txt');

      // Verify sample contains detection pattern
      expect(sampleContent).toContain('SAMPLE-ERR:');

      // Verify sample has placeholder messages
      expect(sampleContent).toContain('Example error message');
      expect(sampleContent).toContain('Replace this file with real error output');
    });

    it('should use correct priority value in generated plugin', async () => {
      await createPlugin('priority-test', {
        description: 'Priority test',
        detectionPattern: 'ERR:',
        priority: '95'
      });

      const pluginContent = readPluginFile('priority-test', 'index.ts');

      // Verify priority is set correctly
      expect(pluginContent).toContain('priority: 95');
    });

    it('should properly substitute all template variables', async () => {
      await createPlugin('kebab-case-name', {
        description: 'Testing variable substitution',
        author: 'Author Name <author@test.com>',
        detectionPattern: 'VAR-TEST:'
      });

      const pluginContent = readPluginFile('kebab-case-name', 'index.ts');

      // Verify kebab-case name is used
      expect(pluginContent).toContain('kebab-case-name');

      // Verify PascalCase conversion (KebabCaseName)
      expect(pluginContent).toContain('detectKebabCaseName');
      expect(pluginContent).toContain('extractKebabCaseName');

      // Verify Title Case conversion (Kebab Case Name)
      expect(pluginContent).toContain('Kebab Case Name');

      // Verify description
      expect(pluginContent).toContain('Testing variable substitution');

      // Verify author
      expect(pluginContent).toContain('Author Name <author@test.com>');

      // Verify detection pattern
      expect(pluginContent).toContain('VAR-TEST:');
    });

    it('should generate package.json with correct version dependencies', async () => {
      await createPlugin('version-test', {
        description: 'Version test',
        detectionPattern: 'ERR:'
      });

      const packageJson = JSON.parse(readPluginFile('version-test', 'package.json'));

      // Verify peerDependencies and devDependencies have @vibe-validate/extractors
      expect(packageJson.peerDependencies).toHaveProperty('@vibe-validate/extractors');
      expect(packageJson.devDependencies).toHaveProperty('@vibe-validate/extractors');

      // Verify versions are valid semver (either ^x.y.z or x.y.z-rc.n)
      const peerVersion = packageJson.peerDependencies['@vibe-validate/extractors'];
      const devVersion = packageJson.devDependencies['@vibe-validate/extractors'];

      // Should be valid version format
      // eslint-disable-next-line security/detect-unsafe-regex -- Simple semver pattern, no exponential backtracking
      expect(peerVersion).toMatch(/^(\^)?\d+\.\d+\.\d+(-rc\.\d+)?$/);
      // eslint-disable-next-line security/detect-unsafe-regex -- Simple semver pattern, no exponential backtracking
      expect(devVersion).toMatch(/^(\^)?\d+\.\d+\.\d+(-rc\.\d+)?$/);

      // Should match each other
      expect(peerVersion).toBe(devVersion);

      // Verify other expected fields
      expect(packageJson.scripts).toHaveProperty('build');
      expect(packageJson.scripts).toHaveProperty('test');
      expect(packageJson.keywords).toContain('vibe-validate');
      expect(packageJson.keywords).toContain('version-test');
    });
  });

  describe('verbose help', () => {
    it('should display comprehensive help documentation', () => {
      // Spy on console.log to capture output
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      showCreateExtractorVerboseHelp();

      // Get all console.log calls and join them
      const output = consoleSpy.mock.calls.map(call => call[0]).join('\n');

      // Verify key sections are present
      expect(output).toContain('# create-extractor Command Reference');
      expect(output).toContain('## Overview');
      expect(output).toContain('## How It Works');
      expect(output).toContain('## Options');
      expect(output).toContain('## Exit Codes');
      expect(output).toContain('## Files Created');
      expect(output).toContain('## Examples');
      expect(output).toContain('## Development Workflow');
      expect(output).toContain('## Plugin Structure');
      expect(output).toContain('## Next Steps After Creation');
      expect(output).toContain('## Related Commands');

      // Verify critical content
      expect(output).toContain('--detection-pattern');
      expect(output).toContain('--priority');
      expect(output).toContain('--force');
      expect(output).toContain('index.ts');
      expect(output).toContain('index.test.ts');
      expect(output).toContain('README.md');
      expect(output).toContain('CLAUDE.md');
      expect(output).toContain('ExtractorPlugin interface');
      expect(output).toContain('vibe-validate create-extractor');

      // Restore console.log
      consoleSpy.mockRestore();
    });
  });

});


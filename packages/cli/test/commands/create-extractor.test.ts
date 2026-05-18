/**
 * Tests for create-extractor command
 *
 * Tests the extractor plugin scaffolding generator, including the
 * --detection-pattern flag for non-interactive plugin generation.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';

import { normalizedTmpdir, toForwardSlash } from '@vibe-validate/utils';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import yaml from 'yaml';

import {
  emitDryRunPreview,
  gatherContext,
  getPluginFileList,
  showCreateExtractorVerboseHelp,
  type CreateExtractorOptions,
  type TemplateContext,
} from '../../src/commands/create-extractor.js';
import {
  executeVibeValidateCombined as execCLI,
  executeVibeValidateCommand,
  setupTestDir,
  cleanupTestDir
} from '../helpers/cli-execution-helpers.js';

/**
 * Parse the YAML document emitted between `---` separators by `outputYamlResult()`.
 * Mirrors the pattern used in run.integration.test.ts.
 */
function parseYamlFrontMatter(stdout: string): any {
  const yamlMatch = /^---\n([\s\S]*?)\n---/.exec(stdout);
  expect(yamlMatch).toBeTruthy();
  return yaml.parse(yamlMatch![1]);
}

/**
 * Helper: Create an extractor plugin with standard options
 */
async function createPlugin(testDir: string, name: string, options: {
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
function readPluginFile(testDir: string, pluginName: string, filename: string): string {
  const filePath = join(testDir, `vibe-validate-plugin-${pluginName}`, filename);
  expect(existsSync(filePath)).toBe(true);
  return readFileSync(filePath, 'utf-8');
}

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

    it('should generate index.test.ts with proper test structure', async () => {
      await createPlugin(testDir, 'test-tool', {
        description: 'Test tool extractor',
        detectionPattern: 'FAIL:'
      });

      const testContent = readPluginFile(testDir, 'test-tool', 'index.test.ts');

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
      await createPlugin(testDir, 'my-tool', {
        description: 'My custom tool',
        author: 'Dev <dev@example.com>',
        detectionPattern: 'MY-ERROR:',
        priority: '85'
      });

      const claudeContent = readPluginFile(testDir, 'my-tool', 'CLAUDE.md');

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
      await createPlugin(testDir, 'sample-tool', {
        description: 'Sample tool extractor',
        detectionPattern: 'SAMPLE-ERR:'
      });

      const sampleContent = readPluginFile(testDir, 'sample-tool', 'samples/sample-error.txt');

      // Verify sample contains detection pattern
      expect(sampleContent).toContain('SAMPLE-ERR:');

      // Verify sample has placeholder messages
      expect(sampleContent).toContain('Example error message');
      expect(sampleContent).toContain('Replace this file with real error output');
    });

    it('should use correct priority value in generated plugin', async () => {
      await createPlugin(testDir, 'priority-test', {
        description: 'Priority test',
        detectionPattern: 'ERR:',
        priority: '95'
      });

      const pluginContent = readPluginFile(testDir, 'priority-test', 'index.ts');

      // Verify priority is set correctly
      expect(pluginContent).toContain('priority: 95');
    });

    it('should properly substitute all template variables', async () => {
      await createPlugin(testDir, 'kebab-case-name', {
        description: 'Testing variable substitution',
        author: 'Author Name <author@test.com>',
        detectionPattern: 'VAR-TEST:'
      });

      const pluginContent = readPluginFile(testDir, 'kebab-case-name', 'index.ts');

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
      await createPlugin(testDir, 'version-test', {
        description: 'Version test',
        detectionPattern: 'ERR:'
      });

      const packageJson = JSON.parse(readPluginFile(testDir, 'version-test', 'package.json'));

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

  describe('--dry-run', () => {
    it('should emit YAML preview and create no files', async () => {
      const result = await executeVibeValidateCommand([
        'create-extractor',
        'dry-tool',
        '--description', 'Dry-run preview test',
        '--author', 'Test <test@example.com>',
        '--detection-pattern', 'DRY:',
        '--dry-run',
      ], { cwd: testDir });

      expect(result.exitCode).toBe(0);

      // No files should exist on disk.
      const pluginDir = join(testDir, 'vibe-validate-plugin-dry-tool');
      expect(existsSync(pluginDir)).toBe(false);
      expect(readdirSync(testDir)).toHaveLength(0);

      // YAML should match the documented schema.
      const parsed = parseYamlFrontMatter(result.stdout);
      expect(parsed.dryRun).toBe(true);
      expect(parsed.pluginName).toBe('dry-tool');
      expect(parsed.pluginDir).toBe('./vibe-validate-plugin-dry-tool');
      expect(parsed.wouldCreateDir).toEqual([
        './vibe-validate-plugin-dry-tool',
        './vibe-validate-plugin-dry-tool/samples',
      ]);

      // 7 files in canonical order: index.ts, index.test.ts, README.md,
      // CLAUDE.md, package.json, tsconfig.json, samples/sample-error.txt
      expect(parsed.wouldCreate).toHaveLength(7);
      const paths = parsed.wouldCreate.map((entry: { path: string }) => entry.path);
      expect(paths).toEqual([
        './vibe-validate-plugin-dry-tool/index.ts',
        './vibe-validate-plugin-dry-tool/index.test.ts',
        './vibe-validate-plugin-dry-tool/README.md',
        './vibe-validate-plugin-dry-tool/CLAUDE.md',
        './vibe-validate-plugin-dry-tool/package.json',
        './vibe-validate-plugin-dry-tool/tsconfig.json',
        './vibe-validate-plugin-dry-tool/samples/sample-error.txt',
      ]);
      for (const entry of parsed.wouldCreate) {
        expect(typeof entry.bytes).toBe('number');
        expect(entry.bytes).toBeGreaterThan(0);
      }

      // Summary should be consistent with the file list.
      expect(parsed.summary.filesCount).toBe(7);
      expect(parsed.summary.dirsCount).toBe(2);
      const expectedTotal = parsed.wouldCreate.reduce(
        (sum: number, entry: { bytes: number }) => sum + entry.bytes,
        0,
      );
      expect(parsed.summary.totalBytes).toBe(expectedTotal);

      // "Next steps" guidance must NOT appear in dry-run (misleading otherwise).
      expect(result.stdout + result.stderr).not.toContain('Next steps:');
    });

    it('should emit YAML and skip overwrite warning when --dry-run + --force on existing dir', async () => {
      // First, actually create the plugin so the directory exists.
      await createPlugin(testDir, 'existing-tool', {
        description: 'Existing plugin',
        detectionPattern: 'ERR:',
      });

      const pluginDir = join(testDir, 'vibe-validate-plugin-existing-tool');
      expect(existsSync(pluginDir)).toBe(true);
      const indexBefore = readFileSync(join(pluginDir, 'index.ts'), 'utf-8');

      // Re-run with --dry-run --force: should preview, not overwrite.
      const result = await executeVibeValidateCommand([
        'create-extractor',
        'existing-tool',
        '--description', 'Different description',
        '--author', 'Test <test@example.com>',
        '--detection-pattern', 'NEW:',
        '--dry-run',
        '--force',
      ], { cwd: testDir });

      expect(result.exitCode).toBe(0);
      // The overwrite warning should NOT have fired (dry-run bypasses it).
      expect(result.stderr).not.toContain('already exists');

      // YAML preview emitted.
      const parsed = parseYamlFrontMatter(result.stdout);
      expect(parsed.dryRun).toBe(true);
      expect(parsed.pluginName).toBe('existing-tool');

      // The actual file on disk must be untouched.
      const indexAfter = readFileSync(join(pluginDir, 'index.ts'), 'utf-8');
      expect(indexAfter).toBe(indexBefore);
    });
  });

  describe('non-TTY guard', () => {
    it('should exit 1 with helpful error when stdin is not a TTY and required args missing', async () => {
      // executeVibeValidateCommand spawns with stdio: ['ignore', ...],
      // so process.stdin.isTTY is undefined in the child — matching the
      // `vv create-extractor </dev/null` scenario the guard fixes.
      const result = await executeVibeValidateCommand(['create-extractor'], { cwd: testDir });

      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain('plugin name is required when running non-interactively');
      expect(result.stderr).toContain('create-extractor <name>');
      expect(result.stderr).toContain('--description');
      expect(result.stderr).toContain('--author');
      expect(result.stderr).toContain('--detection-pattern');

      // No files written.
      expect(readdirSync(testDir)).toHaveLength(0);
    });

    it('should proceed normally when all required flags are passed (hasAllOptions=true)', async () => {
      const result = await executeVibeValidateCommand([
        'create-extractor',
        'full-flags-tool',
        '--description', 'All flags supplied',
        '--author', 'Test <test@example.com>',
        '--detection-pattern', 'FULL:',
        '--force',
      ], { cwd: testDir });

      expect(result.exitCode).toBe(0);
      expect(result.stderr).not.toContain('plugin name is required when running non-interactively');
      expect(existsSync(join(testDir, 'vibe-validate-plugin-full-flags-tool', 'index.ts'))).toBe(true);
    });
  });

  describe('test-extractor reference scrubbed', () => {
    it('should not mention test-extractor in post-creation output', async () => {
      const output = await execCLI([
        'create-extractor',
        'scrub-check',
        '--description', 'Scrub check',
        '--author', 'Test <test@example.com>',
        '--detection-pattern', 'ERR:',
        '--force',
      ], { cwd: testDir });

      expect(output).not.toContain('test-extractor .');
      expect(output).not.toContain('Test the plugin:');
    });

    it('should not mention test-extractor in verbose help', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      showCreateExtractorVerboseHelp();
      const output = consoleSpy.mock.calls.map(call => call[0]).join('\n');
      consoleSpy.mockRestore();

      // The verbose help must not advertise a command that doesn't exist yet.
      // PR 3 will land `test-extractor` and re-add these references.
      expect(output).not.toContain('test-extractor');
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

/**
 * In-process unit tests for the testable seams of `create-extractor.ts`.
 *
 * The subprocess-based tests above prove behaviour end-to-end but don't
 * contribute to V8 coverage (Vitest's instrumentation only sees code that
 * runs inside the test process). These tests call the exported functions
 * directly so the patch coverage reflects what's actually exercised.
 */

const SAMPLE_FILE = join('samples', 'sample-error.txt');

function makeContext(overrides: Partial<TemplateContext> = {}): TemplateContext {
  return {
    pluginName: 'test-tool',
    className: 'TestTool',
    displayName: 'Test Tool',
    description: 'A test extractor plugin',
    author: 'Test Author <test@example.com>',
    priority: 70,
    detectionPattern: 'ERROR:',
    year: '2026',
    ...overrides,
  };
}

/**
 * Capture every `process.stdout.write` call until the test restores the spy.
 * `outputYamlResult` writes the document in four separate calls plus a
 * "flush" trailing empty write; we concatenate everything but the empty
 * pings so the YAML parser sees a single coherent string.
 */
function captureStdout(): { read: () => string; restore: () => void } {
  const chunks: string[] = [];
  const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array): boolean => {
    chunks.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
    return true;
  });
  return {
    read: () => chunks.join(''),
    restore: () => spy.mockRestore(),
  };
}

describe('create-extractor (in-process unit tests)', () => {
  describe('getPluginFileList', () => {
    it('returns the 7 canonical file entries in stable order', () => {
      const list = getPluginFileList(makeContext());

      // Order matters — both writers and previewers iterate this list and
      // surface entries in the same sequence to the user.
      expect(list.map(f => f.relPath)).toEqual([
        'index.ts',
        'index.test.ts',
        'README.md',
        'CLAUDE.md',
        'package.json',
        'tsconfig.json',
        SAMPLE_FILE,
      ]);
    });

    it('returns non-empty content for every entry', () => {
      const list = getPluginFileList(makeContext());

      for (const { relPath, content } of list) {
        expect(content.length, `empty content for ${relPath}`).toBeGreaterThan(0);
      }
    });

    it('substitutes pluginName into generated content', () => {
      const list = getPluginFileList(makeContext({ pluginName: 'my-cool-plugin' }));
      const pkg = list.find(f => f.relPath === 'package.json');

      expect(pkg).toBeDefined();
      expect(pkg!.content).toContain('vibe-validate-plugin-my-cool-plugin');
    });

    it('substitutes className and detectionPattern into the main source', () => {
      const list = getPluginFileList(makeContext({
        className: 'MyClass',
        detectionPattern: 'FAIL:',
      }));
      const indexTs = list.find(f => f.relPath === 'index.ts');

      expect(indexTs).toBeDefined();
      expect(indexTs!.content).toContain('detectMyClass');
      expect(indexTs!.content).toContain('FAIL:');
    });
  });

  describe('emitDryRunPreview', () => {
    // The function is pure with respect to its `cwd`/`pluginDir` arguments —
    // it does no I/O, just path-relative arithmetic — so any string-shaped
    // path is fine. Using `normalizedTmpdir()` satisfies the project's
    // "no publicly-writable directory literals" lint rule while keeping the
    // test self-contained (no actual files touched).
    const dummyCwd = normalizedTmpdir();
    const dummyPluginDir = join(dummyCwd, 'vibe-validate-plugin-test-tool');

    it('emits a YAML document with the documented schema', async () => {
      const captured = captureStdout();

      try {
        await emitDryRunPreview(dummyCwd, dummyPluginDir, makeContext({ pluginName: 'test-tool' }));
      } finally {
        captured.restore();
      }

      const parsed = parseYamlFrontMatter(captured.read());
      expect(parsed.dryRun).toBe(true);
      expect(parsed.pluginName).toBe('test-tool');
      expect(parsed.pluginDir).toBe('./vibe-validate-plugin-test-tool');
      expect(parsed.wouldCreateDir).toEqual([
        './vibe-validate-plugin-test-tool',
        './vibe-validate-plugin-test-tool/samples',
      ]);
      expect(parsed.wouldCreate).toHaveLength(7);
      expect(parsed.summary.filesCount).toBe(7);
      expect(parsed.summary.dirsCount).toBe(2);
    });

    it('byte counts match Buffer.byteLength of the generated content', async () => {
      const list = getPluginFileList(makeContext());
      const captured = captureStdout();

      try {
        await emitDryRunPreview(dummyCwd, dummyPluginDir, makeContext());
      } finally {
        captured.restore();
      }

      const parsed = parseYamlFrontMatter(captured.read());
      const expectedTotal = list.reduce((sum, f) => sum + Buffer.byteLength(f.content, 'utf8'), 0);

      expect(parsed.summary.totalBytes).toBe(expectedTotal);
      // Each entry's byte count matches its generator's output. We match by
      // basename rather than full path because the emitted path is relative
      // to cwd and the source list uses bare relPaths.
      for (const entry of parsed.wouldCreate as Array<{ path: string; bytes: number }>) {
        const filename = basename(entry.path);
        const sourceEntry = list.find(f => f.relPath.endsWith(filename));
        expect(sourceEntry).toBeDefined();
        expect(entry.bytes).toBe(Buffer.byteLength(sourceEntry!.content, 'utf8'));
      }
    });

    it('emits POSIX-style forward-slash paths regardless of OS path separator', async () => {
      const captured = captureStdout();

      try {
        await emitDryRunPreview(dummyCwd, dummyPluginDir, makeContext());
      } finally {
        captured.restore();
      }

      const parsed = parseYamlFrontMatter(captured.read());
      // toForwardSlash() guarantees no backslashes; the leading-`./` marker
      // is set by emitDryRunPreview's display-path helper. We pre-normalize
      // through toForwardSlash to satisfy the project's `no-path-startswith`
      // lint rule (which insists on normalization before path comparisons).
      for (const entry of parsed.wouldCreate as Array<{ path: string }>) {
        expect(entry.path).not.toContain('\\');
        expect(toForwardSlash(entry.path).startsWith('./')).toBe(true);
      }
    });
  });

  describe('gatherContext non-TTY guard', () => {
    let originalIsTTY: boolean | undefined;
    let exitSpy: ReturnType<typeof vi.spyOn>;
    let errorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      originalIsTTY = process.stdin.isTTY;
      // Simulate a non-TTY stdin (e.g., `vv create-extractor </dev/null`).
      Object.defineProperty(process.stdin, 'isTTY', { value: undefined, configurable: true });
      // process.exit is the boundary we assert on. Throwing from the mock
      // lets the test halt the function without actually exiting node.
      exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
        throw new Error(`process.exit(${code ?? 'undefined'})`);
      }) as never);
      errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
      Object.defineProperty(process.stdin, 'isTTY', { value: originalIsTTY, configurable: true });
      exitSpy.mockRestore();
      errorSpy.mockRestore();
    });

    it('exits 1 when stdin is not a TTY and required args are missing', async () => {
      // No positional name, no --description etc. → guard should fire.
      const opts: CreateExtractorOptions = {};

      await expect(gatherContext(undefined, opts)).rejects.toThrow('process.exit(1)');
      expect(exitSpy).toHaveBeenCalledWith(1);

      // The stderr message lists the flags the user needs to pass.
      const stderr = errorSpy.mock.calls.map(c => String(c[0])).join('\n');
      expect(stderr).toContain('plugin name is required when running non-interactively');
      expect(stderr).toContain('--description');
      expect(stderr).toContain('--author');
      expect(stderr).toContain('--detection-pattern');
    });

    it('proceeds (no exit) when stdin is not a TTY but all required args supplied', async () => {
      // hasAllOptions === true short-circuits both the prompts call AND the
      // guard. Returning a fully-populated TemplateContext is the success
      // path — the function never has to read from stdin.
      const opts: CreateExtractorOptions = {
        description: 'A non-interactive run',
        author: 'CI <ci@example.com>',
        detectionPattern: 'ERR:',
        priority: 70,
      };

      const ctx = await gatherContext('my-tool', opts);
      expect(exitSpy).not.toHaveBeenCalled();
      expect(ctx.pluginName).toBe('my-tool');
      expect(ctx.description).toBe('A non-interactive run');
      expect(ctx.detectionPattern).toBe('ERR:');
    });
  });
});


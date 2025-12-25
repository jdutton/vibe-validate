/**
 * Tests for config-templates/ directory
 *
 * Ensures all YAML template files:
 * - Exist in the repository
 * - Are valid YAML syntax
 * - Pass schema validation
 * - Are referenced correctly in documentation
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { safeValidateConfig } from '@vibe-validate/config';
import { describe, it, expect } from 'vitest';
import { parse as parseYaml } from 'yaml';

// Templates moved to packages/cli/config-templates (permanent location)
const TEMPLATES_DIR = resolve(__dirname, '../config-templates');

const TEMPLATE_FILES = [
  'typescript-library.yaml',
  'typescript-nodejs.yaml',
  'typescript-react.yaml',
  'minimal.yaml',
];

/**
 * Helper: Read template file content
 */
function readTemplateFile(filename: string): string {
  const filePath = resolve(TEMPLATES_DIR, filename);
  return readFileSync(filePath, 'utf-8');
}

/**
 * Helper: Check if YAML content is valid
 */
function isValidYaml(content: string): boolean {
  try {
    parseYaml(content);
    return true;
  } catch {
    return false;
  }
}

/**
 * Helper: Validate config without $schema property
 */
function validateConfigContent(content: string, filename: string): { success: boolean; errors?: any } {
  const raw = parseYaml(content);
  let config = raw;
  if (raw && typeof raw === 'object' && '$schema' in raw) {
    // eslint-disable-next-line sonarjs/no-unused-vars -- NOSONAR - Unused variable intentional, destructured only to exclude $schema
    const { $schema: _$schema, ...rest } = raw as any;
    config = rest;
  }
  const result = safeValidateConfig(config);
  if (!result.success) {
    console.error(`Validation errors in ${filename}:`, result.errors);
  }
  return result;
}

/**
 * Helper: Read and parse template config
 */
function readTemplateConfig(filename: string): any {
  const filePath = resolve(TEMPLATES_DIR, filename);
  const content = readFileSync(filePath, 'utf-8');
  return parseYaml(content);
}

/**
 * Helper: Verify template has expected validation phases
 */
function expectTemplatePhasesToMatch(filename: string, expectedPhases: string[]): void {
  const config = readTemplateConfig(filename);
  expect(config.validation.phases).toHaveLength(expectedPhases.length);
  for (const [index, expectedName] of expectedPhases.entries()) {
    expect(config.validation.phases[index].name).toBe(expectedName);
  }
}

describe('config-templates/', () => {
  describe('directory structure', () => {
    it('should have config-templates directory in CLI package', () => {
      expect(existsSync(TEMPLATES_DIR)).toBe(true);
    });

    it('should have README.md', () => {
      const readmePath = resolve(TEMPLATES_DIR, 'README.md');
      expect(existsSync(readmePath)).toBe(true);
    });
  });

  describe('template files', () => {
    for (const filename of TEMPLATE_FILES) {
      describe(filename, () => {
        const filePath = resolve(TEMPLATES_DIR, filename);

        it('should exist', () => {
          expect(existsSync(filePath)).toBe(true);
        });

        it('should be valid YAML', () => {
          const content = readTemplateFile(filename);
          expect(isValidYaml(content)).toBe(true);
        });

        it('should have JSON Schema reference', () => {
          const content = readTemplateFile(filename);
          expect(content).toContain('$schema:');
          expect(content).toContain('config.schema.json');
        });

        it('should pass strict config validation (no unknown properties)', () => {
          const content = readTemplateFile(filename);
          const result = validateConfigContent(content, filename);
          expect(result.success).toBe(true);
        });
      });
    }
  });

  describe('README.md', () => {
    const readmePath = resolve(TEMPLATES_DIR, 'README.md');

    it('should document all template files', () => {
      const content = readFileSync(readmePath, 'utf-8');

      for (const filename of TEMPLATE_FILES) {
        expect(content).toContain(filename);
      }
    });

    it('should link to main documentation', () => {
      const content = readFileSync(readmePath, 'utf-8');

      expect(content).toContain('configuration-reference.md');
      expect(content).toContain('getting-started.md');
    });

    it('should explain how to use templates', () => {
      const content = readFileSync(readmePath, 'utf-8');

      expect(content).toContain('vibe-validate init');
      expect(content.toLowerCase()).toContain('using these templates');
    });
  });

  describe('template content', () => {
    it('typescript-library should have Pre-Qualification and Build & Test phases', () => {
      expectTemplatePhasesToMatch('typescript-library.yaml', ['Pre-Qualification', 'Build & Test']);
    });

    it('typescript-nodejs should have Pre-Qualification, Testing, and Build phases', () => {
      expectTemplatePhasesToMatch('typescript-nodejs.yaml', ['Pre-Qualification', 'Testing', 'Build']);
    });

    it('typescript-react should have Pre-Qualification, Testing, and Build phases', () => {
      expectTemplatePhasesToMatch('typescript-react.yaml', ['Pre-Qualification', 'Testing', 'Build']);
    });

    it('all templates should have git.mainBranch configured', () => {
      for (const filename of TEMPLATE_FILES) {
        const config = readTemplateConfig(filename);

        expect(config.git).toBeDefined();
        expect(config.git.mainBranch).toBe('main');
      }
    });

    it('all templates should omit failFast (uses default true)', () => {
      for (const filename of TEMPLATE_FILES) {
        const config = readTemplateConfig(filename);

        // failFast should be omitted (defaults to true in schema)
        expect(config.validation.failFast).toBeUndefined();
      }
    });

    it('all templates should have descriptive header comments', () => {
      for (const filename of TEMPLATE_FILES) {
        const filePath = resolve(TEMPLATES_DIR, filename);
        const content = readFileSync(filePath, 'utf-8');

        // Check for header comment (starts with # at beginning of file)
        expect(content.trim()).toMatch(/^# /);

        // Check for "Learn more:" link
        expect(content).toContain('Learn more:');
        expect(content).toContain('github.com/jdutton/vibe-validate');
      }
    });
  });
});

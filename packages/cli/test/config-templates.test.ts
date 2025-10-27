/**
 * Tests for config-templates/ directory
 *
 * Ensures all YAML template files:
 * - Exist in the repository
 * - Are valid YAML syntax
 * - Pass schema validation
 * - Are referenced correctly in documentation
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { parse as parseYaml } from 'yaml';
import { resolve } from 'path';
import { safeValidateConfig } from '@vibe-validate/config';

// Templates moved to packages/cli/config-templates (permanent location)
const TEMPLATES_DIR = resolve(__dirname, '../config-templates');

const TEMPLATE_FILES = [
  'typescript-library.yaml',
  'typescript-nodejs.yaml',
  'typescript-react.yaml',
  'minimal.yaml',
];

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
    TEMPLATE_FILES.forEach(filename => {
      describe(filename, () => {
        const filePath = resolve(TEMPLATES_DIR, filename);

        it('should exist', () => {
          expect(existsSync(filePath)).toBe(true);
        });

        it('should be valid YAML', () => {
          const content = readFileSync(filePath, 'utf-8');
          expect(() => parseYaml(content)).not.toThrow();
        });

        it('should have JSON Schema reference', () => {
          const content = readFileSync(filePath, 'utf-8');
          expect(content).toContain('$schema:');
          expect(content).toContain('vibe-validate.schema.json');
        });

        it('should pass strict config validation (no unknown properties)', () => {
          const content = readFileSync(filePath, 'utf-8');
          const raw = parseYaml(content);

          // Remove $schema property before validation (not part of config schema)
          if (raw && typeof raw === 'object' && '$schema' in raw) {
            const { $schema, ...config } = raw as any;
            const result = safeValidateConfig(config);

            if (!result.success) {
              console.error(`Validation errors in ${filename}:`, result.errors);
            }

            expect(result.success).toBe(true);
          }
        });
      });
    });
  });

  describe('README.md', () => {
    const readmePath = resolve(TEMPLATES_DIR, 'README.md');

    it('should document all template files', () => {
      const content = readFileSync(readmePath, 'utf-8');

      TEMPLATE_FILES.forEach(filename => {
        expect(content).toContain(filename);
      });
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
      const filePath = resolve(TEMPLATES_DIR, 'typescript-library.yaml');
      const content = readFileSync(filePath, 'utf-8');
      const config = parseYaml(content) as any;

      expect(config.validation.phases).toHaveLength(2);
      expect(config.validation.phases[0].name).toBe('Pre-Qualification');
      expect(config.validation.phases[1].name).toBe('Build & Test');
    });

    it('typescript-nodejs should have Pre-Qualification, Testing, and Build phases', () => {
      const filePath = resolve(TEMPLATES_DIR, 'typescript-nodejs.yaml');
      const content = readFileSync(filePath, 'utf-8');
      const config = parseYaml(content) as any;

      expect(config.validation.phases).toHaveLength(3);
      expect(config.validation.phases[0].name).toBe('Pre-Qualification');
      expect(config.validation.phases[1].name).toBe('Testing');
      expect(config.validation.phases[2].name).toBe('Build');
    });

    it('typescript-react should have Pre-Qualification, Testing, and Build phases', () => {
      const filePath = resolve(TEMPLATES_DIR, 'typescript-react.yaml');
      const content = readFileSync(filePath, 'utf-8');
      const config = parseYaml(content) as any;

      expect(config.validation.phases).toHaveLength(3);
      expect(config.validation.phases[0].name).toBe('Pre-Qualification');
      expect(config.validation.phases[1].name).toBe('Testing');
      expect(config.validation.phases[2].name).toBe('Build');
    });

    it('all templates should have git.mainBranch configured', () => {
      TEMPLATE_FILES.forEach(filename => {
        const filePath = resolve(TEMPLATES_DIR, filename);
        const content = readFileSync(filePath, 'utf-8');
        const config = parseYaml(content) as any;

        expect(config.git).toBeDefined();
        expect(config.git.mainBranch).toBe('main');
      });
    });

    it('all templates should omit failFast (uses default true)', () => {
      TEMPLATE_FILES.forEach(filename => {
        const filePath = resolve(TEMPLATES_DIR, filename);
        const content = readFileSync(filePath, 'utf-8');
        const config = parseYaml(content) as any;

        // failFast should be omitted (defaults to true in schema)
        expect(config.validation.failFast).toBeUndefined();
      });
    });

    it('all templates should have descriptive header comments', () => {
      TEMPLATE_FILES.forEach(filename => {
        const filePath = resolve(TEMPLATES_DIR, filename);
        const content = readFileSync(filePath, 'utf-8');

        // Check for header comment (starts with # at beginning of file)
        expect(content.trim()).toMatch(/^# /);

        // Check for "Learn more:" link
        expect(content).toContain('Learn more:');
        expect(content).toContain('github.com/jdutton/vibe-validate');
      });
    });
  });
});

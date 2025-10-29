/**
 * Tests for npm package structure
 *
 * Ensures critical files are included in the published package:
 * - Templates must be packaged for `vibe-validate init` to work
 * - JSON schema must be included for watch-pr command
 */

import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { discoverTemplates } from '../src/utils/template-discovery.js';

describe('npm packaging', () => {
  describe('config-templates/', () => {
    it('should have config-templates directory after build', () => {
      // After build, templates should be copied to packages/cli/config-templates/
      const templatesDir = join(__dirname, '../config-templates');
      expect(
        existsSync(templatesDir),
        'config-templates/ directory must exist after build (run `pnpm build` first)'
      ).toBe(true);
    });

    it('should include at least 4 template files', () => {
      const templates = discoverTemplates();
      expect(
        templates.length,
        'Should discover at least 4 templates (minimal, typescript-library, typescript-nodejs, typescript-react)'
      ).toBeGreaterThanOrEqual(4);
    });

    it('should include specific required templates', () => {
      const templates = discoverTemplates();
      const filenames = new Set(templates.map(t => t.filename));

      const requiredTemplates = [
        'minimal.yaml',
        'typescript-library.yaml',
        'typescript-nodejs.yaml',
        'typescript-react.yaml',
      ];

      for (const required of requiredTemplates) {
        expect(
          filenames.has(required),
          `Template ${required} must be packaged with CLI`
        ).toBe(true);
      }
    });

    it('should include README.md in templates directory', () => {
      const readmePath = join(__dirname, '../config-templates/README.md');
      expect(
        existsSync(readmePath),
        'config-templates/README.md must be packaged with CLI'
      ).toBe(true);
    });
  });

  describe('watch-pr-result.schema.json', () => {
    it('should be included in package root', () => {
      const schemaPath = join(__dirname, '../watch-pr-result.schema.json');
      expect(
        existsSync(schemaPath),
        'watch-pr-result.schema.json must be packaged with CLI'
      ).toBe(true);
    });
  });

  describe('package.json files field', () => {
    it('should include config-templates in files array', () => {
      const packageJson = require('../package.json');
      expect(
        packageJson.files,
        'package.json must have files field'
      ).toBeDefined();
      expect(
        packageJson.files.includes('config-templates'),
        'package.json files array must include "config-templates"'
      ).toBe(true);
    });

    it('should include dist in files array', () => {
      const packageJson = require('../package.json');
      expect(
        packageJson.files.includes('dist'),
        'package.json files array must include "dist"'
      ).toBe(true);
    });
  });
});

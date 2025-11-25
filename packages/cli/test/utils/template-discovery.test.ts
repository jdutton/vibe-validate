/**
 * Tests for template discovery utility
 *
 * Ensures that:
 * 1. All templates are discovered correctly
 * 2. Template metadata is parsed correctly
 * 3. Doctor command lists match actual templates
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { discoverTemplates, formatTemplateList } from '../../src/utils/template-discovery.js';

describe('template-discovery', () => {
  describe('discoverTemplates', () => {
    it('should discover all .yaml templates', () => {
      const templates = discoverTemplates();

      // Should find at least 4 templates
      expect(templates.length).toBeGreaterThanOrEqual(4);

      // All templates should have required fields
      for (const template of templates) {
        expect(template.filename).toBeTruthy();
        expect(template.filename).toMatch(/\.yaml$/);
        expect(template.displayName).toBeTruthy();
      }
    });

    it('should match actual files in config-templates directory', () => {
      const templates = discoverTemplates();
      // Templates are now at packages/cli/config-templates
      // From test at packages/cli/test/utils, that's ../../config-templates
      const templatesDir = join(__dirname, '../../config-templates');

      expect(existsSync(templatesDir)).toBe(true);

      const actualFiles = readdirSync(templatesDir)
        .filter(file => file.endsWith('.yaml'))
        .sort();

      const discoveredFiles = templates.map(t => t.filename).sort();

      expect(discoveredFiles).toEqual(actualFiles);
    });

    it('should parse metadata from known templates', () => {
      const templates = discoverTemplates();

      // Find specific templates
      const minimal = templates.find(t => t.filename === 'minimal.yaml');
      const tsNodejs = templates.find(t => t.filename === 'typescript-nodejs.yaml');
      const tsLibrary = templates.find(t => t.filename === 'typescript-library.yaml');
      const tsReact = templates.find(t => t.filename === 'typescript-react.yaml');

      // Minimal template (may not have description)
      if (minimal) {
        expect(minimal.displayName).toBeTruthy();
        // Description is optional for minimal template
      }

      // TypeScript Node.js template
      if (tsNodejs) {
        expect(tsNodejs.displayName).toContain('Node.js');
        expect(tsNodejs.description).toBeTruthy();
      }

      // TypeScript Library template
      if (tsLibrary) {
        expect(tsLibrary.displayName).toContain('TypeScript');
        expect(tsLibrary.description).toBeTruthy();
      }

      // TypeScript React template
      if (tsReact) {
        expect(tsReact.displayName).toContain('React');
        expect(tsReact.description).toBeTruthy();
      }
    });

    it('should sort templates alphabetically by filename', () => {
      const templates = discoverTemplates();
      const filenames = templates.map(t => t.filename);

      // Check if sorted
      const sorted = [...filenames].sort();
      expect(filenames).toEqual(sorted);
    });
  });

  describe('formatTemplateList', () => {
    it('should format templates for CLI output', () => {
      const formatted = formatTemplateList();

      expect(formatted.length).toBeGreaterThan(0);

      // Each line should start with bullet point
      for (const line of formatted) {
        if (line !== 'No templates found') {
          expect(line).toMatch(/^• /);
          expect(line).toContain('.yaml');
        }
      }
    });

    it('should include descriptions when available', () => {
      const formatted = formatTemplateList();

      // At least some templates should have descriptions
      const withDescriptions = formatted.filter(line => line.includes(' - '));
      expect(withDescriptions.length).toBeGreaterThan(0);
    });

    it('should match format used in doctor command', () => {
      const formatted = formatTemplateList();

      // Format should be: "• filename.yaml - description"
      for (const line of formatted) {
        if (line !== 'No templates found') {
          // eslint-disable-next-line security/detect-unsafe-regex -- Safe: Test code validating known template format (no user input), no ReDoS risk
          expect(line).toMatch(/^• [\w-]+\.yaml( - .+)?$/);
        }
      }
    });
  });

  describe('doctor command integration', () => {
    it('should list all actual templates in doctor suggestion', () => {
      const templates = discoverTemplates();
      const formatted = formatTemplateList();

      // All discovered templates should appear in formatted list
      for (const template of templates) {
        const found = formatted.some(line => line.includes(template.filename));
        expect(found, `Template ${template.filename} should appear in formatted list`).toBe(true);
      }
    });

    it('should not have hardcoded templates that do not exist', () => {
      const templates = discoverTemplates();
      const formatted = formatTemplateList();

      // Extract filenames from formatted list
      const formattedFilenames = formatted
        .filter(line => line !== 'No templates found')
        .map(line => {
          const match = line.match(/• ([\w-]+\.yaml)/);
          return match ? match[1] : null;
        })
        .filter((name): name is string => name !== null);

      const discoveredFilenames = templates.map(t => t.filename);

      // Every formatted filename should exist in discovered templates
      for (const filename of formattedFilenames) {
        expect(
          discoveredFilenames.includes(filename),
          `Formatted list includes ${filename} but it was not discovered`
        ).toBe(true);
      }
    });
  });
});

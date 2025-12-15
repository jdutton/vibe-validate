/**
 * Template Discovery Utility
 *
 * Discovers and reads metadata from config templates in the config-templates/ directory.
 */

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { splitLines } from './normalize-line-endings.js';

/**
 * Metadata for a config template
 */
export interface TemplateMetadata {
  /** Template filename (e.g., "typescript-nodejs.yaml") */
  filename: string;
  /** Display name extracted from header comment (e.g., "TypeScript for Node.js") */
  displayName: string;
  /** Short description extracted from template (e.g., "Node.js apps, APIs, and backend services") */
  description: string;
}

/**
 * Get the absolute path to the config-templates directory
 *
 * This function works both in development (from source) and when installed as npm package.
 *
 * @returns Absolute path to config-templates directory
 */
function getTemplatesDir(): string {
  // Templates are at packages/cli/config-templates (permanent location)
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);

  // Path is the same for both dev and production:
  // Development: packages/cli/src/utils/../../config-templates
  // Production:  packages/cli/dist/utils/../../config-templates
  const templatesPath = join(__dirname, '../../config-templates');

  if (!existsSync(templatesPath)) {
    throw new Error(`Config templates directory not found at ${templatesPath}`);
  }

  return templatesPath;
}

/**
 * Extract template metadata from YAML file
 *
 * Parses the header comment block to extract display name and description.
 *
 * Expected format:
 * ```yaml
 * # ============================================================================
 * # CONFIGURATION TEMPLATE - vibe-validate for TypeScript Libraries
 * # ============================================================================
 * # ...
 * # This template is optimized for TypeScript libraries and npm packages.
 * ```
 *
 * @param filename - Template filename
 * @param content - Template file content
 * @returns Template metadata
 */
function parseTemplateMetadata(filename: string, content: string): TemplateMetadata {
  const lines = splitLines(content);

  // Find the title line (line 2, format: "# CONFIGURATION TEMPLATE - <title>")
  let displayName = filename.replace('.yaml', '');
  const titleLine = lines.find(line => line.includes('CONFIGURATION TEMPLATE -'));
  if (titleLine) {
    const match = /CONFIGURATION TEMPLATE\s*-\s*(.+)/.exec(titleLine);
    if (match) {
      displayName = match[1].trim();
      // Remove "vibe-validate for " prefix if present
      displayName = displayName.replace(/^vibe-validate for\s+/i, '');
    }
  }

  // Find the description (first line starting with "# This template is")
  let description = '';
  const descLine = lines.find(line => line.trim().startsWith('# This template is'));
  if (descLine) {
    description = descLine.replace(/^#\s*This template is\s+/, '').replace(/\.$/, '').trim();
    // Capitalize first letter
    if (description.length > 0) {
      description = description.charAt(0).toUpperCase() + description.slice(1);
    }
  }

  return {
    filename,
    displayName,
    description,
  };
}

/**
 * Discover all available config templates
 *
 * Scans the config-templates/ directory and extracts metadata from each template.
 * Results are sorted alphabetically by filename.
 *
 * @returns Array of template metadata
 */
export function discoverTemplates(): TemplateMetadata[] {
  const templatesDir = getTemplatesDir();

  // Check if directory exists
  if (!existsSync(templatesDir)) {
    return [];
  }

  // Read all .yaml files
  const files = readdirSync(templatesDir)
    .filter(file => file.endsWith('.yaml'))
    // eslint-disable-next-line sonarjs/no-alphabetical-sort -- Alphabetical sorting is intentional for template list display
    .sort();

  // Parse metadata from each template
  const templates: TemplateMetadata[] = [];
  for (const file of files) {
    const filePath = join(templatesDir, file);
    const content = readFileSync(filePath, 'utf-8');
    templates.push(parseTemplateMetadata(file, content));
  }

  return templates;
}

/**
 * Format template list for CLI output
 *
 * Creates a human-readable list of templates with descriptions.
 *
 * Example output:
 * ```
 * • typescript-library.yaml - TypeScript libraries and npm packages
 * • typescript-nodejs.yaml - Node.js apps, APIs, and backend services
 * ```
 *
 * @returns Formatted template list (one template per line)
 */
export function formatTemplateList(): string[] {
  const templates = discoverTemplates();

  if (templates.length === 0) {
    return ['No templates found'];
  }

  return templates.map(t => {
    if (t.description) {
      return `• ${t.filename} - ${t.description}`;
    }
    return `• ${t.filename}`;
  });
}

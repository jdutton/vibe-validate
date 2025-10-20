/**
 * Template Discovery Utility
 *
 * Discovers and reads metadata from config templates in the config-templates/ directory.
 */

import { readdirSync, readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

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
  // In production (npm package), templates are at <package-root>/config-templates
  // In development, templates are at <repo-root>/config-templates
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);

  // Try paths in order:
  // 1. Development: packages/cli/src/utils/../../../config-templates
  const devPath = join(__dirname, '../../../../config-templates');
  if (existsSync(devPath)) {
    return devPath;
  }

  // 2. Production: packages/cli/dist/utils/../../config-templates
  const prodPath = join(__dirname, '../../../config-templates');
  if (existsSync(prodPath)) {
    return prodPath;
  }

  // 3. Fallback: assume monorepo root
  const fallbackPath = join(process.cwd(), 'config-templates');
  return fallbackPath;
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
  const lines = content.split('\n');

  // Find the title line (line 2, format: "# CONFIGURATION TEMPLATE - <title>")
  let displayName = filename.replace('.yaml', '');
  const titleLine = lines.find(line => line.includes('CONFIGURATION TEMPLATE -'));
  if (titleLine) {
    const match = titleLine.match(/CONFIGURATION TEMPLATE\s*-\s*(.+)/);
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

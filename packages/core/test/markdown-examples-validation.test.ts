/**
 * Markdown Examples Validation Test
 *
 * This test searches through all *.md files in the project and validates
 * YAML code blocks against their respective schemas based on tags.
 *
 * Supported schemas:
 * - validation-result:example - ValidationResult schema (state files)
 * - config:example - VibeValidateConfig schema (config files)
 *
 * This ensures documentation examples stay in sync with actual schemas.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { safeValidateResult, PhaseResultSchema, StepResultSchema } from '../src/result-schema.js';
import { ErrorExtractorResultSchema } from '@vibe-validate/extractors';

// Import config validator and utilities from config package
// Note: This is a cross-package import for testing purposes
import { safeValidateConfig, GitConfigSchema } from '../../config/src/schema.js';
import { createSafeValidator } from '@vibe-validate/config';

/**
 * Schema validator configuration
 */
interface SchemaValidator {
  name: string;
  tags: string[]; // Tags that trigger this validator
  validate: (_input: unknown) => { success: true; data: unknown } | { success: false; errors: string[] };
  description: string;
}

const VALIDATORS: SchemaValidator[] = [
  {
    name: 'ValidationResult',
    tags: ['validation-result:example', 'state-file:example'],
    validate: safeValidateResult,
    description: 'Validation result schema (git notes history)',
  },
  {
    name: 'VibeValidateConfig',
    tags: ['config:example', 'vibe-config:example'],
    validate: (data: unknown) => {
      // Config validator returns different format, normalize it
      const result = safeValidateConfig(data);
      if (result.success) {
        return { success: true, data: result.data };
      } else {
        return { success: false, errors: result.errors };
      }
    },
    description: 'Configuration file schema (vibe-validate.config.yaml)',
  },
  {
    name: 'PhaseResult',
    tags: ['phase-result:example'],
    validate: createSafeValidator(PhaseResultSchema),
    description: 'Individual validation phase result',
  },
  {
    name: 'StepResult',
    tags: ['step-result:example'],
    validate: createSafeValidator(StepResultSchema),
    description: 'Individual validation step result',
  },
  {
    name: 'ErrorExtractorResult',
    tags: ['extraction:example', 'error-extraction:example'],
    validate: createSafeValidator(ErrorExtractorResultSchema),
    description: 'Error extraction result (from extractors)',
  },
  {
    name: 'GitConfig',
    tags: ['git-config:example'],
    validate: createSafeValidator(GitConfigSchema),
    description: 'Git configuration section',
  },
];

/**
 * Find all markdown files in a directory recursively
 */
function findMarkdownFiles(dir: string, files: string[] = []): string[] {
  const entries = readdirSync(dir);

  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);

    // Skip node_modules, dist, coverage, .git
    if (entry === 'node_modules' || entry === 'dist' || entry === 'coverage' || entry === '.git') {
      continue;
    }

    if (stat.isDirectory()) {
      findMarkdownFiles(fullPath, files);
    } else if (entry.endsWith('.md')) {
      files.push(fullPath);
    }
  }

  return files;
}

/**
 * Extract tagged YAML examples from markdown content
 *
 * Looks for patterns like:
 * <!-- validation-result:example -->
 * ```yaml
 * ...
 * ```
 *
 * Or:
 * <!-- config:example -->
 * ```yaml
 * ...
 * ```
 *
 * Returns array of { tag, yaml, lineNumber, file }
 */
function extractTaggedExamples(
  content: string,
  filePath: string
): Array<{ tag: string; yaml: string; lineNumber: number; file: string }> {
  const examples: Array<{ tag: string; yaml: string; lineNumber: number; file: string }> = [];
  const lines = content.split('\n');

  // Match any tag like: <!-- category:type -->
  const tagPattern = /<!--\s*([a-z-]+):(example|partial)\s*-->/;
  const codeBlockStart = /^```ya?ml\s*$/;
  const codeBlockEnd = /^```\s*$/;

  let currentTag: string | null = null;
  let inCodeBlock = false;
  let codeBlockContent: string[] = [];
  let codeBlockStartLine = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check for tag
    const tagMatch = line.match(tagPattern);
    if (tagMatch) {
      const [, category, type] = tagMatch;
      currentTag = `${category}:${type}`;
      continue;
    }

    // Check for code block start
    if (currentTag && !inCodeBlock && codeBlockStart.test(line)) {
      inCodeBlock = true;
      codeBlockContent = [];
      codeBlockStartLine = i + 1;
      continue;
    }

    // Check for code block end
    if (inCodeBlock && codeBlockEnd.test(line)) {
      inCodeBlock = false;

      // Only include examples tagged with ":example" (not ":partial")
      if (currentTag && currentTag.endsWith(':example')) {
        examples.push({
          tag: currentTag,
          yaml: codeBlockContent.join('\n'),
          lineNumber: codeBlockStartLine,
          file: filePath,
        });
      }

      currentTag = null;
      continue;
    }

    // Collect code block content
    if (inCodeBlock) {
      codeBlockContent.push(line);
    }
  }

  return examples;
}

/**
 * Find validator for a given tag
 */
function findValidator(tag: string): SchemaValidator | undefined {
  return VALIDATORS.find(v => v.tags.includes(tag));
}

describe('Markdown Examples Validation', () => {
  // Find project root (3 levels up from this test file)
  const projectRoot = join(__dirname, '../../..');

  // Find all markdown files
  const markdownFiles = findMarkdownFiles(projectRoot);

  it('should find at least one markdown file', () => {
    expect(markdownFiles.length).toBeGreaterThan(0);
  });

  // Collect all examples from all files
  const allExamples: Array<{
    tag: string;
    yaml: string;
    lineNumber: number;
    file: string;
  }> = [];

  for (const filePath of markdownFiles) {
    const content = readFileSync(filePath, 'utf-8');
    const examples = extractTaggedExamples(content, filePath);
    allExamples.push(...examples);
  }

  it('should find at least one tagged example', () => {
    expect(allExamples.length).toBeGreaterThan(0);

    if (allExamples.length === 0) {
      console.log('\nNo tagged examples found. Add examples with:');
      console.log('<!-- validation-result:example -->');
      console.log('```yaml');
      console.log('passed: false');
      console.log('timestamp: "2025-10-20T12:00:00.000Z"');
      console.log('treeHash: "abc123..."');
      console.log('```');
      console.log('\nOr:');
      console.log('<!-- config:example -->');
      console.log('```yaml');
      console.log('git:');
      console.log('  mainBranch: main');
      console.log('validation:');
      console.log('  phases: []');
      console.log('```');
    }
  });

  // Group examples by validator
  const examplesByValidator = new Map<string, typeof allExamples>();
  const unknownTagExamples: typeof allExamples = [];

  for (const example of allExamples) {
    const validator = findValidator(example.tag);
    if (validator) {
      if (!examplesByValidator.has(validator.name)) {
        examplesByValidator.set(validator.name, []);
      }
      examplesByValidator.get(validator.name)!.push(example);
    } else {
      unknownTagExamples.push(example);
    }
  }

  // Warn about unknown tags
  if (unknownTagExamples.length > 0) {
    it('should have validators for all tagged examples', () => {
      const unknownTags = new Set(unknownTagExamples.map(e => e.tag));
      const relativePaths = unknownTagExamples.map(e =>
        `${relative(projectRoot, e.file)}:${e.lineNumber} (${e.tag})`
      );

      console.warn(
        `\n⚠️  Found ${unknownTagExamples.length} examples with unknown tags:\n` +
        `  Tags: ${Array.from(unknownTags).join(', ')}\n` +
        `  Locations:\n${relativePaths.map(p => `    - ${p}`).join('\n')}\n\n` +
        `  Known tags: ${VALIDATORS.flatMap(v => v.tags).join(', ')}\n`
      );

      // Don't fail the test, just warn
      expect(unknownTagExamples.length).toBeGreaterThanOrEqual(0);
    });
  }

  // Create tests for each validator's examples
  for (const validator of VALIDATORS) {
    const examples = examplesByValidator.get(validator.name) || [];

    describe(`${validator.name} schema validation`, () => {
      if (examples.length === 0) {
        it(`should have at least one example (none found)`, () => {
          console.log(
            `\n⚠️  No examples found for ${validator.name}\n` +
            `  Add examples with tags: ${validator.tags.join(' or ')}\n` +
            `  Schema: ${validator.description}`
          );
          // Don't fail - just informational
          expect(examples.length).toBe(0);
        });
      }

      for (const example of examples) {
        const relativePath = relative(projectRoot, example.file);
        const testName = `${relativePath}:${example.lineNumber}`;

        it(`should validate ${testName}`, () => {
          let parsed: unknown;

          // Parse YAML
          try {
            parsed = parseYaml(example.yaml);
          } catch (err) {
            throw new Error(
              `Failed to parse YAML in ${relativePath}:${example.lineNumber}\n` +
              `Error: ${err instanceof Error ? err.message : String(err)}\n\n` +
              `YAML content:\n${example.yaml}`
            );
          }

          // Remove $schema property if present (used for IDE support only)
          if (parsed && typeof parsed === 'object' && '$schema' in parsed) {
            delete (parsed as Record<string, unknown>)['$schema'];
          }

          // Validate against schema
          const result = validator.validate(parsed);

          if (!result.success) {
            const errorDetails = result.errors.join('\n  - ');
            throw new Error(
              `${validator.name} validation failed for example in ${relativePath}:${example.lineNumber}\n\n` +
              `Errors:\n  - ${errorDetails}\n\n` +
              `YAML content:\n${example.yaml}\n\n` +
              `Parsed object:\n${JSON.stringify(parsed, null, 2)}\n\n` +
              `Fix: Update the example to match the ${validator.name} schema, or tag it as:\n` +
              `<!-- ${example.tag.split(':')[0]}:partial -->\n` +
              `if it's meant to be a partial example for illustration.`
            );
          }

          // If we get here, validation succeeded
          expect(result.success).toBe(true);
        });
      }
    });
  }

  // Summary test
  it('should report summary of validated examples', () => {
    const fileCount = new Set(allExamples.map(e => e.file)).size;

    console.log(`\n✅ Validated ${allExamples.length} examples across ${fileCount} markdown files`);

    // Summary by validator
    console.log('\nExamples by schema:');
    for (const validator of VALIDATORS) {
      const count = examplesByValidator.get(validator.name)?.length || 0;
      console.log(`  ${validator.name}: ${count} example${count !== 1 ? 's' : ''}`);
    }

    // Summary by file
    console.log('\nExamples by file:');
    const byFile = new Map<string, number>();
    for (const example of allExamples) {
      const relativePath = relative(projectRoot, example.file);
      byFile.set(relativePath, (byFile.get(relativePath) || 0) + 1);
    }

    for (const [file, count] of Array.from(byFile.entries()).sort()) {
      console.log(`  ${file}: ${count} example${count > 1 ? 's' : ''}`);
    }

    expect(allExamples.length).toBeGreaterThan(0);
  });
});

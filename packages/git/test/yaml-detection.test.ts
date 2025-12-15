import { describe, it, expect } from 'vitest';

import { extractYamlContent, extractYamlWithPreamble } from '../src/yaml-detection.js';

import {
  createSimpleYaml,
  createYamlInput,
  toWindowsLineEndings,
  createNpmPreamble,
  createPreamble,
  expectYamlWithPreamble,
} from './helpers/yaml-test-helpers.js';

describe('extractYamlContent', () => {
  it('should extract YAML with no preamble', () => {
    const input = createSimpleYaml('key', 'value', 'other', 'data');
    const result = extractYamlContent(input);
    expect(result).toBe(input);
  });

  it('should extract YAML with preamble', () => {
    const preamble = createNpmPreamble('package@1.0.0', 'test', 'vitest run');
    const input = createYamlInput({ yaml: 'key: value', preamble });
    const result = extractYamlContent(input);
    expect(result).toBe(createSimpleYaml('key', 'value'));
  });

  it('should handle Windows line endings', () => {
    const input = toWindowsLineEndings(
      createYamlInput({ yaml: 'key: value', preamble: '> preamble' })
    );
    const result = extractYamlContent(input);
    expect(result).toBe(toWindowsLineEndings(createSimpleYaml('key', 'value')));
  });

  it('should return null if no YAML found', () => {
    const input = 'just some regular text\nno yaml here';
    const result = extractYamlContent(input);
    expect(result).toBeNull();
  });

  it('should stop at trailing --- (traditional frontmatter)', () => {
    const input = createYamlInput({
      yaml: 'title: Post\nauthor: John',
      trailingContent: 'Content after YAML',
    });
    const result = extractYamlContent(input);
    expect(result).toBe('---\ntitle: Post\nauthor: John\n');
    expect(result).not.toContain('Content after YAML');
  });

  it('should stop at trailing --- with Windows line endings', () => {
    const input = toWindowsLineEndings(
      createYamlInput({ yaml: 'title: Post', trailingContent: 'Content' })
    );
    const result = extractYamlContent(input);
    expect(result).toBe(toWindowsLineEndings('---\ntitle: Post\n'));
  });

  it('should handle trailing --- at end of string', () => {
    const input = createYamlInput({ yaml: 'title: Post', trailingContent: '' });
    const result = extractYamlContent(input);
    expect(result).toBe('---\ntitle: Post\n');
  });

  it('should not match --- in YAML values', () => {
    const input = '---\nkey: value with --- inside\nother: data\n';
    const result = extractYamlContent(input);
    expect(result).toBe('---\nkey: value with --- inside\nother: data\n');
  });

  it('should handle preamble with trailing ---', () => {
    const input = createYamlInput({
      yaml: 'title: Post',
      preamble: '> preamble',
      trailingContent: 'Content',
    });
    const result = extractYamlContent(input);
    expect(result).toBe('---\ntitle: Post\n');
  });

  it('should handle empty YAML content', () => {
    const input = '---\n---\n';
    const result = extractYamlContent(input);
    expect(result).toBe('---\n');
  });
});

describe('extractYamlWithPreamble', () => {
  it('should extract YAML and empty preamble when no preamble', () => {
    const yaml = createSimpleYaml('key', 'value');
    const input = yaml;
    const result = extractYamlWithPreamble(input);
    expect(result).toEqual(expectYamlWithPreamble(yaml));
  });

  it('should extract YAML and preamble separately', () => {
    const preamble = createNpmPreamble('package@1.0.0', 'test', 'vitest run');
    const yaml = createSimpleYaml('key', 'value');
    const input = createYamlInput({ yaml: 'key: value', preamble });
    const result = extractYamlWithPreamble(input);
    expect(result).toEqual(expectYamlWithPreamble(yaml, preamble));
  });

  it('should trim preamble whitespace', () => {
    const input = '  \n  preamble with spaces  \n\n---\nkey: value\n';
    const result = extractYamlWithPreamble(input);
    expect(result?.preamble).toBe('preamble with spaces');
  });

  it('should return null if no YAML found', () => {
    const input = 'no yaml here';
    const result = extractYamlWithPreamble(input);
    expect(result).toBeNull();
  });

  it('should handle Windows line endings in preamble', () => {
    const input = toWindowsLineEndings(
      createYamlInput({ yaml: 'key: value', preamble: '> preamble' })
    );
    const result = extractYamlWithPreamble(input);
    expect(result).toEqual(
      expectYamlWithPreamble(toWindowsLineEndings(createSimpleYaml('key', 'value')), '> preamble')
    );
  });

  it('should stop at trailing --- and separate preamble', () => {
    const input = createYamlInput({
      yaml: 'title: Post',
      preamble: 'preamble',
      trailingContent: 'Content',
    });
    const result = extractYamlWithPreamble(input);
    expect(result).toEqual(expectYamlWithPreamble('---\ntitle: Post\n', 'preamble'));
  });

  it('should handle multi-line preamble', () => {
    const preamble = createPreamble('line 1', 'line 2', 'line 3');
    const yaml = createSimpleYaml('key', 'value');
    const input = createYamlInput({ yaml: 'key: value', preamble });
    const result = extractYamlWithPreamble(input);
    expect(result?.preamble).toBe(preamble);
    expect(result?.yaml).toBe(yaml);
  });
});

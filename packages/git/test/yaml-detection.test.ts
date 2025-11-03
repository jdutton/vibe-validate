import { describe, it, expect } from 'vitest';
import { extractYamlContent, extractYamlWithPreamble } from '../src/yaml-detection.js';

describe('extractYamlContent', () => {
  it('should extract YAML with no preamble', () => {
    const input = '---\nkey: value\nother: data\n';
    const result = extractYamlContent(input);
    expect(result).toBe('---\nkey: value\nother: data\n');
  });

  it('should extract YAML with preamble', () => {
    const input = '> package@1.0.0 test\n> vitest run\n\n---\nkey: value\n';
    const result = extractYamlContent(input);
    expect(result).toBe('---\nkey: value\n');
  });

  it('should handle Windows line endings', () => {
    const input = '> preamble\r\n---\r\nkey: value\r\n';
    const result = extractYamlContent(input);
    expect(result).toBe('---\r\nkey: value\r\n');
  });

  it('should return null if no YAML found', () => {
    const input = 'just some regular text\nno yaml here';
    const result = extractYamlContent(input);
    expect(result).toBeNull();
  });

  it('should stop at trailing --- (traditional frontmatter)', () => {
    const input = '---\ntitle: Post\nauthor: John\n---\nContent after YAML';
    const result = extractYamlContent(input);
    expect(result).toBe('---\ntitle: Post\nauthor: John\n');
    expect(result).not.toContain('Content after YAML');
  });

  it('should stop at trailing --- with Windows line endings', () => {
    const input = '---\r\ntitle: Post\r\n---\r\nContent';
    const result = extractYamlContent(input);
    expect(result).toBe('---\r\ntitle: Post\r\n');
  });

  it('should handle trailing --- at end of string', () => {
    const input = '---\ntitle: Post\n---';
    const result = extractYamlContent(input);
    expect(result).toBe('---\ntitle: Post\n');
  });

  it('should not match --- in YAML values', () => {
    const input = '---\nkey: value with --- inside\nother: data\n';
    const result = extractYamlContent(input);
    expect(result).toBe('---\nkey: value with --- inside\nother: data\n');
  });

  it('should handle preamble with trailing ---', () => {
    const input = '> preamble\n---\ntitle: Post\n---\nContent';
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
    const input = '---\nkey: value\n';
    const result = extractYamlWithPreamble(input);
    expect(result).toEqual({
      yaml: '---\nkey: value\n',
      preamble: ''
    });
  });

  it('should extract YAML and preamble separately', () => {
    const input = '> package@1.0.0 test\n> vitest run\n\n---\nkey: value\n';
    const result = extractYamlWithPreamble(input);
    expect(result).toEqual({
      yaml: '---\nkey: value\n',
      preamble: '> package@1.0.0 test\n> vitest run'
    });
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
    const input = '> preamble\r\n---\r\nkey: value\r\n';
    const result = extractYamlWithPreamble(input);
    expect(result).toEqual({
      yaml: '---\r\nkey: value\r\n',
      preamble: '> preamble'
    });
  });

  it('should stop at trailing --- and separate preamble', () => {
    const input = 'preamble\n---\ntitle: Post\n---\nContent';
    const result = extractYamlWithPreamble(input);
    expect(result).toEqual({
      yaml: '---\ntitle: Post\n',
      preamble: 'preamble'
    });
  });

  it('should handle multi-line preamble', () => {
    const input = 'line 1\nline 2\nline 3\n---\nkey: value\n';
    const result = extractYamlWithPreamble(input);
    expect(result?.preamble).toBe('line 1\nline 2\nline 3');
    expect(result?.yaml).toBe('---\nkey: value\n');
  });
});

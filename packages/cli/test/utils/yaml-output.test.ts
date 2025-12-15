import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { outputYamlResult } from '../../src/utils/yaml-output.js';

describe('outputYamlResult', () => {
  let stdoutWriteSpy: ReturnType<typeof vi.spyOn>;
  let writtenData: string[];

  beforeEach(() => {
    writtenData = [];
    stdoutWriteSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: any): boolean => {
      if (typeof chunk === 'string') {
        writtenData.push(chunk);
      }
      return true;
    });
  });

  afterEach(() => {
    stdoutWriteSpy.mockRestore();
  });

  it('should output opening --- separator', async () => {
    await outputYamlResult({ test: 'value' });

    expect(writtenData[0]).toBe('---\n');
  });

  it('should output closing --- separator', async () => {
    await outputYamlResult({ test: 'value' });

    // Find the closing --- in the written data
    const closingSeparator = writtenData.find((chunk, index) =>
      index > 0 && chunk === '---\n'
    );

    expect(closingSeparator).toBe('---\n');
  });

  it('should output YAML content between separators', async () => {
    await outputYamlResult({ test: 'value', number: 42 });

    // Join all written chunks
    const fullOutput = writtenData.join('');

    // Should start with ---
    expect(fullOutput).toMatch(/^---\n/);

    // Should contain YAML content
    expect(fullOutput).toContain('test: value');
    expect(fullOutput).toContain('number: 42');

    // Should end with ---
    expect(fullOutput).toMatch(/---\n$/);
  });

  it('should add newline before closing --- if YAML does not end with newline', async () => {
    await outputYamlResult({ test: 'value' });

    const fullOutput = writtenData.join('');

    // Should not have --- immediately after content (should have newline)
    expect(fullOutput).not.toMatch(/value---/);

    // Should have newline before closing ---
    expect(fullOutput).toMatch(/\n---\n$/);
  });

  it('should handle complex nested YAML structures', async () => {
    const complexData = {
      passed: false,
      phases: [
        {
          name: 'Testing',
          steps: [
            {
              name: 'Unit Tests',
              command: 'pnpm test',
              passed: false,
            },
          ],
        },
      ],
    };

    await outputYamlResult(complexData);

    const fullOutput = writtenData.join('');

    // Should have both separators
    expect(fullOutput).toMatch(/^---\n/);
    expect(fullOutput).toMatch(/---\n$/);

    // Should contain the nested structure
    expect(fullOutput).toContain('passed: false');
    expect(fullOutput).toContain('phases:');
    expect(fullOutput).toContain('- name: Testing');
  });

  it('should handle empty object', async () => {
    await outputYamlResult({});

    const fullOutput = writtenData.join('');

    expect(fullOutput).toMatch(/^---\n/);
    expect(fullOutput).toMatch(/---\n$/);
  });
});

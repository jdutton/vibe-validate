/**
 * Sandbox Module Tests
 *
 * Tests secure extractor execution using isolated-vm.
 * These tests validate the sandbox can execute real extractor code safely.
 */

import { describe, it, expect } from 'vitest';
import {
  runInSandbox,
  createSandboxedCode,
  SandboxStatsCollector,
} from '../src/sandbox.js';
import type { FormattedError } from '../src/types.js';

describe('Sandbox Module', () => {
  describe('runInSandbox', () => {
    it('should execute simple extractor code successfully', async () => {
      const code = `
        function extract(content) {
          return [
            { message: 'Test error', severity: 'error' }
          ];
        }
      `;

      const result = await runInSandbox({
        code,
        input: 'test input',
        extractorName: 'test'
      });

      expect(result.success).toBe(true);
      expect(result.errors).toHaveLength(1);
      expect(result.errors?.[0].message).toBe('Test error');
      expect(result.stats.durationMs).toBeGreaterThan(0);
    });

    it('should handle extractor that throws an error', async () => {
      const code = `
        function extract(content) {
          throw new Error('Intentional failure');
        }
      `;

      const result = await runInSandbox({
        code,
        input: 'test input',
        extractorName: 'test'
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Intentional failure');
    });

    it('should enforce memory limits', async () => {
      const code = `
        function extract(content) {
          // Try to allocate memory and fill it
          const arrays = [];
          try {
            while (true) {
              // Allocate 1MB chunks
              arrays.push(new Array(256 * 1024).fill(1));
            }
          } catch (e) {
            // Memory exhausted - this is expected
            throw new Error('Out of memory');
          }
          return [];
        }
      `;

      const result = await runInSandbox({
        code,
        input: 'test',
        extractorName: 'memory-hog',
        memoryLimitMB: 10, // Very low limit
        timeoutMs: 1000 // Also set timeout to prevent hanging
      });

      // Should fail either due to memory limit or timeout
      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should enforce timeout limits', async () => {
      const code = `
        function extract(content) {
          // Infinite loop
          while (true) {}
          return [];
        }
      `;

      const result = await runInSandbox({
        code,
        input: 'test',
        extractorName: 'infinite-loop',
        timeoutMs: 100 // Short timeout
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('timed out');
    });

    it('should execute real extractor code (TypeScript-like)', async () => {
      const code = String.raw`
        function extract(content) {
          const errors = [];
          const pattern = /error TS(\d+):\s*(.+)/g;

          let match;
          while ((match = pattern.exec(content)) !== null) {
            errors.push({
              message: match[2].trim(),
              code: 'TS' + match[1],
              severity: 'error'
            });
          }

          return errors;
        }
      `;

      const input = `
        src/test.ts:10:15 - error TS2322: Type 'string' is not assignable to type 'number'.
        src/test.ts:20:5 - error TS2304: Cannot find name 'undefined'.
      `;

      const result = await runInSandbox({
        code,
        input,
        extractorName: 'typescript'
      });

      expect(result.success).toBe(true);
      expect(result.errors).toHaveLength(2);
      expect(result.errors?.[0].code).toBe('TS2322');
      expect(result.errors?.[1].code).toBe('TS2304');
    });

    it('should execute real extractor code (Maven-like)', async () => {
      const code = String.raw`
        function extract(content) {
          const errors = [];
          const pattern = /\[ERROR\]\s+([^:]+):\[(\d+),(\d+)\]\s+(.+)/g;

          let match;
          while ((match = pattern.exec(content)) !== null) {
            errors.push({
              file: match[1].trim(),
              line: parseInt(match[2], 10),
              column: parseInt(match[3], 10),
              message: match[4].trim(),
              severity: 'error'
            });
          }

          return errors;
        }
      `;

      const input = `
        [ERROR] /src/main/java/App.java:[15,20] cannot find symbol
        [ERROR] /src/main/java/Utils.java:[42,8] incompatible types
      `;

      const result = await runInSandbox({
        code,
        input,
        extractorName: 'maven-compiler'
      });

      expect(result.success).toBe(true);
      expect(result.errors).toHaveLength(2);
      expect(result.errors?.[0].file).toContain('App.java');
      expect(result.errors?.[0].line).toBe(15);
      expect(result.errors?.[1].file).toContain('Utils.java');
      expect(result.errors?.[1].line).toBe(42);
    });

    it('should provide accurate performance statistics', async () => {
      const code = `
        function extract(content) {
          // Do some work
          let result = [];
          for (let i = 0; i < 1000; i++) {
            result.push({ message: 'Error ' + i, severity: 'error' });
          }
          return result;
        }
      `;

      const result = await runInSandbox({
        code,
        input: 'test',
        extractorName: 'perf-test'
      });

      expect(result.success).toBe(true);
      expect(result.stats.durationMs).toBeGreaterThan(0);
      expect(result.stats.durationMs).toBeLessThan(1000); // Should be fast
      expect(result.stats.memoryUsedMB).toBeGreaterThan(0);
    });

    it('should handle extractors that return empty arrays', async () => {
      const code = `
        function extract(content) {
          return [];
        }
      `;

      const result = await runInSandbox({
        code,
        input: 'no errors here',
        extractorName: 'clean'
      });

      expect(result.success).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should handle extractors with complex logic', async () => {
      const code = String.raw`
        function extract(content) {
          const errors = [];
          const lines = content.split('\n');

          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            // Skip empty lines
            if (!line.trim()) continue;

            // Parse error format
            if (line.includes('ERROR:')) {
              const parts = line.split('ERROR:');
              if (parts.length === 2) {
                errors.push({
                  message: parts[1].trim(),
                  line: i + 1,
                  severity: 'error'
                });
              }
            }
          }

          return errors;
        }
      `;

      const input = `
        Line 1: Some output
        Line 2: ERROR: First error
        Line 3: More output
        Line 4: ERROR: Second error
      `;

      const result = await runInSandbox({
        code,
        input,
        extractorName: 'complex'
      });

      expect(result.success).toBe(true);
      expect(result.errors).toHaveLength(2);
      expect(result.errors?.[0].message).toBe('First error');
      expect(result.errors?.[1].message).toBe('Second error');
    });
  });

  describe('createSandboxedCode', () => {
    it('should handle named function declarations', () => {
      function extract(content: string): FormattedError[] {
        return [{ message: content, severity: 'error' }];
      }

      const code = createSandboxedCode(extract);

      expect(code).toContain('function extract(');
      expect(code).toContain('return [');
    });

    it('should handle arrow functions', () => {
      const extract = (content: string): FormattedError[] => {
        return [{ message: content, severity: 'error' }];
      };

      const code = createSandboxedCode(extract);

      expect(code).toContain('function extract(content)');
    });
  });

  describe('SandboxStatsCollector', () => {
    it('should collect execution statistics', async () => {
      const collector = new SandboxStatsCollector();

      const code = `
        function extract(content) {
          return [{ message: 'Test', severity: 'error' }];
        }
      `;

      // Execute multiple times
      for (let i = 0; i < 3; i++) {
        const result = await runInSandbox({
          code,
          input: 'test',
          extractorName: 'stats-test'
        });

        collector.record(result);
      }

      const stats = collector.getStats();

      expect(stats.totalExecutions).toBe(3);
      expect(stats.successfulExecutions).toBe(3);
      expect(stats.failedExecutions).toBe(0);
      expect(stats.averageDurationMs).toBeGreaterThan(0);
      expect(stats.averageMemoryUsedMB).toBeGreaterThan(0);
    });

    it('should track both successful and failed executions', async () => {
      const collector = new SandboxStatsCollector();

      // Successful execution
      const successCode = `
        function extract(content) {
          return [];
        }
      `;

      const successResult = await runInSandbox({
        code: successCode,
        input: 'test',
        extractorName: 'success'
      });

      collector.record(successResult);

      // Failed execution
      const failCode = `
        function extract(content) {
          throw new Error('Fail');
        }
      `;

      const failResult = await runInSandbox({
        code: failCode,
        input: 'test',
        extractorName: 'fail'
      });

      collector.record(failResult);

      const stats = collector.getStats();

      expect(stats.totalExecutions).toBe(2);
      expect(stats.successfulExecutions).toBe(1);
      expect(stats.failedExecutions).toBe(1);
    });

    it('should reset statistics', async () => {
      const collector = new SandboxStatsCollector();

      const code = `
        function extract(content) {
          return [];
        }
      `;

      const result = await runInSandbox({
        code,
        input: 'test',
        extractorName: 'reset-test'
      });

      collector.record(result);

      expect(collector.getStats().totalExecutions).toBe(1);

      collector.reset();

      expect(collector.getStats().totalExecutions).toBe(0);
      expect(collector.getStats().successfulExecutions).toBe(0);
      expect(collector.getStats().failedExecutions).toBe(0);
    });
  });

  describe('Security Tests', () => {
    it('should block access to Node.js process', async () => {
      const code = `
        function extract(content) {
          // Try to access process
          if (typeof process !== 'undefined') {
            return [{ message: 'Process accessible!', severity: 'error' }];
          }
          return [];
        }
      `;

      const result = await runInSandbox({
        code,
        input: 'test',
        extractorName: 'process-test'
      });

      expect(result.success).toBe(true);
      expect(result.errors).toHaveLength(0); // process should be undefined
    });

    it('should block access to require', async () => {
      const code = `
        function extract(content) {
          // Try to use require
          try {
            require('fs');
            return [{ message: 'require accessible!', severity: 'error' }];
          } catch (e) {
            return [];
          }
        }
      `;

      const result = await runInSandbox({
        code,
        input: 'test',
        extractorName: 'require-test'
      });

      expect(result.success).toBe(true);
      expect(result.errors).toHaveLength(0); // require should fail
    });

    it('should allow safe operations (String, Array, Object, JSON)', async () => {
      const code = String.raw`
        function extract(content) {
          // Use safe APIs
          const lines = content.split('\n');
          const mapped = lines.map(l => l.trim());
          const filtered = mapped.filter(l => l.length > 0);
          const obj = { count: filtered.length };
          const json = JSON.stringify(obj);
          const parsed = JSON.parse(json);

          return [{
            message: 'Count: ' + parsed.count,
            severity: 'info'
          }];
        }
      `;

      const result = await runInSandbox({
        code,
        input: 'line1\nline2\n\nline3',
        extractorName: 'safe-api-test'
      });

      expect(result.success).toBe(true);
      expect(result.errors).toHaveLength(1);
      expect(result.errors?.[0].message).toBe('Count: 3');
    });
  });
});

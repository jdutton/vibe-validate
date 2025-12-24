/**
 * Tests for Sandboxed Extractor Wrapper
 */

import { describe, it, expect } from 'vitest';

import { createSandboxedExtractor } from '../src/sandboxed-extractor.js';

import {
  createMockPlugin,
  createSingleErrorFromOutputPlugin,
  createCommandPrefixErrorPlugin,
  createMultipleErrorPlugin,
  createNoErrorPlugin,
  createSyntaxErrorPlugin,
  createExtractorFailedPlugin,
  parseErrorLines,
  createRegexErrorExtractor,
  expectSingleError,
  expectNoErrors,
  expectErrorCount,
  expectSandboxFailure,
} from './helpers/sandboxed-extractor-helpers.js';

describe('createSandboxedExtractor', () => {
  describe('trust: full (no sandbox)', () => {
    it('should execute extractor directly without sandboxing', async () => {
      const plugin = createSingleErrorFromOutputPlugin();

      const wrappedExtract = createSandboxedExtractor(plugin, { trust: 'full' });
      const result = await wrappedExtract('error: test failed');

      expectSingleError(result, 'error: test failed');
      expect(result.summary).toBe('1 error');
    });

    it('should pass command parameter to extractor', async () => {
      const plugin = createCommandPrefixErrorPlugin();

      const wrappedExtract = createSandboxedExtractor(plugin, { trust: 'full' });
      const result = await wrappedExtract('error', 'npm test');

      expect(result).toBeDefined();
      expectSingleError(result, 'npm test: error');
    });

    it('should handle extractors that return no errors', async () => {
      const plugin = createNoErrorPlugin();

      const wrappedExtract = createSandboxedExtractor(plugin, { trust: 'full' });
      const result = await wrappedExtract('clean output');

      expectNoErrors(result);
      expect(result.summary).toBe('No errors');
    });
  });

  describe('trust: sandbox (with isolation)', () => {
    it('should execute extractor in sandbox', async () => {
      const plugin = createSingleErrorFromOutputPlugin();

      const wrappedExtract = createSandboxedExtractor(plugin, { trust: 'sandbox' });
      const result = await wrappedExtract('error: test failed');

      expect(result).toBeDefined();
      expectSingleError(result, 'error: test failed');
    });

    it('should use default trust level (sandbox) when not specified', async () => {
      const plugin = createSingleErrorFromOutputPlugin();

      // No trust specified - should default to sandbox
      const wrappedExtract = createSandboxedExtractor(plugin);
      const result = await wrappedExtract('error: test failed');

      expect(result).toBeDefined();
      expectSingleError(result, 'error: test failed');
    });

    it('should handle extractors with multiple errors', async () => {
      const plugin = createMultipleErrorPlugin();

      const wrappedExtract = createSandboxedExtractor(plugin, { trust: 'sandbox' });
      const result = await wrappedExtract('multiple errors');

      expectErrorCount(result, 3);
      expect(result.summary).toBe('3 errors');
    });

    it('should handle extractors that use string manipulation', async () => {
      const plugin = createMockPlugin(parseErrorLines);

      const wrappedExtract = createSandboxedExtractor(plugin, { trust: 'sandbox' });
      const result = await wrappedExtract('INFO: Starting\nERROR: Failed\nINFO: Done');

      expect(result).toBeDefined();
      expectSingleError(result, 'ERROR: Failed');
    });

    it('should handle extractors that use regex', async () => {
      const plugin = createMockPlugin(createRegexErrorExtractor());

      const wrappedExtract = createSandboxedExtractor(plugin, { trust: 'sandbox' });
      const result = await wrappedExtract('Error at line 5: undefined variable\nError at line 10: syntax error');

      expectErrorCount(result, 2);
      expect(result.errors[0].line).toBe(5);
      expect(result.errors[1].line).toBe(10);
    });

    it('should handle extractors that return no errors', async () => {
      const plugin = createNoErrorPlugin();

      const wrappedExtract = createSandboxedExtractor(plugin, { trust: 'sandbox' });
      const result = await wrappedExtract('clean output');

      expectNoErrors(result);
      expect(result.summary).toBe('No errors');
    });
  });

  describe('error handling', () => {
    it('should handle syntax errors in extractor code', async () => {
      const plugin = createSyntaxErrorPlugin();

      const wrappedExtract = createSandboxedExtractor(plugin, { trust: 'sandbox' });
      const result = await wrappedExtract('some output');

      expect(result).toBeDefined();
      expectSandboxFailure(result, 'Syntax error');
    });

    it('should handle extractors that throw errors', async () => {
      const plugin = createExtractorFailedPlugin();

      const wrappedExtract = createSandboxedExtractor(plugin, { trust: 'sandbox' });
      const result = await wrappedExtract('some output');

      expect(result).toBeDefined();
      expectSandboxFailure(result, 'Extractor failed');
    });

    it('should handle extractors that return invalid results', async () => {
      const plugin = createMockPlugin(() => ({ invalid: 'result' } as never));

      const wrappedExtract = createSandboxedExtractor(plugin, { trust: 'sandbox' });
      const result = await wrappedExtract('some output');

      // Sandbox should handle this and return error metadata
      expect(result).toBeDefined();
      expect(result.errors).toBeDefined();
    });
  });

  describe('performance options', () => {
    it('should respect custom memory limit', async () => {
      const plugin = createNoErrorPlugin();

      const wrappedExtract = createSandboxedExtractor(plugin, {
        trust: 'sandbox',
        memoryLimitMB: 64,
      });

      const result = await wrappedExtract('test');
      expect(result).toBeDefined();
    });

    it('should respect custom timeout', async () => {
      const plugin = createNoErrorPlugin();

      const wrappedExtract = createSandboxedExtractor(plugin, {
        trust: 'sandbox',
        timeoutMs: 10000,
      });

      const result = await wrappedExtract('test');
      expect(result).toBeDefined();
    });
  });
});

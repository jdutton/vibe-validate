/**
 * Tests for ExternalCheckExtractor
 *
 * Tests cover:
 * - Registry registration
 * - Extractor matching
 * - Codecov extraction
 * - SonarCloud extraction
 * - Graceful failure
 *
 * @packageDocumentation
 */

import { beforeEach, describe, expect, it } from 'vitest';

import type { ExternalCheck } from '../../src/schemas/watch-pr-result.schema.js';
import {
  CodecovExtractor,
  ExternalExtractorRegistry,
  SonarCloudExtractor,
} from '../../src/services/external-check-extractor.js';

describe('ExternalCheckExtractor', () => {
  describe('CodecovExtractor', () => {
    let extractor: CodecovExtractor;

    beforeEach(() => {
      extractor = new CodecovExtractor();
    });

    it('should match codecov checks', () => {
      const check: ExternalCheck = {
        name: 'codecov/patch',
        status: 'completed',
        conclusion: 'success',
        url: 'https://codecov.io/gh/test/test/pull/123',
      };

      expect(extractor.canHandle(check)).toBe(true);
    });

    it('should not match non-codecov checks', () => {
      const check: ExternalCheck = {
        name: 'SonarCloud',
        status: 'completed',
        conclusion: 'success',
        url: 'https://sonarcloud.io',
      };

      expect(extractor.canHandle(check)).toBe(false);
    });

    it('should extract codecov details', async () => {
      const check: ExternalCheck = {
        name: 'codecov/patch',
        status: 'completed',
        conclusion: 'success',
        url: 'https://codecov.io/gh/test/test/pull/123',
      };

      const result = await extractor.extract(check);

      expect(result).toBeDefined();
      expect(result?.summary).toContain('coverage');
    });
  });

  describe('SonarCloudExtractor', () => {
    let extractor: SonarCloudExtractor;

    beforeEach(() => {
      extractor = new SonarCloudExtractor();
    });

    it('should match SonarCloud checks', () => {
      const check: ExternalCheck = {
        name: 'SonarCloud Code Analysis',
        status: 'completed',
        conclusion: 'success',
        url: 'https://sonarcloud.io/project/issues?id=test',
      };

      expect(extractor.canHandle(check)).toBe(true);
    });

    it('should not match non-SonarCloud checks', () => {
      const check: ExternalCheck = {
        name: 'codecov/patch',
        status: 'completed',
        conclusion: 'success',
        url: 'https://codecov.io',
      };

      expect(extractor.canHandle(check)).toBe(false);
    });

    it('should extract SonarCloud details', async () => {
      const check: ExternalCheck = {
        name: 'SonarCloud Code Analysis',
        status: 'completed',
        conclusion: 'success',
        url: 'https://sonarcloud.io/project/issues?id=test',
      };

      const result = await extractor.extract(check);

      expect(result).toBeDefined();
      expect(result?.summary).toContain('quality');
    });
  });

  describe('ExternalExtractorRegistry', () => {
    let registry: ExternalExtractorRegistry;

    beforeEach(() => {
      registry = new ExternalExtractorRegistry();
      registry.register(new CodecovExtractor());
      registry.register(new SonarCloudExtractor());
    });

    it('should extract from all checks', async () => {
      const checks: ExternalCheck[] = [
        {
          name: 'codecov/patch',
          status: 'completed',
          conclusion: 'success',
          url: 'https://codecov.io/gh/test/test/pull/123',
        },
        {
          name: 'SonarCloud Code Analysis',
          status: 'completed',
          conclusion: 'failure',
          url: 'https://sonarcloud.io/project/issues?id=test',
        },
      ];

      const results = await registry.extractAll(checks);

      expect(results).toHaveLength(2);
      expect(results[0].extracted).toBeDefined();
      expect(results[1].extracted).toBeDefined();
    });

    it('should handle checks with no matching extractor', async () => {
      const checks: ExternalCheck[] = [
        {
          name: 'Unknown Check',
          status: 'completed',
          conclusion: 'success',
          url: 'https://example.com',
        },
      ];

      const results = await registry.extractAll(checks);

      expect(results).toHaveLength(1);
      expect(results[0].extracted).toBeNull();
    });

    it('should handle extractor errors gracefully', async () => {
      const failingExtractor = {
        name: 'failing',
        canHandle: () => true,
        extract: async () => {
          throw new Error('Extraction failed');
        },
      };

      registry.register(failingExtractor);

      const checks: ExternalCheck[] = [
        {
          name: 'Test',
          status: 'completed',
          conclusion: 'success',
          url: 'https://example.com',
        },
      ];

      const results = await registry.extractAll(checks);

      expect(results).toHaveLength(1);
      expect(results[0].extraction_error).toBeDefined();
    });
  });
});

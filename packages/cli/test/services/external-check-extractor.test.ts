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

/**
 * Helper: Create an external check object
 */
function createExternalCheck(
  name: string,
  url: string,
  overrides: Partial<ExternalCheck> = {}
): ExternalCheck {
  return {
    name,
    status: 'completed',
    conclusion: 'success',
    url,
    ...overrides,
  };
}

/**
 * Helper: Create a Codecov check
 */
function codecovCheck(overrides: Partial<ExternalCheck> = {}): ExternalCheck {
  return createExternalCheck(
    'codecov/patch',
    'https://codecov.io/gh/test/test/pull/123',
    overrides
  );
}

/**
 * Helper: Create a SonarCloud check
 */
function sonarCloudCheck(overrides: Partial<ExternalCheck> = {}): ExternalCheck {
  return createExternalCheck(
    'SonarCloud Code Analysis',
    'https://sonarcloud.io/project/issues?id=test',
    overrides
  );
}

describe('ExternalCheckExtractor', () => {
  describe('CodecovExtractor', () => {
    let extractor: CodecovExtractor;

    beforeEach(() => {
      extractor = new CodecovExtractor();
    });

    it('should match codecov checks', () => {
      expect(extractor.canHandle(codecovCheck())).toBe(true);
    });

    it('should not match non-codecov checks', () => {
      expect(extractor.canHandle(sonarCloudCheck())).toBe(false);
    });

    it('should extract codecov details', async () => {
      const result = await extractor.extract(codecovCheck());

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
      expect(extractor.canHandle(sonarCloudCheck())).toBe(true);
    });

    it('should not match non-SonarCloud checks', () => {
      expect(extractor.canHandle(codecovCheck())).toBe(false);
    });

    it('should extract SonarCloud details', async () => {
      const result = await extractor.extract(sonarCloudCheck());

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
      const checks = [
        codecovCheck(),
        sonarCloudCheck({ conclusion: 'failure' }),
      ];

      const results = await registry.extractAll(checks);

      expect(results).toHaveLength(2);
      expect(results[0].extracted).toBeDefined();
      expect(results[1].extracted).toBeDefined();
    });

    it('should handle checks with no matching extractor', async () => {
      const checks = [
        createExternalCheck('Unknown Check', 'https://example.com'),
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

      const checks = [createExternalCheck('Test', 'https://example.com')];

      const results = await registry.extractAll(checks);

      expect(results).toHaveLength(1);
      expect(results[0].extraction_error).toBeDefined();
    });
  });
});

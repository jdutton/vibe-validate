/**
 * Test fixture: Valid extractor plugin
 */

export default {
  metadata: {
    name: 'test-plugin',
    version: '1.0.0',
    description: 'A valid test plugin',
    author: 'Test Author',
  },
  priority: 50,
  detect: (output) => ({
    confidence: 80,
    patterns: ['test-pattern'],
    reason: 'Test detection logic',
  }),
  extract: (output) => ({
    totalErrors: 0,
    errors: [],
    guidance: 'Test guidance',
    metadata: {
      confidence: 100,
      completeness: 100,
      issues: [],
    },
  }),
  samples: [],
};

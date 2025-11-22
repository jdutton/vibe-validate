/**
 * Test fixture: Plugin with invalid metadata
 */

export default {
  metadata: {
    name: 'invalid',
    // Missing version and description
  },
  priority: 50,
  detect: () => ({ confidence: 0, patterns: [], reason: '' }),
  extract: () => ({ totalErrors: 0, errors: [], guidance: '', metadata: { confidence: 100, completeness: 100, issues: [] } }),
  samples: [],
};

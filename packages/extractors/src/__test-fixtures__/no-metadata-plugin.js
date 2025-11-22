/**
 * Test fixture: Plugin missing metadata
 */

export default {
  priority: 50,
  detect: () => ({ confidence: 0, patterns: [], reason: '' }),
  extract: () => ({ totalErrors: 0, errors: [], guidance: '', metadata: { confidence: 100, completeness: 100, issues: [] } }),
  samples: [],
};

/**
 * Test fixture: Plugin missing detect function
 */

export default {
  metadata: {
    name: 'no-detect',
    version: '1.0.0',
    description: 'Plugin without detect',
  },
  priority: 50,
  extract: () => ({ totalErrors: 0, errors: [], guidance: '', metadata: { confidence: 100, completeness: 100, issues: [] } }),
  samples: [],
};

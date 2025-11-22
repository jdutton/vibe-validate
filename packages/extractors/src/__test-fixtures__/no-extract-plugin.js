/**
 * Test fixture: Plugin missing extract function
 */

export default {
  metadata: {
    name: 'no-extract',
    version: '1.0.0',
    description: 'Plugin without extract',
  },
  priority: 50,
  detect: () => ({ confidence: 0, patterns: [], reason: '' }),
  samples: [],
};

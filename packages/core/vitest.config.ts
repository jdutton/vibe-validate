import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    exclude: [
      '**/*.integration.test.ts', // Integration tests may need special setup
      '**/*.system.test.ts', // System tests run separately with pnpm test:system
    ],
    globals: true,
    environment: 'node',
  },
});

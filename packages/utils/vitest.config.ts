import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    exclude: [
      '**/*.integration.test.ts',
      '**/*.system.test.ts',
    ],
    globals: true,
    environment: 'node',
  },
});

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['packages/*/test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['packages/*/src/**/*.ts'],
      exclude: ['packages/*/src/**/*.d.ts', 'packages/*/dist/**'],
      thresholds: {
        // Current: 65% statements, 87% branches, 73% functions, 65% lines
        // Goal: Reach 80% across all metrics
        statements: 65,
        branches: 80,
        functions: 73,
        lines: 65,
      },
    },
  },
});

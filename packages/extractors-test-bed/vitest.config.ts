import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/vitest/**/*.test.ts'],
    reporters: ['default'],
    outputFile: {
      junit: './junit-output/vitest-results.xml',
    },
  },
});

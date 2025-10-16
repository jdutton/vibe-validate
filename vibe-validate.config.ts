import { defineConfig } from './packages/config/src/index.js';

/**
 * Vibe-Validate Self-Hosting Configuration
 *
 * This configuration validates vibe-validate itself using vibe-validate.
 * We're eating our own dog food! 🐕
 */
export default defineConfig({
  validation: {
    phases: [
      // Phase 1: Fast Pre-Qualification (parallel)
      {
        name: 'Pre-Qualification',
        parallel: true,
        steps: [
          {
            name: 'TypeScript Type Check',
            command: 'pnpm -r typecheck',
            description: 'Type-check all packages in parallel',
          },
          {
            name: 'ESLint',
            command: 'pnpm -r lint',
            description: 'Lint all packages',
          },
        ],
      },

      // Phase 2: Unit Tests with Coverage
      {
        name: 'Testing',
        parallel: false,
        steps: [
          {
            name: 'Unit Tests',
            command: 'pnpm test:coverage',
            description: 'Run all unit tests with coverage reporting',
          },
        ],
      },

      // Phase 3: Build Verification
      {
        name: 'Build',
        parallel: false,
        steps: [
          {
            name: 'Clean Previous Build',
            command: 'pnpm -r exec rm -rf dist',
            description: 'Clean all dist/ directories',
          },
          {
            name: 'Build All Packages',
            command: 'pnpm -r build',
            description: 'Build all packages in dependency order',
          },
        ],
      },

    ],

    // Use git tree hash caching for maximum performance
    caching: {
      strategy: 'git-tree-hash',
      enabled: true,
    },

    // Fail fast on first error
    failFast: true,
  },

  // Git integration settings
  git: {
    mainBranch: 'main',
    autoSync: false, // Never auto-merge - safety first
  },

  // Output configuration
  output: {
    format: 'auto', // Auto-detect agent vs human context
  },
});

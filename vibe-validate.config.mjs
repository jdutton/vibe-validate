/**
 * Vibe-Validate Self-Hosting Configuration
 *
 * This configuration validates vibe-validate itself using vibe-validate.
 * We're eating our own dog food! 🐕
 *
 * This config file demonstrates the EXACT same workflow that end users
 * will follow - it uses the built packages, not the source code.
 */
export default {
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
            name: 'ESLint Code Quality',
            command: 'pnpm lint',
            description: 'Lint all source files (0 errors, 0 warnings enforced)',
          },
        ],
      },

      // Phase 2: Unit Tests with Coverage
      {
        name: 'Testing',
        parallel: false,
        steps: [
          {
            name: 'Unit Tests with Coverage',
            // Use verbose reporter in CI for better error visibility
            command: process.env.CI ? 'pnpm test:coverage --reporter=verbose' : 'pnpm test:coverage',
            description: 'Run all unit tests (301 tests) with coverage thresholds (75% min)',
          },
        ],
      },

      // Phase 3: Build Verification (ensures packages can build)
      {
        name: 'Build',
        parallel: false,
        steps: [
          {
            name: 'Build All Packages',
            command: 'pnpm -r build',
            description: 'Build all packages in dependency order (incremental, preserves existing builds)',
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

  // CI/CD configuration for GitHub Actions workflow generation
  ci: {
    // Matrix testing: Test across multiple OS and Node.js versions
    nodeVersions: ['20', '22', '24'],
    os: ['ubuntu-latest', 'macos-latest', 'windows-latest'],
    failFast: false, // Run all combinations even if one fails
  },
};

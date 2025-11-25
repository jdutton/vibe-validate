import eslint from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import sonarjs from 'eslint-plugin-sonarjs';
import unicorn from 'eslint-plugin-unicorn';
import security from 'eslint-plugin-security';
import pluginNode from 'eslint-plugin-n';

// Shared Unicorn rules for modern JavaScript standards (applies to both test and production code)
const unicornRules = {
  'unicorn/prefer-node-protocol': 'error', // Enforce node: prefix for built-ins (security + clarity)
  'unicorn/prefer-number-properties': 'error', // Prefer Number.isNaN over global isNaN (reliability)
  'unicorn/throw-new-error': 'error', // Require 'new' when throwing Error
  'unicorn/prefer-module': 'error', // Prefer ESM over CommonJS
  'unicorn/prefer-top-level-await': 'error', // Modern async patterns
  'unicorn/no-array-for-each': 'error', // Prefer for...of over forEach
  'unicorn/no-useless-undefined': 'error', // Simplify unnecessary undefined
  'unicorn/prefer-ternary': 'off', // Too aggressive - doesn't account for readability
  'unicorn/prefer-string-raw': 'error', // Use String.raw for strings with backslashes
};

export default [
  eslint.configs.recommended,
  sonarjs.configs.recommended,
  security.configs.recommended,
  {
    // Test files - disable type-aware linting (test files excluded from tsconfig)
    // This MUST come before general TS config (more specific patterns first in flat config)
    files: ['**/*.test.ts', '**/test/**/*.ts', '**/test-*.ts', '**/tests/**/*.ts', '**/scripts/**/*.ts', '**/vitest.config.ts'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        project: false, // Override inherited 'project: true' - test files excluded from tsconfig
      },
      globals: {
        NodeJS: 'readonly',
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
      unicorn,
      security,
      n: pluginNode,
    },
    rules: {
      // Disable type-aware rules for test files (require TypeScript project)
      '@typescript-eslint/no-floating-promises': 'off',
      '@typescript-eslint/await-thenable': 'off',
      '@typescript-eslint/no-misused-promises': 'off',
      '@typescript-eslint/prefer-nullish-coalescing': 'off',
      '@typescript-eslint/prefer-optional-chain': 'off',

      // Relaxed rules for test files (pragmatic testing standards)
      '@typescript-eslint/no-explicit-any': 'off', // Tests often use 'any' for mocking/fixtures
      '@typescript-eslint/explicit-module-boundary-types': 'off', // Test helpers don't need explicit return types
      '@typescript-eslint/no-non-null-assertion': 'off', // Tests often assert known state
      'no-undef': 'off', // Node.js globals (__dirname, setTimeout, etc.) used in tests

      // Security - relaxed for tests
      'security/detect-child-process': 'off', // Tests execute commands
      'security/detect-non-literal-fs-filename': 'off', // Tests use temp paths
      'security/detect-object-injection': 'off', // TypeScript type safety covers this

      // SonarJS rules - relaxed for tests but still visible
      'sonarjs/no-ignored-exceptions': 'error', // Enforce exception handling (use // NOSONAR with explanation if intentional)
      'sonarjs/os-command': 'off', // Tests execute commands for validation
      'sonarjs/no-os-command-from-path': 'off', // Test fixtures use PATH commands
      'sonarjs/no-nested-functions': 'off', // Common in describe/it blocks
      'sonarjs/no-nested-template-literals': 'off', // Test fixtures often have nested templates
      'sonarjs/slow-regex': 'off', // No DoS risk in test code
      'sonarjs/cognitive-complexity': ['warn', 20], // Higher threshold for tests (20 vs 15)

      // Keep strict on real code quality issues
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      }],
      'no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      }],

      // Unicorn rules - apply same modern JavaScript standards to test code
      ...unicornRules,
    },
  },
  {
    // General TypeScript files (production code with type-aware linting)
    // Exclude test files - they have their own config above
    files: ['**/*.ts', '**/*.tsx'],
    ignores: ['**/*.test.ts', '**/test/**/*.ts'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        project: true, // Auto-discover tsconfig.json for each package in monorepo
      },
      globals: {
        // Node.js globals
        NodeJS: 'readonly',
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
      unicorn,
      security,
      n: pluginNode,
    },
    rules: {
      // TypeScript-specific rules
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      }],
      '@typescript-eslint/no-explicit-any': 'error', // Promoted from warn - prevent 'any' types
      '@typescript-eslint/explicit-module-boundary-types': 'error', // Require explicit return types on exported functions
      '@typescript-eslint/no-non-null-assertion': 'error', // Promoted from warn - prevent unsafe ! assertions

      // TypeScript async/promise safety rules
      '@typescript-eslint/no-floating-promises': 'error', // Catch unhandled promises
      '@typescript-eslint/await-thenable': 'error', // Prevent awaiting non-promises
      '@typescript-eslint/no-misused-promises': 'error', // Catch promise misuse in conditionals

      // Modern JavaScript patterns (promoted to errors - already compliant)
      '@typescript-eslint/prefer-nullish-coalescing': 'error', // Promoted from warn - enforce ?? usage
      '@typescript-eslint/prefer-optional-chain': 'error', // Promote from warn - enforce ?. usage

      // General rules
      'no-console': 'off', // CLI tool needs console output
      'no-undef': 'off', // TypeScript handles this
      'no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      }],

      // Security - vulnerability detection (CRITICAL)
      'security/detect-child-process': 'error', // Catch command injection vulnerabilities
      'security/detect-non-literal-fs-filename': 'warn', // Catch path traversal risks
      'security/detect-non-literal-regexp': 'warn',
      'security/detect-unsafe-regex': 'error',
      'security/detect-buffer-noassert': 'error',
      'security/detect-eval-with-expression': 'error',
      'security/detect-no-csrf-before-method-override': 'error',
      'security/detect-possible-timing-attacks': 'warn',
      'security/detect-pseudoRandomBytes': 'error',
      'security/detect-object-injection': 'off', // False positive for TypeScript

      // Node.js best practices
      'n/no-path-concat': 'error', // Catch path traversal via string concatenation

      // SonarJS rules - active enforcement
      'sonarjs/no-ignored-exceptions': 'error', // Fixed: all exceptions now handled
      'sonarjs/no-control-regex': 'error', // 1 intentional use documented with eslint-disable (ANSI escape codes)
      'sonarjs/no-redundant-jump': 'error', // Fixed: removed 2 redundant continue statements
      'sonarjs/updated-loop-counter': 'error', // Fixed: converted for-loop to while-loop with explicit index control
      'sonarjs/no-nested-template-literals': 'error', // Fixed: extracted nested conditionals to variables
      'sonarjs/no-nested-functions': 'error', // Fixed: extracted inline callbacks to named functions
      'sonarjs/no-nested-conditional': 'error', // Fixed: converted nested ternaries to if-else statements

      // SonarJS rules - cognitive complexity (aligned with SonarQube threshold of 15)
      'sonarjs/cognitive-complexity': ['error', 15], // Aligned with SonarQube (was 25)
      'sonarjs/slow-regex': 'warn', // Check regex patterns for potential ReDoS vulnerabilities

      // SonarJS rules - promoted to errors (clean codebase, prevent regressions)
      'sonarjs/duplicates-in-character-class': 'error', // Promoted from warn
      'sonarjs/prefer-single-boolean-return': 'error', // Promoted from warn
      'sonarjs/no-unused-vars': 'warn', // Keep as warn (duplicate of @typescript-eslint/no-unused-vars)

      // Unicorn rules - modern JavaScript best practices
      ...unicornRules,
    },
  },
  {
    // Git-aware packages - OS command execution is intentional and necessary
    files: [
      'packages/cli/src/**/*.ts',
      'packages/git/src/**/*.ts',
      'packages/core/src/**/*.ts',
      'packages/history/src/**/*.ts',
    ],
    rules: {
      'sonarjs/os-command': 'off', // Git operations require system command execution
      'sonarjs/no-os-command-from-path': 'off', // Git commands require PATH access
      'security/detect-child-process': 'off', // Git package uses secure spawnSync patterns (validated in GH-57)
      'security/detect-non-literal-fs-filename': 'off', // Git notes use computed paths (validated for traversal)
    },
  },
  {
    // Extractor plugins - parse controlled test framework output (not user input)
    files: ['packages/extractors/src/extractors/**/*.ts'],
    rules: {
      'security/detect-unsafe-regex': 'off', // Extractors parse controlled test output (already protected by sonarjs/slow-regex)
    },
  },
  {
    // Config loader - reads config files from filesystem
    files: ['packages/config/src/loader.ts'],
    rules: {
      'security/detect-non-literal-fs-filename': 'off', // Config paths validated before reaching loader
    },
  },
  {
    ignores: [
      'dist/',
      'build/',
      'coverage/',
      'node_modules/',
      '**/*.js', // Ignore compiled JS files
      '**/*.d.ts',
      // Files not in tsconfig.json
      'vitest.config.ts',
      'vitest.config.system.ts',
      'packages/extractors-test-bed/scripts/**',
      'packages/extractors-test-bed/vitest.config.ts',
      'packages/extractors/vitest.config.ts',
      'packages/extractors/test-generic-baseline.ts',
    ],
  },
];

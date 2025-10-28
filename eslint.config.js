import eslint from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import sonarjs from 'eslint-plugin-sonarjs';

export default [
  eslint.configs.recommended,
  sonarjs.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
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
      '@typescript-eslint/prefer-optional-chain': 'error', // Promoted from warn - enforce ?. usage

      // General rules
      'no-console': 'off', // CLI tool needs console output
      'no-undef': 'off', // TypeScript handles this
      'no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      }],

      // SonarJS rules - active enforcement
      'sonarjs/no-ignored-exceptions': 'error', // Fixed: all exceptions now handled
      'sonarjs/no-control-regex': 'error', // 1 intentional use documented with eslint-disable (ANSI escape codes)
      'sonarjs/no-redundant-jump': 'error', // Fixed: removed 2 redundant continue statements
      'sonarjs/updated-loop-counter': 'error', // Fixed: converted for-loop to while-loop with explicit index control
      'sonarjs/no-nested-template-literals': 'error', // Fixed: extracted nested conditionals to variables
      'sonarjs/no-nested-functions': 'error', // Fixed: extracted inline callbacks to named functions
      'sonarjs/no-nested-conditional': 'error', // Fixed: converted nested ternaries to if-else statements

      // SonarJS rules - intentionally disabled (documented technical debt)
      // These represent known architectural issues that require significant refactoring.
      // They are disabled to prevent noise, but documented for future improvement.
      // New code should avoid these patterns where practical.
      'sonarjs/cognitive-complexity': ['warn', 25], // Warn on functions with complexity > 25 (gradually reducing technical debt)
      'sonarjs/slow-regex': 'warn', // Check regex patterns for potential ReDoS vulnerabilities

      // SonarJS rules - promoted to errors (clean codebase, prevent regressions)
      'sonarjs/duplicates-in-character-class': 'error', // Promoted from warn
      'sonarjs/prefer-single-boolean-return': 'error', // Promoted from warn
      'sonarjs/no-unused-vars': 'warn', // Keep as warn (duplicate of @typescript-eslint/no-unused-vars)
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
    ],
  },
];

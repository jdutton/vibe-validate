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
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-non-null-assertion': 'warn',

      // General rules
      'no-console': 'off', // CLI tool needs console output
      'no-undef': 'off', // TypeScript handles this
      'no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      }],

      // SonarJS rules - downgrade to warnings during migration
      // Will be progressively fixed and upgraded to errors
      'sonarjs/cognitive-complexity': 'warn',
      'sonarjs/no-ignored-exceptions': 'warn',
      'sonarjs/no-nested-conditional': 'warn',
      'sonarjs/no-nested-template-literals': 'warn',
      'sonarjs/no-nested-functions': 'warn',
      'sonarjs/slow-regex': 'warn', // TODO: Fix regex patterns and upgrade to error
      'sonarjs/no-redundant-jump': 'warn',
      'sonarjs/no-control-regex': 'warn',
      'sonarjs/duplicates-in-character-class': 'warn',
      'sonarjs/updated-loop-counter': 'warn',
      'sonarjs/prefer-single-boolean-return': 'warn',
      'sonarjs/no-unused-vars': 'warn',
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

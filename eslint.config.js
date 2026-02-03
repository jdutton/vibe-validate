import eslint from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import sonarjs from 'eslint-plugin-sonarjs';
import unicorn from 'eslint-plugin-unicorn';
import security from 'eslint-plugin-security';
import pluginNode from 'eslint-plugin-n';
import importPlugin from 'eslint-plugin-import';
import localRules from './packages/dev-tools/eslint-local-rules/index.js';

/**
 * ESLint configuration for vibe-validate
 *
 * Strict rules for source code with pragmatic test file overrides.
 * Test files allow common patterns (any types, ! assertions, dynamic paths)
 * while maintaining quality standards.
 *
 * Includes custom local rules for agentic code safety (see packages/dev-tools/eslint-local-rules/)
 */

export default [
  // Global ignores
  {
    ignores: [
      'dist/',
      'build/',
      'coverage/',
      'node_modules/',
      '**/*.d.ts',
      'vitest.config.ts',
      'vitest.*.config.ts',
      '.worktrees/',  // Git worktrees
    ],
  },

  // Base recommended configs
  eslint.configs.recommended,
  sonarjs.configs.recommended,
  security.configs.recommended,

  // Main configuration - applies to ALL TypeScript files
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 2024,
        sourceType: 'module',
        project: './tsconfig.eslint.json',
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
      import: importPlugin,
      local: localRules,
    },
    rules: {
      // Local rules - agentic code safety
      'local/no-child-process-execSync': 'error',
      'local/no-os-tmpdir': 'error',
      'local/no-fs-mkdirSync': 'error',
      'local/no-fs-realpathSync': 'error',
      'local/no-path-resolve-dirname': 'error',
      'local/no-unix-shell-commands': 'error',
      'local/no-manual-path-normalize': 'error',
      'local/no-path-sep-in-strings': 'error',
      'local/no-path-operations-in-comparisons': 'error',
      'local/no-path-startswith': 'error',
      'local/no-hardcoded-path-split': 'error',
      'local/no-git-commands-direct': 'error',
      'local/no-gh-commands-direct': 'error',
      'local/no-npm-pnpm-direct': 'error',
      'local/no-direct-cli-bin-execution': 'error',

      // TypeScript
      'no-unused-vars': 'off', // Use @typescript-eslint/no-unused-vars instead
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      }],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/explicit-module-boundary-types': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/prefer-nullish-coalescing': 'error',
      '@typescript-eslint/prefer-optional-chain': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', {
        prefer: 'type-imports',
        fixStyle: 'inline-type-imports',
      }],
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/prefer-readonly': 'error',
      '@typescript-eslint/no-redundant-type-constituents': 'error',
      '@typescript-eslint/prefer-function-type': 'error',
      '@typescript-eslint/no-require-imports': 'error',
      '@typescript-eslint/prefer-string-starts-ends-with': 'error',
      '@typescript-eslint/no-unnecessary-type-assertion': 'error',

      // Stricter type safety - catch SonarQube-style issues early
      '@typescript-eslint/no-base-to-string': 'error', // Prevent [object Object] in strings
      '@typescript-eslint/restrict-template-expressions': ['error', {
        allowNumber: true,
        allowBoolean: true,
        allowAny: false,
        allowNullish: false, // Strict: prevents "undefined"/"null" appearing in strings
      }],
      // Note: no-unsafe-member-access and no-unsafe-assignment are too noisy (hundreds of warnings)
      // They're valuable for new code but too much to fix in existing codebase

      // General
      'no-console': 'off',
      'no-undef': 'off',
      'prefer-const': 'error',
      'no-var': 'error',
      'no-lonely-if': 'error',
      'max-depth': ['error', 4],
      'max-params': ['error', 7],
      'max-nested-callbacks': ['error', 4],
      'no-negated-condition': 'error',
      'no-inner-declarations': ['error', 'functions'],

      // Security
      'security/detect-object-injection': 'off',
      // CLI tools legitimately use dynamic paths from config/env/project structure
      // Path safety is enforced through the @vibe-validate/utils package and validation
      'security/detect-non-literal-fs-filename': 'off',
      'security/detect-non-literal-regexp': 'warn',
      'security/detect-unsafe-regex': 'error',
      'security/detect-buffer-noassert': 'error',
      'security/detect-eval-with-expression': 'error',
      'security/detect-no-csrf-before-method-override': 'error',
      'security/detect-possible-timing-attacks': 'warn',
      'security/detect-pseudoRandomBytes': 'error',

      // SonarJS
      'sonarjs/cognitive-complexity': ['error', 15],
      'sonarjs/no-duplicate-string': 'warn',
      'sonarjs/no-ignored-exceptions': 'error',
      'sonarjs/no-control-regex': 'error',
      'sonarjs/no-redundant-jump': 'error',
      'sonarjs/updated-loop-counter': 'error',
      'sonarjs/no-nested-template-literals': 'error',
      'sonarjs/no-nested-functions': 'error',
      'sonarjs/no-nested-conditional': 'error',
      'sonarjs/duplicates-in-character-class': 'error',
      'sonarjs/prefer-single-boolean-return': 'error',
      'sonarjs/no-inverted-boolean-check': 'error',
      'sonarjs/prefer-immediate-return': 'error',
      'sonarjs/no-collapsible-if': 'error',
      'sonarjs/no-collection-size-mischeck': 'error',
      'sonarjs/slow-regex': 'warn',

      // Node.js
      'n/no-path-concat': 'error',

      // Import organization
      'import/no-duplicates': 'error',
      'import/order': ['error', {
        groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
        'newlines-between': 'always',
        alphabetize: { order: 'asc', caseInsensitive: true },
      }],
      'import/first': 'error',
      'import/newline-after-import': 'error',

      // Unicorn - modern JavaScript
      'unicorn/prefer-node-protocol': 'error',
      'unicorn/prefer-module': 'error',
      'unicorn/throw-new-error': 'error',
      'unicorn/no-array-for-each': 'error',
      'unicorn/prefer-string-replace-all': 'error',
      'unicorn/prefer-array-find': 'error',
      'unicorn/prefer-array-some': 'error',
      'unicorn/prefer-at': 'error',
      'unicorn/prefer-includes': 'error',
      'unicorn/no-for-loop': 'error',
      'unicorn/prefer-spread': 'error',
      'unicorn/no-instanceof-array': 'error',
      'unicorn/prefer-date-now': 'error',
      'unicorn/prefer-ternary': 'off',
      'unicorn/prefer-string-raw': 'error',
      'unicorn/prefer-number-properties': 'error',
      'unicorn/no-negated-condition': 'error',
      'unicorn/prefer-export-from': 'error',
      'unicorn/prefer-structured-clone': 'error',
      'unicorn/no-zero-fractions': 'error',
      'unicorn/prefer-top-level-await': 'error',
      'unicorn/no-useless-spread': 'error',
      'unicorn/no-array-push-push': 'error',
      'unicorn/no-useless-undefined': 'error',
      'unicorn/prefer-code-point': 'error',
      'unicorn/prefer-set-has': 'error',
    },
  },

  // Test file overrides - pragmatic approach for test code
  {
    files: ['**/*.test.ts', '**/test/**/*.ts', '**/tests/**/*.ts'],
    rules: {
      // Test mocks often need 'any' for third-party library types
      '@typescript-eslint/no-explicit-any': 'off',

      // Test assertions often use ! when we know the value exists
      '@typescript-eslint/no-non-null-assertion': 'off',

      // Test files legitimately repeat string literals across test cases
      'sonarjs/no-duplicate-string': 'off',

      // Tests need to execute commands for validation/integration testing
      'sonarjs/os-command': 'off',
      'sonarjs/no-os-command-from-path': 'off',

      // Test helper functions may use deprecated APIs being tested
      'sonarjs/deprecation': 'warn',

      // Complexity limits can be higher in test files with many test cases
      'sonarjs/cognitive-complexity': ['warn', 20],
      'max-nested-callbacks': ['warn', 5],
    },
  },
];

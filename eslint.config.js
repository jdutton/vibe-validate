import eslint from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import sonarjs from 'eslint-plugin-sonarjs';
import unicorn from 'eslint-plugin-unicorn';
import security from 'eslint-plugin-security';
import pluginNode from 'eslint-plugin-n';
import importPlugin from 'eslint-plugin-import';
import localRules from './tools/eslint-local-rules/index.js';

/**
 * SHARED RULES PHILOSOPHY
 *
 * Why rules are defined at the top:
 * - Define once, apply everywhere (DRY principle)
 * - Consistent standards across all contexts (test, production, tools)
 * - Override only where legitimately needed (explicit exceptions)
 *
 * This approach makes security boundaries and exceptions visible and auditable.
 */

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
  'unicorn/prefer-string-replace-all': 'error', // Prefer replaceAll() over replace() with regex (ES2021)
  'unicorn/prefer-code-point': 'error', // Prefer codePointAt() over charCodeAt() for Unicode

  // Bug prevention rules (common patterns)
  'unicorn/prefer-array-find': 'error', // Prevent .filter()[0] → use .find()
  'unicorn/prefer-array-some': 'error', // Prevent .find() for boolean checks → use .some()
  'unicorn/prefer-includes': 'error', // Prevent indexOf() !== -1 → use .includes()
  'unicorn/no-for-loop': 'error', // Prevent traditional for loops → use for...of
  'unicorn/prefer-spread': 'error', // Prevent Array.from([...]) → use spread
  'unicorn/prefer-set-has': 'error', // Optimize Set lookups over Array.includes()
  'unicorn/no-instanceof-array': 'error', // Enforce Array.isArray() over instanceof
  'unicorn/prefer-date-now': 'error', // Prefer Date.now() over new Date().getTime()
};

// Shared import organization rules (applies to both test and production code)
const importRules = {
  'import/no-duplicates': 'error',
  'import/order': ['error', {
    groups: ['builtin', 'external', 'internal', 'parent', 'sibling', 'index'],
    'newlines-between': 'always',
    alphabetize: { order: 'asc', caseInsensitive: true },
  }],
  'import/first': 'error',
  'import/newline-after-import': 'error',
};

// Shared plugin configuration (applies to both test and production code)
const sharedPlugins = {
  '@typescript-eslint': tseslint,
  unicorn,
  security,
  n: pluginNode,
  import: importPlugin,
  'local': localRules,
};

// Shared custom rules (Windows compatibility, security, and architecture)
const customRules = {
  // Windows compatibility rules (prevent 8.3 short path issues)
  'local/no-os-tmpdir': 'error',
  'local/no-fs-mkdirSync': 'error',
  'local/no-fs-realpathSync': 'error',
  'local/no-path-resolve-dirname': 'error', // Test files only

  // Security and architecture rules
  'local/no-child-process-execSync': 'error',
  'local/no-git-commands-direct': 'error',
  'local/no-gh-commands-direct': 'error',
  'local/no-direct-cli-bin-execution': 'error', // Test files only - enforce shared CLI helpers
};

export default [
  {
    // Global ignores - must be first in array
    ignores: [
      '**/vitest.config.ts', // Vitest configs don't need linting
      '**/vitest.config.js',
      '**/vitest.integration.config.ts', // Vitest integration test configs
    ],
  },
  eslint.configs.recommended,
  sonarjs.configs.recommended,
  security.configs.recommended,
  {
    /**
     * TEST FILES CONFIGURATION
     *
     * Why project: false (no type-aware linting):
     * - Test files are excluded from tsconfig.json (via exclude patterns)
     * - Reason for exclusion: Build performance + published packages shouldn't include test types
     * - Trade-off: Faster builds vs type-aware linting in tests
     *
     * What this means:
     * - Type-aware rules like no-floating-promises can't work (need type info)
     * - We catch fewer bugs in test code (unhandled promises, await mistakes)
     * - But linting is ~30-50% faster (no type-checking for tests)
     *
     * Why rules are relaxed:
     * - Tests use 'any' for mocking/fixtures (explicit-any off)
     * - Tests execute commands for validation (security rules relaxed)
     * - Tests have nested describe/it blocks (cognitive-complexity higher threshold)
     * - Pragmatic testing standards vs strict production code standards
     *
     * Alternative considered:
     * - Create tsconfig.test.json for type-aware linting in tests
     * - Rejected: Would slow down linting significantly without clear benefit
     */
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
    plugins: sharedPlugins,
    rules: {
      ...customRules,

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

      // Enforce function declarations at module scope (prevent SonarQube code smells)
      'no-inner-declarations': ['error', 'functions'], // Functions must be at module/outer function scope

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

      // Import rules - organization and quality
      ...importRules,

      // Unicorn rules - apply same modern JavaScript standards to test code
      ...unicornRules,
    },
  },
  {
    /**
     * PRODUCTION TYPESCRIPT CONFIGURATION
     *
     * Why project: true (full type-aware linting):
     * - Production code is in tsconfig.json (src/** files)
     * - TypeScript can provide type information for advanced linting
     * - Catches bugs that simple AST analysis can't find
     *
     * What type-aware linting catches:
     * - Unhandled promises (@typescript-eslint/no-floating-promises)
     * - Awaiting non-promises (@typescript-eslint/await-thenable)
     * - Promise misuse in conditionals (@typescript-eslint/no-misused-promises)
     * - Unnecessary null checks when TypeScript knows value isn't null
     *
     * Why rules are strict:
     * - Production code ships to users (quality matters)
     * - Security vulnerabilities have real impact (detect-child-process enforced)
     * - Maintainability over years (explicit-module-boundary-types required)
     * - Bundle size optimization (consistent-type-imports for tree-shaking)
     *
     * Trade-off:
     * - Slower linting (type-checking required)
     * - More false positives to suppress
     * - But catches real bugs before production
     */
    // General TypeScript files (production code with type-aware linting)
    // Exclude test files and tools - they have their own configs
    files: ['**/*.ts', '**/*.tsx'],
    ignores: ['**/*.test.ts', '**/test/**/*.ts', 'tools/**/*.ts'],
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
    plugins: sharedPlugins,
    rules: {
      ...customRules,

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

      // TypeScript type safety & optimization rules
      '@typescript-eslint/consistent-type-imports': ['error', {
        prefer: 'type-imports',
        fixStyle: 'inline-type-imports',
      }], // Bundle size optimization + clarity
      '@typescript-eslint/switch-exhaustiveness-check': 'error', // Catch missing switch cases
      '@typescript-eslint/no-unnecessary-condition': 'off', // Disabled: Too aggressive, catches defensive programming patterns (while(true), ??, ?.)
      '@typescript-eslint/prefer-string-starts-ends-with': 'error', // Prefer startsWith/endsWith
      '@typescript-eslint/prefer-readonly': 'warn', // Suggest immutability improvements

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
      'sonarjs/no-inverted-boolean-check': 'error', // Simplify !(!condition)
      'sonarjs/prefer-immediate-return': 'error', // Remove unnecessary temp variables
      'sonarjs/no-collapsible-if': 'error', // Merge nested if statements
      'sonarjs/no-collection-size-mischeck': 'error', // Catch .length > 0 vs .length >= 1 bugs

      // ESLint core rules - code quality
      'no-negated-condition': 'error', // Avoid negated conditions with else clauses
      // Enforce function declarations at module scope (prevent SonarQube code smells)
      'no-inner-declarations': ['error', 'functions'], // Functions must be at module/outer function scope

      // Import rules - organization and quality
      ...importRules,

      // Unicorn rules - modern JavaScript best practices
      ...unicornRules,
    },
  },
  {
    /**
     * GIT-AWARE PACKAGES - SECURITY EXCEPTION
     *
     * ⚠️  CRITICAL: This is an explicit security boundary exception
     *
     * Why these packages need command execution:
     * - @vibe-validate/git: Centralized git command execution (@vibe-validate/git functions)
     * - @vibe-validate/cli: Invokes git commands via @vibe-validate/git
     * - @vibe-validate/core: Orchestrates validation (uses git for tree hashing)
     * - @vibe-validate/history: Git notes storage (uses @vibe-validate/git)
     *
     * Security model:
     * - Command execution is REQUIRED for git operations (no alternative)
     * - Commands use secure patterns: safeExecSync (no shell, args array)
     * - Commands validated in GH-57 security review
     * - These packages are the ONLY ones allowed to execute commands
     *
     * Why each rule is disabled:
     * - security/detect-child-process: Git operations require spawnSync/execSync
     * - sonarjs/os-command: Git commands are system commands
     * - sonarjs/no-os-command-from-path: git/gh commands resolved via PATH
     * - local/no-git-commands-direct: These packages ARE the centralization point
     * - local/no-gh-commands-direct: These packages ARE the centralization point
     *
     * What's enforced everywhere else:
     * - @vibe-validate/extractors: CANNOT execute commands (parses test output only)
     * - @vibe-validate/config: CANNOT execute commands (reads config files only)
     * - Test files: Command execution validated as test infrastructure
     *
     * Architecture principle:
     * - Security by default (strict everywhere)
     * - Explicit exceptions (only where REQUIRED)
     * - Centralized command execution (@vibe-validate/git)
     */
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
      'local/no-git-commands-direct': 'off', // Git package is where git commands are centralized
      'local/no-gh-commands-direct': 'off', // Git package is where gh commands are centralized
    },
  },
  {
    /**
     * EXTRACTOR PLUGINS - REGEX SECURITY EXCEPTION
     *
     * Why unsafe regex rules are relaxed:
     * - Extractors parse controlled test framework output (vitest, jest, playwright, etc.)
     * - Input is NOT user-controlled (no ReDoS attack vector)
     * - Test frameworks have deterministic output formats
     *
     * What extractors do:
     * - Parse test output to extract errors, file paths, line numbers
     * - Use regex to match known patterns (e.g., "Error: ... at file:line:col")
     * - Transform verbose test output into concise, LLM-friendly YAML
     *
     * Why security/detect-unsafe-regex is off:
     * - Rule catches potential ReDoS (Regular expression Denial of Service)
     * - ReDoS requires attacker-controlled input (we don't have that)
     * - Test output is generated by known, trusted test frameworks
     * - Still protected by sonarjs/slow-regex (warns on catastrophic backtracking)
     *
     * Security boundary:
     * - Extractors CANNOT execute commands (enforced by parent config)
     * - Extractors only READ test output (no file system access)
     * - No user input ever reaches extractors (validated by test runner)
     */
    // Extractor plugins - parse controlled test framework output (not user input)
    files: ['packages/extractors/src/extractors/**/*.ts'],
    rules: {
      'security/detect-unsafe-regex': 'off', // Extractors parse controlled test output (already protected by sonarjs/slow-regex)
    },
  },
  {
    /**
     * CONFIG LOADER - FILE PATH SECURITY EXCEPTION
     *
     * Why security/detect-non-literal-fs-filename is relaxed:
     * - Config loader needs to read config files from computed paths
     * - Paths are validated BEFORE reaching the loader (no path traversal risk)
     * - User provides config file location via CLI flag or default search
     *
     * What config loader does:
     * - Searches for vibe-validate.config.yaml in project directory tree
     * - Reads config file from validated path
     * - Parses YAML and validates against schema
     *
     * Security model:
     * - CLI validates --config flag path (no ../ traversal)
     * - Default search is limited to project directory tree (upward only)
     * - Loader receives pre-validated paths (not user input directly)
     * - YAML parsing uses safe-load (no code execution)
     *
     * Why this is safe:
     * - Path validation happens at CLI layer (entry point)
     * - Loader is internal API (not exposed to external callers)
     * - No arbitrary file read (only config files in project tree)
     */
    // Config loader - reads config files from filesystem
    files: ['packages/config/src/loader.ts'],
    rules: {
      'security/detect-non-literal-fs-filename': 'off', // Config paths validated before reaching loader
    },
  },
  {
    /**
     * TOOLS SCRIPTS - DEVELOPMENT TOOLING
     *
     * Why tools need flexibility:
     * - Build scripts, dev utilities, pre-publish checks
     * - Execute system commands (npm, git, file operations)
     * - Process dynamic paths (generate docs, check duplication)
     * - Development environment only (never shipped to users)
     *
     * Why rules are still strict:
     * - Tools are part of the codebase (maintainability matters)
     * - Build failures impact all developers (reliability important)
     * - Security still matters (supply chain attacks target build tools)
     *
     * What's relaxed vs production:
     * - security/detect-child-process: Tools spawn npm, git, etc.
     * - security/detect-non-literal-fs-filename: Tools process dynamic paths
     * - sonarjs/cognitive-complexity: 20 vs 15 (tools have complex logic)
     *
     * What's enforced same as production:
     * - Windows compatibility rules (no-os-tmpdir, no-fs-mkdirSync)
     * - Architecture rules (no-git-commands-direct, no-gh-commands-direct)
     * - Code quality rules (unicorn, import organization)
     *
     * Why project: false:
     * - Tools not in tsconfig.json project references (separate from packages)
     * - Don't need type-aware linting (simple scripts)
     * - Faster linting for frequently-edited tools
     */
    // Tools scripts - strict linting (match production standards)
    files: ['tools/**/*.ts'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
        project: false, // Tools are not included in tsconfig.json project references
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
      import: importPlugin,
      security,
      n: pluginNode,
      'local': localRules,
    },
    rules: {
      // Windows compatibility rules (prevent 8.3 short path issues)
      'local/no-os-tmpdir': 'error',
      'local/no-fs-mkdirSync': 'error',
      'local/no-fs-realpathSync': 'error',

      // Security and architecture rules
      'local/no-child-process-execSync': 'error',
      'local/no-git-commands-direct': 'error',
      'local/no-gh-commands-direct': 'error',

      // TypeScript rules
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

      // General rules
      'no-console': 'off', // Tools use console for output
      'prefer-const': 'error',
      'no-var': 'error',

      // Security - only relax what's legitimately needed
      'security/detect-child-process': 'off', // Tools spawn processes
      'security/detect-non-literal-fs-filename': 'off', // Tools use dynamic paths
      'security/detect-object-injection': 'off', // TypeScript provides safety
      'security/detect-unsafe-regex': 'off', // Tools process known input
      'security/detect-non-literal-regexp': 'warn',

      // SonarJS rules - strict enforcement
      'sonarjs/no-ignored-exceptions': 'error', // Enforce exception handling
      'sonarjs/cognitive-complexity': ['error', 20], // Slightly higher than production (15) but still strict
      'sonarjs/no-duplicate-string': 'warn',
      'sonarjs/no-identical-functions': 'warn',
      'sonarjs/no-nested-conditional': 'error', // Prevent nested ternaries
      'sonarjs/no-inverted-boolean-check': 'error', // Simplify !(!condition)
      'sonarjs/prefer-immediate-return': 'error',
      'sonarjs/no-collapsible-if': 'error',
      'sonarjs/no-os-command-from-path': 'off', // Tools spawn processes
      'sonarjs/os-command': 'off', // Tools execute system commands

      // ESLint core rules - code quality
      'no-negated-condition': 'error', // Avoid negated conditions with else clauses

      // Import rules - organization and quality
      ...importRules,

      // Unicorn rules - modern JavaScript best practices
      ...unicornRules,

      // Node.js rules
      'n/no-path-concat': 'error',
    },
  },
  {
    ignores: [
      'dist/',
      'build/',
      'coverage/',
      'node_modules/',
      '**/dist/**/*.js', // Ignore compiled output (more specific)
      '*.config.js', // Ignore root config files (eslint, vitest, etc)
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

/**
 * Doctor Command Test Helpers
 *
 * Comprehensive test utilities for doctor command tests.
 * Reduces 500+ lines of duplication across 47 test cases.
 *
 * @package @vibe-validate/cli
 */

import { vi, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import type { VibeValidateConfig } from '@vibe-validate/config';
import type { DoctorCheckResult } from '../../src/commands/doctor.js';

/** @deprecated State file deprecated in v0.12.0 - validation now uses git notes */
const DEPRECATED_STATE_FILE = '.vibe-validate-state.yaml';

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Environment mock configuration for doctor tests
 */
export interface DoctorEnvironmentConfig {
  /** Node.js version string (default: 'v22.0.0') */
  nodeVersion?: string;
  /** Git version string (default: 'git version 2.43.0') */
  gitVersion?: string;
  /** vibe-validate npm version (default: '0.9.11') */
  vibeVersion?: string;
  /** pnpm version string (default: '9.0.0') */
  pnpmVersion?: string;
  /** Include git commands (default: true) */
  includeGitCommands?: boolean;
  /** Include git remote commands (default: true) */
  includeRemote?: boolean;
}

/**
 * File system mock configuration for doctor tests
 */
export interface DoctorFileSystemConfig {
  /** Package.json version (default: '0.9.11') */
  packageVersion?: string;
  /** .gitignore content (default: 'node_modules\\ndist\\n') */
  gitignoreContent?: string;
  /** Pre-commit hook script content (default: 'npx vibe-validate pre-commit') */
  preCommitContent?: string;
  /** Whether config file exists (default: true) */
  configExists?: boolean;
  /** Whether deprecated state file exists (default: false) */
  deprecatedStateFileExists?: boolean;
  /** Custom file mocks - map of filename patterns to content */
  customFiles?: Record<string, string>;
}

/**
 * Git mock configuration for doctor tests
 */
export interface DoctorGitMockConfig {
  /** Whether repository has git initialized (default: true) */
  isRepository?: boolean;
  /** Whether remote is configured (default: true) */
  hasRemote?: boolean;
  /** Whether main branch exists (default: true) */
  mainBranchExists?: boolean;
  /** Legacy validation history refs (for migration tests) */
  validationHistoryRefs?: string[];
  /** Current run cache refs */
  runCacheRefs?: string[];
  /** Custom git command responses - override specific commands */
  customCommands?: Record<string, { success: boolean; stdout: string; stderr: string; exitCode: number } | Error>;
}

/**
 * Configuration mock configuration for doctor tests
 */
export interface DoctorConfigMockConfig {
  /** Whether config is valid (default: true) */
  valid?: boolean;
  /** Configuration object (default: mockConfig with test phase) */
  config?: VibeValidateConfig | null;
  /** Validation errors (if valid=false) */
  errors?: string[];
  /** Config file path (default: 'vibe-validate.config.yaml') */
  filePath?: string;
  /** Whether workflow is in sync (default: true) */
  workflowInSync?: boolean;
  /** Workflow diff text (if not in sync) */
  workflowDiff?: string;
}

// ============================================================================
// Environment Mocking
// ============================================================================

/**
 * Setup environment mocks for doctor tests
 *
 * Mocks execSync calls for version checks and system commands.
 *
 * @param overrides - Custom responses for specific commands (supports Error for failures)
 * @param config - Configuration options for common values
 * @returns Cleanup function to restore mocks
 *
 * @example
 * ```typescript
 * // Standard healthy environment
 * mockDoctorEnvironment();
 *
 * // Old Node version
 * mockDoctorEnvironment({}, { nodeVersion: 'v18.0.0' });
 *
 * // Missing git
 * mockDoctorEnvironment({ 'git --version': new Error('git not found') });
 *
 * // No git commands
 * mockDoctorEnvironment({}, { includeGitCommands: false });
 * ```
 */
export function mockDoctorEnvironment(
  overrides?: Partial<Record<string, string | Error>>,
  config?: DoctorEnvironmentConfig
): () => void {
  const opts = {
    nodeVersion: 'v22.0.0',
    gitVersion: 'git version 2.43.0',
    vibeVersion: '0.9.11',
    pnpmVersion: '9.0.0',
    includeGitCommands: true,
    includeRemote: true,
    ...config
  };

  const mockedExecSync = vi.mocked(execSync);
  // eslint-disable-next-line sonarjs/cognitive-complexity -- Test helper requires comprehensive mocking
  mockedExecSync.mockImplementation((cmd: string) => {
    const cmdStr = cmd.toString();

    // Check overrides first
    if (overrides) {
      for (const [pattern, response] of Object.entries(overrides)) {
        if (cmdStr.includes(pattern)) {
          if (response instanceof Error) throw response;
          return response as any;
        }
      }
    }

    // Standard responses
    if (cmdStr.includes('npm view vibe-validate version')) return opts.vibeVersion as any;
    if (cmdStr.includes('node --version')) return opts.nodeVersion as any;
    if (cmdStr.includes('git --version')) return opts.gitVersion as any;
    if (cmdStr.includes('pnpm --version')) return opts.pnpmVersion as any;

    // Git commands (if enabled)
    if (opts.includeGitCommands) {
      if (cmdStr.includes('git rev-parse --git-dir')) return '.git' as any;
      if (cmdStr.includes('git rev-parse --verify main')) return 'abc123' as any;

      if (opts.includeRemote) {
        if (cmdStr.includes('git remote')) return 'origin' as any;
        if (cmdStr.includes('git ls-remote --heads origin main')) return 'abc123 refs/heads/main' as any;
      }
    }

    return '' as any;
  });

  return () => {
    vi.restoreAllMocks();
  };
}

/**
 * Setup file system mocks for doctor tests
 *
 * Mocks readFileSync and existsSync for common files.
 *
 * @param config - File content overrides and existence flags
 * @returns Cleanup function to restore mocks
 *
 * @example
 * ```typescript
 * // Standard healthy file system
 * await mockDoctorFileSystem();
 *
 * // Old package version
 * await mockDoctorFileSystem({ packageVersion: '0.9.10' });
 *
 * // Custom gitignore with deprecated state file
 * await mockDoctorFileSystem({
 *   gitignoreContent: `${DEPRECATED_STATE_FILE}\\nnode_modules\\n`
 * });
 *
 * // Missing config
 * await mockDoctorFileSystem({ configExists: false });
 *
 * // Custom files
 * await mockDoctorFileSystem({
 *   customFiles: {
 *     'custom.txt': 'custom content'
 *   }
 * });
 * ```
 */
export async function mockDoctorFileSystem(config?: DoctorFileSystemConfig): Promise<() => void> {
  const opts = {
    packageVersion: '0.9.11',
    gitignoreContent: 'node_modules\ndist\n',
    preCommitContent: 'npx vibe-validate pre-commit',
    configExists: true,
    deprecatedStateFileExists: false,
    ...config
  };

  const { readFileSync } = await import('node:fs');
  const mockedReadFileSync = vi.mocked(readFileSync);
  mockedReadFileSync.mockImplementation((path: any) => {
    const pathStr = path.toString();

    // Check custom files first
    if (opts.customFiles) {
      for (const [filePath, content] of Object.entries(opts.customFiles)) {
        if (pathStr.includes(filePath)) return content as any;
      }
    }

    // Standard files
    if (pathStr.includes('package.json')) {
      return JSON.stringify({ version: opts.packageVersion }) as any;
    }

    if (pathStr.includes('.gitignore')) {
      return opts.gitignoreContent as any;
    }

    // Pre-commit hook
    return opts.preCommitContent as any;
  });

  const mockedExistsSync = vi.mocked(existsSync);
  mockedExistsSync.mockImplementation((path: string) => {
    const pathStr = path.toString();

    if (pathStr === 'vibe-validate.config.yaml') return opts.configExists;
    if (pathStr === DEPRECATED_STATE_FILE) return opts.deprecatedStateFileExists;

    return true; // Default: files exist
  });

  // Also mock findConfigPath() to be consistent with existsSync mock
  const { findConfigPath } = await import('../../src/utils/config-loader.js');
  const mockedFindConfigPath = vi.mocked(findConfigPath);
  mockedFindConfigPath.mockReturnValue(
    opts.configExists ? 'vibe-validate.config.yaml' : null
  );

  return () => {
    vi.restoreAllMocks();
  };
}

/**
 * Setup git command mocks for doctor tests
 *
 * Mocks executeGitCommand from @vibe-validate/git package.
 *
 * @param config - Git behavior configuration
 * @returns Cleanup function to restore mocks
 *
 * @example
 * ```typescript
 * // Standard git repository
 * await mockDoctorGit();
 *
 * // Not a git repository
 * await mockDoctorGit({ isRepository: false });
 *
 * // Legacy validation history exists
 * await mockDoctorGit({
 *   validationHistoryRefs: ['refs/notes/vibe-validate/runs']
 * });
 *
 * // Current run cache exists
 * await mockDoctorGit({
 *   runCacheRefs: ['refs/notes/vibe-validate/run/tree123/key456']
 * });
 * ```
 */
export async function mockDoctorGit(config?: DoctorGitMockConfig): Promise<() => void> {
  const opts = {
    isRepository: true,
    hasRemote: true,
    mainBranchExists: true,
    validationHistoryRefs: [],
    runCacheRefs: [],
    ...config
  };

  const { executeGitCommand } = await import('@vibe-validate/git');

  const mockedExecuteGitCommand = vi.mocked(executeGitCommand);
  mockedExecuteGitCommand.mockImplementation((args: string[]) => {
    // Check custom commands first
    if (opts.customCommands) {
      const cmdKey = args.join(' ');
      const customResponse = opts.customCommands[cmdKey];
      if (customResponse) {
        if (customResponse instanceof Error) throw customResponse;
        return customResponse;
      }
    }

    // Legacy validation history check (old format)
    if (args[0] === 'for-each-ref' && args[2] === 'refs/notes/vibe-validate/runs') {
      const refs = opts.validationHistoryRefs?.join('\n') || '';
      return { success: true, stdout: refs, stderr: '', exitCode: 0 };
    }

    // Current run cache check (new format)
    if (args[0] === 'for-each-ref' && args[2]?.startsWith('refs/notes/vibe-validate/run')) {
      const refs = opts.runCacheRefs?.join('\n') || '';
      return { success: true, stdout: refs, stderr: '', exitCode: 0 };
    }

    // Update-ref for cleanup
    if (args[0] === 'update-ref' && args[1] === '-d') {
      return { success: true, stdout: '', stderr: '', exitCode: 0 };
    }

    // Default success
    return { success: true, stdout: '', stderr: '', exitCode: 0 };
  });

  return () => {
    vi.restoreAllMocks();
  };
}

// ============================================================================
// Assertion Helpers
// ============================================================================

/**
 * Find a specific doctor check result
 *
 * @param result - Doctor command result
 * @param checkName - Name of the check to find
 * @returns The found check result
 * @throws Error if check not found (with helpful message listing available checks)
 *
 * @example
 * ```typescript
 * const check = findCheck(result, 'Node.js version');
 * expect(check.passed).toBe(true);
 * ```
 */
export function findCheck(
  result: { checks: DoctorCheckResult[] },
  checkName: string
): DoctorCheckResult {
  const check = result.checks.find(c => c.name === checkName);
  if (!check) {
    const available = result.checks.map(c => c.name).join(', ');
    throw new Error(
      `Check "${checkName}" not found. Available checks: ${available}`
    );
  }
  return check;
}

/**
 * Assert check passed/failed with message matching
 *
 * Reduces 3-4 lines of assertions to a single function call.
 *
 * @param result - Doctor command result
 * @param checkName - Name of the check
 * @param assertions - Assertions to perform on the check
 *
 * @example
 * ```typescript
 * // Simple pass/fail assertion
 * assertCheck(result, 'Git installed', { passed: true });
 *
 * // With message matching
 * assertCheck(result, 'Node.js version', {
 *   passed: false,
 *   messageContains: 'Node.js 20+'
 * });
 *
 * // With suggestion matching
 * assertCheck(result, 'Node.js version', {
 *   passed: false,
 *   messageContains: 'Node.js 20+',
 *   suggestionContains: 'nvm'
 * });
 *
 * // Multiple message patterns
 * assertCheck(result, 'Configuration', {
 *   passed: false,
 *   messageContains: ['invalid', 'schema']
 * });
 * ```
 */
export function assertCheck(
  result: { checks: DoctorCheckResult[] },
  checkName: string,
  assertions: {
    passed: boolean;
    messageContains?: string | string[];
    suggestionContains?: string | string[];
  }
): void {
  const check = findCheck(result, checkName);

  expect(check.passed).toBe(assertions.passed);

  if (assertions.messageContains) {
    const messages = Array.isArray(assertions.messageContains)
      ? assertions.messageContains
      : [assertions.messageContains];
    for (const msg of messages) {
      expect(check.message).toContain(msg);
    }
  }

  if (assertions.suggestionContains) {
    expect(check.suggestion).toBeDefined();
    const suggestions = Array.isArray(assertions.suggestionContains)
      ? assertions.suggestionContains
      : [assertions.suggestionContains];
    for (const sug of suggestions) {
      expect(check.suggestion).toContain(sug);
    }
  }
}

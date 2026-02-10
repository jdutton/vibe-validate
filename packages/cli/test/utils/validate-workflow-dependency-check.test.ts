/**
 * Validate Workflow - Dependency Check Integration Tests
 *
 * Tests the integration of dependency lock file checking with the validation workflow.
 * Uses focused unit tests that don't require full workflow mocking.
 */

/**
 * Validate Workflow - Dependency Check Integration Tests
 *
 * Tests the integration of dependency lock file checking with the validation workflow.
 * These tests verify the business logic without requiring full workflow integration.
 */

import type { VibeValidateConfig } from '@vibe-validate/config';
import * as core from '@vibe-validate/core';
import * as git from '@vibe-validate/git';
import * as history from '@vibe-validate/history';
import type { DependencyCheckResult } from '@vibe-validate/utils';
import * as utils from '@vibe-validate/utils';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import type { AgentContext } from '../../src/utils/context-detector.js';

// Mock core module
vi.mock('@vibe-validate/core', async () => {
  const actual = await vi.importActual<typeof core>('@vibe-validate/core');
  return {
    ...actual,
    runValidation: vi.fn(),
  };
});

// Mock git module
vi.mock('@vibe-validate/git', async () => {
  const actual = await vi.importActual<typeof git>('@vibe-validate/git');
  return {
    ...actual,
    getRepositoryRoot: vi.fn(),
    getGitTreeHash: vi.fn(),
  };
});

// Mock history module
vi.mock('@vibe-validate/history', async () => {
  const actual = await vi.importActual<typeof history>('@vibe-validate/history');
  return {
    ...actual,
    findCachedValidation: vi.fn(),
    checkWorktreeStability: vi.fn(),
    recordValidationHistory: vi.fn(),
    checkHistoryHealth: vi.fn(),
  };
});

// Mock utils module for runDependencyCheck
vi.mock('@vibe-validate/utils', async () => {
  const actual = await vi.importActual<typeof utils>('@vibe-validate/utils');
  return {
    ...actual,
    runDependencyCheck: vi.fn(),
  };
});

// Type alias for cleaner test code
type DependencyLockCheckConfig = NonNullable<VibeValidateConfig['ci']>['dependencyLockCheck'];

/**
 * Test helper: Business logic for determining when dependency check should run
 * This mirrors the implementation in validate-workflow.ts
 */
function testShouldRunDependencyCheck(
  config: DependencyLockCheckConfig | undefined,
  isPreCommit: boolean
): boolean {
  if (!config) return isPreCommit;
  if (!config.runOn) return isPreCommit;

  if (config.runOn === 'validate') return true;
  if (config.runOn === 'pre-commit') return isPreCommit;
  return false; // disabled
}

/**
 * Helper: Create mock dependency check result
 */
function createMockDependencyCheckResult(
  overrides: Partial<DependencyCheckResult> = {}
): DependencyCheckResult {
  return {
    passed: true,
    skipped: false,
    duration: 100,
    ...overrides,
  };
}

/**
 * Helper: Create test config for dependency check tests
 */
function createTestConfig(): VibeValidateConfig {
  return {
    validation: {
      phases: [
        {
          name: 'Test Phase',
          steps: [],
        },
      ],
    },
    ci: {
      dependencyLockCheck: {
        runOn: 'validate',
      },
    },
  };
}

/**
 * Helper: Create test context for dependency check tests
 */
function createTestContext(isPreCommit = true): AgentContext {
  return {
    isAgent: false,
    isCI: false,
    isInteractive: true,
    isPreCommit,
  };
}

/**
 * Helper: Setup mocks for workflow to proceed without cache
 */
function setupWorkflowMocks(): void {
  vi.mocked(core.runValidation).mockResolvedValue({
    passed: true,
    timestamp: new Date().toISOString(),
    phases: [],
  });

  // Mock git tree hash to avoid cache lookup
  vi.mocked(git.getGitTreeHash).mockRejectedValue(new Error('Git error'));
}

/**
 * Helper: Run workflow and return result
 */
async function runWorkflow(
  depCheckResult: DependencyCheckResult,
  verbose = false
): Promise<any> {
  vi.mocked(git.getRepositoryRoot).mockReturnValue('/test/repo');
  vi.mocked(utils.runDependencyCheck).mockResolvedValue(depCheckResult);
  setupWorkflowMocks();

  const { runValidateWorkflow } = await import('../../src/utils/validate-workflow.js');

  return runValidateWorkflow(createTestConfig(), {
    verbose,
    context: createTestContext(),
  });
}

describe('Dependency Check Business Logic', () => {
  describe('runOn: validate', () => {
    it('should run in both validate and pre-commit contexts', () => {
      const config = { runOn: 'validate' as const };
      expect(testShouldRunDependencyCheck(config, false)).toBe(true);
      expect(testShouldRunDependencyCheck(config, true)).toBe(true);
    });
  });

  describe('runOn: pre-commit', () => {
    it('should run only in pre-commit context', () => {
      const config = { runOn: 'pre-commit' as const };
      expect(testShouldRunDependencyCheck(config, false)).toBe(false);
      expect(testShouldRunDependencyCheck(config, true)).toBe(true);
    });
  });

  describe('runOn: disabled', () => {
    it('should never run', () => {
      const config = { runOn: 'disabled' as const };
      expect(testShouldRunDependencyCheck(config, false)).toBe(false);
      expect(testShouldRunDependencyCheck(config, true)).toBe(false);
    });
  });

  describe('implicit behavior (undefined config)', () => {
    it('should behave as pre-commit when config is undefined', () => {
      expect(testShouldRunDependencyCheck(undefined, false)).toBe(false);
      expect(testShouldRunDependencyCheck(undefined, true)).toBe(true);
    });

    it('should behave as pre-commit when runOn is undefined', () => {
      const config = { packageManager: 'npm' as const };
      expect(testShouldRunDependencyCheck(config, false)).toBe(false);
      expect(testShouldRunDependencyCheck(config, true)).toBe(true);
    });
  });
});

describe('AgentContext Type Extension', () => {
  it('should support isPreCommit field', () => {
    const context: AgentContext = {
      isAgent: false,
      isCI: false,
      isInteractive: true,
      isPreCommit: true,
    };
    expect(context.isPreCommit).toBe(true);
  });

  it('should allow isPreCommit to be optional', () => {
    const context: AgentContext = {
      isAgent: false,
      isCI: false,
      isInteractive: true,
    };
    expect(context.isPreCommit).toBeUndefined();
  });
});

describe('runDependencyLockCheck integration', () => {
  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();

    // Mock console methods to test output
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Setup default mocks that most tests need
    vi.mocked(history.findCachedValidation).mockResolvedValue(null);
    vi.mocked(history.checkWorktreeStability).mockResolvedValue({ stable: true, treeHashBefore: 'abc', treeHashAfter: 'abc' });
    vi.mocked(history.recordValidationHistory).mockResolvedValue({ recorded: true, treeHash: 'abc123' });
    vi.mocked(history.checkHistoryHealth).mockResolvedValue({ shouldWarn: false, warningMessage: '', totalNotes: 0, oldNotesCount: 0 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getRepositoryRoot error handling', () => {
    it('should handle error when getRepositoryRoot throws', async () => {
      // Mock getRepositoryRoot to throw error
      vi.mocked(git.getRepositoryRoot).mockImplementation(() => {
        throw new Error('Not a git repository');
      });

      setupWorkflowMocks();

      const { runValidateWorkflow } = await import('../../src/utils/validate-workflow.js');

      // Run workflow with verbose enabled to see warning
      await runValidateWorkflow(createTestConfig(), {
        verbose: true,
        context: createTestContext(),
      });

      // Verify warning was logged
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('Could not get repository root - dependency check skipped')
      );
    });
  });

  describe('dependency check failure', () => {
    it('should display failure message and return failure result', async () => {
      vi.mocked(git.getRepositoryRoot).mockReturnValue('/test/repo');

      vi.mocked(utils.runDependencyCheck).mockResolvedValue(
        createMockDependencyCheckResult({
          passed: false,
          skipped: false,
          error: 'Lock file out of sync',
          command: 'npm ci',
        })
      );

      setupWorkflowMocks();

      const { runValidateWorkflow } = await import('../../src/utils/validate-workflow.js');

      const result = await runValidateWorkflow(createTestConfig(), {
        context: createTestContext(),
      });

      expect(result.passed).toBe(false);
      expect(result.failedStep).toBe('Dependency Lock Check');
      expect(result.summary).toBe('Dependency lock check failed');

      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('Dependency lock check failed')
      );
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('Lock file out of sync')
      );
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('npm ci')
      );
    });
  });

  describe('npm-link skip scenario', () => {
    it('should display npm-link skip message with linked packages', async () => {
      await runWorkflow(
        createMockDependencyCheckResult({
          passed: true,
          skipped: true,
          skipReason: 'npm-link',
          linkedPackages: ['@vibe-validate/core', '@vibe-validate/utils'],
        })
      );

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Dependency lock check skipped (npm link detected)')
      );
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Linked packages:')
      );
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('@vibe-validate/core')
      );
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('@vibe-validate/utils')
      );
    });

    it('should handle npm-link skip with empty linked packages list', async () => {
      await runWorkflow(
        createMockDependencyCheckResult({
          passed: true,
          skipped: true,
          skipReason: 'npm-link',
          linkedPackages: [],
        })
      );

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Dependency lock check skipped (npm link detected)')
      );
    });
  });

  describe('env-var skip scenario', () => {
    it('should display env-var skip message', async () => {
      await runWorkflow(
        createMockDependencyCheckResult({
          passed: true,
          skipped: true,
          skipReason: 'env-var',
        })
      );

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Dependency lock check skipped (VV_SKIP_DEPENDENCY_CHECK set)')
      );
    });
  });

  describe('dependency check success', () => {
    it('should not display any messages on success', async () => {
      await runWorkflow(
        createMockDependencyCheckResult({
          passed: true,
          skipped: false,
        })
      );

      expect(console.log).not.toHaveBeenCalledWith(
        expect.stringContaining('Dependency lock check')
      );
      expect(console.error).not.toHaveBeenCalledWith(
        expect.stringContaining('Dependency lock check')
      );
    });
  });
});

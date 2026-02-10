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
import { describe, it, expect } from 'vitest';

import type { AgentContext } from '../../src/utils/context-detector.js';

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

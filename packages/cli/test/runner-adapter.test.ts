import type { VibeValidateConfig } from '@vibe-validate/config';
import type { RunnerConfig } from '@vibe-validate/core';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import type { AgentContext } from '../src/utils/context-detector.js';
import { createRunnerConfig } from '../src/utils/runner-adapter.js';

/**
 * Create a mock VibeValidateConfig for testing
 * @param phases - Optional array of phases (defaults to single test phase)
 * @returns Minimal test config
 */
function createMockConfig(phases?: VibeValidateConfig['validation']['phases']): VibeValidateConfig {
  if (phases === undefined) {
    return {
      validation: {
        phases: [
          {
            name: 'Test Phase',
            parallel: true,
            steps: [{ name: 'Test Step', command: 'echo test' }]
          }
        ]
      }
    };
  }

  return phases.length === 0
    ? { validation: { phases: [] } }
    : { validation: { phases } };
}

/**
 * Create a mock AgentContext for testing
 * @param overrides - Optional context properties to override
 * @returns Test agent context
 */
function createMockContext(overrides?: Partial<AgentContext>): AgentContext {
  return {
    isAgent: false,
    isCI: false,
    isInteractive: true,
    ...overrides
  };
}

/**
 * Setup a runner test with config, context, and options
 * @param configPhases - Optional phases for config
 * @param contextOverrides - Optional context overrides
 * @param verbose - Verbose flag (default: true)
 * @returns Object with config, context, and runnerConfig
 */
function setupRunnerTest(
  configPhases?: VibeValidateConfig['validation']['phases'],
  contextOverrides?: Partial<AgentContext>,
  verbose = true
) {
  const config = createMockConfig(configPhases);
  const context = createMockContext(contextOverrides);
  const runnerConfig = createRunnerConfig(config, { verbose, context });

  return { config, context, runnerConfig };
}

/**
 * Assert basic runner behavior expectations
 * @param runnerConfig - Runner config to validate
 * @param expectedPhases - Expected phases array
 */
function expectRunnerBehavior(
  runnerConfig: RunnerConfig,
  expectedPhases: VibeValidateConfig['validation']['phases']
) {
  expect(runnerConfig.phases).toEqual(expectedPhases);
  expect(runnerConfig.enableFailFast).toBe(true);
  expect(runnerConfig.env).toBeDefined();
}

describe('runner-adapter', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    // Save original environment
    originalEnv = { ...process.env };

    // Set up minimal environment
    process.env.TEST_VAR = 'test-value';

    // Clear VIBE_VALIDATE_FORCE to avoid test isolation issues
    delete process.env.VIBE_VALIDATE_FORCE;

    // Spy on console.log to reduce noise
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  describe('createRunnerConfig', () => {
    it('should create basic runner config from vibe-validate config', () => {
      const { config, runnerConfig } = setupRunnerTest();
      expectRunnerBehavior(runnerConfig, config.validation.phases);
    });

    it('should include environment variables in runner config', () => {
      const { runnerConfig } = setupRunnerTest([]);

      expect(runnerConfig.env).toBeDefined();
      expect(runnerConfig.env?.TEST_VAR).toBe('test-value');
    });

    // Note: forceRun tests removed in v0.12.0 - force flag now handled at CLI layer via git notes

    it('should filter out undefined environment variables', () => {
      // Add an undefined variable
      process.env.UNDEFINED_VAR = undefined;

      const { runnerConfig } = setupRunnerTest([]);

      expect(runnerConfig.env?.UNDEFINED_VAR).toBeUndefined();
      // All env values should be strings
      for (const value of Object.values(runnerConfig.env ?? {})) {
        expect(typeof value).toBe('string');
      }
    });

    it('should use empty phases array if validation config is missing', () => {
      const config: VibeValidateConfig = {};
      const context = createMockContext();
      const runnerConfig = createRunnerConfig(config, { verbose: true, context });

      expect(runnerConfig.phases).toEqual([]);
    });

    it('should include verbose callbacks when verbose=true', () => {
      const { runnerConfig } = setupRunnerTest([]);

      expect(runnerConfig.onPhaseStart).toBeDefined();
      expect(runnerConfig.onPhaseComplete).toBeDefined();
      expect(runnerConfig.onStepStart).toBeDefined();
      expect(runnerConfig.onStepComplete).toBeDefined();
    });

    it('should include minimal callbacks when verbose=false', () => {
      const { runnerConfig } = setupRunnerTest(
        [],
        { isAgent: true, agentName: 'claude-code', isInteractive: false },
        false
      );

      expect(runnerConfig.onPhaseStart).toBeDefined();
      expect(runnerConfig.onPhaseComplete).toBeDefined();
      expect(runnerConfig.onStepStart).toBeDefined();
      expect(runnerConfig.onStepComplete).toBeDefined();
    });

    it('should include minimal callbacks for CI context (verbose=false)', () => {
      const { runnerConfig } = setupRunnerTest(
        [],
        { isCI: true, isInteractive: false },
        false
      );

      expect(runnerConfig.onPhaseStart).toBeDefined();
      expect(runnerConfig.onPhaseComplete).toBeDefined();
      expect(runnerConfig.onStepStart).toBeDefined();
      expect(runnerConfig.onStepComplete).toBeDefined();
    });
  });

  describe('verbose callbacks', () => {
    it('should log colorful output for phase start', () => {
      const { config, runnerConfig } = setupRunnerTest([
        { name: 'Test Phase', parallel: true, steps: [] }
      ]);

      // Call the callback
      runnerConfig.onPhaseStart?.(config.validation.phases[0]);

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Running phase')
      );
    });

    it('should log success for phase complete', () => {
      const { config, runnerConfig } = setupRunnerTest([
        { name: 'Test Phase', parallel: true, steps: [] }
      ]);

      // Call the callback with success result
      runnerConfig.onPhaseComplete?.(config.validation.phases[0], {
        name: 'Test Phase',
        passed: true,
        steps: [],
        duration: 100
      });

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('completed successfully')
      );
    });

    it('should log failure for phase complete', () => {
      const { config, runnerConfig } = setupRunnerTest([
        { name: 'Test Phase', parallel: true, steps: [] }
      ]);

      // Call the callback with failure result
      runnerConfig.onPhaseComplete?.(config.validation.phases[0], {
        name: 'Test Phase',
        passed: false,
        steps: [],
        duration: 100
      });

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('failed')
      );
    });
  });

  describe('minimal callbacks', () => {
    it('should log minimal structured output when verbose=false', () => {
      const { config, runnerConfig } = setupRunnerTest(
        [{ name: 'Test Phase', parallel: true, steps: [] }],
        { isAgent: true, agentName: 'claude-code', isInteractive: false },
        false
      );

      // Call phase start callback
      runnerConfig.onPhaseStart?.(config.validation.phases[0]);

      expect(console.log).toHaveBeenCalledWith('phase_start: Test Phase');
    });

    it('should log minimal output for CI context (not silent)', () => {
      const { config, runnerConfig } = setupRunnerTest(
        [{ name: 'Test Phase', parallel: true, steps: [] }],
        { isCI: true, isInteractive: false },
        false
      );

      // Call callbacks - should log minimal YAML output
      runnerConfig.onPhaseStart?.(config.validation.phases[0]);
      runnerConfig.onPhaseComplete?.(config.validation.phases[0], {
        name: 'Test Phase',
        passed: true,
        steps: [],
        duration: 100
      });

      // Minimal callbacks DO log output (just minimal format)
      expect(console.log).toHaveBeenCalledWith('phase_start: Test Phase');
      expect(console.log).toHaveBeenCalledWith('phase_complete: Test Phase (passed)');
    });
  });
});

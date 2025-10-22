import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRunnerConfig } from '../src/utils/runner-adapter.js';
import type { VibeValidateConfig } from '@vibe-validate/config';
import type { AgentContext } from '../src/utils/context-detector.js';

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
      const config: VibeValidateConfig = {
        validation: {
          phases: [
            {
              name: 'Test Phase',
              parallel: true,
              steps: [
                { name: 'Test Step', command: 'echo test' }
              ]
            }
          ]
        }
      };

      const context: AgentContext = {
        isAgent: false,
        isCI: false,
        isInteractive: true
      };

      const runnerConfig = createRunnerConfig(config, {
        verbose: true,
        context
      });

      expect(runnerConfig.phases).toEqual(config.validation.phases);
      expect(runnerConfig.enableFailFast).toBe(true);
      expect(runnerConfig.env).toBeDefined();
    });

    it('should include environment variables in runner config', () => {
      const config: VibeValidateConfig = {
        validation: {
          phases: []
        }
      };

      const context: AgentContext = {
        isAgent: false,
        isCI: false,
        isInteractive: true
      };

      const runnerConfig = createRunnerConfig(config, {
        verbose: true,
        context
      });

      expect(runnerConfig.env).toBeDefined();
      expect(runnerConfig.env?.TEST_VAR).toBe('test-value');
    });

    // Note: forceRun tests removed in v0.12.0 - force flag now handled at CLI layer via git notes

    it('should filter out undefined environment variables', () => {
      // Add an undefined variable
      process.env.UNDEFINED_VAR = undefined;

      const config: VibeValidateConfig = {
        validation: {
          phases: []
        }
      };

      const context: AgentContext = {
        isAgent: false,
        isCI: false,
        isInteractive: true
      };

      const runnerConfig = createRunnerConfig(config, {
        verbose: true,
        context
      });

      expect(runnerConfig.env?.UNDEFINED_VAR).toBeUndefined();
      // All env values should be strings
      Object.values(runnerConfig.env || {}).forEach(value => {
        expect(typeof value).toBe('string');
      });
    });

    it('should use empty phases array if validation config is missing', () => {
      const config: VibeValidateConfig = {};

      const context: AgentContext = {
        isAgent: false,
        isCI: false,
        isInteractive: true
      };

      const runnerConfig = createRunnerConfig(config, {
        verbose: true,
        context
      });

      expect(runnerConfig.phases).toEqual([]);
    });

    it('should include verbose callbacks when verbose=true', () => {
      const config: VibeValidateConfig = {
        validation: {
          phases: []
        }
      };

      const context: AgentContext = {
        isAgent: false,
        isCI: false,
        isInteractive: true
      };

      const runnerConfig = createRunnerConfig(config, {
        verbose: true,
        context
      });

      expect(runnerConfig.onPhaseStart).toBeDefined();
      expect(runnerConfig.onPhaseComplete).toBeDefined();
      expect(runnerConfig.onStepStart).toBeDefined();
      expect(runnerConfig.onStepComplete).toBeDefined();
    });

    it('should include minimal callbacks when verbose=false', () => {
      const config: VibeValidateConfig = {
        validation: {
          phases: []
        }
      };

      const context: AgentContext = {
        isAgent: true,
        agentName: 'claude-code',
        isCI: false,
        isInteractive: false
      };

      const runnerConfig = createRunnerConfig(config, {
        verbose: false,
        context
      });

      expect(runnerConfig.onPhaseStart).toBeDefined();
      expect(runnerConfig.onPhaseComplete).toBeDefined();
      expect(runnerConfig.onStepStart).toBeDefined();
      expect(runnerConfig.onStepComplete).toBeDefined();
    });

    it('should include minimal callbacks for CI context (verbose=false)', () => {
      const config: VibeValidateConfig = {
        validation: {
          phases: []
        }
      };

      const context: AgentContext = {
        isAgent: false,
        isCI: true,
        isInteractive: false
      };

      const runnerConfig = createRunnerConfig(config, {
        verbose: false,
        context
      });

      expect(runnerConfig.onPhaseStart).toBeDefined();
      expect(runnerConfig.onPhaseComplete).toBeDefined();
      expect(runnerConfig.onStepStart).toBeDefined();
      expect(runnerConfig.onStepComplete).toBeDefined();
    });
  });

  describe('verbose callbacks', () => {
    it('should log colorful output for phase start', () => {
      const config: VibeValidateConfig = {
        validation: {
          phases: [
            {
              name: 'Test Phase',
              parallel: true,
              steps: []
            }
          ]
        }
      };

      const context: AgentContext = {
        isAgent: false,
        isCI: false,
        isInteractive: true
      };

      const runnerConfig = createRunnerConfig(config, {
        verbose: true,
        context
      });

      // Call the callback
      runnerConfig.onPhaseStart?.(config.validation.phases[0]);

      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Running phase')
      );
    });

    it('should log success for phase complete', () => {
      const config: VibeValidateConfig = {
        validation: {
          phases: [
            {
              name: 'Test Phase',
              parallel: true,
              steps: []
            }
          ]
        }
      };

      const context: AgentContext = {
        isAgent: false,
        isCI: false,
        isInteractive: true
      };

      const runnerConfig = createRunnerConfig(config, {
        verbose: true,
        context
      });

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
      const config: VibeValidateConfig = {
        validation: {
          phases: [
            {
              name: 'Test Phase',
              parallel: true,
              steps: []
            }
          ]
        }
      };

      const context: AgentContext = {
        isAgent: false,
        isCI: false,
        isInteractive: true
      };

      const runnerConfig = createRunnerConfig(config, {
        verbose: true,
        context
      });

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
      const config: VibeValidateConfig = {
        validation: {
          phases: [
            {
              name: 'Test Phase',
              parallel: true,
              steps: []
            }
          ]
        }
      };

      const context: AgentContext = {
        isAgent: true,
        agentName: 'claude-code',
        isCI: false,
        isInteractive: false
      };

      const runnerConfig = createRunnerConfig(config, {
        verbose: false,
        context
      });

      // Call phase start callback
      runnerConfig.onPhaseStart?.(config.validation.phases[0]);

      expect(console.log).toHaveBeenCalledWith('phase_start: Test Phase');
    });

    it('should log minimal output for CI context (not silent)', () => {
      const config: VibeValidateConfig = {
        validation: {
          phases: [
            {
              name: 'Test Phase',
              parallel: true,
              steps: []
            }
          ]
        }
      };

      const context: AgentContext = {
        isAgent: false,
        isCI: true,
        isInteractive: false
      };

      const runnerConfig = createRunnerConfig(config, {
        verbose: false,
        context
      });

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

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
        format: 'human',
        context
      });

      expect(runnerConfig.phases).toEqual(config.validation.phases);
      expect(runnerConfig.enableFailFast).toBe(true);
      expect(runnerConfig.stateFilePath).toBe('.vibe-validate-state.yaml');
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
        format: 'human',
        context
      });

      expect(runnerConfig.env).toBeDefined();
      expect(runnerConfig.env?.TEST_VAR).toBe('test-value');
    });

    it('should add VIBE_VALIDATE_FORCE env var when force is true', () => {
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
        force: true,
        format: 'human',
        context
      });

      expect(runnerConfig.env?.VIBE_VALIDATE_FORCE).toBe('1');
    });

    it('should not add VIBE_VALIDATE_FORCE when force is false', () => {
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
        force: false,
        format: 'human',
        context
      });

      expect(runnerConfig.env?.VIBE_VALIDATE_FORCE).toBeUndefined();
    });

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
        format: 'human',
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
        format: 'human',
        context
      });

      expect(runnerConfig.phases).toEqual([]);
    });

    it('should include human callbacks for human format', () => {
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
        format: 'human',
        context
      });

      expect(runnerConfig.onPhaseStart).toBeDefined();
      expect(runnerConfig.onPhaseComplete).toBeDefined();
      expect(runnerConfig.onStepStart).toBeDefined();
      expect(runnerConfig.onStepComplete).toBeDefined();
    });

    it('should include agent callbacks for yaml format', () => {
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
        format: 'yaml',
        context
      });

      expect(runnerConfig.onPhaseStart).toBeDefined();
      expect(runnerConfig.onPhaseComplete).toBeDefined();
      expect(runnerConfig.onStepStart).toBeDefined();
      expect(runnerConfig.onStepComplete).toBeDefined();
    });

    it('should include silent callbacks for json format', () => {
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
        format: 'json',
        context
      });

      expect(runnerConfig.onPhaseStart).toBeDefined();
      expect(runnerConfig.onPhaseComplete).toBeDefined();
      expect(runnerConfig.onStepStart).toBeDefined();
      expect(runnerConfig.onStepComplete).toBeDefined();
    });
  });

  describe('human callbacks', () => {
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
        format: 'human',
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
        format: 'human',
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
        format: 'human',
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

  describe('agent callbacks', () => {
    it('should log structured output for yaml format', () => {
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
        format: 'yaml',
        context
      });

      // Call phase start callback
      runnerConfig.onPhaseStart?.(config.validation.phases[0]);

      expect(console.log).toHaveBeenCalledWith('phase_start: Test Phase');
    });

    it('should be silent for json format', () => {
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
        format: 'json',
        context
      });

      // Call callbacks - should not log anything
      runnerConfig.onPhaseStart?.(config.validation.phases[0]);
      runnerConfig.onPhaseComplete?.(config.validation.phases[0], {
        name: 'Test Phase',
        passed: true,
        steps: [],
        duration: 100
      });

      expect(console.log).not.toHaveBeenCalled();
    });
  });
});

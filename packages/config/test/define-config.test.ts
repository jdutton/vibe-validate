/**
 * Tests for TypeScript-First Config Helper
 *
 * Tests defineConfig and mergeConfig functions.
 */

import { describe, it, expect } from 'vitest';
import { defineConfig, mergeConfig } from '../src/define-config.js';
import type { VibeValidateConfig } from '../src/schema.js';

describe('defineConfig', () => {
  it('should return the same config object', () => {
    const config: VibeValidateConfig = {
      validation: {
        phases: [
          {
            name: 'Test Phase',
            parallel: true,
            steps: [
              { name: 'Test Step', command: 'echo "test"' },
            ],
          },
        ],
        caching: {
          strategy: 'git-tree-hash',
          enabled: true,
          statePath: '.vibe-validate-state.yaml',
        },
      },
      git: {
        mainBranch: 'main',
        autoSync: false,
        warnIfBehind: true,
      },
      output: {
        format: 'auto',
        showProgress: true,
        verbose: false,
        noColor: false,
      },
    };

    const result = defineConfig(config);
    expect(result).toBe(config);
    expect(result).toEqual(config);
  });

  it('should provide type safety for config objects', () => {
    const config = defineConfig({
      validation: {
        phases: [
          {
            name: 'Build',
            parallel: false,
            steps: [
              { name: 'Compile', command: 'npm run build' },
            ],
          },
        ],
        caching: {
          strategy: 'timestamp',
          enabled: false,
          statePath: '.vibe-state.yaml',
        },
      },
      git: {
        mainBranch: 'develop',
        autoSync: true,
        warnIfBehind: false,
      },
      output: {
        format: 'json',
        showProgress: false,
        verbose: true,
        noColor: true,
      },
    });

    expect(config.validation.phases[0].name).toBe('Build');
    expect(config.git.mainBranch).toBe('develop');
    expect(config.output.format).toBe('json');
  });
});

describe('mergeConfig', () => {
  it('should merge base and override configs', () => {
    const base: VibeValidateConfig = {
      validation: {
        phases: [
          {
            name: 'Base Phase',
            parallel: true,
            steps: [
              { name: 'Base Step', command: 'echo "base"' },
            ],
          },
        ],
        caching: {
          strategy: 'git-tree-hash',
          enabled: true,
          statePath: '.base-state.yaml',
        },
      },
      git: {
        mainBranch: 'main',
        autoSync: false,
        warnIfBehind: true,
      },
      output: {
        format: 'auto',
        showProgress: true,
        verbose: false,
        noColor: false,
      },
    };

    const override: Partial<VibeValidateConfig> = {
      output: {
        verbose: true,
        noColor: true,
      },
    };

    const result = mergeConfig(base, override);

    expect(result.validation).toEqual(base.validation);
    expect(result.git).toEqual(base.git);
    expect(result.output.verbose).toBe(true);
    expect(result.output.noColor).toBe(true);
    expect(result.output.format).toBe('auto');
    expect(result.output.showProgress).toBe(true);
  });

  it('should override phases completely', () => {
    const base: VibeValidateConfig = {
      validation: {
        phases: [
          {
            name: 'Base Phase',
            parallel: true,
            steps: [
              { name: 'Base Step', command: 'echo "base"' },
            ],
          },
        ],
        caching: {
          strategy: 'git-tree-hash',
          enabled: true,
          statePath: '.vibe-validate-state.yaml',
        },
      },
      git: {
        mainBranch: 'main',
        autoSync: false,
        warnIfBehind: true,
      },
      output: {
        format: 'auto',
        showProgress: true,
        verbose: false,
        noColor: false,
      },
    };

    const override: Partial<VibeValidateConfig> = {
      validation: {
        phases: [
          {
            name: 'Override Phase',
            parallel: false,
            steps: [
              { name: 'Override Step', command: 'echo "override"' },
            ],
          },
        ],
      },
    };

    const result = mergeConfig(base, override);

    expect(result.validation.phases).toHaveLength(1);
    expect(result.validation.phases[0].name).toBe('Override Phase');
    expect(result.validation.phases[0].parallel).toBe(false);
  });

  it('should merge caching config deeply', () => {
    const base: VibeValidateConfig = {
      validation: {
        phases: [
          {
            name: 'Test',
            parallel: true,
            steps: [
              { name: 'Test Step', command: 'npm test' },
            ],
          },
        ],
        caching: {
          strategy: 'git-tree-hash',
          enabled: true,
          statePath: '.vibe-validate-state.yaml',
        },
      },
      git: {
        mainBranch: 'main',
        autoSync: false,
        warnIfBehind: true,
      },
      output: {
        format: 'auto',
        showProgress: true,
        verbose: false,
        noColor: false,
      },
    };

    const override: Partial<VibeValidateConfig> = {
      validation: {
        caching: {
          enabled: false,
        },
      },
    };

    const result = mergeConfig(base, override);

    expect(result.validation.caching.enabled).toBe(false);
    expect(result.validation.caching.strategy).toBe('git-tree-hash');
    expect(result.validation.caching.statePath).toBe('.vibe-validate-state.yaml');
  });

  it('should merge git config', () => {
    const base: VibeValidateConfig = {
      validation: {
        phases: [
          {
            name: 'Test',
            parallel: true,
            steps: [
              { name: 'Test Step', command: 'npm test' },
            ],
          },
        ],
        caching: {
          strategy: 'git-tree-hash',
          enabled: true,
          statePath: '.vibe-validate-state.yaml',
        },
      },
      git: {
        mainBranch: 'main',
        autoSync: false,
        warnIfBehind: true,
      },
      output: {
        format: 'auto',
        showProgress: true,
        verbose: false,
        noColor: false,
      },
    };

    const override: Partial<VibeValidateConfig> = {
      git: {
        mainBranch: 'develop',
        autoSync: true,
      },
    };

    const result = mergeConfig(base, override);

    expect(result.git.mainBranch).toBe('develop');
    expect(result.git.autoSync).toBe(true);
    expect(result.git.warnIfBehind).toBe(true);
  });

  it('should override preset field', () => {
    const base: VibeValidateConfig = {
      preset: 'typescript-library',
      validation: {
        phases: [
          {
            name: 'Test',
            parallel: true,
            steps: [
              { name: 'Test Step', command: 'npm test' },
            ],
          },
        ],
        caching: {
          strategy: 'git-tree-hash',
          enabled: true,
          statePath: '.vibe-validate-state.yaml',
        },
      },
      git: {
        mainBranch: 'main',
        autoSync: false,
        warnIfBehind: true,
      },
      output: {
        format: 'auto',
        showProgress: true,
        verbose: false,
        noColor: false,
      },
    };

    const override: Partial<VibeValidateConfig> = {
      preset: 'typescript-nodejs',
    };

    const result = mergeConfig(base, override);

    expect(result.preset).toBe('typescript-nodejs');
  });

  it('should override extends field', () => {
    const base: VibeValidateConfig = {
      extends: './base.config.json',
      validation: {
        phases: [
          {
            name: 'Test',
            parallel: true,
            steps: [
              { name: 'Test Step', command: 'npm test' },
            ],
          },
        ],
        caching: {
          strategy: 'git-tree-hash',
          enabled: true,
          statePath: '.vibe-validate-state.yaml',
        },
      },
      git: {
        mainBranch: 'main',
        autoSync: false,
        warnIfBehind: true,
      },
      output: {
        format: 'auto',
        showProgress: true,
        verbose: false,
        noColor: false,
      },
    };

    const override: Partial<VibeValidateConfig> = {
      extends: './override.config.json',
    };

    const result = mergeConfig(base, override);

    expect(result.extends).toBe('./override.config.json');
  });

  it('should handle empty override', () => {
    const base: VibeValidateConfig = {
      validation: {
        phases: [
          {
            name: 'Test',
            parallel: true,
            steps: [
              { name: 'Test Step', command: 'npm test' },
            ],
          },
        ],
        caching: {
          strategy: 'git-tree-hash',
          enabled: true,
          statePath: '.vibe-validate-state.yaml',
        },
      },
      git: {
        mainBranch: 'main',
        autoSync: false,
        warnIfBehind: true,
      },
      output: {
        format: 'auto',
        showProgress: true,
        verbose: false,
        noColor: false,
      },
    };

    const override: Partial<VibeValidateConfig> = {};

    const result = mergeConfig(base, override);

    expect(result).toEqual(base);
  });

  it('should handle all fields being overridden', () => {
    const base: VibeValidateConfig = {
      validation: {
        phases: [
          {
            name: 'Base Phase',
            parallel: true,
            steps: [
              { name: 'Base Step', command: 'echo "base"' },
            ],
          },
        ],
        caching: {
          strategy: 'git-tree-hash',
          enabled: true,
          statePath: '.base-state.yaml',
        },
      },
      git: {
        mainBranch: 'main',
        autoSync: false,
        warnIfBehind: true,
      },
      output: {
        format: 'auto',
        showProgress: true,
        verbose: false,
        noColor: false,
      },
    };

    const override: Partial<VibeValidateConfig> = {
      validation: {
        phases: [
          {
            name: 'Override Phase',
            parallel: false,
            steps: [
              { name: 'Override Step', command: 'echo "override"' },
            ],
          },
        ],
        caching: {
          strategy: 'timestamp',
          enabled: false,
          statePath: '.override-state.yaml',
        },
      },
      git: {
        mainBranch: 'develop',
        autoSync: true,
        warnIfBehind: false,
      },
      output: {
        format: 'json',
        showProgress: false,
        verbose: true,
        noColor: true,
      },
      preset: 'typescript-react',
      extends: './override.config.json',
    };

    const result = mergeConfig(base, override);

    expect(result.validation.phases[0].name).toBe('Override Phase');
    expect(result.validation.caching.strategy).toBe('timestamp');
    expect(result.git.mainBranch).toBe('develop');
    expect(result.output.format).toBe('json');
    expect(result.preset).toBe('typescript-react');
    expect(result.extends).toBe('./override.config.json');
  });
});

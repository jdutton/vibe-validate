/**
 * Tests for TypeScript-First Config Helper
 *
 * Tests defineConfig function.
 */

import { describe, it, expect } from 'vitest';
import { defineConfig } from '../src/define-config.js';
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
    });

    expect(config.validation.phases[0].name).toBe('Build');
    expect(config.git.mainBranch).toBe('develop');
  });
});

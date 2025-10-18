/**
 * Preset: TypeScript Library
 *
 * Default preset for TypeScript libraries (npm packages).
 * Includes type checking, linting, testing, and build validation.
 */

import type { VibeValidateConfig } from '../schema.js';
import { GIT_DEFAULTS } from '../constants.js';

export const typescriptLibraryPreset = {
  preset: 'typescript-library',

  validation: {
    phases: [
      {
        name: 'Phase 1: Pre-Qualification',
        parallel: true,
        failFast: true,
        steps: [
          {
            name: 'TypeScript type checking',
            command: 'tsc --noEmit',
          },
          {
            name: 'ESLint code checking',
            command: 'eslint .',
          },
        ],
      },
      {
        name: 'Phase 2: Testing',
        parallel: true,
        dependsOn: ['Phase 1: Pre-Qualification'],
        steps: [
          {
            name: 'Unit tests',
            command: 'npm test',
          },
        ],
      },
      {
        name: 'Phase 3: Build',
        parallel: false,
        dependsOn: ['Phase 2: Testing'],
        steps: [
          {
            name: 'Build package',
            command: 'npm run build',
          },
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
    mainBranch: GIT_DEFAULTS.MAIN_BRANCH,
    remoteOrigin: GIT_DEFAULTS.REMOTE_ORIGIN,
    autoSync: GIT_DEFAULTS.AUTO_SYNC,
    warnIfBehind: GIT_DEFAULTS.WARN_IF_BEHIND,
  },

  output: {
    format: 'auto',
    showProgress: true,
    verbose: false,
    noColor: false,
  },
} as VibeValidateConfig;

/**
 * Preset: TypeScript React Application
 *
 * Preset for React applications with TypeScript.
 * Includes type checking, linting, component tests, and build validation.
 */

import type { VibeValidateConfig } from '../schema.js';
import { GIT_DEFAULTS } from '../constants.js';

export const typescriptReactPreset = {
  preset: 'typescript-react',

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
            command: 'npm run test:unit',
          },
          {
            name: 'Component tests',
            command: 'npm run test:components',
            continueOnError: true, // Optional if component tests are in progress
          },
        ],
      },
      {
        name: 'Phase 3: Build',
        parallel: false,
        dependsOn: ['Phase 2: Testing'],
        steps: [
          {
            name: 'Production build',
            command: 'npm run build',
            timeout: 600000, // 10 minutes for React builds
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
    showProgress: true,
    verbose: false,
    noColor: false,
  },
} as VibeValidateConfig;

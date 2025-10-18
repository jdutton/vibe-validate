/**
 * Preset: TypeScript Node.js Application
 *
 * Preset for Node.js applications with TypeScript.
 * Includes type checking, linting, unit/integration tests, and build validation.
 */

import type { VibeValidateConfig } from '../schema.js';
import { GIT_DEFAULTS } from '../constants.js';

export const typescriptNodejsPreset = {
  preset: 'typescript-nodejs',

  validation: {
    phases: [
      {
        name: 'Phase 1: Pre-Qualification + Build',
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
          {
            name: 'Build',
            command: 'npm run build',
          },
        ],
      },
      {
        name: 'Phase 2: Testing',
        parallel: true,
        dependsOn: ['Phase 1: Pre-Qualification + Build'],
        steps: [
          {
            name: 'Unit tests',
            command: 'npm run test:unit',
          },
          {
            name: 'Integration tests',
            command: 'npm run test:integration',
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

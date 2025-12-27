/**
 * Shared test fixtures for generate-workflow tests
 */

import type { VibeValidateConfig } from '@vibe-validate/config';

/**
 * Standard mock configuration for workflow generation tests
 */
export const mockConfig: VibeValidateConfig = {
  validation: {
    phases: [
      {
        name: 'Pre-Qualification',
        parallel: true,
        steps: [
          {
            name: 'TypeScript Type Check',
            command: 'pnpm -r typecheck',
          },
          {
            name: 'ESLint Code Quality',
            command: 'pnpm lint',
          },
        ],
        timeout: 300000,
        failFast: true,
      },
      {
        name: 'Testing',
        parallel: false,
        steps: [
          {
            name: 'Unit Tests with Coverage',
            command: 'pnpm test:coverage',
          },
        ],
        timeout: 300000,
        failFast: true,
      },
    ],
  },
  git: {
    mainBranch: 'main',
    autoSync: false,
    warnIfBehind: true,
  },
};

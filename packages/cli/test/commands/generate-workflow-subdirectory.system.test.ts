/**
 * System tests for generate-workflow subdirectory support
 *
 * These tests use real filesystem operations (no mocking) to verify that
 * generate-workflow command works correctly from subdirectories.
 */

import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import type { VibeValidateConfig } from '@vibe-validate/config';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { generateWorkflow, checkSync, type GenerateWorkflowOptions } from '../../src/commands/generate-workflow.js';

describe('generate-workflow subdirectory support (system tests)', () => {
  const testRoot = join(process.cwd(), 'test-temp-generate-workflow-system');
  const testSubdir = join(testRoot, 'packages', 'cli');
  const workflowPath = join(testRoot, '.github/workflows/validate.yml');

  const mockConfig: VibeValidateConfig = {
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
          timeout: 600000,
          failFast: false,
        },
      ],
    },
    git: {
      mainBranch: 'main',
      remoteOrigin: 'origin',
    },
  };

  beforeEach(() => {
    // Create test directory structure with .git
    mkdirSync(join(testRoot, '.git'), { recursive: true });
    mkdirSync(testSubdir, { recursive: true });
    mkdirSync(join(testRoot, '.github/workflows'), { recursive: true });

    // Create package.json at git root with pnpm
    writeFileSync(
      join(testRoot, 'package.json'),
      JSON.stringify({ name: 'test-project', packageManager: 'pnpm@9.0.0' })
    );
    writeFileSync(join(testRoot, 'pnpm-lock.yaml'), 'lockfile');

    // Generate workflow with projectRoot and write to workflow file
    const workflowContent = generateWorkflow(mockConfig, { projectRoot: testRoot });
    writeFileSync(workflowPath, workflowContent);
  });

  afterEach(() => {
    // Clean up test directories
    if (existsSync(testRoot)) {
      rmSync(testRoot, { recursive: true, force: true });
    }
  });

  it('should detect package manager from git root when projectRoot provided', () => {
    // Arrange: Use projectRoot option
    const options: GenerateWorkflowOptions = {
      projectRoot: testRoot,
    };

    // Act: Generate workflow from test directory
    const workflow = generateWorkflow(mockConfig, options);

    // Assert: Should detect pnpm from git root package.json
    expect(workflow).toContain('pnpm/action-setup');
    expect(workflow).toContain('pnpm install');
    expect(workflow).toContain('cache: pnpm');
  });

  it('should check sync against workflow at projectRoot when provided', () => {
    // Arrange: checkSync with projectRoot option
    const options: GenerateWorkflowOptions = {
      projectRoot: testRoot,
    };

    // Act: Check sync with absolute workflow path
    const result = checkSync(mockConfig, options, workflowPath);

    // Assert: Should find workflow and report in sync
    expect(result.inSync).toBe(true);
    expect(result.diff).toBe('');
  });

  it('should detect different package manager when projectRoot points to subdirectory', () => {
    // Arrange: Create package.json in subdirectory with npm (no pnpm files)
    writeFileSync(
      join(testSubdir, 'package.json'),
      JSON.stringify({ name: 'subproject' })
    );
    writeFileSync(join(testSubdir, 'package-lock.json'), 'npm lockfile');

    const options: GenerateWorkflowOptions = {
      projectRoot: testSubdir,
    };

    // Act: Generate workflow from subdirectory
    const workflow = generateWorkflow(mockConfig, options);

    // Assert: Should detect npm from subdirectory (not pnpm from parent)
    expect(workflow).toContain('npm ci');
    expect(workflow).toContain('cache: npm');
    expect(workflow).not.toContain('pnpm/action-setup');
    expect(workflow).not.toContain('pnpm install');
  });

  it('should fallback to process.cwd() when projectRoot not provided', () => {
    // Note: This tests backward compatibility - without projectRoot, uses cwd
    // Since we're running from packages/cli, it should detect the actual project's package manager

    // Act: Generate without projectRoot (uses process.cwd())
    const workflow = generateWorkflow(mockConfig);

    // Assert: Should generate valid workflow (exact package manager depends on where test runs)
    expect(workflow).toContain('name: Validation Pipeline');
    expect(workflow).toContain('actions/checkout@v4');
    expect(workflow).toContain('actions/setup-node@v4');
  });
});

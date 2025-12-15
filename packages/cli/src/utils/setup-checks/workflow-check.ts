/**
 * Workflow Setup Check
 *
 * Ensures that .github/workflows/validate.yml exists and is configured
 * to run vibe-validate validation in CI.
 *
 * This check reuses the existing workflow generation logic from the
 * generate-workflow command to create a standard GitHub Actions workflow.
 */

import { existsSync } from 'node:fs';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import { generateWorkflow, type GenerateWorkflowOptions } from '../../commands/generate-workflow.js';
import { loadConfig } from '../config-loader.js';
import type {
  SetupCheck,
  CheckResult,
  FixResult,
  PreviewResult,
  FixOptions,
} from '../setup-engine.js';

export class WorkflowSetupCheck implements SetupCheck {
  readonly id = 'workflow';
  readonly name = 'GitHub Actions Workflow Setup';

  async check(options?: FixOptions): Promise<CheckResult> {
    const cwd = options?.cwd ?? process.cwd();
    const githubDir = join(cwd, '.github');
    const workflowsDir = join(githubDir, 'workflows');
    const workflowPath = join(workflowsDir, 'validate.yml');

    // Check if .github directory exists
    if (!existsSync(githubDir)) {
      return {
        passed: false,
        message: '.github directory not found',
        suggestion: 'Create .github/workflows/validate.yml with vibe-validate workflow',
      };
    }

    // Check if workflows directory exists
    if (!existsSync(workflowsDir)) {
      return {
        passed: false,
        message: '.github/workflows directory not found',
        suggestion: 'Create .github/workflows/validate.yml',
      };
    }

    // Check if validate.yml exists
    if (!existsSync(workflowPath)) {
      return {
        passed: false,
        message: 'validate.yml workflow not found',
        suggestion: 'Create .github/workflows/validate.yml',
      };
    }

    return {
      passed: true,
      message: 'GitHub Actions workflow exists',
    };
  }

  async preview(options?: FixOptions): Promise<PreviewResult> {
    const cwd = options?.cwd ?? process.cwd();

    // Check current state
    const checkResult = await this.check(options);

    if (checkResult.passed) {
      return {
        description: 'GitHub Actions workflow already exists',
        filesAffected: [],
        changes: [],
      };
    }

    // Load config to generate workflow content
    const config = await loadConfig(cwd);
    if (!config) {
      return {
        description: 'Cannot generate workflow: No vibe-validate config found',
        filesAffected: [],
        changes: [],
      };
    }

    const workflowContent = await this.generateWorkflowContent(cwd);

    return {
      description: 'Create GitHub Actions workflow for vibe-validate',
      filesAffected: ['.github/workflows/validate.yml'],
      changes: [
        {
          file: '.github/workflows/validate.yml',
          action: 'create',
          content: workflowContent,
        },
      ],
    };
  }

  async fix(options?: FixOptions): Promise<FixResult> {
    const cwd = options?.cwd ?? process.cwd();
    const githubDir = join(cwd, '.github');
    const workflowsDir = join(githubDir, 'workflows');
    const workflowPath = join(workflowsDir, 'validate.yml');
    const dryRun = options?.dryRun ?? false;

    // Check current state
    const checkResult = await this.check(options);

    if (checkResult.passed && !options?.force) {
      return {
        success: true,
        message: 'GitHub Actions workflow already exists',
        filesChanged: [],
      };
    }

    if (dryRun) {
      return {
        success: true,
        message: '[dry-run] Would create .github/workflows/validate.yml',
        filesChanged: [],
      };
    }

    // Generate workflow content
    const workflowContent = await this.generateWorkflowContent(cwd);

    // Ensure .github/workflows directory exists
    if (!existsSync(workflowsDir)) {
      await mkdir(workflowsDir, { recursive: true });
    }

    // Don't overwrite existing workflow unless force is true
    if (existsSync(workflowPath) && !options?.force) {
      return {
        success: true,
        message: 'GitHub Actions workflow already exists (use --force to overwrite)',
        filesChanged: [],
      };
    }

    // Write workflow file
    await writeFile(workflowPath, workflowContent, 'utf-8');

    return {
      success: true,
      message: 'Created .github/workflows/validate.yml',
      filesChanged: ['.github/workflows/validate.yml'],
    };
  }

  /**
   * Generate workflow content using the existing workflow generator
   */
  private async generateWorkflowContent(cwd: string): Promise<string> {
    // Load config
    const config = await loadConfig(cwd);
    if (!config) {
      throw new Error('No vibe-validate configuration found. Run `vibe-validate init` first.');
    }

    // Generate workflow with default options
    const options: GenerateWorkflowOptions = {
      nodeVersions: ['20'],  // Single version (no matrix) for simplicity
      os: ['ubuntu-latest'],
      packageManager: undefined,  // Auto-detect
    };

    return generateWorkflow(config, options);
  }
}

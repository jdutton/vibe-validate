/**
 * Hooks Setup Check
 *
 * Ensures that husky pre-commit hook is configured to run vibe-validate.
 * This check creates/modifies .husky/pre-commit to include the vibe-validate
 * pre-commit command.
 *
 * Note: This check does NOT install husky as a dependency. Users should
 * install husky manually via `npm install -D husky` or `pnpm add -D husky`.
 */

import { existsSync } from 'node:fs';
import { readFile, writeFile, mkdir, chmod } from 'node:fs/promises';
import { join } from 'node:path';

import type {
  SetupCheck,
  CheckResult,
  FixResult,
  PreviewResult,
  FixOptions,
} from '../setup-engine.js';

const VIBE_VALIDATE_COMMAND = 'npx vibe-validate pre-commit';
const VIBE_VALIDATE_PRE_COMMIT = 'vibe-validate pre-commit';
const HUSKY_PRE_COMMIT_PATH = '.husky/pre-commit';
const PRE_COMMIT_HOOK_NAME = 'pre-commit';

export class HooksSetupCheck implements SetupCheck {
  readonly id = 'hooks';
  readonly name = 'Pre-commit Hook Setup';

  async check(options?: FixOptions): Promise<CheckResult> {
    const cwd = options?.cwd ?? process.cwd();
    const huskyDir = join(cwd, '.husky');
    const preCommitPath = join(huskyDir, PRE_COMMIT_HOOK_NAME);

    // Check if .husky directory exists
    if (!existsSync(huskyDir)) {
      return {
        passed: false,
        message: '.husky directory not found',
        suggestion: 'Install husky: npm install -D husky && npx husky init',
      };
    }

    // Check if pre-commit hook exists
    if (!existsSync(preCommitPath)) {
      return {
        passed: false,
        message: 'pre-commit hook not found',
        suggestion: 'Create .husky/pre-commit with vibe-validate command',
      };
    }

    // Read pre-commit content
    const content = await readFile(preCommitPath, 'utf-8');

    // Check if vibe-validate command exists
    const hasCommand = content.includes(VIBE_VALIDATE_PRE_COMMIT);

    if (!hasCommand) {
      return {
        passed: false,
        message: 'pre-commit hook missing vibe-validate command',
        suggestion: `Add "${VIBE_VALIDATE_COMMAND}" to .husky/pre-commit`,
      };
    }

    return {
      passed: true,
      message: 'pre-commit hook configured correctly',
    };
  }

  async preview(options?: FixOptions): Promise<PreviewResult> {
    const cwd = options?.cwd ?? process.cwd();
    const huskyDir = join(cwd, '.husky');
    const preCommitPath = join(huskyDir, PRE_COMMIT_HOOK_NAME);

    // Check current state
    const checkResult = await this.check(options);

    if (checkResult.passed) {
      return {
        description: 'pre-commit hook already configured correctly',
        filesAffected: [],
        changes: [],
      };
    }

    // If .husky/pre-commit doesn't exist
    if (!existsSync(preCommitPath)) {
      const content = this.generateNewPreCommitHook();
      return {
        description: 'Install husky and create .husky/pre-commit hook with vibe-validate command',
        filesAffected: [HUSKY_PRE_COMMIT_PATH],
        changes: [
          {
            file: HUSKY_PRE_COMMIT_PATH,
            action: 'create',
            content,
          },
        ],
      };
    }

    // If pre-commit exists but missing vibe-validate command
    return {
      description: 'Add vibe-validate command to existing pre-commit hook',
      filesAffected: [HUSKY_PRE_COMMIT_PATH],
      changes: [
        {
          file: HUSKY_PRE_COMMIT_PATH,
          action: 'modify',
        },
      ],
    };
  }

  async fix(options?: FixOptions): Promise<FixResult> {
    const cwd = options?.cwd ?? process.cwd();
    const huskyDir = join(cwd, '.husky');
    const preCommitPath = join(huskyDir, PRE_COMMIT_HOOK_NAME);
    const dryRun = options?.dryRun ?? false;

    // Check current state
    const checkResult = await this.check(options);

    if (checkResult.passed && !options?.force) {
      return {
        success: true,
        message: 'pre-commit hook already configured correctly',
        filesChanged: [],
      };
    }

    if (dryRun) {
      return {
        success: true,
        message: '[dry-run] Would create/update .husky/pre-commit',
        filesChanged: [],
      };
    }

    // Ensure .husky directory exists
    if (!existsSync(huskyDir)) {
      await mkdir(huskyDir, { recursive: true });
    }

    // If pre-commit doesn't exist, create it
    if (!existsSync(preCommitPath)) {
      const content = this.generateNewPreCommitHook();
      await writeFile(preCommitPath, content, 'utf-8');
      // Make file executable
      await chmod(preCommitPath, 0o755);

      return {
        success: true,
        message: 'Created .husky/pre-commit hook (Note: Install husky as dev dependency if not already installed)',
        filesChanged: [HUSKY_PRE_COMMIT_PATH],
      };
    }

    // If pre-commit exists, check if command is already there
    const content = await readFile(preCommitPath, 'utf-8');
    const hasCommand = content.includes(VIBE_VALIDATE_PRE_COMMIT);

    if (hasCommand) {
      // Command already exists (idempotent)
      return {
        success: true,
        message: 'pre-commit hook already contains vibe-validate command',
        filesChanged: [],
      };
    }

    // Add command to existing pre-commit hook
    const updatedContent = this.addCommandToPreCommit(content);
    await writeFile(preCommitPath, updatedContent, 'utf-8');

    return {
      success: true,
      message: 'Added vibe-validate command to pre-commit hook',
      filesChanged: [HUSKY_PRE_COMMIT_PATH],
    };
  }

  /**
   * Generate content for a new pre-commit hook
   */
  private generateNewPreCommitHook(): string {
    return `#!/bin/sh

# vibe-validate pre-commit check
${VIBE_VALIDATE_COMMAND}
`;
  }

  /**
   * Add vibe-validate command to existing pre-commit hook
   */
  private addCommandToPreCommit(content: string): string {
    // Ensure content ends with newline
    let updatedContent = content;
    if (!content.endsWith('\n')) {
      updatedContent += '\n';
    }

    // Add vibe-validate command
    updatedContent += `\n# vibe-validate pre-commit check\n${VIBE_VALIDATE_COMMAND}\n`;

    return updatedContent;
  }
}

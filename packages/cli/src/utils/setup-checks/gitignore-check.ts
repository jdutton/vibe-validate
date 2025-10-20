/**
 * Gitignore Setup Check
 *
 * Ensures that .vibe-validate-state.yaml is listed in .gitignore
 * to prevent committing validation state files.
 */

import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { splitLines } from '../normalize-line-endings.js';
import type {
  SetupCheck,
  CheckResult,
  FixResult,
  PreviewResult,
  FixOptions,
} from '../setup-engine.js';

const STATE_FILE_ENTRY = '.vibe-validate-state.yaml';

export class GitignoreSetupCheck implements SetupCheck {
  readonly id = 'gitignore';
  readonly name = 'Gitignore Setup';

  async check(options?: FixOptions): Promise<CheckResult> {
    const cwd = options?.cwd ?? process.cwd();
    const gitignorePath = join(cwd, '.gitignore');

    // Check if .gitignore exists
    if (!existsSync(gitignorePath)) {
      return {
        passed: false,
        message: '.gitignore not found',
        suggestion: `Create .gitignore and add ${STATE_FILE_ENTRY}`,
      };
    }

    // Read .gitignore content
    const content = await readFile(gitignorePath, 'utf-8');

    // Check if state file entry exists (with flexible whitespace)
    const hasEntry = splitLines(content)
      .some(line => line.trim() === STATE_FILE_ENTRY);

    if (!hasEntry) {
      return {
        passed: false,
        message: `.gitignore missing ${STATE_FILE_ENTRY} entry`,
        suggestion: `Add ${STATE_FILE_ENTRY} to .gitignore`,
      };
    }

    return {
      passed: true,
      message: '.gitignore correctly configured with state file entry',
    };
  }

  async preview(options?: FixOptions): Promise<PreviewResult> {
    const cwd = options?.cwd ?? process.cwd();
    const gitignorePath = join(cwd, '.gitignore');

    // Check current state
    const checkResult = await this.check(options);

    if (checkResult.passed) {
      return {
        description: '.gitignore already configured correctly',
        filesAffected: [],
        changes: [],
      };
    }

    // If .gitignore doesn't exist
    if (!existsSync(gitignorePath)) {
      const content = this.generateNewGitignoreContent();
      return {
        description: 'Create new .gitignore with vibe-validate state file entry',
        filesAffected: ['.gitignore'],
        changes: [
          {
            file: '.gitignore',
            action: 'create',
            content,
          },
        ],
      };
    }

    // If .gitignore exists but missing entry
    return {
      description: `Add ${STATE_FILE_ENTRY} entry to existing .gitignore`,
      filesAffected: ['.gitignore'],
      changes: [
        {
          file: '.gitignore',
          action: 'modify',
        },
      ],
    };
  }

  async fix(options?: FixOptions): Promise<FixResult> {
    const cwd = options?.cwd ?? process.cwd();
    const gitignorePath = join(cwd, '.gitignore');
    const dryRun = options?.dryRun ?? false;

    // Check current state
    const checkResult = await this.check(options);

    if (checkResult.passed && !options?.force) {
      return {
        success: true,
        message: '.gitignore already configured correctly',
        filesChanged: [],
      };
    }

    if (dryRun) {
      return {
        success: true,
        message: '[dry-run] Would update .gitignore',
        filesChanged: [],
      };
    }

    // If .gitignore doesn't exist, create it
    if (!existsSync(gitignorePath)) {
      const content = this.generateNewGitignoreContent();
      await writeFile(gitignorePath, content, 'utf-8');

      return {
        success: true,
        message: 'Created .gitignore with state file entry',
        filesChanged: ['.gitignore'],
      };
    }

    // If .gitignore exists, add entry if missing
    const content = await readFile(gitignorePath, 'utf-8');
    const hasEntry = splitLines(content)
      .some(line => line.trim() === STATE_FILE_ENTRY);

    if (hasEntry) {
      // Entry already exists (idempotent)
      return {
        success: true,
        message: '.gitignore already contains state file entry',
        filesChanged: [],
      };
    }

    // Add entry to existing .gitignore
    const updatedContent = this.addEntryToGitignore(content);
    await writeFile(gitignorePath, updatedContent, 'utf-8');

    return {
      success: true,
      message: `Added ${STATE_FILE_ENTRY} to .gitignore`,
      filesChanged: ['.gitignore'],
    };
  }

  /**
   * Generate content for a new .gitignore file
   */
  private generateNewGitignoreContent(): string {
    return `# vibe-validate
${STATE_FILE_ENTRY}
`;
  }

  /**
   * Add state file entry to existing .gitignore content
   */
  private addEntryToGitignore(content: string): string {
    // Ensure content ends with newline
    let updatedContent = content;
    if (!content.endsWith('\n')) {
      updatedContent += '\n';
    }

    // Add vibe-validate section
    updatedContent += `\n# vibe-validate\n${STATE_FILE_ENTRY}\n`;

    return updatedContent;
  }
}

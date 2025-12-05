#!/usr/bin/env node
/**
 * Uninstall vibe-validate skill from ~/.claude/skills/vibe-validate
 *
 * This script runs before `npm uninstall -g vibe-validate` to clean up the skill.
 */

import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

// Target location
const CLAUDE_SKILLS_DIR = join(homedir(), '.claude', 'skills', 'vibe-validate');

/**
 * Uninstall skill
 */
function uninstallSkill() {
  // Only uninstall for global installations
  // Check if we're in node_modules (global or local)
  const isGlobalInstall = process.cwd().includes('/lib/node_modules/');

  if (!isGlobalInstall) {
    // Local project installation - skip skill uninstall
    return;
  }

  try {
    if (existsSync(CLAUDE_SKILLS_DIR)) {
      console.log('🗑️  Removing vibe-validate skill from Claude Code...');
      rmSync(CLAUDE_SKILLS_DIR, { recursive: true, force: true });
      console.log(`✅ Skill removed from ${CLAUDE_SKILLS_DIR}`);
    }
  } catch (error) {
    console.error('⚠️  Failed to remove skill:', error.message);
    console.error(`   You can manually remove: ${CLAUDE_SKILLS_DIR}`);
  }
}

// Run uninstallation
uninstallSkill();

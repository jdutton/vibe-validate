#!/usr/bin/env node
/**
 * Install vibe-validate skill to ~/.claude/skills/vibe-validate
 *
 * This script runs after `npm install -g vibe-validate` to make the skill
 * available to Claude Code globally.
 */

import { copyFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Determine skill source location
const PACKAGE_ROOT = join(__dirname, '..');
const SKILL_SOURCE = join(PACKAGE_ROOT, '../../docs/skill');

// Target location
const CLAUDE_SKILLS_DIR = join(homedir(), '.claude', 'skills', 'vibe-validate');

/**
 * Recursively copy directory
 */
function copyDirectory(src, dest) {
  if (!existsSync(dest)) {
    mkdirSync(dest, { recursive: true });
  }

  const entries = readdirSync(src);

  for (const entry of entries) {
    const srcPath = join(src, entry);
    const destPath = join(dest, entry);

    if (statSync(srcPath).isDirectory()) {
      copyDirectory(srcPath, destPath);
    } else {
      copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * Install skill
 */
function installSkill() {
  // Only install if skill source exists
  if (!existsSync(SKILL_SOURCE)) {
    console.log('⚠️  Skill source not found, skipping installation');
    return;
  }

  // Only install for global installations
  // Check if we're in node_modules (global or local)
  const isGlobalInstall = __dirname.includes('/lib/node_modules/');

  if (!isGlobalInstall) {
    // Local project installation - skip skill install
    return;
  }

  try {
    console.log('📦 Installing vibe-validate skill to Claude Code...');

    // Create ~/.claude/skills directory if needed
    mkdirSync(dirname(CLAUDE_SKILLS_DIR), { recursive: true });

    // Copy skill files
    copyDirectory(SKILL_SOURCE, CLAUDE_SKILLS_DIR);

    console.log(`✅ Skill installed to ${CLAUDE_SKILLS_DIR}`);
    console.log('   Claude Code will automatically discover it on next launch');
  } catch (error) {
    console.error('⚠️  Failed to install skill:', error.message);
    console.error('   You can manually copy docs/skill/ to ~/.claude/skills/vibe-validate');
  }
}

// Run installation
installSkill();

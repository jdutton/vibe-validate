/**
 * Git notes recorder
 */

import type { ValidationResult } from '@vibe-validate/core';
import {
  getGitTreeHash,
  hasWorkingTreeChanges,
  getCurrentBranch as getGitBranch,
  getHeadCommitSha,
  addNote,
  type NotesRef,
  type TreeHashResult,
} from '@vibe-validate/git';
import { stringify as stringifyYaml } from 'yaml';

import { truncateValidationOutput } from './truncate.js';
import type {
  ValidationRun,
  HistoryNote,
  RecordResult,
  StabilityCheck,
  HistoryConfig,
} from './types.js';
import { DEFAULT_HISTORY_CONFIG } from './types.js';

/**
 * Get current branch name
 *
 * @returns Branch name or 'detached' if in detached HEAD state
 */
async function getCurrentBranch(): Promise<string> {
  try {
    const branch = getGitBranch();
    return branch === 'HEAD' ? 'detached' : branch;
  } catch {
    return 'unknown';
  }
}

/**
 * Get HEAD commit SHA
 *
 * @returns Commit SHA or 'none' if no commits
 */
async function getHeadCommit(): Promise<string> {
  try {
    return getHeadCommitSha();
  } catch {
    return 'none';
  }
}

/**
 * Record validation result to git notes
 *
 * @param treeHashResult - Git tree hash result with components
 * @param result - Validation result
 * @param config - History configuration
 * @returns Record result
 */
export async function recordValidationHistory(
  treeHashResult: TreeHashResult,
  result: ValidationResult,
  config: HistoryConfig = {}
): Promise<RecordResult> {
  const mergedConfig = {
    ...DEFAULT_HISTORY_CONFIG,
    ...config,
    gitNotes: {
      ...DEFAULT_HISTORY_CONFIG.gitNotes,
      ...config.gitNotes,
    },
    retention: {
      ...DEFAULT_HISTORY_CONFIG.retention,
      ...config.retention,
    },
  };

  // Type assertions safe: DEFAULT_HISTORY_CONFIG is Required<HistoryConfig>
  const notesRef = (mergedConfig.gitNotes.ref ?? DEFAULT_HISTORY_CONFIG.gitNotes.ref) as NotesRef;
  const maxOutputBytes = (mergedConfig.gitNotes.maxOutputBytes ?? DEFAULT_HISTORY_CONFIG.gitNotes.maxOutputBytes);

  try {
    // 1. Create new run entry
    const newRun: ValidationRun = {
      id: `run-${Date.now()}`,
      timestamp: new Date().toISOString(),
      duration: 0, // Will be calculated from result if available
      passed: result.passed,
      branch: await getCurrentBranch(),
      headCommit: await getHeadCommit(),
      uncommittedChanges: await hasWorkingTreeChanges(),
      result: truncateValidationOutput(result, maxOutputBytes),
      submoduleHashes: treeHashResult.submoduleHashes,
    };

    // Calculate duration from result phases if available (convert to milliseconds)
    if (result.phases && result.phases.length > 0) {
      newRun.duration = result.phases.reduce(
        (total, phase) => total + phase.durationSecs * 1000,
        0
      );
    }

    // 2. Create note with ONLY the new run
    // The addNote function will handle merging with existing runs atomically
    const note: HistoryNote = {
      treeHash: treeHashResult.hash,
      runs: [newRun],
    };

    // 3. Add note to git using optimistic locking (prevents data loss in concurrent writes)
    // addNote will merge this with existing runs and handle pruning atomically
    const noteContent = stringifyYaml(note);
    const success = addNote(notesRef, treeHashResult.hash, noteContent, false);

    if (!success) {
      return {
        recorded: false,
        reason: 'Failed to add git note',
        treeHash: treeHashResult.hash,
      };
    }

    return {
      recorded: true,
      treeHash: treeHashResult.hash,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      recorded: false,
      reason: errorMessage,
      treeHash: treeHashResult.hash,
    };
  }
}

/**
 * Check worktree stability (compare tree hash before and after)
 *
 * @param treeHashBefore - Tree hash before validation
 * @returns Stability check result
 */
export async function checkWorktreeStability(
  treeHashBefore: string
): Promise<StabilityCheck> {
  const treeHashResult = await getGitTreeHash();
  const treeHashAfter = treeHashResult.hash;

  return {
    stable: treeHashBefore === treeHashAfter,
    treeHashBefore,
    treeHashAfter,
  };
}

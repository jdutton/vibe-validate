/**
 * Git notes recorder
 */

import { execSync } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stringify as stringifyYaml } from 'yaml';
import { getGitTreeHash, hasWorkingTreeChanges } from '@vibe-validate/git';
import type { ValidationResult } from '@vibe-validate/core';
import type {
  ValidationRun,
  HistoryNote,
  RecordResult,
  StabilityCheck,
  HistoryConfig,
} from './types.js';
import { DEFAULT_HISTORY_CONFIG } from './types.js';
import { truncateValidationOutput } from './truncate.js';
import { readHistoryNote } from './reader.js';

const GIT_TIMEOUT = 30000;
const GIT_OPTIONS = {
  encoding: 'utf8' as const,
  timeout: GIT_TIMEOUT,
  stdio: ['pipe', 'pipe', 'ignore'] as ['pipe', 'pipe', 'ignore'],
};

/**
 * Get current branch name
 *
 * @returns Branch name or 'detached' if in detached HEAD state
 */
async function getCurrentBranch(): Promise<string> {
  try {
    const branch = execSync('git rev-parse --abbrev-ref HEAD', GIT_OPTIONS).trim();
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
    return execSync('git rev-parse HEAD', GIT_OPTIONS).trim();
  } catch {
    return 'none';
  }
}

/**
 * Record validation result to git notes
 *
 * @param treeHash - Git tree hash
 * @param result - Validation result
 * @param config - History configuration
 * @returns Record result
 */
export async function recordValidationHistory(
  treeHash: string,
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
  const notesRef = (mergedConfig.gitNotes.ref ?? DEFAULT_HISTORY_CONFIG.gitNotes.ref) as string;
  const maxRunsPerTree = (mergedConfig.gitNotes.maxRunsPerTree ?? DEFAULT_HISTORY_CONFIG.gitNotes.maxRunsPerTree) as number;
  const maxOutputBytes = (mergedConfig.gitNotes.maxOutputBytes ?? DEFAULT_HISTORY_CONFIG.gitNotes.maxOutputBytes) as number;

  try {
    // 1. Read existing note (if any)
    const existingNote = await readHistoryNote(treeHash, notesRef);

    // 2. Create new run entry
    const newRun: ValidationRun = {
      id: `run-${Date.now()}`,
      timestamp: new Date().toISOString(),
      duration: 0, // Will be calculated from result if available
      passed: result.passed,
      branch: await getCurrentBranch(),
      headCommit: await getHeadCommit(),
      uncommittedChanges: await hasWorkingTreeChanges(),
      result: truncateValidationOutput(result, maxOutputBytes),
    };

    // Calculate duration from result phases if available (convert to milliseconds)
    if (result.phases && result.phases.length > 0) {
      newRun.duration = result.phases.reduce(
        (total, phase) => total + phase.durationSecs * 1000,
        0
      );
    }

    // 3. Append or create
    let note: HistoryNote;
    if (existingNote) {
      note = {
        ...existingNote,
        runs: [...existingNote.runs, newRun],
      };

      // Prune: keep last N runs
      if (note.runs.length > maxRunsPerTree) {
        note.runs = note.runs.slice(-maxRunsPerTree);
      }
    } else {
      note = {
        treeHash,
        runs: [newRun],
      };
    }

    // 4. Write note to temp file (use cross-platform temp directory)
    const tempFile = join(tmpdir(), `note.vibe-validate.${treeHash.slice(0, 12)}.${process.pid}.yaml`);

    try {
      writeFileSync(tempFile, stringifyYaml(note), 'utf8');

      // 5. Add note to git (force overwrite)
      execSync(
        `git notes --ref=${notesRef} add -f -F "${tempFile}" ${treeHash}`,
        { ...GIT_OPTIONS, stdio: 'ignore' }
      );

      return {
        recorded: true,
        treeHash,
      };
    } finally {
      // Cleanup temp file
      try {
        unlinkSync(tempFile);
      } catch {
        // Ignore cleanup errors
      }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      recorded: false,
      reason: errorMessage,
      treeHash,
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
  const treeHashAfter = await getGitTreeHash();

  return {
    stable: treeHashBefore === treeHashAfter,
    treeHashBefore,
    treeHashAfter,
  };
}

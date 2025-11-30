/**
 * @vibe-validate/git
 *
 * Git utilities for vibe-validate - deterministic tree hash calculation,
 * branch synchronization, and post-merge cleanup.
 *
 * @packageDocumentation
 */

// Tree hash calculation (deterministic, content-based)
export {
  getGitTreeHash,
  getHeadTreeHash,
  hasWorkingTreeChanges
} from './tree-hash.js';

// Branch sync checking (safe, no auto-merge)
export {
  BranchSyncChecker,
  checkBranchSync,
  type SyncCheckResult,
  type SyncCheckOptions
} from './branch-sync.js';

// Post-merge cleanup (delete merged branches)
export {
  PostPRMergeCleanup,
  cleanupMergedBranches,
  type CleanupResult,
  type CleanupOptions
} from './post-merge-cleanup.js';

// Cache key encoding for run command
export {
  encodeRunCacheKey
} from './cache-key.js';

// YAML output detection
export {
  extractYamlContent,
  extractYamlWithPreamble
} from './yaml-detection.js';

// Git command utilities (standardized rev-parse operations)
export {
  isGitRepository,
  getGitDir,
  getRepositoryRoot,
  getCurrentBranch,
  getHeadCommitSha,
  getHeadTreeSha,
  verifyRef,
  verifyRefOrThrow,
  hasNotesRef
} from './git-commands.js';

// Secure git command execution (low-level - use high-level APIs when possible)
export {
  executeGitCommand,
  execGitCommand,
  tryGitCommand,
  validateGitRef,
  validateNotesRef,
  validateTreeHash,
  type GitExecutionOptions,
  type GitExecutionResult
} from './git-executor.js';

// Git notes operations (high-level abstraction)
export {
  addNote,
  readNote,
  removeNote,
  listNotes,
  hasNote,
  listNotesRefs,
  removeNotesRefs,
  getNotesRefSha
} from './git-notes.js';

// Git staging detection (prevent partially staged files in pre-commit)
export {
  getPartiallyStagedFiles
} from './staging.js';

// Git tracking branch detection (check if current branch is behind remote)
export {
  isCurrentBranchBehindTracking
} from './tracking-branch.js';

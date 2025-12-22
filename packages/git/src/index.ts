/**
 * @vibe-validate/git
 *
 * Git utilities for vibe-validate - deterministic tree hash calculation,
 * branch synchronization, and post-merge cleanup.
 *
 * @packageDocumentation
 */

// Branded types for git objects (compile-time safety)
export type { TreeHash, CommitSha, NotesRef } from './types.js';

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
  getRemoteUrl,
  getHeadCommitSha,
  getHeadTreeSha,
  verifyRef,
  verifyRefOrThrow,
  hasNotesRef,
  isMergeInProgress,
  getDiffStats,
  getCommitCount,
  getNotesRefs
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

// GitHub CLI commands (centralized gh command execution)
export {
  fetchPRDetails,
  fetchPRChecks,
  getCurrentPR,
  listPullRequests,
  fetchRunLogs,
  fetchRunDetails,
  listWorkflowRuns,
  type GitHubPullRequest,
  type GitHubRun
} from './gh-commands.js';

// Branch cleanup analysis (identify safe-to-delete branches)
export {
  detectDefaultBranch,
  isProtectedBranch,
  isAutoDeleteSafe,
  needsReview,
  shouldShowBranch,
  gatherBranchGitFacts,
  setupCleanupContext,
  parseRemoteTracking,
  getUnpushedCommitCount,
  detectMergeMethod,
  fetchPRDataForBranches,
  enrichWithGitHubData,
  cleanupBranches,
  type RemoteStatus,
  type BranchGitFacts,
  type BranchGitHubFacts,
  type BranchAssessment,
  type BranchAnalysis,
  type CleanupContext
} from './branch-cleanup.js';

// Re-export CleanupResult from new branch-cleanup as BranchCleanupResult to avoid conflict
export type { CleanupResult as BranchCleanupResult } from './branch-cleanup.js';

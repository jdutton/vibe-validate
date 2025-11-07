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

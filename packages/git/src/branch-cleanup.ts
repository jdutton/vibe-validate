/**
 * Branch Cleanup - Core Analysis Functions
 *
 * Git-aware branch cleanup that safely identifies and removes merged branches.
 * This module provides the core analysis functionality for determining which
 * branches are safe to delete automatically and which need manual review.
 *
 * Safety principles:
 * 1. NEVER delete branches with unpushed work
 * 2. Auto-delete only if 100% safe (merged + no unpushed commits)
 * 3. All deletions are recoverable via reflog
 * 4. Never touch protected branches (main/master/develop)
 *
 * @packageDocumentation
 */

import { isToolAvailable } from '@vibe-validate/utils';

import { listPullRequests, fetchPRDetails, type GitHubPullRequest } from './gh-commands.js';
import { getCurrentBranch } from './git-commands.js';
import { execGitCommand, tryGitCommand } from './git-executor.js';

/**
 * Remote tracking status for a branch
 */
export type RemoteStatus = 'exists' | 'deleted' | 'never_pushed';

/**
 * Git metadata about a branch
 */
export interface BranchGitFacts {
  /** Branch name */
  name: string;
  /** Is branch merged to default branch */
  mergedToMain: boolean;
  /** Remote tracking status */
  remoteStatus: RemoteStatus;
  /** Number of unpushed commits */
  unpushedCommitCount: number;
  /** Last commit date (ISO 8601) */
  lastCommitDate: string;
  /** Last commit author */
  lastCommitAuthor: string;
  /** Days since last activity */
  daysSinceActivity: number;
}

/**
 * GitHub metadata about a branch (from PR data)
 */
export interface BranchGitHubFacts {
  /** Associated PR number */
  prNumber?: number;
  /** PR state (open, closed, merged) */
  prState?: 'open' | 'closed' | 'merged';
  /** Merge method used */
  mergeMethod?: 'merge' | 'squash' | 'rebase';
  /** When PR was merged */
  mergedAt?: string;
  /** Who merged the PR */
  mergedBy?: string;
}

/**
 * Assessment and action commands for a branch
 */
export interface BranchAssessment {
  /** Human-readable assessment */
  summary: string;
  /** Exact command to delete branch */
  deleteCommand: string;
  /** Command to recover branch after deletion */
  recoveryCommand: string;
}

/**
 * Complete analysis of a branch
 */
export interface BranchAnalysis {
  /** Git facts about the branch */
  gitFacts: BranchGitFacts;
  /** GitHub facts (if available) */
  githubFacts?: BranchGitHubFacts;
  /** Assessment and commands */
  assessment: BranchAssessment;
}

/**
 * Context about the cleanup operation
 */
export interface CleanupContext {
  /** Repository name (owner/repo) */
  repository: string;
  /** Remote name (usually 'origin') */
  remote: string;
  /** Default branch name (main/master/develop) */
  defaultBranch: string;
  /** Branch we were on before switching */
  previousBranch?: string;
  /** Current branch after potential switch */
  currentBranch: string;
  /** Did we switch branches during cleanup? */
  switchedBranch: boolean;
  /** Why we switched (if applicable) */
  switchReason?: string;
}

/**
 * Detect the repository's default branch
 *
 * Tries multiple methods in order of reliability:
 * 1. Remote HEAD symbolic ref (most reliable)
 * 2. Git config init.defaultBranch
 * 3. Fallback to 'main'
 *
 * @param options - Options for detection
 * @returns Default branch name
 * @throws Error if throwOnError is true and detection fails
 */
export function detectDefaultBranch(options: { throwOnError?: boolean } = {}): string {
  const { throwOnError = false } = options;

  try {
    // Try remote HEAD symbolic ref first (most reliable)
    const symbolicRef = execGitCommand(['symbolic-ref', 'refs/remotes/origin/HEAD']);
    const regex = /refs\/heads\/(.+)$/;
    const match = regex.exec(symbolicRef);
    if (match) {
      return match[1];
    }
  } catch {
    // Fall through to next method
  }

  try {
    // Try git config
    const configBranch = execGitCommand(['config', '--get', 'init.defaultBranch']);
    if (configBranch) {
      // Remove refs/heads/ prefix if present
      return configBranch.replace(/^refs\/heads\//, '');
    }
  } catch {
    // Fall through to fallback
  }

  // Check if we should throw or use fallback
  if (throwOnError && !tryGitCommand(['rev-parse', '--verify', 'main'])) {
    throw new Error('Unable to detect default branch');
  }

  // Last resort fallback
  return 'main';
}

/**
 * Check if a branch is protected (should never be deleted)
 *
 * @param name - Branch name
 * @param defaultBranch - Default branch name
 * @returns true if branch is protected
 */
export function isProtectedBranch(name: string, defaultBranch: string): boolean {
  const protectedBranches = ['main', 'master', 'develop', defaultBranch];
  return protectedBranches.includes(name);
}

/**
 * Parse remote tracking status from git branch -vv output
 *
 * @param branchVerbose - Output from git branch -vv
 * @returns Remote status and ref
 */
export function parseRemoteTracking(branchVerbose: string): {
  remoteStatus: RemoteStatus;
  remoteRef: string | null;
} {
  // Extract tracking ref from git branch -vv format
  // Format: "* branch-name  abc1234 [origin/branch-name: ahead 2] Commit message"
  // Use non-backtracking character class to avoid catastrophic backtracking
  // eslint-disable-next-line sonarjs/slow-regex
  const trackingRegex = /\[([^\]]*)\]/;
  const trackingMatch = trackingRegex.exec(branchVerbose);

  if (!trackingMatch) {
    return { remoteStatus: 'never_pushed', remoteRef: null };
  }

  const trackingInfo = trackingMatch[1];
  const remoteRef = trackingInfo.split(':')[0].trim();

  return { remoteStatus: 'exists', remoteRef };
}

/**
 * Get unpushed commit count for a branch
 *
 * @param branch - Branch name
 * @param remoteRef - Remote ref (e.g., 'origin/feature/test')
 * @returns Number of unpushed commits
 */
export function getUnpushedCommitCount(branch: string, remoteRef: string | null): number {
  if (!remoteRef) {
    return 0;
  }

  try {
    const count = execGitCommand(['rev-list', '--count', `${remoteRef}..${branch}`]);
    return Number.parseInt(count, 10) || 0;
  } catch {
    return 0;
  }
}

/**
 * Gather git facts about a branch
 *
 * @param branch - Branch name
 * @param _defaultBranch - Default branch name (reserved for future use)
 * @param mergedBranches - Set of branch names that are merged to main
 * @returns Git facts about the branch
 */
export async function gatherBranchGitFacts(
  branch: string,
  _defaultBranch: string,
  mergedBranches: Set<string>
): Promise<BranchGitFacts> {
  // Check if merged to main
  const mergedToMain = mergedBranches.has(branch);

  // Get remote tracking status
  let remoteStatus: 'exists' | 'deleted' | 'never_pushed' = 'never_pushed';
  let remoteRef: string | null = null;

  try {
    // Check for tracking ref
    const trackingRef = execGitCommand(['config', '--get', `branch.${branch}.merge`]);
    if (trackingRef) {
      // Extract branch name from refs/heads/xxx
      const remoteBranch = trackingRef.replace('refs/heads/', '');
      const remote = execGitCommand(['config', '--get', `branch.${branch}.remote`]) || 'origin';
      remoteRef = `${remote}/${remoteBranch}`;

      // Check if remote ref exists
      try {
        execGitCommand(['rev-parse', '--verify', `refs/remotes/${remoteRef}`]);
        remoteStatus = 'exists';
      } catch {
        remoteStatus = 'deleted';
      }
    }
  } catch {
    remoteStatus = 'never_pushed';
  }

  // Get unpushed commit count
  const unpushedCommitCount = getUnpushedCommitCount(branch, remoteRef);

  // Get commit info
  const commitInfo = execGitCommand([
    'log',
    '-1',
    '--format=%aI%n%an',
    branch,
  ]);

  const [lastCommitDate, lastCommitAuthor] = commitInfo.split('\n');

  // Calculate days since activity
  const commitDate = new Date(lastCommitDate);
  const now = new Date();
  const daysSinceActivity = Math.floor(
    (now.getTime() - commitDate.getTime()) / (1000 * 60 * 60 * 24)
  );

  return {
    name: branch,
    mergedToMain,
    remoteStatus,
    unpushedCommitCount,
    lastCommitDate,
    lastCommitAuthor,
    daysSinceActivity,
  };
}

/**
 * Determine if a branch is 100% safe to auto-delete
 *
 * A branch is auto-delete safe if:
 * - Merged to main (detected by git)
 * - Zero unpushed commits
 * - Even if deleted, it's recoverable via reflog
 *
 * @param facts - Git facts about the branch
 * @returns true if safe to auto-delete
 */
export function isAutoDeleteSafe(facts: BranchGitFacts): boolean {
  // Must be merged to main
  if (!facts.mergedToMain) {
    return false;
  }

  // Must have no unpushed work
  if (facts.unpushedCommitCount > 0) {
    return false;
  }

  return true;
}

/**
 * Determine if a branch needs manual review before deletion
 *
 * A branch needs review if:
 * - Not merged (could be squash/rebase merged)
 * - Zero unpushed commits (safe from data loss)
 * - Remote deleted OR >30 days old
 * - NOT if has open PR (obviously keep)
 * - NOT if has unpushed work (obviously keep)
 *
 * @param facts - Git facts about the branch
 * @param githubFacts - GitHub facts (used to check PR state)
 * @returns true if needs manual review
 */
export function needsReview(facts: BranchGitFacts, githubFacts?: BranchGitHubFacts): boolean {
  // Never review branches with unpushed work
  if (facts.unpushedCommitCount > 0) {
    return false;
  }

  // Never review if PR is still open (obviously keep)
  if (githubFacts?.prState === 'open') {
    return false;
  }

  // Never review active branches (< 30 days)
  if (facts.daysSinceActivity < 30) {
    return false;
  }

  // Don't review if already auto-delete safe
  if (facts.mergedToMain) {
    return false;
  }

  // Review if PR was merged and remote deleted (squash merge pattern)
  if (githubFacts?.prState === 'merged' && facts.remoteStatus === 'deleted') {
    return true;
  }

  // Review if remote deleted (likely squash merged, even without PR data)
  if (facts.remoteStatus === 'deleted') {
    return true;
  }

  // Review if old and never pushed (abandoned local work)
  if (facts.remoteStatus === 'never_pushed' && facts.daysSinceActivity >= 90) {
    return true;
  }

  return false;
}

/**
 * Determine if a branch should be shown in output
 *
 * @param analysis - Branch analysis
 * @returns true if should be shown
 */
export function shouldShowBranch(analysis: BranchAnalysis): boolean {
  // Never show branches with unpushed work
  if (analysis.gitFacts.unpushedCommitCount > 0) {
    return false;
  }

  // Show if auto-delete safe or needs review
  return isAutoDeleteSafe(analysis.gitFacts) || needsReview(analysis.gitFacts, analysis.githubFacts);
}

/**
 * Detect merge method from PR data
 *
 * Analyzes PR metadata to determine how it was merged:
 * - Squash: merge commit exists but PR has multiple commits
 * - Merge: merge commit with multiple parents (true merge)
 * - Rebase: commits were rebased onto target branch
 *
 * @param pr - Pull request data
 * @returns Merge method or undefined if cannot determine
 */
export function detectMergeMethod(pr: GitHubPullRequest): 'merge' | 'squash' | 'rebase' | undefined {
  // If no merge commit, can't determine
  if (!pr.mergeCommit?.oid) {
    return undefined;
  }

  // Squash merge: merge commit exists but PR had multiple commits
  // The merge commit will have only 1 parent (squashed into single commit)
  if (pr.commits?.totalCount && pr.commits.totalCount > 1 && pr.mergeCommit.parents?.[0]?.totalCount === 1) {
    return 'squash';
  }

  // True merge: merge commit has 2+ parents
  if (pr.mergeCommit.parents?.[0]?.totalCount && pr.mergeCommit.parents[0].totalCount >= 2) {
    return 'merge';
  }

  // Rebase merge: merge commit exists but is not a true merge commit
  // This is harder to detect reliably, so we use this as fallback
  return 'rebase';
}

/**
 * Fetch PR data for a list of branches
 *
 * Efficiently batch-fetches merged PRs from GitHub and creates a map
 * of branch name → PR data for quick lookups during enrichment.
 *
 * @param repository - Repository in owner/repo format
 * @param _branches - Branch names (reserved for future filtering)
 * @returns Map of branch name → PR data
 * @throws Error if gh CLI is not available
 */
export async function fetchPRDataForBranches(
  repository: string,
  _branches: string[]
): Promise<Map<string, GitHubPullRequest>> {
  // Check gh CLI availability (hard requirement)
  if (!isToolAvailable('gh')) {
    throw new Error('GitHub CLI (gh) is required for branch cleanup. Install: https://cli.github.com/');
  }

  const prMap = new Map<string, GitHubPullRequest>();

  try {
    // Parse repository
    // eslint-disable-next-line local/no-hardcoded-path-split -- GitHub repo format (owner/repo), not a file path
    const [owner, repo] = repository.split('/');
    if (!owner || !repo) {
      throw new Error(`Invalid repository format: ${repository}. Expected: owner/repo`);
    }

    // Fetch recent merged PRs (batch operation)
    // Note: 'commits' field excluded to avoid GitHub GraphQL node limit (would exceed 500k nodes for 100 PRs)
    // We fetch commits per-PR in the next step via fetchPRDetails()
    const mergedPRs = listPullRequests(
      owner,
      repo,
      20, // Last 20 merged PRs covers most cleanup scenarios (most repos have <20 local branches)
      ['number', 'title', 'headRefName', 'baseRefName', 'state', 'mergedAt', 'mergedBy'],
      'merged'
    );

    // Process PRs in parallel batches with early termination
    // Stop once we've found PRs for all local branches
    const localBranchSet = new Set(_branches);
    const BATCH_SIZE = 5; // Parallel requests per batch

    for (let i = 0; i < mergedPRs.length; i += BATCH_SIZE) {
      // Early termination: stop if we've found all local branches
      if (prMap.size >= localBranchSet.size) {
        break;
      }

      // Process batch in parallel
      const batch = mergedPRs.slice(i, i + BATCH_SIZE);
      const results = await Promise.allSettled(
        batch.map(async pr =>
          fetchPRDetails(pr.number, owner, repo, [
            'number',
            'headRefName',
            'state',
            'mergedAt',
            'mergedBy',
            'mergeCommit',
            'commits',
          ])
        )
      );

      // Add results to map
      for (const [index, result] of results.entries()) {
        const pr = batch[index];
        if (result.status === 'fulfilled') {
          prMap.set(result.value.headRefName, result.value);
        } else {
          // If individual PR fetch fails, use basic data
          prMap.set(pr.headRefName, pr);
        }
      }
    }

    return prMap;
  } catch (error) {
    // Re-throw with context
    if (error instanceof Error) {
      throw new Error(`Failed to fetch PR data: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Enrich branch analyses with GitHub PR data
 *
 * Populates the githubFacts field in each analysis by matching branches
 * to merged PRs. This helps identify squash-merged branches that git
 * doesn't recognize as merged.
 *
 * @param analyses - Branch analyses to enrich
 * @param repository - Repository in owner/repo format
 * @throws Error if gh CLI is not available
 */
export async function enrichWithGitHubData(
  analyses: BranchAnalysis[],
  repository: string
): Promise<void> {
  // Extract branch names
  const branchNames = analyses.map(a => a.gitFacts.name);

  // Fetch PR data (throws if gh not available)
  const prMap = await fetchPRDataForBranches(repository, branchNames);

  // Enrich each analysis
  for (const analysis of analyses) {
    const pr = prMap.get(analysis.gitFacts.name);

    if (pr) {
      // Normalize state to lowercase for consistency
      const prState = pr.state?.toLowerCase() as 'open' | 'closed' | 'merged' | undefined;

      analysis.githubFacts = {
        prNumber: pr.number,
        prState,
        mergeMethod: detectMergeMethod(pr),
        mergedAt: pr.mergedAt,
        mergedBy: pr.mergedBy?.login,
      };
    }
  }
}

/**
 * Result of branch cleanup operation
 */
export interface CleanupResult {
  /** Context about the cleanup operation */
  context: CleanupContext;
  /** Branches that were auto-deleted */
  autoDeleted: Array<{
    name: string;
    reason: string;
    recoveryCommand: string;
  }>;
  /** Branches that need manual review */
  needsReview: Array<{
    name: string;
    verification: BranchGitFacts & Partial<BranchGitHubFacts>;
    assessment: string;
    deleteCommand: string;
    recoveryCommand: string;
  }>;
  /** Summary statistics */
  summary: {
    autoDeletedCount: number;
    needsReviewCount: number;
    totalBranchesAnalyzed: number;
  };
  /** Recovery information */
  recoveryInfo: string;
}

/**
 * Setup cleanup context and handle current branch switching
 *
 * If we're on a branch that needs cleanup, switch to default branch first.
 *
 * @returns Cleanup context
 */
export async function setupCleanupContext(): Promise<CleanupContext> {
  const currentBranch = getCurrentBranch();
  const defaultBranch = detectDefaultBranch();
  const remote = 'origin'; // Currently hardcoded, will be configurable in future

  // Get repository name
  let repository = 'unknown/unknown';
  try {
    const remoteUrl = execGitCommand(['remote', 'get-url', remote]);
    // Match owner/repo pattern from SSH (git@github.com:owner/repo) or HTTPS (https://github.com/owner/repo)
    // Match after last ':' or after last '/' in the path
    const repoRegex = /[:/]([^/:]+\/[^/]+?)(?:\.git)?$/;
    const match = repoRegex.exec(remoteUrl);
    if (match) {
      repository = match[1];
    }
  } catch {
    // Keep default
  }

  const context: CleanupContext = {
    repository,
    remote,
    defaultBranch,
    currentBranch,
    switchedBranch: false,
  };

  // If already on default branch, nothing to do
  if (currentBranch === defaultBranch) {
    return context;
  }

  // Check if current branch needs cleanup
  const mergedBranches = new Set(
    execGitCommand(['branch', '--merged', defaultBranch])
      .split('\n')
      .map(b => b.trim().replace(/^\*\s+/, ''))
      .filter(Boolean)
  );

  const currentBranchFacts = await gatherBranchGitFacts(currentBranch, defaultBranch, mergedBranches);

  // Decide if we need to switch
  let shouldSwitch = false;
  let switchReason: string | undefined;

  if (isAutoDeleteSafe(currentBranchFacts)) {
    shouldSwitch = true;
    switchReason = 'current branch is auto-delete safe';
  } else if (needsReview(currentBranchFacts)) {
    shouldSwitch = true;
    switchReason = 'current branch needs review';
  }

  if (shouldSwitch) {
    // Switch to default branch
    execGitCommand(['checkout', defaultBranch]);

    context.previousBranch = currentBranch;
    context.currentBranch = defaultBranch;
    context.switchedBranch = true;
    context.switchReason = switchReason;
  }

  return context;
}

/**
 * Generate assessment text for a branch needing review
 */
export function generateAssessment(gitFacts: BranchGitFacts, githubFacts?: BranchGitHubFacts): string {
  if (gitFacts.remoteStatus === 'deleted') {
    return generateDeletedRemoteAssessment(gitFacts, githubFacts);
  }

  if (gitFacts.remoteStatus === 'never_pushed' && gitFacts.daysSinceActivity >= 90) {
    return `Old abandoned branch (${gitFacts.daysSinceActivity} days)\nNever pushed to remote\nNo unpushed commits (safe to delete)`;
  }

  return 'Needs manual review';
}

/**
 * Generate assessment for branch with deleted remote
 */
export function generateDeletedRemoteAssessment(
  gitFacts: BranchGitFacts,
  githubFacts?: BranchGitHubFacts
): string {
  let text = 'Remote deleted by GitHub\n';

  if (githubFacts?.prNumber) {
    text += `PR #${githubFacts.prNumber} ${githubFacts.prState ?? 'unknown'} ${gitFacts.daysSinceActivity} days ago`;
    if (githubFacts.mergedBy) {
      text += ` by ${githubFacts.mergedBy}`;
    }
    text += '\n';

    if (githubFacts.mergeMethod) {
      text += `${githubFacts.mergeMethod} merge explains why git branch --merged returned false\n`;
    }
  }

  text += 'No unpushed commits (safe to delete)';
  return text;
}

/**
 * Try to delete a safe branch and return result
 */
export function tryDeleteBranch(gitFacts: BranchGitFacts): { deleted: boolean; error?: string } {
  try {
    execGitCommand(['branch', '-d', gitFacts.name]);
    return { deleted: true };
  } catch (error) {
    return {
      deleted: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Categorize branches into auto-delete and needs-review
 */
export function categorizeBranches(
  analyses: BranchAnalysis[]
): {
  autoDeleted: CleanupResult['autoDeleted'];
  needsReview: CleanupResult['needsReview'];
} {
  const autoDeleted: CleanupResult['autoDeleted'] = [];
  const branchesNeedingReview: CleanupResult['needsReview'] = [];

  for (const analysis of analyses) {
    const { gitFacts, githubFacts, assessment } = analysis;

    if (isAutoDeleteSafe(gitFacts)) {
      const result = tryDeleteBranch(gitFacts);

      if (result.deleted) {
        autoDeleted.push({
          name: gitFacts.name,
          reason: 'merged_to_main',
          recoveryCommand: assessment.recoveryCommand,
        });
      } else {
        branchesNeedingReview.push({
          name: gitFacts.name,
          verification: { ...gitFacts, ...githubFacts },
          assessment: `Failed to delete: ${result.error ?? 'Unknown error'}`,
          deleteCommand: assessment.deleteCommand,
          recoveryCommand: assessment.recoveryCommand,
        });
      }
    } else if (needsReview(gitFacts, githubFacts)) {
      branchesNeedingReview.push({
        name: gitFacts.name,
        verification: { ...gitFacts, ...githubFacts },
        assessment: generateAssessment(gitFacts, githubFacts),
        deleteCommand: assessment.deleteCommand,
        recoveryCommand: assessment.recoveryCommand,
      });
    }
  }

  return { autoDeleted, needsReview: branchesNeedingReview };
}

/**
 * Perform comprehensive branch cleanup
 *
 * This is the main entry point for branch cleanup. It:
 * 1. Sets up context and switches branches if needed
 * 2. Gathers all local branches
 * 3. Analyzes each branch (git facts + GitHub enrichment)
 * 4. Categorizes branches (auto-delete vs needs-review)
 * 5. Deletes safe branches
 * 6. Returns structured result with YAML-compatible format
 *
 * @returns Cleanup result with detailed analysis
 */
export async function cleanupBranches(): Promise<CleanupResult> {
  // Step 1: Setup context (may switch branches)
  const context = await setupCleanupContext();

  // Step 2: Get all local branches (excluding protected)
  const allBranches = execGitCommand(['branch', '--format=%(refname:short)'])
    .split('\n')
    .map(b => b.trim())
    .filter(Boolean)
    .filter(b => !isProtectedBranch(b, context.defaultBranch));

  // Step 3: Get merged branches list (for efficient lookup)
  const mergedBranches = new Set(
    execGitCommand(['branch', '--merged', context.defaultBranch])
      .split('\n')
      .map(b => b.trim().replace(/^\*\s+/, ''))
      .filter(Boolean)
  );

  // Step 4: Analyze all branches (gather git facts)
  const analyses: BranchAnalysis[] = [];
  for (const branch of allBranches) {
    const gitFacts = await gatherBranchGitFacts(branch, context.defaultBranch, mergedBranches);

    analyses.push({
      gitFacts,
      assessment: {
        summary: '',
        deleteCommand: `git branch -D ${branch}`,
        recoveryCommand: `git reflog | grep '${branch}' | head -1`,
      },
    });
  }

  // Step 5: Enrich with GitHub data (throws if gh not available)
  await enrichWithGitHubData(analyses, context.repository);

  // Step 6: Categorize and delete safe branches
  const { autoDeleted, needsReview } = categorizeBranches(analyses);

  // Step 7: Build result
  return {
    context,
    autoDeleted,
    needsReview,
    summary: {
      autoDeletedCount: autoDeleted.length,
      needsReviewCount: needsReview.length,
      totalBranchesAnalyzed: analyses.length,
    },
    recoveryInfo:
      'Deleted branches are recoverable for 30 days via git reflog:\n' +
      '  git reflog\n' +
      '  git checkout -b <branch-name> <SHA>',
  };
}

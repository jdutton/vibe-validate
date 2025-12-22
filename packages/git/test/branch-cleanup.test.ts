/**
 * Tests for Branch Cleanup Functionality
 *
 * Tests the branch cleanup logic that safely identifies and removes merged branches.
 * Phase 2 (TDD): Make the tests pass by implementing the functions.
 *
 * Critical safety requirement: NO branches with unpushed work are ever deleted.
 */

import * as utils from '@vibe-validate/utils';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  detectDefaultBranch,
  isAutoDeleteSafe,
  needsReview,
  isProtectedBranch,
  detectMergeMethod,
  fetchPRDataForBranches,
  enrichWithGitHubData,
  setupCleanupContext,
  parseRemoteTracking,
  getUnpushedCommitCount,
  gatherBranchGitFacts,
  shouldShowBranch,
  generateAssessment,
  generateDeletedRemoteAssessment,
  tryDeleteBranch,
  categorizeBranches,
  type BranchGitFacts,
  type BranchGitHubFacts,
  type BranchAnalysis,
} from '../src/branch-cleanup.js';
import * as ghCommands from '../src/gh-commands.js';
import * as gitExecutor from '../src/git-executor.js';

// Mock dependencies
vi.mock('../src/git-executor.js', async () => {
  const actual = await vi.importActual('../src/git-executor.js');
  return {
    ...actual,
    execGitCommand: vi.fn(),
    tryGitCommand: vi.fn(),
    executeGitCommand: vi.fn(),
  };
});

vi.mock('../src/gh-commands.js', async () => {
  const actual = await vi.importActual('../src/gh-commands.js');
  return {
    ...actual,
    listPullRequests: vi.fn(),
    fetchPRDetails: vi.fn(),
  };
});

vi.mock('@vibe-validate/utils', async () => {
  const actual = await vi.importActual('@vibe-validate/utils');
  return {
    ...actual,
    isToolAvailable: vi.fn(),
  };
});

// Test Data Factories (DRY)
const DEFAULT_COMMIT_DATE = '2023-01-01T00:00:00Z';
const DEFAULT_AUTHOR = 'Test User';

function createBranchFacts(overrides: Partial<BranchGitFacts> = {}): BranchGitFacts {
  return {
    name: 'feature/test',
    mergedToMain: false,
    remoteStatus: 'exists',
    unpushedCommitCount: 0,
    lastCommitDate: DEFAULT_COMMIT_DATE,
    lastCommitAuthor: DEFAULT_AUTHOR,
    daysSinceActivity: 30,
    ...overrides,
  };
}

function createGitHubFacts(overrides: Partial<BranchGitHubFacts> = {}): BranchGitHubFacts {
  return {
    prNumber: 42,
    prState: 'merged',
    mergeMethod: 'squash',
    mergedAt: DEFAULT_COMMIT_DATE,
    mergedBy: 'test-user',
    ...overrides,
  };
}

function createMockPR(overrides: Partial<any> = {}): any {
  return {
    number: 42,
    title: 'Test PR',
    url: 'https://github.com/owner/repo/pull/42',
    headRefName: 'feature/test',
    baseRefName: 'main',
    author: { login: 'user' },
    state: 'MERGED' as const,
    ...overrides,
  };
}

// Helper to setup common GitHub mocks
function mockGitHubAvailable(mockPRs: any[]) {
  vi.mocked(utils.isToolAvailable).mockReturnValue(true);
  vi.mocked(ghCommands.listPullRequests).mockReturnValue(mockPRs);
}

// Helper to mock git commands for setup tests
function mockGitForSetup(remoteUrl: string) {
  vi.mocked(gitExecutor.execGitCommand).mockImplementation((args: string[]) => {
    if (args[0] === 'branch' && args[1] === '--show-current') {
      return 'main';
    }
    if (args[0] === 'remote' && args[1] === 'get-url') {
      return remoteUrl;
    }
    if (args[0] === 'symbolic-ref' && args[1] === 'refs/remotes/origin/HEAD') {
      return 'refs/remotes/origin/main';
    }
    return '';
  });
}

// Helper to mock git for branches with no remote tracking
function mockGitForNeverPushedBranch(commitDate: string, author: string) {
  vi.mocked(gitExecutor.execGitCommand).mockImplementation((args: string[]) => {
    if (args[0] === 'config') {
      throw new Error('Not found');
    }
    if (args[0] === 'log') {
      return `${commitDate}\n${author}`;
    }
    return '';
  });
}

describe('Branch Cleanup - Default Branch Detection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should detect default branch from remote HEAD symbolic ref', () => {
    vi.mocked(gitExecutor.execGitCommand).mockReturnValueOnce('ref: refs/heads/main');

    const result = detectDefaultBranch();
    expect(result).toBe('main');
    expect(gitExecutor.execGitCommand).toHaveBeenCalledWith([
      'symbolic-ref',
      'refs/remotes/origin/HEAD',
    ]);
  });

  it('should handle non-standard default branch (master)', () => {
    vi.mocked(gitExecutor.execGitCommand).mockReturnValueOnce('ref: refs/heads/master');

    const result = detectDefaultBranch();
    expect(result).toBe('master');
  });

  it('should handle non-standard default branch (develop)', () => {
    vi.mocked(gitExecutor.execGitCommand).mockReturnValueOnce('ref: refs/heads/develop');

    const result = detectDefaultBranch();
    expect(result).toBe('develop');
  });

  it('should fallback to git config when symbolic-ref fails', () => {
    vi.mocked(gitExecutor.execGitCommand)
      .mockImplementationOnce(() => {
        throw new Error('fatal: ref refs/remotes/origin/HEAD is not a symbolic ref');
      })
      .mockReturnValueOnce('refs/heads/main');

    const result = detectDefaultBranch();
    expect(result).toBe('main');
    expect(gitExecutor.execGitCommand).toHaveBeenNthCalledWith(2, [
      'config',
      '--get',
      'init.defaultBranch',
    ]);
  });

  it('should use "main" as last resort when all detection methods fail', () => {
    vi.mocked(gitExecutor.execGitCommand).mockImplementation(() => {
      throw new Error('Not found');
    });

    const result = detectDefaultBranch();
    expect(result).toBe('main');
  });

  it('should throw error if default branch cannot be detected (per requirements)', () => {
    vi.mocked(gitExecutor.execGitCommand).mockImplementation(() => {
      throw new Error('Not found');
    });
    vi.mocked(gitExecutor.tryGitCommand).mockReturnValue(false);

    expect(() => detectDefaultBranch({ throwOnError: true })).toThrow(
      /Unable to detect default branch/
    );
  });
});

describe('Branch Cleanup - Safety Analysis', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should mark branch as auto-delete safe when merged with no unpushed work', () => {
    const branchFacts = createBranchFacts({
      name: 'feature/merged',
      mergedToMain: true,
    });

    const result = isAutoDeleteSafe(branchFacts);
    expect(result).toBe(true);
  });

  it('should NOT mark as auto-delete safe when merged but has unpushed work', () => {
    const branchFacts = createBranchFacts({
      name: 'feature/merged-wip',
      mergedToMain: true,
      unpushedCommitCount: 2, // HAS UNPUSHED WORK
    });

    const result = isAutoDeleteSafe(branchFacts);
    expect(result).toBe(false);
  });

  it('should NOT mark squash-merged branch as auto-delete safe', () => {
    const branchFacts = createBranchFacts({
      name: 'feature/squashed',
      mergedToMain: false, // Squash merge - not detected by git
      remoteStatus: 'deleted', // Remote was deleted
    });

    const result = isAutoDeleteSafe(branchFacts);
    expect(result).toBe(false);
  });

  it('should flag squash-merged branch for review', () => {
    const branchFacts = createBranchFacts({
      name: 'feature/squashed',
      remoteStatus: 'deleted', // Remote deleted
    });

    const githubFacts = createGitHubFacts();

    const result = needsReview(branchFacts, githubFacts);
    expect(result).toBe(true);
  });

  it('should flag old abandoned branches for review', () => {
    const branchFacts = createBranchFacts({
      name: 'feature/old',
      remoteStatus: 'never_pushed',
      daysSinceActivity: 90, // 90 days old
    });

    const result = needsReview(branchFacts);
    expect(result).toBe(true);
  });

  it('should NOT flag active branches for review', () => {
    const recentDate = new Date();
    recentDate.setDate(recentDate.getDate() - 5);

    const branchFacts = createBranchFacts({
      name: 'feature/active',
      lastCommitDate: recentDate.toISOString(),
      daysSinceActivity: 5, // Recently active
    });

    const result = needsReview(branchFacts);
    expect(result).toBe(false);
  });

  it('should NEVER show branches with unpushed work in any category', () => {
    const branchFacts = createBranchFacts({
      name: 'feature/wip',
      mergedToMain: true,
      unpushedCommitCount: 3, // HAS UNPUSHED WORK
    });

    const autoDelete = isAutoDeleteSafe(branchFacts);
    const review = needsReview(branchFacts);
    expect(autoDelete).toBe(false);
    expect(review).toBe(false);
  });
});

describe('Branch Cleanup - Protected Branches', () => {
  it('should protect main', () => {
    expect(isProtectedBranch('main', 'main')).toBe(true);
  });

  it('should protect master', () => {
    expect(isProtectedBranch('master', 'main')).toBe(true);
  });

  it('should protect develop', () => {
    expect(isProtectedBranch('develop', 'main')).toBe(true);
  });

  it('should protect custom default branch', () => {
    expect(isProtectedBranch('production', 'production')).toBe(true);
  });

  it('should not protect feature branches', () => {
    expect(isProtectedBranch('feature/test', 'main')).toBe(false);
  });
});

describe('Branch Cleanup - Remote Tracking Parsing', () => {
  it('should parse existing remote tracking ref', () => {
    const branchVerbose = '  feature/test  abc1234 [origin/feature/test] Commit message';
    const { remoteStatus, remoteRef } = parseRemoteTracking(branchVerbose);

    expect(remoteStatus).toBe('exists');
    expect(remoteRef).toBe('origin/feature/test');
  });

  it('should parse remote with ahead/behind info', () => {
    const branchVerbose = '* feature/test  abc1234 [origin/feature/test: ahead 2, behind 1] Message';
    const { remoteStatus, remoteRef } = parseRemoteTracking(branchVerbose);

    expect(remoteStatus).toBe('exists');
    expect(remoteRef).toBe('origin/feature/test');
  });

  it('should detect never pushed branches (no tracking info)', () => {
    const branchVerbose = '  feature/local  abc1234 Commit message';
    const { remoteStatus, remoteRef } = parseRemoteTracking(branchVerbose);

    expect(remoteStatus).toBe('never_pushed');
    expect(remoteRef).toBeNull();
  });
});

describe('Branch Cleanup - Unpushed Commit Counting', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return 0 if no remote ref', () => {
    const count = getUnpushedCommitCount('feature/test', null);
    expect(count).toBe(0);
  });

  it('should count unpushed commits', () => {
    vi.mocked(gitExecutor.execGitCommand).mockReturnValue('3');

    const count = getUnpushedCommitCount('feature/test', 'origin/feature/test');

    expect(count).toBe(3);
    expect(gitExecutor.execGitCommand).toHaveBeenCalledWith([
      'rev-list',
      '--count',
      'origin/feature/test..feature/test',
    ]);
  });

  it('should return 0 if git command fails', () => {
    vi.mocked(gitExecutor.execGitCommand).mockImplementation(() => {
      throw new Error('fatal: ambiguous argument');
    });

    const count = getUnpushedCommitCount('feature/test', 'origin/feature/test');
    expect(count).toBe(0);
  });
});

describe('Branch Cleanup - shouldShowBranch', () => {
  it('should hide branches with unpushed work', () => {
    const analysis: BranchAnalysis = {
      gitFacts: createBranchFacts({ unpushedCommitCount: 2 }),
      assessment: {
        summary: '',
        deleteCommand: '',
        recoveryCommand: '',
      },
    };

    expect(shouldShowBranch(analysis)).toBe(false);
  });

  it('should show auto-delete safe branches', () => {
    const analysis: BranchAnalysis = {
      gitFacts: createBranchFacts({ mergedToMain: true, unpushedCommitCount: 0 }),
      assessment: {
        summary: '',
        deleteCommand: '',
        recoveryCommand: '',
      },
    };

    expect(shouldShowBranch(analysis)).toBe(true);
  });

  it('should show branches needing review', () => {
    const analysis: BranchAnalysis = {
      gitFacts: createBranchFacts({
        remoteStatus: 'deleted',
        unpushedCommitCount: 0,
        daysSinceActivity: 45,
      }),
      assessment: {
        summary: '',
        deleteCommand: '',
        recoveryCommand: '',
      },
    };

    expect(shouldShowBranch(analysis)).toBe(true);
  });
});

describe('Branch Cleanup - gatherBranchGitFacts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should gather complete facts for a branch with remote tracking', async () => {
    const mergedBranches = new Set(['feature/test']);

    // Mock git commands
    vi.mocked(gitExecutor.execGitCommand).mockImplementation((args: string[]) => {
      if (args[0] === 'config' && args[2] === 'branch.feature/test.merge') {
        return 'refs/heads/feature/test';
      }
      if (args[0] === 'config' && args[2] === 'branch.feature/test.remote') {
        return 'origin';
      }
      if (args[0] === 'rev-parse') {
        return 'abc123'; // Remote exists
      }
      if (args[0] === 'rev-list') {
        return '2'; // 2 unpushed commits
      }
      if (args[0] === 'log') {
        return '2023-12-15T10:00:00Z\nJohn Doe';
      }
      return '';
    });

    const facts = await gatherBranchGitFacts('feature/test', 'main', mergedBranches);

    expect(facts.name).toBe('feature/test');
    expect(facts.mergedToMain).toBe(true);
    expect(facts.remoteStatus).toBe('exists');
    expect(facts.unpushedCommitCount).toBe(2);
    expect(facts.lastCommitDate).toBe('2023-12-15T10:00:00Z');
    expect(facts.lastCommitAuthor).toBe('John Doe');
    expect(facts.daysSinceActivity).toBeGreaterThan(0);
  });

  it('should handle branch with deleted remote', async () => {
    const mergedBranches = new Set<string>();

    vi.mocked(gitExecutor.execGitCommand).mockImplementation((args: string[]) => {
      if (args[0] === 'config' && args[2] === 'branch.feature/old.merge') {
        return 'refs/heads/feature/old';
      }
      if (args[0] === 'config' && args[2] === 'branch.feature/old.remote') {
        return 'origin';
      }
      if (args[0] === 'rev-parse') {
        throw new Error('fatal: ref does not exist');
      }
      if (args[0] === 'log') {
        return '2023-01-01T00:00:00Z\nTest User';
      }
      return '';
    });

    const facts = await gatherBranchGitFacts('feature/old', 'main', mergedBranches);

    expect(facts.remoteStatus).toBe('deleted');
    expect(facts.unpushedCommitCount).toBe(0);
  });

  it('should handle branch never pushed', async () => {
    const mergedBranches = new Set<string>();
    mockGitForNeverPushedBranch('2023-12-20T00:00:00Z', 'Local Dev');

    const facts = await gatherBranchGitFacts('feature/local', 'main', mergedBranches);

    expect(facts.remoteStatus).toBe('never_pushed');
    expect(facts.unpushedCommitCount).toBe(0);
  });

  it('should calculate days since activity correctly', async () => {
    const mergedBranches = new Set<string>();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    mockGitForNeverPushedBranch(yesterday.toISOString(), 'Recent Dev');

    const facts = await gatherBranchGitFacts('feature/recent', 'main', mergedBranches);

    expect(facts.daysSinceActivity).toBe(1);
  });
});

describe('Branch Cleanup - Edge Cases', () => {
  it('should handle branch never pushed (active)', () => {
    const branchFacts = createBranchFacts({
      name: 'feature/local',
      remoteStatus: 'never_pushed',
      daysSinceActivity: 5,
    });

    // Should not be flagged for deletion or review (still active locally)
    const autoDelete = isAutoDeleteSafe(branchFacts);
    const review = needsReview(branchFacts);
    expect(autoDelete).toBe(false);
    expect(review).toBe(false);
  });

  it('should handle very old branches (>90 days)', () => {
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    const branchFacts = createBranchFacts({
      name: 'feature/ancient',
      remoteStatus: 'never_pushed',
      lastCommitDate: ninetyDaysAgo.toISOString(),
      daysSinceActivity: 90,
    });

    // Should be flagged for review
    const result = needsReview(branchFacts);
    expect(result).toBe(true);
  });
});

describe('Branch Cleanup - GitHub Enrichment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('detectMergeMethod', () => {
    it('should detect squash merge (multiple commits squashed to one)', () => {
      const pr = createMockPR({
        mergeCommit: {
          oid: 'abc123',
          parents: [{ totalCount: 1 }], // Only 1 parent = squashed
        },
        commits: { totalCount: 5 }, // Had 5 commits before squash
      });

      const method = detectMergeMethod(pr);
      expect(method).toBe('squash');
    });

    it('should detect true merge commit (2+ parents)', () => {
      const pr = createMockPR({
        mergeCommit: {
          oid: 'abc123',
          parents: [{ totalCount: 2 }], // 2 parents = merge commit
        },
        commits: { totalCount: 5 },
      });

      const method = detectMergeMethod(pr);
      expect(method).toBe('merge');
    });

    it('should detect rebase merge (fallback)', () => {
      const pr = createMockPR({
        mergeCommit: {
          oid: 'abc123',
          parents: [{ totalCount: 1 }], // 1 parent but...
        },
        commits: { totalCount: 1 }, // ...only 1 commit (not squashed)
      });

      const method = detectMergeMethod(pr);
      expect(method).toBe('rebase');
    });

    it('should return undefined if no merge commit', () => {
      const pr = createMockPR(); // No mergeCommit field

      const method = detectMergeMethod(pr);
      expect(method).toBeUndefined();
    });
  });

  describe('fetchPRDataForBranches', () => {
    it('should throw error if gh CLI not available', async () => {
      vi.mocked(utils.isToolAvailable).mockReturnValue(false);

      await expect(fetchPRDataForBranches('owner/repo', ['feature/test'])).rejects.toThrow(
        /GitHub CLI \(gh\) is required/
      );
    });

    it('should throw error for invalid repository format', async () => {
      vi.mocked(utils.isToolAvailable).mockReturnValue(true);

      await expect(fetchPRDataForBranches('invalid-repo', ['feature/test'])).rejects.toThrow(
        /Invalid repository format/
      );
    });

    it('should batch fetch merged PRs and create map', async () => {
      vi.mocked(utils.isToolAvailable).mockReturnValue(true);

      const mockPRs = [
        createMockPR({ number: 42, headRefName: 'feature/test', author: { login: 'user1' } }),
        createMockPR({ number: 43, title: 'Another PR', headRefName: 'feature/other', author: { login: 'user2' } }),
      ];

      vi.mocked(ghCommands.listPullRequests).mockReturnValue(mockPRs);
      vi.mocked(ghCommands.fetchPRDetails)
        .mockReturnValueOnce({
          ...mockPRs[0],
          mergeCommit: { oid: 'abc123' },
          commits: { totalCount: 3 },
        })
        .mockReturnValueOnce({
          ...mockPRs[1],
          mergeCommit: { oid: 'def456' },
          commits: { totalCount: 1 },
        });

      const result = await fetchPRDataForBranches('owner/repo', ['feature/test', 'feature/other']);

      expect(result.size).toBe(2);
      expect(result.get('feature/test')).toBeDefined();
      expect(result.get('feature/test')?.number).toBe(42);
      expect(result.get('feature/other')).toBeDefined();
      expect(result.get('feature/other')?.number).toBe(43);

      // Should call listPullRequests with merged state (limit: 20 for performance)
      expect(ghCommands.listPullRequests).toHaveBeenCalledWith(
        'owner',
        'repo',
        20,
        expect.any(Array),
        'merged'
      );
    });

    it('should handle PR fetch failures gracefully', async () => {
      const mockPRs = [createMockPR({ headRefName: 'feature/test' })];
      mockGitHubAvailable(mockPRs);
      vi.mocked(ghCommands.fetchPRDetails).mockImplementation(() => {
        throw new Error('API rate limit');
      });

      const result = await fetchPRDataForBranches('owner/repo', ['feature/test']);

      // Should use basic PR data when detailed fetch fails
      expect(result.size).toBe(1);
      expect(result.get('feature/test')?.number).toBe(42);
    });
  });

  describe('enrichWithGitHubData', () => {
    it('should enrich branch analyses with PR data', async () => {
      const mockPRs = [createMockPR({ headRefName: 'feature/test' })];
      mockGitHubAvailable(mockPRs);
      vi.mocked(ghCommands.fetchPRDetails).mockReturnValue({
        ...mockPRs[0],
        mergeCommit: { oid: 'abc123', parents: [{ totalCount: 1 }] },
        commits: { totalCount: 3 },
        mergedAt: '2023-01-15T00:00:00Z',
        mergedBy: { login: 'merger' },
      });

      const analyses: BranchAnalysis[] = [
        {
          gitFacts: createBranchFacts({ name: 'feature/test', remoteStatus: 'deleted' }),
          assessment: {
            summary: 'Needs review',
            deleteCommand: 'git branch -D feature/test',
            recoveryCommand: 'git checkout -b feature/test abc123',
          },
        },
      ];

      await enrichWithGitHubData(analyses, 'owner/repo');

      // Should populate GitHub facts
      expect(analyses[0].githubFacts).toBeDefined();
      expect(analyses[0].githubFacts?.prNumber).toBe(42);
      expect(analyses[0].githubFacts?.prState).toBe('merged');
      expect(analyses[0].githubFacts?.mergeMethod).toBe('squash');
      expect(analyses[0].githubFacts?.mergedAt).toBe('2023-01-15T00:00:00Z');
      expect(analyses[0].githubFacts?.mergedBy).toBe('merger');
    });

    it('should handle branches without matching PRs', async () => {
      vi.mocked(utils.isToolAvailable).mockReturnValue(true);
      vi.mocked(ghCommands.listPullRequests).mockReturnValue([]); // No PRs

      const analyses: BranchAnalysis[] = [
        {
          gitFacts: createBranchFacts({ name: 'feature/orphan' }),
          assessment: {
            summary: 'No PR found',
            deleteCommand: 'git branch -D feature/orphan',
            recoveryCommand: 'git checkout -b feature/orphan abc123',
          },
        },
      ];

      await enrichWithGitHubData(analyses, 'owner/repo');

      // Should not populate GitHub facts
      expect(analyses[0].githubFacts).toBeUndefined();
    });

    it('should throw error if gh CLI not available', async () => {
      vi.mocked(utils.isToolAvailable).mockReturnValue(false);

      const analyses: BranchAnalysis[] = [];

      await expect(enrichWithGitHubData(analyses, 'owner/repo')).rejects.toThrow(
        /GitHub CLI \(gh\) is required/
      );
    });
  });

  describe('needsReview with GitHub facts', () => {
    it('should NOT flag branches with open PRs for review', () => {
      const branchFacts = createBranchFacts({
        name: 'feature/active-pr',
        remoteStatus: 'exists',
        daysSinceActivity: 45, // Old enough to review normally
      });

      const githubFacts = createGitHubFacts({
        prState: 'open', // But PR is still open
      });

      const result = needsReview(branchFacts, githubFacts);
      expect(result).toBe(false); // Should NOT review (PR is open)
    });

    it('should flag merged PR with deleted remote for review', () => {
      const branchFacts = createBranchFacts({
        name: 'feature/squashed',
        remoteStatus: 'deleted', // Remote deleted
        daysSinceActivity: 45,
      });

      const githubFacts = createGitHubFacts({
        prState: 'merged', // PR was merged
        mergeMethod: 'squash',
      });

      const result = needsReview(branchFacts, githubFacts);
      expect(result).toBe(true); // Should review (squash merge pattern)
    });
  });
});

describe('Branch Cleanup - Setup Context', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Repository name extraction', () => {
    it('should strip .git suffix from remote URL', async () => {
      mockGitForSetup('git@github.com:jdutton/vibe-validate.git');

      const context = await setupCleanupContext();

      expect(context.repository).toBe('jdutton/vibe-validate');
      expect(context.repository).not.toContain('.git');
    });

    it('should handle remote URL without .git suffix', async () => {
      mockGitForSetup('git@github.com:owner/repo');

      const context = await setupCleanupContext();

      expect(context.repository).toBe('owner/repo');
    });

    it('should handle HTTPS remote URL with .git suffix', async () => {
      mockGitForSetup('https://github.com/owner/repo.git');

      const context = await setupCleanupContext();

      expect(context.repository).toBe('owner/repo');
      expect(context.repository).not.toContain('.git');
    });
  });
});

describe('Branch Cleanup - Assessment Generation', () => {
  it('should generate assessment for deleted remote with PR info', () => {
    const gitFacts = createBranchFacts({
      remoteStatus: 'deleted',
      daysSinceActivity: 2,
    });

    const githubFacts = createGitHubFacts({
      prNumber: 42,
      prState: 'merged',
      mergeMethod: 'squash',
      mergedBy: 'test-user',
    });

    const assessment = generateDeletedRemoteAssessment(gitFacts, githubFacts);

    expect(assessment).toContain('Remote deleted by GitHub');
    expect(assessment).toContain('PR #42');
    expect(assessment).toContain('merged');
    expect(assessment).toContain('by test-user');
    expect(assessment).toContain('squash merge explains why git branch --merged returned false');
    expect(assessment).toContain('No unpushed commits (safe to delete)');
  });

  it('should generate assessment for deleted remote without PR info', () => {
    const gitFacts = createBranchFacts({
      remoteStatus: 'deleted',
      daysSinceActivity: 5,
    });

    const assessment = generateDeletedRemoteAssessment(gitFacts);

    expect(assessment).toContain('Remote deleted by GitHub');
    expect(assessment).toContain('No unpushed commits (safe to delete)');
    expect(assessment).not.toContain('PR #');
  });

  it('should generate assessment for old never-pushed branch', () => {
    const gitFacts = createBranchFacts({
      remoteStatus: 'never_pushed',
      daysSinceActivity: 95,
    });

    const assessment = generateAssessment(gitFacts);

    expect(assessment).toContain('Old abandoned branch');
    expect(assessment).toContain('95 days');
    expect(assessment).toContain('Never pushed to remote');
    expect(assessment).toContain('No unpushed commits (safe to delete)');
  });

  it('should delegate to generateDeletedRemoteAssessment for deleted remote', () => {
    const gitFacts = createBranchFacts({
      remoteStatus: 'deleted',
    });

    const assessment = generateAssessment(gitFacts);

    expect(assessment).toContain('Remote deleted by GitHub');
  });
});

describe('Branch Cleanup - tryDeleteBranch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should successfully delete a branch', () => {
    vi.mocked(gitExecutor.execGitCommand).mockReturnValue('');

    const gitFacts = createBranchFacts({ name: 'feature/test' });
    const result = tryDeleteBranch(gitFacts);

    expect(result.deleted).toBe(true);
    expect(result.error).toBeUndefined();
    expect(gitExecutor.execGitCommand).toHaveBeenCalledWith(['branch', '-d', 'feature/test']);
  });

  it('should handle deletion failure', () => {
    vi.mocked(gitExecutor.execGitCommand).mockImplementation(() => {
      throw new Error('error: branch not fully merged');
    });

    const gitFacts = createBranchFacts({ name: 'feature/test' });
    const result = tryDeleteBranch(gitFacts);

    expect(result.deleted).toBe(false);
    expect(result.error).toContain('branch not fully merged');
  });
});

describe('Branch Cleanup - categorizeBranches', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should auto-delete safe branches successfully', () => {
    vi.mocked(gitExecutor.execGitCommand).mockReturnValue('');

    const analyses: BranchAnalysis[] = [
      {
        gitFacts: createBranchFacts({
          name: 'feature/merged',
          mergedToMain: true,
          unpushedCommitCount: 0,
        }),
        assessment: {
          summary: 'Auto-delete safe',
          deleteCommand: 'git branch -D feature/merged',
          recoveryCommand: 'git reflog | grep feature/merged',
        },
      },
    ];

    const { autoDeleted, needsReview } = categorizeBranches(analyses);

    expect(autoDeleted).toHaveLength(1);
    expect(autoDeleted[0].name).toBe('feature/merged');
    expect(autoDeleted[0].reason).toBe('merged_to_main');
    expect(needsReview).toHaveLength(0);
  });

  it('should add failed deletions to needs-review', () => {
    vi.mocked(gitExecutor.execGitCommand).mockImplementation(() => {
      throw new Error('Cannot delete checked out branch');
    });

    const analyses: BranchAnalysis[] = [
      {
        gitFacts: createBranchFacts({
          name: 'feature/current',
          mergedToMain: true,
          unpushedCommitCount: 0,
        }),
        assessment: {
          summary: 'Auto-delete safe',
          deleteCommand: 'git branch -D feature/current',
          recoveryCommand: 'git reflog | grep feature/current',
        },
      },
    ];

    const { autoDeleted, needsReview } = categorizeBranches(analyses);

    expect(autoDeleted).toHaveLength(0);
    expect(needsReview).toHaveLength(1);
    expect(needsReview[0].name).toBe('feature/current');
    expect(needsReview[0].assessment).toContain('Failed to delete');
    expect(needsReview[0].assessment).toContain('Cannot delete checked out branch');
  });

  it('should categorize branches needing review', () => {
    const analyses: BranchAnalysis[] = [
      {
        gitFacts: createBranchFacts({
          name: 'feature/squashed',
          mergedToMain: false,
          remoteStatus: 'deleted',
          unpushedCommitCount: 0,
          daysSinceActivity: 45,
        }),
        githubFacts: createGitHubFacts({
          prState: 'merged',
          mergeMethod: 'squash',
        }),
        assessment: {
          summary: 'Needs review',
          deleteCommand: 'git branch -D feature/squashed',
          recoveryCommand: 'git reflog | grep feature/squashed',
        },
      },
    ];

    const { autoDeleted, needsReview } = categorizeBranches(analyses);

    expect(autoDeleted).toHaveLength(0);
    expect(needsReview).toHaveLength(1);
    expect(needsReview[0].name).toBe('feature/squashed');
    expect(needsReview[0].verification).toMatchObject({
      mergedToMain: false,
      remoteStatus: 'deleted',
      prState: 'merged',
      mergeMethod: 'squash',
    });
  });

  it('should handle mixed categories', () => {
    vi.mocked(gitExecutor.execGitCommand).mockReturnValue('');

    const analyses: BranchAnalysis[] = [
      {
        gitFacts: createBranchFacts({
          name: 'feature/safe',
          mergedToMain: true,
          unpushedCommitCount: 0,
        }),
        assessment: {
          summary: 'Auto-delete safe',
          deleteCommand: 'git branch -D feature/safe',
          recoveryCommand: 'git reflog | grep feature/safe',
        },
      },
      {
        gitFacts: createBranchFacts({
          name: 'feature/review',
          mergedToMain: false,
          remoteStatus: 'deleted',
          unpushedCommitCount: 0,
          daysSinceActivity: 45,
        }),
        assessment: {
          summary: 'Needs review',
          deleteCommand: 'git branch -D feature/review',
          recoveryCommand: 'git reflog | grep feature/review',
        },
      },
    ];

    const { autoDeleted, needsReview } = categorizeBranches(analyses);

    expect(autoDeleted).toHaveLength(1);
    expect(autoDeleted[0].name).toBe('feature/safe');
    expect(needsReview).toHaveLength(1);
    expect(needsReview[0].name).toBe('feature/review');
  });
});

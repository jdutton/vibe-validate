/**
 * Test Fixtures for watch-pr - Shared test data factories
 *
 * Eliminates duplication of check objects, WatchPRResult structures, and extraction results across test files.
 *
 * @packageDocumentation
 */

import type { ErrorExtractorResult } from '@vibe-validate/extractors';

import type {
	GitHubActionCheck,
	WatchPRResult,
} from '../../src/schemas/watch-pr-result.schema.js';

/**
 * Factory for creating GitHubActionCheck test objects
 *
 * @param overrides - Properties to override defaults
 * @returns GitHubActionCheck object
 */
export function createTestCheck(
	overrides: Partial<GitHubActionCheck> = {}
): GitHubActionCheck {
	return {
		name: 'CI / Test',
		status: 'completed',
		conclusion: 'failure',
		run_id: 12345,
		workflow: 'CI',
		started_at: '2025-12-16T10:00:00Z',
		duration: '2m30s',
		...overrides,
	};
}

/**
 * Factory for creating WatchPRResult test objects
 *
 * @param overrides - Properties to override defaults (deep merge supported)
 * @returns WatchPRResult object
 */
export function createTestWatchPRResult(
	overrides: Partial<WatchPRResult> = {}
): WatchPRResult {
	const base: WatchPRResult = {
		pr: {
			number: 90,
			title: 'Test PR',
			url: 'https://github.com/test/repo/pull/90',
			branch: 'test-branch',
			base_branch: 'main',
			author: 'testuser',
			draft: false,
			mergeable: true,
			merge_state_status: 'CLEAN',
			labels: [],
			linked_issues: [],
		},
		status: 'passed',
		checks: {
			total: 0,
			passed: 0,
			failed: 0,
			pending: 0,
			github_actions: [],
			external_checks: [],
		},
		changes: {
			files_changed: 0,
			insertions: 0,
			deletions: 0,
			commits: 0,
			top_files: [],
		},
	};

	// Deep merge for nested objects
	return {
		...base,
		...overrides,
		pr: { ...base.pr, ...(overrides.pr || {}) },
		checks: { ...base.checks, ...(overrides.checks || {}) },
		changes: { ...base.changes, ...(overrides.changes || {}) },
	};
}

/**
 * Factory for creating ErrorExtractorResult test objects
 *
 * @param overrides - Properties to override defaults
 * @returns ErrorExtractorResult object
 */
export function createTestExtraction(
	overrides: Partial<ErrorExtractorResult> = {}
): ErrorExtractorResult {
	return {
		errors: [
			{
				file: 'test.ts',
				line: 42,
				message: 'Test error',
			},
		],
		summary: 'Test summary',
		totalErrors: 1,
		guidance: 'Fix the test',
		metadata: {
			confidence: 100,
			completeness: 100,
			issues: [],
			detection: {
				extractor: 'vitest',
				confidence: 100,
				patterns: [],
				reason: 'Test',
			},
		},
		...overrides,
	};
}

/**
 * Create YAML log content with extraction data
 *
 * @param extraction - Extraction data to embed in YAML
 * @returns YAML string suitable for testing matrix mode detection
 */
export function createValidateYamlLog(
	extraction: Partial<ErrorExtractorResult>
): string {
	return `
---
command: npm test
exitCode: 1
durationSecs: 2.5
timestamp: 2025-12-16T10:01:01.000Z
treeHash: abc123
extraction:
  summary: ${extraction.summary || 'Test failure'}
  totalErrors: ${extraction.totalErrors || 1}
  errors:
${(extraction.errors || [{ message: 'Test error' }])
	.map((e) => `    - ${e.file ? `file: ${e.file}\n      ` : ''}${e.line ? `line: ${e.line}\n      ` : ''}message: ${e.message}`)
	.join('\n')}
  ${extraction.guidance ? `guidance: ${extraction.guidance}` : ''}
---
`;
}

/**
 * Create GitHub Actions log format (with job/step prefix and timestamp)
 *
 * @param yamlContent - YAML content to wrap
 * @param jobName - GitHub Actions job name
 * @param stepName - GitHub Actions step name
 * @returns Formatted log string
 */
export function createGitHubActionsLog(
	yamlContent: string,
	jobName = 'Run vibe-validate validation',
	stepName = 'Run validation'
): string {
	const lines = yamlContent.trim().split('\n');
	return lines
		.map(
			(line, index) =>
				`${jobName}\t${stepName}\t2025-12-16T16:33:10.${String(index).padStart(7, '0')}Z ${line}`
		)
		.join('\n');
}

/**
 * Create mock check object for testing (simplified version)
 *
 * @param name - Check name
 * @returns Mock check object suitable for detectAndExtract
 */
export function createMockCheck(name: string): any {
	return { name, __typename: 'CheckRun' } as any;
}

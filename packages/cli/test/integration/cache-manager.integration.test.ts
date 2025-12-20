/**
 * Integration tests for CacheManager
 *
 * These tests verify cache behavior with real file system operations.
 */

import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import type { ErrorExtractorResult } from '@vibe-validate/extractors';
import { normalizedTmpdir } from '@vibe-validate/utils';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import type { WatchPRResult } from '../../src/schemas/watch-pr-result.schema.js';
import { CacheManager } from '../../src/services/cache-manager.js';

describe('CacheManager Integration Tests', () => {
	let tempDir: string;
	let cacheManager: CacheManager;
	const testPRNumber = 90;

	beforeEach(() => {
		// Create temp directory for each test
		tempDir = mkdtempSync(join(normalizedTmpdir(), 'vv-cache-test-'));
		cacheManager = new CacheManager('test-repo', testPRNumber, tempDir);
	});

	afterEach(() => {
		// Clean up
		rmSync(tempDir, { recursive: true, force: true });
	});

	describe('Metadata Operations', () => {
		it('should save and retrieve metadata', async () => {
			const testData: WatchPRResult = {
				pr: {
					number: testPRNumber,
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
					total: 1,
					passed: 1,
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

			// Save
			await cacheManager.saveMetadata(testData);

			// Retrieve
			const retrieved = await cacheManager.getMetadata();

			// Verify
			expect(retrieved).toBeDefined();
			expect(retrieved?.pr.number).toBe(testPRNumber);
			expect(retrieved?.pr.title).toBe('Test PR');
			expect(retrieved?.status).toBe('passed');
		});

		it('should return null for missing metadata', async () => {
			// Don't save anything

			// Try to retrieve
			const retrieved = await cacheManager.getMetadata();

			// Should be null
			expect(retrieved).toBeNull();
		});

		it('should save data without modifying it', async () => {
			const testData: WatchPRResult = {
				pr: {
					number: testPRNumber,
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

			// Save
			await cacheManager.saveMetadata(testData);

			// Retrieve
			const retrieved = await cacheManager.getMetadata();

			// Verify data is preserved
			expect(retrieved).toBeDefined();
			expect(retrieved?.pr.number).toBe(testPRNumber);
			expect(retrieved?.pr.title).toBe('Test PR');
		});
	});

	describe('Log Operations', () => {
		it('should save and retrieve logs', async () => {
			const runId = 123456;
			const testLogs = 'Test log content\nLine 2\nLine 3';

			// Save
			const logPath = await cacheManager.saveLog(runId, testLogs);

			// Verify path
			expect(logPath).toContain('logs');
			expect(logPath).toContain(runId.toString());
			expect(existsSync(logPath)).toBe(true);
		});

		it('should create logs directory structure', async () => {
			const runId = 123456;
			const testLogs = 'Test logs';

			// Save
			await cacheManager.saveLog(runId, testLogs);

			// Verify directory structure exists (correct path with watch-pr-cache)
			const logsDir = join(
				tempDir,
				'vibe-validate',
				'watch-pr-cache',
				'test-repo',
				testPRNumber.toString(),
				'logs',
			);
			expect(existsSync(logsDir)).toBe(true);
		});
	});

	describe('Extraction Operations', () => {
		it('should save and retrieve extractions', async () => {
			const runId = 123456;
			const testExtraction: ErrorExtractorResult = {
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
			};

			// Save
			await cacheManager.saveExtraction(runId, testExtraction);

			// Retrieve
			const retrieved = await cacheManager.getExtraction(runId);

			// Verify
			expect(retrieved).toBeDefined();
			expect(retrieved?.errors.length).toBe(1);
			expect(retrieved?.errors[0].file).toBe('test.ts');
			expect(retrieved?.summary).toBe('Test summary');
		});

		it('should return null for missing extraction', async () => {
			const runId = 999999;

			// Try to retrieve non-existent extraction
			const retrieved = await cacheManager.getExtraction(runId);

			// Should be null
			expect(retrieved).toBeNull();
		});

		it('should create extractions directory structure', async () => {
			const runId = 123456;
			const testExtraction: ErrorExtractorResult = {
				errors: [],
				summary: 'No errors',
				totalErrors: 0,
				metadata: {
					confidence: 100,
					completeness: 100,
					issues: [],
				},
			};

			// Save
			await cacheManager.saveExtraction(runId, testExtraction);

			// Verify directory structure (correct path with watch-pr-cache)
			const extractionsDir = join(
				tempDir,
				'vibe-validate',
				'watch-pr-cache',
				'test-repo',
				testPRNumber.toString(),
				'extractions',
			);
			expect(existsSync(extractionsDir)).toBe(true);
		});
	});

	describe('Cache Directory Structure', () => {
		it('should create correct directory hierarchy', async () => {
			const testData: WatchPRResult = {
				pr: {
					number: testPRNumber,
					title: 'Test',
					url: 'https://test',
					branch: 'test',
					base_branch: 'main',
					author: 'test',
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

			// Trigger cache creation by saving metadata
			await cacheManager.saveMetadata(testData);

			// Verify structure (correct path with watch-pr-cache)
			const prCacheDir = join(
				tempDir,
				'vibe-validate',
				'watch-pr-cache',
				'test-repo',
				testPRNumber.toString(),
			);
			expect(existsSync(prCacheDir)).toBe(true);
			expect(existsSync(join(prCacheDir, 'metadata.json'))).toBe(true);
		});
	});
});

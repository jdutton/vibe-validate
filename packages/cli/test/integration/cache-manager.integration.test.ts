/**
 * Integration tests for CacheManager
 *
 * These tests verify cache behavior with real file system operations.
 */

import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import { normalizedTmpdir } from '@vibe-validate/utils';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { CacheManager } from '../../src/services/cache-manager.js';
import {
	createTestWatchPRResult,
	createTestExtraction,
} from '../helpers/watch-pr-fixtures.js';

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
			const testData = createTestWatchPRResult({
				checks: { total: 1, passed: 1, failed: 0, pending: 0 },
			});

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
			const testData = createTestWatchPRResult();

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
			const testExtraction = createTestExtraction();

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
			const testExtraction = createTestExtraction({
				errors: [],
				summary: 'No errors',
				totalErrors: 0,
			});

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
			const testData = createTestWatchPRResult({
				pr: { title: 'Test', url: 'https://test', branch: 'test', author: 'test' },
			});

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

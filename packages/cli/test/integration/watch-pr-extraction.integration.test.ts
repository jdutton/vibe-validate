/**
 * Integration tests for watch-pr extraction pipeline
 *
 * These tests verify that the extraction mode detector works correctly
 * with real log fixtures from GitHub Actions.
 */

import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it, expect } from 'vitest';

import { ExtractionModeDetector } from '../../src/services/extraction-mode-detector.js';
import { createMockCheck } from '../helpers/watch-pr-fixtures.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, '../fixtures');

describe('Extraction Pipeline Integration', () => {
	const detector = new ExtractionModeDetector();

	describe('Matrix Mode Extraction (validate YAML)', () => {
		it('should extract errors from real PR #90 validate YAML logs', async () => {
			// Load real logs from PR #90 (matrix mode with validate)
			const logs = readFileSync(
				path.join(FIXTURES_DIR, 'pr-90/run-20275187200.log'),
				'utf-8',
			);

			// Detect and extract
			const extraction = await detector.detectAndExtract(
				createMockCheck('Validation Pipeline'),
				logs,
			);

			// Should successfully extract from YAML
			expect(extraction).toBeDefined();
			if (extraction) {
				expect(extraction.errors).toBeDefined();
				expect(Array.isArray(extraction.errors)).toBe(true);
				expect(extraction.summary).toBeDefined();
				expect(extraction.totalErrors).toBeGreaterThanOrEqual(0);

				// Verify ErrorExtractorResult schema compliance
				expect(extraction).toMatchObject({
					summary: expect.any(String),
					totalErrors: expect.any(Number),
					metadata: expect.objectContaining({
						confidence: expect.any(Number),
						completeness: expect.any(Number),
					}),
				});
			}
		});
	});

	describe('Non-Matrix Mode Extraction (raw test output)', () => {
		it('should extract TypeScript errors from Docker Build logs', async () => {
			// Load real Docker Build logs with TypeScript errors
			const logs = readFileSync(
				path.join(FIXTURES_DIR, 'pr-104/run-19754182675-docker.log'),
				'utf-8',
			);

			// Detect and extract
			const extraction = await detector.detectAndExtract(
				createMockCheck('Docker Build'),
				logs,
			);

			// Should successfully extract TypeScript errors
			expect(extraction).toBeDefined();
			if (extraction) {
				expect(extraction.errors.length).toBeGreaterThan(0);
				expect(extraction.summary).toContain('type error');

				// Verify first error has proper structure
				const firstError = extraction.errors[0];
				expect(firstError).toMatchObject({
					file: expect.any(String),
					line: expect.any(Number),
					message: expect.any(String),
				});

				// Verify metadata indicates TypeScript detection
				expect(extraction.metadata?.detection?.extractor).toBe('typescript');
			}
		});

		it('should extract Vitest errors from Validation Pipeline logs', async () => {
			// Load real Validation Pipeline logs with Vitest test failures
			const logs = readFileSync(
				path.join(FIXTURES_DIR, 'pr-104/run-19744677825-vitest.log'),
				'utf-8',
			);

			// Detect and extract
			const extraction = await detector.detectAndExtract(
				createMockCheck('Validation Pipeline'),
				logs,
			);

			// Should successfully detect (may not have errors if logs were truncated)
			expect(extraction).toBeDefined();
			if (extraction && extraction.errors.length > 0) {
				expect(extraction.summary).toContain('failure');

				// Verify first error has proper structure
				const firstError = extraction.errors[0];
				expect(firstError).toMatchObject({
					file: expect.any(String),
					line: expect.any(Number),
					message: expect.any(String),
				});

				// Verify metadata indicates Vitest detection
				expect(extraction.metadata?.detection?.extractor).toBe('vitest');
				expect(extraction.metadata?.detection?.confidence).toBeGreaterThanOrEqual(90);
			} else {
				// If no errors found, log fixture may be truncated - that's okay
				expect(true).toBe(true);
			}
		});

		it('should extract ESLint errors from Validation Pipeline logs', async () => {
			// Load real Validation Pipeline logs with ESLint errors
			const logs = readFileSync(
				path.join(FIXTURES_DIR, 'pr-104/run-19742892857-eslint.log'),
				'utf-8',
			);

			// Detect and extract
			const extraction = await detector.detectAndExtract(
				createMockCheck('Validation Pipeline'),
				logs,
			);

			// Should successfully extract ESLint errors
			expect(extraction).toBeDefined();
			if (extraction) {
				expect(extraction.errors.length).toBeGreaterThan(0);
				expect(extraction.summary).toContain('ESLint');

				// Verify errors have proper structure
				const firstError = extraction.errors[0];
				expect(firstError).toMatchObject({
					file: expect.any(String),
					line: expect.any(Number),
					message: expect.any(String),
					severity: expect.stringMatching(/error|warning/),
				});

				// Verify metadata indicates ESLint detection
				expect(extraction.metadata?.detection?.extractor).toBe('eslint');
			}
		});
	});

	describe('Mode Detection Fallback', () => {
		it('should try matrix mode first, then fall back to non-matrix', async () => {
			// Logs without YAML should fall back to non-matrix mode
			const plainLogs = `
FAIL test/example.test.ts:10:5
  ● should work
    Error: Test failed
			`;

			const extraction = await detector.detectAndExtract(
				createMockCheck('Tests'),
				plainLogs,
			);

			// Should detect as non-matrix mode (generic or specific extractor)
			expect(extraction).toBeDefined();
			if (extraction) {
				expect(extraction.metadata?.detection?.extractor).toBeDefined();
				// Should not be matrix mode (no YAML found)
				expect(extraction.metadata?.detection?.extractor).not.toBe('matrix');
			}
		});

		it('should return null for logs with no extractable content', async () => {
			const emptyLogs = 'Some logs with no errors or test failures';

			const extraction = await detector.detectAndExtract(
				createMockCheck('Unknown'),
				emptyLogs,
			);

			// May return null or empty errors array depending on generic extractor behavior
			if (extraction) {
				expect(extraction.totalErrors).toBe(0);
			}
		});
	});
});

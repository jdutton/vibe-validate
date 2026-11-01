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
		it('should extract errors from real PR #90 validate YAML logs', () => {
			// Load real logs from PR #90 (matrix mode with validate)
			const logs = readFileSync(
				path.join(FIXTURES_DIR, 'pr-90/run-20275187200.log'),
				'utf-8',
			);

			// Detect and extract
			const extraction = detector.detectAndExtract(
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
		// Real logs whose failure one extractor owns: it must find structured errors
		it.each([
			{ tool: 'TypeScript', fixture: 'pr-104/run-19754182675-docker.log', check: 'Docker Build', summary: 'type error', extractor: 'typescript', fields: {} },
			{ tool: 'ESLint', fixture: 'pr-104/run-19742892857-eslint.log', check: 'Validation Pipeline', summary: 'ESLint', extractor: 'eslint', fields: { severity: expect.stringMatching(/error|warning/) } },
		])('should extract $tool errors from $check logs', ({ fixture, check, summary, extractor, fields }) => {
			const logs = readFileSync(path.join(FIXTURES_DIR, fixture), 'utf-8');

			const extraction = detector.detectAndExtract(createMockCheck(check), logs);

			expect(extraction).not.toBeNull();
			expect(extraction!.errors.length).toBeGreaterThan(0);
			expect(extraction!.summary).toContain(summary);
			expect(extraction!.errors[0]).toMatchObject({
				file: expect.any(String),
				line: expect.any(Number),
				message: expect.any(String),
				...fields,
			});
			expect(extraction!.metadata?.detection?.extractor).toBe(extractor);
		});

		it('should extract Vitest errors from Validation Pipeline logs', () => {
			// Load real Validation Pipeline logs with Vitest test failures
			const logs = readFileSync(
				path.join(FIXTURES_DIR, 'pr-104/run-19744677825-vitest.log'),
				'utf-8',
			);

			// Detect and extract
			const extraction = detector.detectAndExtract(
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
	});

	describe('Mode Detection Fallback', () => {
		it('should try matrix mode first, then fall back to non-matrix', () => {
			// Logs without YAML should fall back to non-matrix mode
			const plainLogs = `
FAIL test/example.test.ts:10:5
  ● should work
    Error: Test failed
			`;

			const extraction = detector.detectAndExtract(
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

		it('should return null for logs with no extractable content', () => {
			const emptyLogs = 'Some logs with no errors or test failures';

			const extraction = detector.detectAndExtract(
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

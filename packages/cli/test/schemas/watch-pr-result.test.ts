/**
 * Tests for Watch PR Result Schemas
 *
 * TDD approach: Tests written BEFORE implementation
 * These tests define the expected behavior of the schema validation.
 *
 * @packageDocumentation
 */

import { describe, expect, it } from 'vitest';

import {
  CacheInfoSchema,
  ChangesContextSchema,
  CheckConclusionSchema,
  CheckHistorySummarySchema,
  CheckStatusSchema,
  ChecksSummarySchema,
  ExternalCheckDetailsSchema,
  ExternalCheckSchema,
  FileChangeSchema,
  GitHubActionCheckSchema,
  GuidanceSchema,
  LinkedIssueSchema,
  MergeStateStatusSchema,
  NextStepSchema,
  PRMetadataSchema,
  SeveritySchema,
  WatchPRResultSchema,
  type WatchPRResult,
} from '../../src/schemas/watch-pr-result.schema.js';

describe('Watch PR Result Schemas', () => {
  describe('Enum Schemas', () => {
    it('should validate CheckStatus enum', () => {
      expect(() => CheckStatusSchema.parse('queued')).not.toThrow();
      expect(() => CheckStatusSchema.parse('in_progress')).not.toThrow();
      expect(() => CheckStatusSchema.parse('completed')).not.toThrow();
      expect(() => CheckStatusSchema.parse('invalid')).toThrow();
    });

    it('should validate CheckConclusion enum', () => {
      expect(() => CheckConclusionSchema.parse('success')).not.toThrow();
      expect(() => CheckConclusionSchema.parse('failure')).not.toThrow();
      expect(() => CheckConclusionSchema.parse('neutral')).not.toThrow();
      expect(() => CheckConclusionSchema.parse('cancelled')).not.toThrow();
      expect(() => CheckConclusionSchema.parse('skipped')).not.toThrow();
      expect(() => CheckConclusionSchema.parse('timed_out')).not.toThrow();
      expect(() => CheckConclusionSchema.parse('action_required')).not.toThrow();
      expect(() => CheckConclusionSchema.parse('invalid')).toThrow();
    });

    it('should validate MergeStateStatus enum', () => {
      expect(() => MergeStateStatusSchema.parse('CLEAN')).not.toThrow();
      expect(() => MergeStateStatusSchema.parse('UNSTABLE')).not.toThrow();
      expect(() => MergeStateStatusSchema.parse('BLOCKED')).not.toThrow();
      expect(() => MergeStateStatusSchema.parse('INVALID')).toThrow();
    });

    it('should validate Severity enum', () => {
      expect(() => SeveritySchema.parse('error')).not.toThrow();
      expect(() => SeveritySchema.parse('warning')).not.toThrow();
      expect(() => SeveritySchema.parse('info')).not.toThrow();
      expect(() => SeveritySchema.parse('critical')).toThrow();
    });
  });

  describe('LinkedIssueSchema', () => {
    it('should validate valid linked issue', () => {
      const validIssue = {
        number: 86,
        title: 'Windows CI failures',
        url: 'https://github.com/jdutton/vibe-validate/issues/86',
      };

      expect(() => LinkedIssueSchema.parse(validIssue)).not.toThrow();
    });

    it('should reject malformed URL', () => {
      const invalidIssue = {
        number: 86,
        title: 'Test',
        url: 'not-a-url',
      };

      expect(() => LinkedIssueSchema.parse(invalidIssue)).toThrow();
    });

    it('should reject missing required fields', () => {
      expect(() => LinkedIssueSchema.parse({ number: 86 })).toThrow();
      expect(() => LinkedIssueSchema.parse({ title: 'Test' })).toThrow();
    });
  });

  describe('PRMetadataSchema', () => {
    it('should validate complete PR metadata', () => {
      const validPR = {
        number: 90,
        title: 'fix: Improve Windows platform independence',
        url: 'https://github.com/jdutton/vibe-validate/pull/90',
        branch: 'fix/windows-shell-independence',
        base_branch: 'main',
        author: 'jdutton',
        draft: false,
        mergeable: true,
        merge_state_status: 'UNSTABLE',
        labels: ['bug', 'windows'],
        linked_issues: [
          {
            number: 86,
            title: 'Windows CI failures',
            url: 'https://github.com/jdutton/vibe-validate/issues/86',
          },
        ],
      };

      expect(() => PRMetadataSchema.parse(validPR)).not.toThrow();
    });

    it('should accept PR without linked issues', () => {
      const prWithoutIssues = {
        number: 90,
        title: 'Test PR',
        url: 'https://github.com/org/repo/pull/90',
        branch: 'feature',
        base_branch: 'main',
        author: 'user',
        draft: false,
        mergeable: true,
        merge_state_status: 'CLEAN',
        labels: [],
      };

      expect(() => PRMetadataSchema.parse(prWithoutIssues)).not.toThrow();
    });

    it('should reject invalid merge_state_status', () => {
      const invalidPR = {
        number: 90,
        title: 'Test',
        url: 'https://github.com/org/repo/pull/90',
        branch: 'feature',
        base_branch: 'main',
        author: 'user',
        draft: false,
        mergeable: true,
        merge_state_status: 'INVALID',
        labels: [],
      };

      expect(() => PRMetadataSchema.parse(invalidPR)).toThrow();
    });

    it('should reject malformed URL', () => {
      const invalidPR = {
        number: 90,
        title: 'Test',
        url: 'not-a-url',
        branch: 'feature',
        base_branch: 'main',
        author: 'user',
        draft: false,
        mergeable: true,
        merge_state_status: 'CLEAN',
        labels: [],
      };

      expect(() => PRMetadataSchema.parse(invalidPR)).toThrow();
    });
  });

  describe('GitHubActionCheckSchema', () => {
    it('should validate complete GitHub Actions check', () => {
      const validCheck = {
        name: 'Run vibe-validate validation (windows-latest, 22)',
        status: 'completed',
        conclusion: 'success',
        run_id: 20275647370,
        workflow: 'Validation Pipeline',
        started_at: '2025-12-16T16:43:17Z',
        duration: '2m15s',
        log_command: 'gh run view 20275647370 --log',
        // eslint-disable-next-line sonarjs/publicly-writable-directories -- test fixture path
        log_file: '/tmp/vibe-validate/watch-pr/90/github-actions/20275647370.log',
      };

      expect(() => GitHubActionCheckSchema.parse(validCheck)).not.toThrow();
    });

    it('should validate check with extraction (matrix mode)', () => {
      const checkWithExtraction = {
        name: 'Validation (windows-latest, 22)',
        status: 'completed',
        conclusion: 'failure',
        run_id: 20275647370,
        workflow: 'Validation Pipeline',
        started_at: '2025-12-16T16:43:17Z',
        duration: '2m15s',
        log_command: 'gh run view 20275647370 --log',
        extraction: {
          summary: '1 test failure',
          totalErrors: 1,
          errors: [
            {
              file: 'test.ts',
              line: 42,
              message: 'Expected success',
            },
          ],
        },
      };

      expect(() => GitHubActionCheckSchema.parse(checkWithExtraction)).not.toThrow();
    });

    it('should accept check without conclusion (in progress)', () => {
      const inProgressCheck = {
        name: 'Test',
        status: 'in_progress',
        run_id: 123,
        workflow: 'CI',
        started_at: '2025-12-16T16:43:17Z',
        duration: '0s',
        log_command: 'gh run view 123 --log',
      };

      expect(() => GitHubActionCheckSchema.parse(inProgressCheck)).not.toThrow();
    });

    it('should reject invalid datetime format', () => {
      const invalidCheck = {
        name: 'Test',
        status: 'completed',
        run_id: 123,
        workflow: 'CI',
        started_at: 'not-a-datetime',
        duration: '2m',
        log_command: 'gh run view 123 --log',
      };

      expect(() => GitHubActionCheckSchema.parse(invalidCheck)).toThrow();
    });

    it('should accept check with log_file field', () => {
      const checkWithLogFile = {
        name: 'Tests',
        status: 'completed',
        conclusion: 'failure',
        run_id: 123,
        workflow: 'CI',
        started_at: '2025-12-16T16:43:17Z',
        duration: '2m15s',
        log_command: 'gh run view 123 --log',
        // eslint-disable-next-line sonarjs/publicly-writable-directories -- test fixture path
        log_file: '/tmp/vibe-validate/watch-pr-logs/123-14-30-45-integration-tests.log',
      };

      expect(() => GitHubActionCheckSchema.parse(checkWithLogFile)).not.toThrow();
    });

    it('should accept check without log_file field', () => {
      const checkWithoutLogFile = {
        name: 'Tests',
        status: 'completed',
        conclusion: 'success',
        run_id: 456,
        workflow: 'CI',
        started_at: '2025-12-16T16:43:17Z',
        duration: '3m00s',
        log_command: 'gh run view 456 --log',
      };

      expect(() => GitHubActionCheckSchema.parse(checkWithoutLogFile)).not.toThrow();
    });

    it('should accept log_file with VV_TEMP_DIR format', () => {
      const checkWithVVTempDir = {
        name: 'Build (ubuntu-latest, 22)',
        status: 'completed',
        conclusion: 'failure',
        run_id: 789,
        job_id: 101112,
        workflow: 'CI',
        started_at: '2025-12-16T16:43:17Z',
        duration: '5m30s',
        log_command: 'gh run view 789 --log-failed',
        // eslint-disable-next-line sonarjs/publicly-writable-directories -- test fixture path
        log_file: '/tmp/vibe-validate/watch-pr-logs/789-09-15-30-build-ubuntu-latest-22.log',
      };

      expect(() => GitHubActionCheckSchema.parse(checkWithVVTempDir)).not.toThrow();
    });

    it('should accept empty log_file string (schema allows it)', () => {
      const checkWithEmptyLogFile = {
        name: 'Tests',
        status: 'completed',
        conclusion: 'failure',
        run_id: 999,
        workflow: 'CI',
        started_at: '2025-12-16T16:43:17Z',
        duration: '1m00s',
        log_command: 'gh run view 999 --log',
        log_file: '',
      };

      // Current schema accepts empty strings (could be tightened in future)
      expect(() => GitHubActionCheckSchema.parse(checkWithEmptyLogFile)).not.toThrow();
    });

    it('should accept log_file with timestamped filename format', () => {
      const checkWithTimestampedLog = {
        name: 'Tests',
        status: 'completed',
        conclusion: 'failure',
        run_id: 12345,
        workflow: 'CI',
        started_at: '2025-12-16T16:43:17Z',
        duration: '2m00s',
        log_command: 'gh run view 12345 --log',
        // eslint-disable-next-line sonarjs/publicly-writable-directories -- test fixture path
        log_file: '/tmp/vibe-validate/watch-pr-logs/12345-14-30-45-integration-tests.log',
      };

      expect(() => GitHubActionCheckSchema.parse(checkWithTimestampedLog)).not.toThrow();
    });
  });

  describe('ExternalCheckDetailsSchema', () => {
    it('should validate external check details', () => {
      const validDetails = {
        summary: 'Coverage decreased by 2.3%',
        details: {
          base_coverage: 85.2,
          head_coverage: 82.9,
          files_affected: 2,
        },
        severity: 'warning',
      };

      expect(() => ExternalCheckDetailsSchema.parse(validDetails)).not.toThrow();
    });

    it('should accept minimal details (summary only)', () => {
      const minimalDetails = {
        summary: 'Quality gate failed',
      };

      expect(() => ExternalCheckDetailsSchema.parse(minimalDetails)).not.toThrow();
    });
  });

  describe('ExternalCheckSchema', () => {
    it('should validate external check with extraction', () => {
      const validCheck = {
        name: 'codecov/patch',
        status: 'completed',
        conclusion: 'failure',
        url: 'https://app.codecov.io/gh/jdutton/vibe-validate/pull/90',
        provider: 'codecov',
        extracted: {
          summary: 'Coverage decreased by 2.3%',
          severity: 'warning',
        },
      };

      expect(() => ExternalCheckSchema.parse(validCheck)).not.toThrow();
    });

    it('should accept check without extraction', () => {
      const checkWithoutExtraction = {
        name: 'unknown-check',
        status: 'completed',
        conclusion: 'success',
        url: 'https://example.com/check',
      };

      expect(() => ExternalCheckSchema.parse(checkWithoutExtraction)).not.toThrow();
    });

    it('should accept check with extraction_error', () => {
      const checkWithError = {
        name: 'codecov/patch',
        status: 'completed',
        conclusion: 'failure',
        url: 'https://app.codecov.io/gh/org/repo/pull/1',
        provider: 'codecov',
        extracted: null,
        extraction_error: 'Failed to parse codecov response',
      };

      expect(() => ExternalCheckSchema.parse(checkWithError)).not.toThrow();
    });

    it('should reject malformed URL', () => {
      const invalidCheck = {
        name: 'test',
        status: 'completed',
        url: 'not-a-url',
      };

      expect(() => ExternalCheckSchema.parse(invalidCheck)).toThrow();
    });
  });

  describe('CheckHistorySummarySchema', () => {
    it('should validate history summary', () => {
      const validSummary = {
        total_runs: 8,
        recent_pattern: 'Passed last 2 runs (was failing before)',
        success_rate: '75%',
      };

      expect(() => CheckHistorySummarySchema.parse(validSummary)).not.toThrow();
    });

    it('should accept summary without success_rate', () => {
      const minimalSummary = {
        total_runs: 1,
        recent_pattern: 'First run',
      };

      expect(() => CheckHistorySummarySchema.parse(minimalSummary)).not.toThrow();
    });
  });

  describe('ChecksSummarySchema', () => {
    it('should validate complete checks summary', () => {
      const validSummary = {
        total: 9,
        passed: 7,
        failed: 2,
        pending: 0,
        history_summary: {
          total_runs: 8,
          recent_pattern: 'Passed last 2 runs',
          success_rate: '75%',
        },
        github_actions: [
          {
            name: 'Test',
            status: 'completed',
            conclusion: 'success',
            run_id: 123,
            workflow: 'CI',
            started_at: '2025-12-16T16:43:17Z',
            duration: '2m',
            log_command: 'gh run view 123 --log',
          },
        ],
        external_checks: [
          {
            name: 'codecov/patch',
            status: 'completed',
            conclusion: 'success',
            url: 'https://codecov.io/check',
          },
        ],
      };

      expect(() => ChecksSummarySchema.parse(validSummary)).not.toThrow();
    });

    it('should accept summary without history_summary', () => {
      const summaryWithoutHistory = {
        total: 1,
        passed: 1,
        failed: 0,
        pending: 0,
        github_actions: [],
        external_checks: [],
      };

      expect(() => ChecksSummarySchema.parse(summaryWithoutHistory)).not.toThrow();
    });

    it('should validate counts match arrays', () => {
      // Note: This is a logical validation, not schema validation
      // We could add a custom refinement for this later
      const summary = {
        total: 2,
        passed: 2,
        failed: 0,
        pending: 0,
        github_actions: [
          {
            name: 'Test',
            status: 'completed',
            conclusion: 'success',
            run_id: 123,
            workflow: 'CI',
            started_at: '2025-12-16T16:43:17Z',
            duration: '2m',
            log_command: 'gh run view 123 --log',
          },
        ],
        external_checks: [
          {
            name: 'codecov',
            status: 'completed',
            conclusion: 'success',
            url: 'https://codecov.io',
          },
        ],
      };

      expect(() => ChecksSummarySchema.parse(summary)).not.toThrow();
    });
  });

  describe('FileChangeSchema', () => {
    it('should validate file change', () => {
      const validChange = {
        file: 'packages/cli/src/commands/run.ts',
        insertions: 117,
        deletions: 30,
      };

      expect(() => FileChangeSchema.parse(validChange)).not.toThrow();
    });

    it('should validate new file', () => {
      const newFile = {
        file: 'packages/utils/test/path-helpers.test.ts',
        insertions: 211,
        deletions: 0,
        new_file: true,
      };

      expect(() => FileChangeSchema.parse(newFile)).not.toThrow();
    });
  });

  describe('ChangesContextSchema', () => {
    it('should validate complete changes context', () => {
      const validContext = {
        files_changed: 20,
        insertions: 991,
        deletions: 210,
        commits: 13,
        top_files: [
          {
            file: 'packages/cli/src/commands/create-extractor.ts',
            insertions: 117,
            deletions: 30,
          },
        ],
      };

      expect(() => ChangesContextSchema.parse(validContext)).not.toThrow();
    });

    it('should accept context without top_files', () => {
      const minimalContext = {
        files_changed: 1,
        insertions: 10,
        deletions: 5,
        commits: 1,
      };

      expect(() => ChangesContextSchema.parse(minimalContext)).not.toThrow();
    });
  });

  describe('NextStepSchema', () => {
    it('should validate next step with URL', () => {
      const validStep = {
        action: 'Review code coverage decrease',
        url: 'https://app.codecov.io/gh/org/repo/pull/90',
        severity: 'warning',
        reason: 'Coverage dropped 2.3% on changed files',
      };

      expect(() => NextStepSchema.parse(validStep)).not.toThrow();
    });

    it('should accept step without URL or reason', () => {
      const minimalStep = {
        action: 'Fix tests',
        severity: 'error',
      };

      expect(() => NextStepSchema.parse(minimalStep)).not.toThrow();
    });
  });

  describe('GuidanceSchema', () => {
    it('should validate complete guidance', () => {
      const validGuidance = {
        status: 'failed',
        blocking: false,
        severity: 'warning',
        summary: '2 external quality checks failed. All functional validation passed.',
        next_steps: [
          {
            action: 'Review code coverage',
            url: 'https://codecov.io',
            severity: 'warning',
            reason: 'Coverage decreased',
          },
        ],
      };

      expect(() => GuidanceSchema.parse(validGuidance)).not.toThrow();
    });

    it('should accept guidance without next_steps', () => {
      const minimalGuidance = {
        status: 'passed',
        blocking: false,
        severity: 'info',
        summary: 'All checks passed',
      };

      expect(() => GuidanceSchema.parse(minimalGuidance)).not.toThrow();
    });
  });

  describe('CacheInfoSchema', () => {
    it('should validate cache info', () => {
      const validCache = {
        // eslint-disable-next-line sonarjs/publicly-writable-directories -- test fixture path
        location: '/tmp/vibe-validate/vibe-validate/watch-pr/90',
        cached_at: '2025-12-16T16:45:50Z',
        expires_at: '2025-12-16T16:50:50Z',
      };

      expect(() => CacheInfoSchema.parse(validCache)).not.toThrow();
    });

    it('should reject invalid datetime', () => {
      const invalidCache = {
        // eslint-disable-next-line sonarjs/publicly-writable-directories -- test fixture path
        location: '/tmp/cache',
        cached_at: 'not-a-datetime',
        expires_at: '2025-12-16T16:50:50Z',
      };

      expect(() => CacheInfoSchema.parse(invalidCache)).toThrow();
    });
  });

  describe('WatchPRResultSchema', () => {
    it('should validate minimal valid result', () => {
      const minimalResult: WatchPRResult = {
        pr: {
          number: 90,
          title: 'Test PR',
          url: 'https://github.com/org/repo/pull/90',
          branch: 'feature',
          base_branch: 'main',
          author: 'user',
          draft: false,
          mergeable: true,
          merge_state_status: 'CLEAN',
          labels: [],
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
      };

      expect(() => WatchPRResultSchema.parse(minimalResult)).not.toThrow();
    });

    it('should validate complete result with all fields', () => {
      const completeResult: WatchPRResult = {
        pr: {
          number: 90,
          title: 'fix: Improve Windows platform independence',
          url: 'https://github.com/jdutton/vibe-validate/pull/90',
          branch: 'fix/windows-shell-independence',
          base_branch: 'main',
          author: 'jdutton',
          draft: false,
          mergeable: true,
          merge_state_status: 'UNSTABLE',
          labels: ['bug', 'windows'],
          linked_issues: [
            {
              number: 86,
              title: 'Windows CI failures',
              url: 'https://github.com/jdutton/vibe-validate/issues/86',
            },
          ],
        },
        status: 'failed',
        checks: {
          total: 9,
          passed: 7,
          failed: 2,
          pending: 0,
          history_summary: {
            total_runs: 8,
            recent_pattern: 'Passed last 2 runs',
            success_rate: '75%',
          },
          github_actions: [
            {
              name: 'Validation (windows-latest, 22)',
              status: 'completed',
              conclusion: 'failure',
              run_id: 20275647370,
              workflow: 'Validation Pipeline',
              started_at: '2025-12-16T16:43:17Z',
              duration: '2m15s',
              log_command: 'gh run view 20275647370 --log',
              extraction: {
                summary: '1 test failure',
                totalErrors: 1,
                errors: [
                  {
                    file: 'test.ts',
                    line: 42,
                    message: 'Expected success',
                  },
                ],
              },
            },
          ],
          external_checks: [
            {
              name: 'codecov/patch',
              status: 'completed',
              conclusion: 'failure',
              url: 'https://app.codecov.io/gh/jdutton/vibe-validate/pull/90',
              provider: 'codecov',
              extracted: {
                summary: 'Coverage decreased by 2.3%',
                severity: 'warning',
              },
            },
          ],
        },
        changes: {
          files_changed: 20,
          insertions: 991,
          deletions: 210,
          commits: 13,
          top_files: [
            {
              file: 'packages/cli/src/commands/create-extractor.ts',
              insertions: 117,
              deletions: 30,
            },
          ],
        },
        guidance: {
          status: 'failed',
          blocking: false,
          severity: 'warning',
          summary: '2 external quality checks failed.',
          next_steps: [
            {
              action: 'Review code coverage',
              url: 'https://codecov.io',
              severity: 'warning',
              reason: 'Coverage decreased',
            },
          ],
        },
        cache: {
          // eslint-disable-next-line sonarjs/publicly-writable-directories -- test fixture path
          location: '/tmp/vibe-validate/vibe-validate/watch-pr/90',
          cached_at: '2025-12-16T16:45:50Z',
          expires_at: '2025-12-16T16:50:50Z',
        },
      };

      expect(() => WatchPRResultSchema.parse(completeResult)).not.toThrow();
    });

    it('should reject invalid status enum', () => {
      const invalidResult = {
        pr: {
          number: 90,
          title: 'Test',
          url: 'https://github.com/org/repo/pull/90',
          branch: 'feature',
          base_branch: 'main',
          author: 'user',
          draft: false,
          mergeable: true,
          merge_state_status: 'CLEAN',
          labels: [],
        },
        status: 'INVALID',
        checks: {
          total: 0,
          passed: 0,
          failed: 0,
          pending: 0,
          github_actions: [],
          external_checks: [],
        },
      };

      expect(() => WatchPRResultSchema.parse(invalidResult)).toThrow();
    });

    it('should reject result with missing required fields', () => {
      const incompleteResult = {
        pr: {
          number: 90,
          title: 'Test',
          url: 'https://github.com/org/repo/pull/90',
        },
        status: 'passed',
      };

      expect(() => WatchPRResultSchema.parse(incompleteResult)).toThrow();
    });
  });

  describe('Type inference', () => {
    it('should infer correct TypeScript types', () => {
      // This is a compile-time test - if it compiles, types are correct
      const result: WatchPRResult = {
        pr: {
          number: 90,
          title: 'Test',
          url: 'https://github.com/org/repo/pull/90',
          branch: 'feature',
          base_branch: 'main',
          author: 'user',
          draft: false,
          mergeable: true,
          merge_state_status: 'CLEAN',
          labels: [],
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
      };

      // Should compile without errors
      expect(result.pr.number).toBe(90);
      expect(result.status).toBe('passed');
    });
  });
});

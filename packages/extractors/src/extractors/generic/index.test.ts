/**
 * Generic Extractor Tests
 *
 * @package @vibe-validate/extractors
 */

import { describe, it, expect } from 'vitest';

import {
  expectDetection,
  expectPluginMetadata,
} from '../../test/helpers/extractor-test-helpers.js';
import type { ErrorExtractorResult } from '../../types.js';

import genericExtractor from './index.js';

const { extract: extractGenericErrors } = genericExtractor;

function expectErrorSummary(
  result: ErrorExtractorResult,
  expectations: { has?: string[]; missing?: string[] }
): void {
  for (const text of expectations.has ?? []) {
    expect(result.errorSummary).toContain(text);
  }
  for (const text of expectations.missing ?? []) {
    expect(result.errorSummary).not.toContain(text);
  }
}

/**
 * Build an input that on its own satisfies the multi-key YAML heuristic
 * (3 top-level keys + 5 meaningful lines), then appends the given trailer
 * line. Used by both the log-indicator disqualifier tests and the
 * threshold-boundary tests.
 */
function qualifyingYamlPlus(trailer: string): string {
  return `status: ok
phase: build
step: compile
detail: foo
note: bar
${trailer}
`;
}

/** Body-only lines that ARE preserved by the YAML path but dropped by the keyword filter. */
const YAML_ONLY_BODY = ['phase: build', 'detail: foo', 'note: bar'];

describe('Generic Extractor Plugin', () => {
  describe('detect', () => {
    it('should always return low confidence (fallback)', () => {
      expectDetection(
        genericExtractor,
        'Any random output text that does not match any specific format',
        {
          confidence: 10,
          patterns: ['Generic fallback'],
          reasonContains: 'Fallback extractor',
        }
      );
      expect(genericExtractor).toBeDefined();
    });

    it('should return same confidence for any input', () => {
      expectDetection(
        genericExtractor,
        'FAILED tests/test.py - Error',
        {
          confidence: 10,
        }
      );
      expect(genericExtractor).toBeDefined();
    });
  });

  describe('metadata', () => {
    it('should have correct plugin metadata', () => {
      expectPluginMetadata(genericExtractor, {
        name: 'generic',
        priority: 10,
        tags: ['generic', 'fallback'],
      });
      expect(genericExtractor).toBeDefined();
    });

    it('should have undefined hints (accepts everything)', () => {
      expect(genericExtractor.hints).toBeUndefined();
    });

    it('should have samples', () => {
      expect(genericExtractor.samples).toBeDefined();
      expect(genericExtractor.samples.length).toBeGreaterThan(0);
    });
  });

  describe('Python pytest output', () => {
    it('should extract error lines from pytest output', () => {
      const pytestOutput = `
FAILED tests/test_foo.py::test_divide - ZeroDivisionError
FAILED tests/test_bar.py::test_validate - AssertionError
2 failed, 3 passed
`;

      const result = extractGenericErrors(pytestOutput);

      expect(result.summary).toBe('Command failed - see output');
      expect(result.errorSummary).toContain('FAILED');
      expect(result.errorSummary).toContain('ZeroDivisionError');
    });
  });

  describe('Go test output', () => {
    it('should extract FAIL lines from Go output', () => {
      const goOutput = `
--- FAIL: TestDivide (0.00s)
panic: runtime error
FAIL example.com/project 0.123s
`;

      const result = extractGenericErrors(goOutput);

      expect(result.errorSummary).toContain('FAIL: TestDivide');
      expect(result.errorSummary).toContain('panic:');
    });
  });

  describe('Token efficiency', () => {
    it('should limit errorSummary to 20 lines max', () => {
      const manyErrors = Array.from({ length: 50 }, (_, i) =>
        `FAILED test${i}.py - Error`
      ).join('\n');

      const result = extractGenericErrors(manyErrors);

      const lineCount = (result.errorSummary ?? '').split('\n').length;
      expect(lineCount).toBeLessThanOrEqual(20);
    });
  });

  describe('Data integrity', () => {
    it('should always have totalErrors = 0 (generic doesnt populate errors array)', () => {
      const result = extractGenericErrors('FAILED test - error');
      expect(result.totalErrors).toBe(0);
      expect(result.errors).toEqual([]);
    });
  });

  describe('Structured YAML output preservation', () => {
    const vatYamlOutput = `status: failed
filesScanned: 248
filesWithErrors: 1
errorsFound: 1
errorSummary:
  broken_file: 1
durationSecs: 1.45
validationMode: strict
collections:
  adrs:
    resourceCount: 5
    hasSchema: true
    validationMode: permissive
  processes:
    resourceCount: 10
    hasSchema: true
    validationMode: permissive
  systems:
    resourceCount: 28
    hasSchema: true
    validationMode: permissive
  teams:
    resourceCount: 2
    hasSchema: true
    validationMode: permissive
errors:
  - file: /fixtures/repo/CLAUDE.md
    errors:
      - line: 28
        column: 1
        type: broken_file
        message: "Link target is a directory: /fixtures/repo/docs/teams"
`;

    it('should preserve YAML value lines, not just keys', () => {
      expectErrorSummary(extractGenericErrors(vatYamlOutput), {
        has: [
          'broken_file: 1',
          '/fixtures/repo/CLAUDE.md',
          'line: 28',
          'message: "Link target is a directory',
        ],
      });
    });

    it('should preserve all top-level YAML keys', () => {
      expectErrorSummary(extractGenericErrors(vatYamlOutput), {
        has: ['status:', 'filesScanned:', 'filesWithErrors:', 'errorsFound:', 'errorSummary:', 'errors:'],
      });
    });

    it('should report Command failed summary when YAML output indicates failure', () => {
      const result = extractGenericErrors(vatYamlOutput);
      expect(result.summary).toBe('Command failed - see output');
    });

    // ---- Log-indicator disqualifier tests ----------------------------------
    //
    // Each input below satisfies the multi-key heuristic on its own
    // (>= 3 top-level keys, >= 5 meaningful lines) AND contains exactly one
    // log-indicator line. If the log indicator did not disqualify the input,
    // `looksLikeYaml` would return true and `summary` would be set to
    // 'Command failed - see output' (YAML preservation path). We detect
    // "fell through to keyword filter" by asserting `summary` is the
    // benign value the keyword filter produces when no error keywords match.
    //
    // Note: each input below intentionally uses error-keyword-free body lines
    // (`status: ok`, `phase: build`, etc.) and a log indicator that is NOT
    // itself an error keyword recognised by the keyword filter — so when the
    // disqualifier rejects YAML preservation, the keyword filter sees no
    // matches and reports 'No errors detected'.

    it('Traceback line disqualifies YAML preservation', () => {
      // 'Traceback' is itself an ERROR_KEYWORD, so the keyword filter would still
      // set summary to 'Command failed'. Distinguish the two paths by asserting
      // YAML-only body lines were dropped.
      expectErrorSummary(extractGenericErrors(qualifyingYamlPlus('Traceback (most recent call last):')), {
        missing: YAML_ONLY_BODY,
      });
    });

    it('npm ERR! line disqualifies YAML preservation', () => {
      // `npm ERR!` is also a NOISE_PATTERN, so both paths strip the line itself.
      // Summary distinguishes: YAML path sets 'Command failed'; keyword filter
      // with no matches sets 'No errors detected'.
      const result = extractGenericErrors(qualifyingYamlPlus('npm ERR! code ELIFECYCLE'));
      expect(result.summary).toBe('No errors detected');
    });

    it('stack frame ("at /...") line disqualifies YAML preservation', () => {
      // 'at ' is an ERROR_KEYWORD, so distinguish via YAML-only body lines.
      expectErrorSummary(extractGenericErrors(qualifyingYamlPlus('    at /home/user/app/index.js:42:9')), {
        missing: YAML_ONLY_BODY,
      });
    });

    it('caret indicator line disqualifies YAML preservation', () => {
      // Bare `^^^^` matches no error keyword, so `summary` cleanly distinguishes.
      const result = extractGenericErrors(qualifyingYamlPlus('    ^^^^'));
      expect(result.summary).toBe('No errors detected');
    });

    // ---- Threshold-boundary tests ------------------------------------------

    it('exactly 3 top-level keys + 5 meaningful lines is preserved as YAML', () => {
      // 3 root keys (status, phase, step) + 2 indented continuation lines =
      // exactly 5 meaningful lines. Indented lines do not count as
      // top-level keys, so this lands exactly on both floors.
      const input = `status: ok
phase: build
step: compile
  detail: foo
  note: bar
`;
      const result = extractGenericErrors(input);
      expect(result.summary).toBe('Command failed - see output');
      // Indented body lines are preserved on the YAML path; the keyword
      // filter would drop them.
      expectErrorSummary(result, {
        has: ['status: ok', 'phase: build', 'detail: foo', 'note: bar'],
      });
    });

    it('2 top-level keys + 10 meaningful lines falls through to keyword filter', () => {
      // Two top-level keys; remaining lines are indented (so they do NOT
      // increment the top-level key count) but they are non-blank /
      // non-noise, so meaningfulLineCount >= 5.
      const input = `status: ok
details:
  one: 1
  two: 2
  three: 3
  four: 4
  five: 5
  six: 6
  seven: 7
  eight: 8
`;
      const result = extractGenericErrors(input);
      expect(result.summary).toBe('No errors detected');
    });

    it('3 top-level keys + 4 meaningful lines falls through to keyword filter', () => {
      // 3 root keys (status, phase, step) + 1 indented continuation line =
      // 4 meaningful lines total, below the 5-line floor.
      const input = `status: ok
phase: build
step: compile
  nested: thing
`;
      const result = extractGenericErrors(input);
      expect(result.summary).toBe('No errors detected');
    });

    it('should truncate structured YAML output longer than 80 lines', () => {
      const header = 'status: failed\nphase: build\nstep: compile\n';
      const longBody = Array.from({ length: 200 }, (_, i) => `  key${i}: value${i}`).join('\n');
      const longYaml = `${header}details:\n${longBody}\n`;

      const result = extractGenericErrors(longYaml);

      const lines = (result.errorSummary ?? '').split('\n');
      expect(lines.length).toBeLessThanOrEqual(81);
      const lastLine = lines.at(-1) ?? '';
      // Marker must be a YAML comment (`# ...`) so downstream YAML parsers
      // treat the truncation note as a comment rather than a doc-end marker.
      expect(lastLine.startsWith('# ')).toBe(true);
      // Header contributes 4 lines ("status:", "phase:", "step:", "details:"),
      // plus 200 body lines, plus 1 trailing empty line from the closing `\n`
      // (`buildYamlResult` keeps blank lines). 205 - 80 = 125 omitted.
      const denoisedTotal = 4 + 200 + 1;
      const omitted = denoisedTotal - 80;
      expect(lastLine).toContain(`${omitted} additional lines omitted`);
    });
  });

  describe('Delimited (---bracketed) YAML extraction', () => {
    it('detects ---bracketed YAML and extracts only the YAML block', () => {
      const input = `preamble line 1
> npm install
---
status: ok
key: value
---
trailing log line
more trailing
`;
      expectErrorSummary(extractGenericErrors(input), {
        has: ['---', 'status: ok', 'key: value'],
        missing: ['preamble line 1', '> npm install', 'trailing log line', 'more trailing'],
      });
    });

    it('stops at non-YAML line when no closing --- exists', () => {
      const input = `---
foo: 1
bar: 2
this is not yaml
more log
`;
      expectErrorSummary(extractGenericErrors(input), {
        has: ['---', 'foo: 1', 'bar: 2'],
        missing: ['this is not yaml', 'more log'],
      });
    });

    it('comments and blank lines between --- and first key are allowed', () => {
      const input = `---
# header comment

key: value
`;
      expectErrorSummary(extractGenericErrors(input), {
        has: ['---', '# header comment', 'key: value'],
      });
    });

    it('--- alone followed by a non-YAML line is rejected (falls through)', () => {
      const input = `---
this is garbage not yaml
more stuff
`;
      const result = extractGenericErrors(input);

      // YAML preservation path would set summary to 'Command failed - see output'.
      // Falling through to keyword filter with no error keywords yields 'No errors detected'.
      expect(result.summary).toBe('No errors detected');
    });

    it('closing ... terminates the block', () => {
      const input = `---
key: value
...
after the ellipsis line
`;
      expectErrorSummary(extractGenericErrors(input), {
        has: ['---', 'key: value', '...'],
        missing: ['after the ellipsis line'],
      });
    });

    it('VAT-style output (no ---) still goes through the multi-key heuristic', () => {
      const vatYamlOutput = `status: failed
filesScanned: 248
filesWithErrors: 1
errorsFound: 1
errorSummary:
  broken_file: 1
durationSecs: 1.45
validationMode: strict
collections:
  adrs:
    resourceCount: 5
    hasSchema: true
    validationMode: permissive
errors:
  - file: /fixtures/repo/CLAUDE.md
    errors:
      - line: 28
        column: 1
        type: broken_file
        message: "Link target is a directory: /fixtures/repo/docs/teams"
`;
      const result = extractGenericErrors(vatYamlOutput);
      expect(result.summary).toBe('Command failed - see output');
      expectErrorSummary(result, {
        has: ['status: failed', 'filesScanned: 248', '/fixtures/repo/CLAUDE.md', 'line: 28'],
      });
    });
  });

  describe('Non-YAML output still keyword-filtered', () => {
    it('should not include non-error log lines for free-form logs', () => {
      const pytestLog = `Loading config from /etc/pytest.ini
Collecting tests
Loading plugin: coverage
Starting test session
FAILED tests/test_foo.py::test_divide - ZeroDivisionError
FAILED tests/test_bar.py::test_validate - AssertionError
2 failed, 3 passed
Done`;

      const result = extractGenericErrors(pytestLog);

      expect(result.errorSummary).toContain('FAILED');
      expect(result.errorSummary).not.toContain('Loading config');
      expect(result.errorSummary).not.toContain('Loading plugin');
    });
  });

  describe('Plugin Samples', () => {
    it('should pass all registered samples', () => {
      for (const sample of genericExtractor.samples) {
        expect(sample.input).toBeDefined();
        const result = extractGenericErrors(sample.input ?? '');
        const expected = sample.expected;
        if (expected?.totalErrors !== undefined) {
          expect(result.totalErrors).toBe(expected.totalErrors);
        }
      }
    });
  });
});

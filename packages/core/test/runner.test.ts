 
/* eslint-disable sonarjs/deprecation */
 
 
import type { ChildProcess } from 'node:child_process';
import { readFileSync, unlinkSync, existsSync, readdirSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';

import { getGitTreeHash } from '@vibe-validate/git';
import { mkdirSyncReal, normalizedTmpdir } from '@vibe-validate/utils';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  parseFailures,
  runStepsInParallel,
  runValidation,
  setupSignalHandlers,
} from '../src/runner.js';
import type { ValidationConfig, ValidationStep } from '../src/types.js';

// Mock git functions
vi.mock('@vibe-validate/git', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getGitTreeHash: vi.fn(),
  };
});

describe('runner', () => {
  let testDir: string;

  beforeEach(() => {
    // Create temp directory for test files
    testDir = join(normalizedTmpdir(), `vibe-validate-test-${Date.now()}`);
    if (!existsSync(testDir)) {
      mkdirSyncReal(testDir, { recursive: true });
    }

    // Mock git tree hash to return consistent value
    vi.mocked(getGitTreeHash).mockResolvedValue('test-tree-hash-abc123' as Awaited<ReturnType<typeof getGitTreeHash>>);

    // Spy on console.log to reduce noise
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    // Clean up test files
    if (existsSync(testDir)) {
      try {
        const files = readdirSync(testDir);
        for (const file of files) {
          unlinkSync(join(testDir, file));
        }
        rmdirSync(testDir);
      } catch {
        // Ignore cleanup errors
      }
    }

    vi.restoreAllMocks();
  });

  // Note: getGitTreeHash is tested in packages/git/test/tree-hash.test.ts
  // These tests focus on runner logic, with getGitTreeHash mocked

  describe('parseFailures', () => {
    it('should extract Vitest test failures', () => {
      const output = `
        ❌ should test something
        ❌ should test another thing
        Some other output
      `;

      const failures = parseFailures(output);

      expect(failures).toHaveLength(2);
      expect(failures[0]).toContain('should test something');
      expect(failures[1]).toContain('should test another thing');
    });

    it('should extract TypeScript errors', () => {
      const output = `
        src/index.ts(10,5): error TS2322: Type 'string' is not assignable to type 'number'
        src/utils.ts(25,12): error TS2345: Argument of type 'number' is not assignable
      `;

      const failures = parseFailures(output);

      expect(failures.length).toBeGreaterThan(0);
      expect(failures.some(f => f.includes('TS2322'))).toBe(true);
    });

    it('should extract ESLint errors', () => {
      const output = `
        src/index.ts(10,5): error no-unused-vars
        src/utils.ts(25,12): warning prefer-const
      `;

      const failures = parseFailures(output);

      expect(failures.length).toBeGreaterThan(0);
    });

    it('should limit to 10 failures', () => {
      const output = Array.from({ length: 20 }, (_, i) => `❌ test ${i}`).join('\n');

      const failures = parseFailures(output);

      expect(failures.length).toBeLessThanOrEqual(10);
    });

    it('should return empty array if no failures found', () => {
      const output = 'All tests passed successfully!';

      const failures = parseFailures(output);

      expect(failures).toHaveLength(0);
    });
  });

  describe('runStepsInParallel', () => {
    it('should run multiple steps in parallel', async () => {
      const steps: ValidationStep[] = [
        { name: 'Step1', command: 'node -e "console.log(\'test1\')"' },
        { name: 'Step2', command: 'node -e "console.log(\'test2\')"' },
      ];

      const result = await runStepsInParallel(steps, 'Test Phase', {});

      expect(result.success).toBe(true);
      expect(result.outputs.size).toBe(2);
      expect(result.stepResults).toHaveLength(2);
      expect(result.stepResults[0].passed).toBe(true);
      expect(result.stepResults[1].passed).toBe(true);
    });

    it('should detect failed step', async () => {
      const steps: ValidationStep[] = [
        { name: 'Success', command: 'node -e "console.log(\'ok\')"' },
        { name: 'Failure', command: 'node -e "process.exit(1)"' },
      ];

      const result = await runStepsInParallel(steps, 'Test Phase', {});

      expect(result.success).toBe(false);
      expect(result.failedStep?.name).toBe('Failure');
    });

    it('should capture stdout and stderr', async () => {
      const steps: ValidationStep[] = [
        { name: 'Output', command: 'node -e "console.log(\'stdout\'); console.error(\'stderr\')"' },
      ];

      const result = await runStepsInParallel(steps, 'Test Phase', {});

      const output = result.outputs.get('Output');
      expect(output).toContain('stdout');
      expect(output).toContain('stderr');
    });

    it('should track step duration', async () => {
      const steps: ValidationStep[] = [
        { name: 'Quick', command: 'node -e "setTimeout(() => process.exit(0), 100)"' },
      ];

      const result = await runStepsInParallel(steps, 'Test Phase', {});

      expect(result.stepResults[0].durationSecs).toBeGreaterThan(0.05);
    });

    it('should pass environment variables to child processes', async () => {
      const steps: ValidationStep[] = [
        // Use Node.js to print env var for cross-platform compatibility
        // (Unix: $TEST_VAR, Windows cmd: %TEST_VAR%, Windows PS: $env:TEST_VAR)
        { name: 'EnvTest', command: 'node -e "console.log(process.env.TEST_VAR)"' },
      ];

      const result = await runStepsInParallel(steps, 'Test Phase', {
        env: {
          TEST_VAR: 'test-value',
        },
      });

      const output = result.outputs.get('EnvTest');
      expect(output).toContain('test-value');
    });

    it('should handle fail-fast mode (kill other processes on first failure)', async () => {
      const steps: ValidationStep[] = [
        { name: 'Fast', command: 'node -e "process.exit(1)"' },
        { name: 'Slow', command: 'node -e "setTimeout(() => { console.log(\'done\'); process.exit(0); }, 5000)"' },
      ];

      const startTime = Date.now();
      const result = await runStepsInParallel(steps, 'Test Phase', { enableFailFast: true });
      const duration = Date.now() - startTime;

      expect(result.success).toBe(false);
      expect(duration).toBeLessThan(4000); // Should not wait for 5s sleep
    });

    it('should not kill other processes when fail-fast disabled', async () => {
      const steps: ValidationStep[] = [
        { name: 'Fast', command: 'node -e "process.exit(1)"' },
        { name: 'Quick', command: 'node -e "console.log(\'done\')"' },
      ];

      const result = await runStepsInParallel(steps, 'Test Phase', {});

      expect(result.success).toBe(false);
      // Both steps should complete
      expect(result.stepResults).toHaveLength(2);
    });

    it('should provide meaningful extraction for killed processes (fail-fast)', async () => {
      const steps: ValidationStep[] = [
        { name: 'Fast Fail', command: 'node -e "process.exit(1)"' },
        { name: 'Slow Process', command: 'node -e "setTimeout(() => { console.log(\'done\'); process.exit(0); }, 10000)"' },
      ];

      const result = await runStepsInParallel(steps, 'Test Phase', { enableFailFast: true });

      expect(result.success).toBe(false);
      expect(result.stepResults).toHaveLength(2);

      // Find the killed process step
      const killedStep = result.stepResults.find(s => s.name === 'Slow Process');
      expect(killedStep).toBeDefined();
      expect(killedStep!.passed).toBe(false);
      expect(killedStep!.exitCode).not.toBe(0);

      // Should have meaningful extraction, not "0 errors"
      expect(killedStep!.extraction).toBeDefined();
      expect(killedStep!.extraction!.summary).toContain('stopped');
      expect(killedStep!.extraction!.summary).toContain('fail-fast');
      expect(killedStep!.extraction!.guidance).toBeDefined();
      expect(killedStep!.extraction!.guidance).toContain('terminated');
    });

    it('should handle step with no output', async () => {
      const steps: ValidationStep[] = [
        { name: 'Silent', command: 'true' },
      ];

      const result = await runStepsInParallel(steps, 'Test Phase', {});

      expect(result.success).toBe(true);
      expect(result.outputs.get('Silent')).toBeDefined();
    });
  });

  describe('runValidation', () => {
    it('should run validation phases sequentially', async () => {
      const config: ValidationConfig = {
        phases: [
          {
            name: 'Phase1',
            parallel: true,
            steps: [{ name: 'Step1', command: 'node -e "console.log(\'phase1\')"' }],
          },
          {
            name: 'Phase2',
            parallel: true,
            steps: [{ name: 'Step2', command: 'node -e "console.log(\'phase2\')"' }],
          },
        ],
        logPath: join(testDir, 'log.txt'),
      };

      const result = await runValidation(config);

      expect(result.passed).toBe(true);
      expect(result.phases).toHaveLength(2);
      expect(result.phases![0].name).toBe('Phase1');
      expect(result.phases![1].name).toBe('Phase2');
    });

    it('should stop on first failed phase', async () => {
      const config: ValidationConfig = {
        phases: [
          {
            name: 'Pass',
            parallel: true,
            steps: [{ name: 'Ok', command: 'node -e "console.log(\'ok\')"' }],
          },
          {
            name: 'Fail',
            parallel: true,
            steps: [{ name: 'Bad', command: 'node -e "process.exit(1)"' }],
          },
          {
            name: 'Skip',
            parallel: true,
            steps: [{ name: 'Never', command: 'node -e "console.log(\'skipped\')"' }],
          },
        ],
        logPath: join(testDir, 'log.txt'),
      };

      const result = await runValidation(config);

      expect(result.passed).toBe(false);
      expect(result.failedStep).toBe('Bad');
      expect(result.phases).toHaveLength(2); // Should not run third phase
    });

    // Note: State file persistence tests removed in v0.12.0
    // Caching is now handled at CLI layer via git notes (see packages/cli/src/commands/validate.ts)

    it('should call onPhaseStart callback', async () => {
      const phaseStartCallback = vi.fn();

      const config: ValidationConfig = {
        phases: [
          {
            name: 'Test',
            parallel: true,
            steps: [{ name: 'Step', command: 'node -e "console.log(\'test\')"' }],
          },
        ],
        logPath: join(testDir, 'log.txt'),
        onPhaseStart: phaseStartCallback,
      };

      await runValidation(config);

      expect(phaseStartCallback).toHaveBeenCalledWith(config.phases[0]);
    });

    it('should call onPhaseComplete callback', async () => {
      const phaseCompleteCallback = vi.fn();

      const config: ValidationConfig = {
        phases: [
          {
            name: 'Test',
            parallel: true,
            steps: [{ name: 'Step', command: 'node -e "console.log(\'test\')"' }],
          },
        ],
        logPath: join(testDir, 'log.txt'),
        onPhaseComplete: phaseCompleteCallback,
      };

      await runValidation(config);

      expect(phaseCompleteCallback).toHaveBeenCalledWith(
        config.phases[0],
        expect.objectContaining({
          name: 'Test',
          passed: true,
        })
      );
    });

    it('should include failed step output in result', async () => {
      const config: ValidationConfig = {
        phases: [
          {
            name: 'Fail',
            parallel: true,
            // Use output >50 chars to avoid fail-fast heuristic (see runner.ts:711)
            steps: [{ name: 'Bad', command: 'node -e "console.log(\'This is an error message with enough content to trigger extraction properly\'); process.exit(1)"' }],
          },
        ],
        logPath: join(testDir, 'log.txt'),
      };

      const result = await runValidation(config);

      expect(result.passed).toBe(false);
      // Check extraction at step level instead of removed failedStepOutput
      expect(result.phases).toBeDefined();
      expect(result.phases![0].steps[0].extraction).toBeDefined();
      expect(result.phases![0].steps[0].extraction!.errorSummary).toBeDefined();
      expect(result.phases![0].steps[0].extraction!.errorSummary).toContain('error message');
    });

    it('should write log file with all outputs', async () => {
      const logFile = join(testDir, 'log.txt');
      const config: ValidationConfig = {
        phases: [
          {
            name: 'Test',
            parallel: true,
            steps: [
              { name: 'Step1', command: 'node -e "console.log(\'output1\')"' },
              { name: 'Step2', command: 'node -e "console.log(\'output2\')"' },
            ],
          },
        ],
        logPath: logFile,
      };

      await runValidation(config);

      expect(existsSync(logFile)).toBe(true);

      const logContent = readFileSync(logFile, 'utf8');
      expect(logContent).toContain('output1');
      expect(logContent).toContain('output2');
    });
  });

  describe('setupSignalHandlers', () => {
    it('should register SIGTERM handler', () => {
      const activeProcesses = new Set();
      const onSpy = vi.spyOn(process, 'on');

      setupSignalHandlers(activeProcesses);

      expect(onSpy).toHaveBeenCalledWith('SIGTERM', expect.any(Function));
    });

    it('should register SIGINT handler', () => {
      const activeProcesses = new Set();
      const onSpy = vi.spyOn(process, 'on');

      setupSignalHandlers(activeProcesses);

      expect(onSpy).toHaveBeenCalledWith('SIGINT', expect.any(Function));
    });
  });

  describe('extractionQuality behavior', () => {
    describe('developerFeedback=false (default)', () => {
      it('should NOT include extractionQuality when developerFeedback is false', async () => {
        // TDD: This test should FAIL initially
        const config: ValidationConfig = {
          phases: [
            {
              name: 'Test Phase',
              steps: [
                {
                  name: 'Failing Step',
                  command: 'node -e "process.exit(1)"', // Intentional failure
                },
              ],
            },
          ],
          env: {},
          enableFailFast: false,
          developerFeedback: false, // Explicitly false (also the default)
        };

        const result = await runValidation(config);

        // Assert: ValidationResult should NOT have extractionQuality field
        expect(result.phases).toBeDefined();
        expect(result.phases![0].steps).toBeDefined();
        const failedStep = result.phases![0].steps[0];

        expect(failedStep.passed).toBe(false);
        // This should NOT exist when developerFeedback is false
        expect(failedStep.extractionQuality).toBeUndefined();
      });
    });

    describe('developerFeedback=true', () => {
      it('should include extraction metadata when developerFeedback is true and test fails', async () => {
        // When developerFeedback is enabled, extractors include metadata
        // Runner no longer adds redundant extractionQuality field
        const config: ValidationConfig = {
          phases: [
            {
              name: 'Test Phase',
              steps: [
                {
                  name: 'Failing Step',
                  command: 'node -e "console.log(\'ERROR: test failed\'); process.exit(1)"',
                },
              ],
            },
          ],
          env: {},
          enableFailFast: false,
          developerFeedback: true, // Enable contributor mode
        };

        const result = await runValidation(config);

        // Assert: extraction.metadata should exist (from extractor)
        expect(result.phases).toBeDefined();
        expect(result.phases![0].steps).toBeDefined();
        const failedStep = result.phases![0].steps[0];

        expect(failedStep.passed).toBe(false);
        // Extraction should have metadata from the extractor
        expect(failedStep.extraction).toBeDefined();
        expect(failedStep.extraction!.metadata).toBeDefined();
        expect(failedStep.extraction!.metadata).toHaveProperty('confidence');
        expect(failedStep.extraction!.metadata).toHaveProperty('completeness');
        expect(failedStep.extraction!.metadata!.detection).toBeDefined();
        // extractionQuality should NOT be present (would be redundant)
        expect(failedStep.extractionQuality).toBeUndefined();
      });

      it('should NOT include extractionQuality for passing tests', async () => {
        // TDD: This test should FAIL initially
        // Rationale: Passing tests have no failures to extract, score would always be 0 (meaningless)
        const config: ValidationConfig = {
          phases: [
            {
              name: 'Test Phase',
              steps: [
                {
                  name: 'Passing Step',
                  command: 'node -e "console.log(\'success\'); process.exit(0)"',
                },
              ],
            },
          ],
          env: {},
          enableFailFast: false,
          developerFeedback: true, // Even with this enabled...
        };

        const result = await runValidation(config);

        // Assert: extractionQuality should NOT exist for passing tests
        expect(result.phases).toBeDefined();
        expect(result.phases![0].steps).toBeDefined();
        const passingStep = result.phases![0].steps[0];

        expect(passingStep.passed).toBe(true);
        // Should NOT extract on success - no failures to extract!
        expect(passingStep.extractionQuality).toBeUndefined();
      });
    });

    describe('YAML frontmatter parsing (nested run commands)', () => {
      it.skipIf(process.platform === 'win32')('should parse YAML frontmatter and extract clean file paths', async () => {
        // Skipped on Windows: command execution with nested JSON.stringify quoting needs fix
        // This test reproduces the bug where preamble lines were shown as file paths
        // Scenario: Step outputs preamble + YAML (like `pnpm lint` which wraps `run "eslint"`)
        const yamlOutput = String.raw`
> vibe-validate@ lint /Users/jeff/Workspaces/vibe-validate
> node packages/cli/dist/bin.js run "eslint --max-warnings=0 \"packages/**/*.ts\""

---
command: eslint --max-warnings=0 "packages/**/*.ts"
exitCode: 1
extraction:
  errors:
    - file: packages/core/src/runner.ts
      line: 349
      column: 21
      severity: error
      message: Review this redundant assignment
      code: sonarjs/no-redundant-assignments
    - file: packages/cli/src/commands/run.ts
      line: 220
      column: 23
      severity: error
      message: Complete the task associated to this TODO comment
      code: sonarjs/todo-tag
  summary: 2 ESLint error(s), 0 warning(s)
  totalErrors: 2
rawOutput: ""
`.trim();

        const config: ValidationConfig = {
          phases: [
            {
              name: 'Test Phase',
              steps: [
                {
                  name: 'ESLint with YAML',
                  // Use single quotes for -e (works with shell:true on all platforms)
                  command: 'node -e ' + JSON.stringify(`console.log(${JSON.stringify(yamlOutput)}); process.exit(1)`),
                },
              ],
            },
          ],
          env: {},
          enableFailFast: false,
        };

        const result = await runValidation(config);

        // Verify: Validation failed
        expect(result.passed).toBe(false);

        // Check extraction at step level (failedTests removed)
        const extraction = result.phases![0].steps[0].extraction;
        expect(extraction).toBeDefined();
        expect(extraction!.errors.length).toBe(2);

        // CRITICAL: File paths should be clean (NOT include preamble)
        // BAD:  "> node packages/cli/dist/bin.js run \"eslint...\":349 - error"
        // GOOD: "packages/core/src/runner.ts:349 - error"
        const errors = extraction!.errors;

        // First error - should have clean file path
        expect(errors[0].file).toBe('packages/core/src/runner.ts');
        expect(errors[0].line).toBe(349);
        expect(errors[0].message).toContain('Review this redundant assignment');

        // Second error - should have clean file path
        expect(errors[1].file).toBe('packages/cli/src/commands/run.ts');
        expect(errors[1].line).toBe(220);
        expect(errors[1].message).toContain('Complete the task');
      });

      it('should fallback to autoDetectAndExtract if YAML parsing fails', async () => {
        // Scenario: Output has --- but YAML is invalid
        const invalidYamlOutput = `
> preamble line

---
this is not valid: yaml: syntax
invalid indentation
  bad structure
`.trim();

        const config: ValidationConfig = {
          phases: [
            {
              name: 'Test Phase',
              steps: [
                {
                  name: 'Invalid YAML',
                  // Use JSON.stringify to properly quote and escape for shell:true
                  command: 'node -e ' + JSON.stringify(`console.log(${JSON.stringify(invalidYamlOutput)}); process.exit(1)`),
                },
              ],
            },
          ],
          env: {},
          enableFailFast: false,
        };

        const result = await runValidation(config);

        // Should still run (fallback to generic extractor)
        expect(result.passed).toBe(false);
        // No crash, validation completes
      });

      it.skipIf(process.platform === 'win32')('should handle YAML with Windows line endings', async () => {
        // Skipped on Windows: command execution with nested JSON.stringify quoting needs fix
        // Scenario: YAML separator with \r\n instead of \n
        const windowsYamlOutput = [
          '> preamble line',
          '> another preamble',
          '',
          '---',
          'command: test',
          'exitCode: 1',
          'extraction:',
          '  errors:',
          '    - file: test.ts',
          '      line: 10',
          '      message: Test error',
          '  summary: 1 error',
          '  totalErrors: 1',
          'rawOutput: ""',
        ].join('\r\n');

        const config: ValidationConfig = {
          phases: [
            {
              name: 'Test Phase',
              steps: [
                {
                  name: 'Windows YAML',
                  // Use JSON.stringify to properly quote and escape for shell:true
                  command: 'node -e ' + JSON.stringify(`console.log(${JSON.stringify(windowsYamlOutput)}); process.exit(1)`),
                },
              ],
            },
          ],
          env: {},
          enableFailFast: false,
        };

        const result = await runValidation(config);

        // Should parse Windows line endings correctly
        expect(result.passed).toBe(false);

        // Check extraction at step level (failedTests removed)
        const extraction = result.phases![0].steps[0].extraction;
        expect(extraction).toBeDefined();
        expect(extraction!.errors.length).toBe(1);
        expect(extraction!.errors[0].file).toContain('test.ts');
        expect(extraction!.errors[0].line).toBe(10);
      });

      it('should not detect --- inside error messages as YAML separator', async () => {
        // Scenario: Error message contains "---" but it's not YAML frontmatter
        const outputWithDashesInError = `
Error: Something went wrong
--- this is part of the error message ---
Not YAML frontmatter

/path/to/file.ts:42:10: error Something bad happened
`.trim();

        const config: ValidationConfig = {
          phases: [
            {
              name: 'Test Phase',
              steps: [
                {
                  name: 'Dashes in error',
                  // Use JSON.stringify to properly quote and escape for shell:true
                  command: 'node -e ' + JSON.stringify(`console.log(${JSON.stringify(outputWithDashesInError)}); process.exit(1)`),
                },
              ],
            },
          ],
          env: {},
          enableFailFast: false,
        };

        const result = await runValidation(config);

        // Should use autoDetectAndExtract (not try to parse as YAML)
        expect(result.passed).toBe(false);
        // Validation completes without crashing
      });

      it.skipIf(process.platform === 'win32')('should use first --- separator when multiple exist', async () => {
        // Skipped on Windows: command execution with nested JSON.stringify quoting needs fix
        // Scenario: Multiple --- separators (first one is the YAML separator)
        const multipleYamlOutput = `
> preamble

---
command: test
exitCode: 1
extraction:
  errors:
    - file: first.ts
      line: 1
      message: First error
  summary: 1 error
  totalErrors: 1
rawOutput: |
  Some raw output that contains
  ---
  another separator
  ---
  but these should be ignored
`.trim();

        const config: ValidationConfig = {
          phases: [
            {
              name: 'Test Phase',
              steps: [
                {
                  name: 'Multiple separators',
                  // Use JSON.stringify to properly quote and escape for shell:true
                  command: 'node -e ' + JSON.stringify(`console.log(${JSON.stringify(multipleYamlOutput)}); process.exit(1)`),
                },
              ],
            },
          ],
          env: {},
          enableFailFast: false,
        };

        const result = await runValidation(config);

        // Should parse using first --- separator
        expect(result.passed).toBe(false);

        // Check extraction at step level (failedTests removed)
        const extraction = result.phases![0].steps[0].extraction;
        expect(extraction).toBeDefined();
        expect(extraction!.errors.length).toBe(1);
        expect(extraction!.errors[0].file).toContain('first.ts');
        expect(extraction!.errors[0].line).toBe(1);
      });
    });
  });

  describe('outputFiles creation', () => {
    it('should create output files for failing steps', async () => {
      const config: ValidationConfig = {
        phases: [
          {
            name: 'Test Phase',
            parallel: true,
            steps: [
              {
                name: 'Failing Step',
                command: 'node -e "console.log(\'error output\'); process.exit(1)"',
              },
            ],
          },
        ],
        env: {},
        enableFailFast: false,
        debug: false, // Debug off, but should still create files for failing step
      };

      const result = await runValidation(config);

      expect(result.passed).toBe(false);
      expect(result.phases).toBeDefined();
      expect(result.phases![0].steps[0].outputFiles).toBeDefined();

      const outputFiles = result.phases![0].steps[0].outputFiles;
      expect(outputFiles?.combined).toBeDefined();
      // Normalize path separators for Windows (\ -> /)
      const normalizedPath = outputFiles?.combined?.replaceAll('\\', '/');
      expect(normalizedPath).toContain('/vibe-validate/steps/');
      expect(outputFiles?.combined).toContain('.jsonl');

      // Verify files exist
      const { existsSync, readFileSync } = await import('node:fs');
      expect(existsSync(outputFiles!.combined)).toBe(true);

      // Verify combined.jsonl has timestamped entries
      const combinedContent = readFileSync(outputFiles!.combined, 'utf-8');
      expect(combinedContent).toContain('"ts":"');
      expect(combinedContent).toContain('"stream":"stdout"');
      expect(combinedContent).toContain('"line":"error output"');
    });

    it('should create output files for all steps when debug mode is enabled', async () => {
      const config: ValidationConfig = {
        phases: [
          {
            name: 'Test Phase',
            parallel: true,
            steps: [
              {
                name: 'Passing Step',
                command: 'node -e "console.log(\'success output\'); process.exit(0)"',
              },
            ],
          },
        ],
        env: {},
        enableFailFast: false,
        debug: true, // Debug mode: create files even for passing steps
      };

      const result = await runValidation(config);

      expect(result.passed).toBe(true);
      expect(result.phases).toBeDefined();
      expect(result.phases![0].steps[0].outputFiles).toBeDefined();

      const outputFiles = result.phases![0].steps[0].outputFiles;
      expect(outputFiles?.combined).toBeDefined();
      expect(outputFiles?.stdout).toBeDefined();

      // Verify files exist
      const { existsSync, readFileSync } = await import('node:fs');
      expect(existsSync(outputFiles!.combined)).toBe(true);
      expect(existsSync(outputFiles!.stdout!)).toBe(true);

      // Verify stdout.log has content
      const stdoutContent = readFileSync(outputFiles!.stdout!, 'utf-8');
      expect(stdoutContent).toContain('success output');
    });

    it('should NOT create output files for passing steps without debug mode', async () => {
      const config: ValidationConfig = {
        phases: [
          {
            name: 'Test Phase',
            parallel: true,
            steps: [
              {
                name: 'Passing Step',
                command: 'node -e "console.log(\'success\'); process.exit(0)"',
              },
            ],
          },
        ],
        env: {},
        enableFailFast: false,
        debug: false, // No debug: passing steps should not create files
      };

      const result = await runValidation(config);

      expect(result.passed).toBe(true);
      expect(result.phases).toBeDefined();

      // outputFiles should be undefined for passing step without debug
      const outputFiles = result.phases![0].steps[0].outputFiles;
      expect(outputFiles).toBeUndefined();
    });

    it('should create stdout and stderr files when both are present', async () => {
      const config: ValidationConfig = {
        phases: [
          {
            name: 'Test Phase',
            parallel: true,
            steps: [
              {
                name: 'Mixed Output Step',
                command: 'node -e "console.log(\'stdout line\'); console.error(\'stderr line\'); process.exit(1)"',
              },
            ],
          },
        ],
        env: {},
        enableFailFast: false,
        debug: false,
      };

      const result = await runValidation(config);

      expect(result.passed).toBe(false);

      const outputFiles = result.phases![0].steps[0].outputFiles;
      expect(outputFiles?.stdout).toBeDefined();
      expect(outputFiles?.stderr).toBeDefined();
      expect(outputFiles?.combined).toBeDefined();

      // Verify file contents
      const { readFileSync } = await import('node:fs');
      const stdoutContent = readFileSync(outputFiles!.stdout!, 'utf-8');
      const stderrContent = readFileSync(outputFiles!.stderr!, 'utf-8');

      expect(stdoutContent).toContain('stdout line');
      expect(stderrContent).toContain('stderr line');
    });

    it('should use step name in output directory path', async () => {
      const config: ValidationConfig = {
        phases: [
          {
            name: 'Test Phase',
            parallel: true,
            steps: [
              {
                name: 'TypeScript Compiler',
                command: 'node -e "console.log(\'error\'); process.exit(1)"',
              },
            ],
          },
        ],
        env: {},
        enableFailFast: false,
        debug: false,
      };

      const result = await runValidation(config);

      const outputFiles = result.phases![0].steps[0].outputFiles;
      expect(outputFiles?.combined).toBeDefined();

      // Path should contain sanitized step name
      expect(outputFiles!.combined).toContain('-typescript-compiler');
    });

    it('should handle multiple failing steps with separate output files', async () => {
      const config: ValidationConfig = {
        phases: [
          {
            name: 'Test Phase',
            parallel: true,
            steps: [
              {
                name: 'Step 1',
                command: 'node -e "console.log(\'step1 error\'); process.exit(1)"',
              },
              {
                name: 'Step 2',
                command: 'node -e "console.log(\'step2 error\'); process.exit(1)"',
              },
            ],
          },
        ],
        env: {},
        enableFailFast: false,
        debug: false,
      };

      const result = await runValidation(config);

      expect(result.passed).toBe(false);

      const step1Files = result.phases![0].steps.find(s => s.name === 'Step 1')?.outputFiles;
      const step2Files = result.phases![0].steps.find(s => s.name === 'Step 2')?.outputFiles;

      expect(step1Files).toBeDefined();
      expect(step2Files).toBeDefined();

      // Different steps should have different output directories
      expect(step1Files!.combined).not.toBe(step2Files!.combined);
      expect(step1Files!.combined).toContain('-step-1');
      expect(step2Files!.combined).toContain('-step-2');

      // Verify content is different
      const { readFileSync } = await import('node:fs');
      const step1Content = readFileSync(step1Files!.combined, 'utf-8');
      const step2Content = readFileSync(step2Files!.combined, 'utf-8');

      expect(step1Content).toContain('step1 error');
      expect(step2Content).toContain('step2 error');
    });
  });

  describe('ValidationResult outputFiles (top-level)', () => {
    it('should include top-level outputFiles with debug mode enabled (passing)', async () => {
      const config: ValidationConfig = {
        phases: [
          {
            name: 'Test Phase',
            parallel: true,
            steps: [
              {
                name: 'Passing Step',
                command: 'node -e "console.log(\'success\'); process.exit(0)"',
              },
            ],
          },
        ],
        env: {},
        enableFailFast: false,
        debug: true, // Enable debug mode
      };

      const result = await runValidation(config);

      expect(result.passed).toBe(true);
      expect(result.outputFiles).toBeDefined();
      expect(result.outputFiles?.combined).toBeDefined();
      // Normalize path separators for Windows (\ -> /)
      const normalizedPath1 = result.outputFiles?.combined?.replaceAll('\\', '/');
      expect(normalizedPath1).toContain('/validation-');
      expect(result.outputFiles?.combined).toContain('.log');

      // Verify file exists
      const { existsSync } = await import('node:fs');
      expect(existsSync(result.outputFiles!.combined)).toBe(true);
    });

    it('should include top-level outputFiles with debug mode enabled (failing)', async () => {
      const config: ValidationConfig = {
        phases: [
          {
            name: 'Test Phase',
            parallel: true,
            steps: [
              {
                name: 'Failing Step',
                command: 'node -e "console.log(\'error\'); process.exit(1)"',
              },
            ],
          },
        ],
        env: {},
        enableFailFast: false,
        debug: true, // Enable debug mode
      };

      const result = await runValidation(config);

      expect(result.passed).toBe(false);
      expect(result.outputFiles).toBeDefined();
      expect(result.outputFiles?.combined).toBeDefined();
      // Normalize path separators for Windows (\ -> /)
      const normalizedPath2 = result.outputFiles?.combined?.replaceAll('\\', '/');
      expect(normalizedPath2).toContain('/validation-');
      expect(result.outputFiles?.combined).toContain('.log');

      // Verify file exists
      const { existsSync } = await import('node:fs');
      expect(existsSync(result.outputFiles!.combined)).toBe(true);
    });

    it('should NOT include top-level outputFiles without debug mode (passing)', async () => {
      const config: ValidationConfig = {
        phases: [
          {
            name: 'Test Phase',
            parallel: true,
            steps: [
              {
                name: 'Passing Step',
                command: 'node -e "console.log(\'success\'); process.exit(0)"',
              },
            ],
          },
        ],
        env: {},
        enableFailFast: false,
        debug: false, // Debug mode off
      };

      const result = await runValidation(config);

      expect(result.passed).toBe(true);
      expect(result.outputFiles).toBeUndefined();
    });

    it('should NOT include top-level outputFiles without debug mode (failing)', async () => {
      const config: ValidationConfig = {
        phases: [
          {
            name: 'Test Phase',
            parallel: true,
            steps: [
              {
                name: 'Failing Step',
                command: 'node -e "console.log(\'error\'); process.exit(1)"',
              },
            ],
          },
        ],
        env: {},
        enableFailFast: false,
        debug: false, // Debug mode off
      };

      const result = await runValidation(config);

      expect(result.passed).toBe(false);
      expect(result.outputFiles).toBeUndefined();
    });
  });

  describe('plugin loading', () => {
    it('should load plugins when extractors config is provided', async () => {
      // Mock the extractors module
      const mockDiscoverPlugins = vi.fn().mockResolvedValue([
        {
          metadata: { name: 'test-plugin', version: '1.0.0' },
          priority: 100,
          detect: () => ({ confidence: 100, reason: 'test' }),
          extract: () => ({ errors: [], totalErrors: 0 }),
        },
      ]);
      const mockRegisterPlugins = vi.fn();

      vi.doMock('@vibe-validate/extractors', () => ({
        discoverPlugins: mockDiscoverPlugins,
        registerPluginsToRegistry: mockRegisterPlugins,
      }));

      const config: ValidationConfig = {
        phases: [
          {
            name: 'Test',
            steps: [{ name: 'Pass', command: 'node -e "console.log(\'test\')"' }],
          },
        ],
        env: {},
        extractors: {
          localPlugins: {
            trust: 'sandbox',
            disable: [],
          },
        },
      };

      await runValidation(config);

      expect(mockDiscoverPlugins).toHaveBeenCalledWith({ baseDir: expect.any(String) });
      expect(mockRegisterPlugins).toHaveBeenCalledWith(
        expect.any(Array),
        'sandbox'
      );

      vi.doUnmock('@vibe-validate/extractors');
    });

    it('should not attempt plugin loading when extractors config is missing', async () => {
      const mockDiscoverPlugins = vi.fn();
      const mockRegisterPlugins = vi.fn();

      vi.doMock('@vibe-validate/extractors', () => ({
        discoverPlugins: mockDiscoverPlugins,
        registerPluginsToRegistry: mockRegisterPlugins,
      }));

      const config: ValidationConfig = {
        phases: [
          {
            name: 'Test',
            steps: [{ name: 'Pass', command: 'node -e "console.log(\'test\')"' }],
          },
        ],
        env: {},
        // No extractors config
      };

      await runValidation(config);

      expect(mockDiscoverPlugins).not.toHaveBeenCalled();
      expect(mockRegisterPlugins).not.toHaveBeenCalled();

      vi.doUnmock('@vibe-validate/extractors');
    });

    it('should continue validation if plugin loading fails', async () => {
      const mockDiscoverPlugins = vi.fn().mockRejectedValue(new Error('Plugin discovery failed'));

      vi.doMock('@vibe-validate/extractors', () => ({
        discoverPlugins: mockDiscoverPlugins,
        registerPluginsToRegistry: vi.fn(),
      }));

      const config: ValidationConfig = {
        phases: [
          {
            name: 'Test',
            steps: [{ name: 'Pass', command: 'node -e "console.log(\'test\')"' }],
          },
        ],
        env: {},
        extractors: {
          localPlugins: {
            trust: 'sandbox',
            disable: [],
          },
        },
      };

      // Should not throw - validation continues despite plugin failure
      const result = await runValidation(config);
      expect(result.passed).toBe(true);

      vi.doUnmock('@vibe-validate/extractors');
    });
  });

  describe('async error handling', () => {
    /**
     * Helper to mock getGitTreeHash that fails on subsequent calls
     */
    function mockFailingGitTreeHash(errorMessage: string): () => void {
      const originalMock = vi.mocked(getGitTreeHash);
      let callCount = 0;
      vi.mocked(getGitTreeHash).mockImplementation(async () => {
        callCount++;
        if (callCount > 1) {
          throw new Error(errorMessage);
        }
        return 'test-tree-hash' as Awaited<ReturnType<typeof getGitTreeHash>>;
      });
      return () => vi.mocked(getGitTreeHash).mockImplementation(originalMock);
    }

    /**
     * Helper to create validation config for async error tests
     */
    function createAsyncErrorConfig(options: { verbose?: boolean } = {}): ValidationConfig {
      return {
        phases: [
          {
            name: 'Test Phase',
            parallel: true,
            steps: [
              {
                name: 'Failing Step',
                command: 'node -e "console.log(\'error\'); process.exit(1)"',
              },
            ],
          },
        ],
        env: {},
        enableFailFast: false,
        debug: true,
        verbose: options.verbose,
      };
    }

    it('should handle errors in async close handler', async () => {
      const restore = mockFailingGitTreeHash('Git tree hash failed');

      const result = await runValidation(createAsyncErrorConfig());

      expect(result.passed).toBe(false);
      restore();
    });

    it('should log warning when output file creation fails', async () => {
      const consoleLogSpy = vi.spyOn(console, 'log');
      const restore = mockFailingGitTreeHash('Simulated async error');

      await runValidation(createAsyncErrorConfig({ verbose: true }));

      const logOutput = consoleLogSpy.mock.calls.map(call => call.join(' ')).join('\n');
      expect(logOutput).toContain('Could not create output files');
      restore();
    });
  });

  describe('signal handler error paths', () => {
    /**
     * Helper to test signal handler cleanup behavior
     */
    async function testSignalHandler(signalName: 'SIGTERM' | 'SIGINT'): Promise<void> {
      const activeProcesses: Set<ChildProcess> = new Set();
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const processExitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as never);

      setupSignalHandlers(activeProcesses);

      // Get the signal handler
      const handler = process.listeners(signalName).pop() as (() => void);
      expect(handler).toBeDefined();

      // Trigger the handler
      handler();

      // Allow async cleanup to run
      await new Promise((resolve) => {
        setTimeout(resolve, 100);
      });

      // Verify process.exit was called
      expect(processExitSpy).toHaveBeenCalled();
    }

    it('should handle SIGTERM cleanup errors', async () => {
      await testSignalHandler('SIGTERM');
    });

    it('should handle SIGINT cleanup errors', async () => {
      await testSignalHandler('SIGINT');
    });
  });
});

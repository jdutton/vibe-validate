import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync, unlinkSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getGitTreeHash } from '@vibe-validate/git';
import {
  parseFailures,
  runStepsInParallel,
  runValidation,
  setupSignalHandlers,
} from '../src/runner.js';
import type { ValidationConfig, ValidationStep } from '../src/types.js';

// Mock git functions
vi.mock('@vibe-validate/git', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@vibe-validate/git')>();
  return {
    ...actual,
    getGitTreeHash: vi.fn(),
  };
});

describe('runner', () => {
  let testDir: string;

  beforeEach(() => {
    // Create temp directory for test files
    testDir = join(tmpdir(), `vibe-validate-test-${Date.now()}`);
    if (!existsSync(testDir)) {
      mkdirSync(testDir, { recursive: true });
    }

    // Mock git tree hash to return consistent value
    vi.mocked(getGitTreeHash).mockResolvedValue('test-tree-hash-abc123');

    // Spy on console.log to reduce noise
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    // Clean up test files
    if (existsSync(testDir)) {
      try {
        const files = require('node:fs').readdirSync(testDir);
        for (const file of files) {
          unlinkSync(join(testDir, file));
        }
        require('node:fs').rmdirSync(testDir);
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
        { name: 'Step1', command: 'echo "test1"' },
        { name: 'Step2', command: 'echo "test2"' },
      ];

      const result = await runStepsInParallel(steps, 'Test Phase', false);

      expect(result.success).toBe(true);
      expect(result.outputs.size).toBe(2);
      expect(result.stepResults).toHaveLength(2);
      expect(result.stepResults[0].passed).toBe(true);
      expect(result.stepResults[1].passed).toBe(true);
    });

    it('should detect failed step', async () => {
      const steps: ValidationStep[] = [
        { name: 'Success', command: 'echo "ok"' },
        { name: 'Failure', command: 'exit 1' },
      ];

      const result = await runStepsInParallel(steps, 'Test Phase', false);

      expect(result.success).toBe(false);
      expect(result.failedStep?.name).toBe('Failure');
    });

    it('should capture stdout and stderr', async () => {
      const steps: ValidationStep[] = [
        { name: 'Output', command: 'echo "stdout" && echo "stderr" >&2' },
      ];

      const result = await runStepsInParallel(steps, 'Test Phase', false);

      const output = result.outputs.get('Output');
      expect(output).toContain('stdout');
      expect(output).toContain('stderr');
    });

    it('should track step duration', async () => {
      const steps: ValidationStep[] = [
        { name: 'Quick', command: 'sleep 0.1' },
      ];

      const result = await runStepsInParallel(steps, 'Test Phase', false);

      expect(result.stepResults[0].durationSecs).toBeGreaterThan(0.05);
    });

    it('should pass environment variables to child processes', async () => {
      const steps: ValidationStep[] = [
        // Use Node.js to print env var for cross-platform compatibility
        // (Unix: $TEST_VAR, Windows cmd: %TEST_VAR%, Windows PS: $env:TEST_VAR)
        { name: 'EnvTest', command: 'node -e "console.log(process.env.TEST_VAR)"' },
      ];

      const result = await runStepsInParallel(steps, 'Test Phase', false, {
        TEST_VAR: 'test-value',
      });

      const output = result.outputs.get('EnvTest');
      expect(output).toContain('test-value');
    });

    it('should handle fail-fast mode (kill other processes on first failure)', async () => {
      const steps: ValidationStep[] = [
        { name: 'Fast', command: 'exit 1' },
        { name: 'Slow', command: 'sleep 5 && echo "done"' },
      ];

      const startTime = Date.now();
      const result = await runStepsInParallel(steps, 'Test Phase', true);
      const duration = Date.now() - startTime;

      expect(result.success).toBe(false);
      expect(duration).toBeLessThan(4000); // Should not wait for 5s sleep
    });

    it('should not kill other processes when fail-fast disabled', async () => {
      const steps: ValidationStep[] = [
        { name: 'Fast', command: 'exit 1' },
        { name: 'Quick', command: 'echo "done"' },
      ];

      const result = await runStepsInParallel(steps, 'Test Phase', false);

      expect(result.success).toBe(false);
      // Both steps should complete
      expect(result.stepResults).toHaveLength(2);
    });

    it('should handle step with no output', async () => {
      const steps: ValidationStep[] = [
        { name: 'Silent', command: 'true' },
      ];

      const result = await runStepsInParallel(steps, 'Test Phase', false);

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
            steps: [{ name: 'Step1', command: 'echo "phase1"' }],
          },
          {
            name: 'Phase2',
            parallel: true,
            steps: [{ name: 'Step2', command: 'echo "phase2"' }],
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
            steps: [{ name: 'Ok', command: 'echo "ok"' }],
          },
          {
            name: 'Fail',
            parallel: true,
            steps: [{ name: 'Bad', command: 'exit 1' }],
          },
          {
            name: 'Skip',
            parallel: true,
            steps: [{ name: 'Never', command: 'echo "skipped"' }],
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
            steps: [{ name: 'Step', command: 'echo "test"' }],
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
            steps: [{ name: 'Step', command: 'echo "test"' }],
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
            steps: [{ name: 'Bad', command: 'echo "error message" && exit 1' }],
          },
        ],
        logPath: join(testDir, 'log.txt'),
      };

      const result = await runValidation(config);

      expect(result.passed).toBe(false);
      expect(result.failedStepOutput).toContain('error message');
    });

    it('should write log file with all outputs', async () => {
      const logFile = join(testDir, 'log.txt');
      const config: ValidationConfig = {
        phases: [
          {
            name: 'Test',
            parallel: true,
            steps: [
              { name: 'Step1', command: 'echo "output1"' },
              { name: 'Step2', command: 'echo "output2"' },
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
                  command: 'exit 1', // Intentional failure
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
        const failedStep = result.phases![0].steps![0];

        expect(failedStep.passed).toBe(false);
        // This should NOT exist when developerFeedback is false
        expect(failedStep.extractionQuality).toBeUndefined();
      });
    });

    describe('developerFeedback=true', () => {
      it('should include extractionQuality when developerFeedback is true and test fails', async () => {
        // TDD: This test should FAIL initially
        const config: ValidationConfig = {
          phases: [
            {
              name: 'Test Phase',
              steps: [
                {
                  name: 'Failing Step',
                  command: 'echo "ERROR: test failed" && exit 1',
                },
              ],
            },
          ],
          env: {},
          enableFailFast: false,
          developerFeedback: true, // Enable contributor mode
        };

        const result = await runValidation(config);

        // Assert: ValidationResult SHOULD have extractionQuality field
        expect(result.phases).toBeDefined();
        expect(result.phases![0].steps).toBeDefined();
        const failedStep = result.phases![0].steps![0];

        expect(failedStep.passed).toBe(false);
        // This SHOULD exist when developerFeedback is true and test fails
        expect(failedStep.extractionQuality).toBeDefined();
        expect(failedStep.extractionQuality).toHaveProperty('score');
        expect(failedStep.extractionQuality).toHaveProperty('confidence');
        expect(failedStep.extractionQuality).toHaveProperty('detectedTool');
        expect(failedStep.extractionQuality).toHaveProperty('actionable');
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
                  command: 'echo "success" && exit 0',
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
        const passingStep = result.phases![0].steps![0];

        expect(passingStep.passed).toBe(true);
        // Should NOT extract on success - no failures to extract!
        expect(passingStep.extractionQuality).toBeUndefined();
      });
    });

    describe('YAML frontmatter parsing (nested run commands)', () => {
      it('should parse YAML frontmatter and extract clean file paths', async () => {
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
  totalCount: 2
rawOutput: ""
`.trim();

        const config: ValidationConfig = {
          phases: [
            {
              name: 'Test Phase',
              steps: [
                {
                  name: 'ESLint with YAML',
                  command: `echo '${yamlOutput.replace(/'/g, String.raw`'\''`)}' && exit 1`,
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
        expect(result.failedTests).toBeDefined();

        // CRITICAL: File paths should be clean (NOT include preamble)
        // BAD:  "> node packages/cli/dist/bin.js run \"eslint...\":349 - error"
        // GOOD: "packages/core/src/runner.ts:349 - error"
        const failedTests = result.failedTests!;
        expect(failedTests.length).toBe(2);

        // First error - should have clean file path
        expect(failedTests[0]).toContain('packages/core/src/runner.ts:349');
        expect(failedTests[0]).toContain('Review this redundant assignment');
        expect(failedTests[0]).not.toContain('> node packages/cli/dist/bin.js');
        expect(failedTests[0]).not.toContain('> vibe-validate@');

        // Second error - should have clean file path
        expect(failedTests[1]).toContain('packages/cli/src/commands/run.ts:220');
        expect(failedTests[1]).toContain('Complete the task');
        expect(failedTests[1]).not.toContain('> node packages/cli/dist/bin.js');
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
                  command: `echo '${invalidYamlOutput.replace(/'/g, String.raw`'\''`)}' && exit 1`,
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

      it('should handle YAML with Windows line endings', async () => {
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
          'rawOutput: ""',
        ].join('\r\n');

        const config: ValidationConfig = {
          phases: [
            {
              name: 'Test Phase',
              steps: [
                {
                  name: 'Windows YAML',
                  command: `printf '${windowsYamlOutput.replace(/'/g, String.raw`'\''`)}' && exit 1`,
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
        expect(result.failedTests).toBeDefined();
        expect(result.failedTests!.length).toBe(1);
        expect(result.failedTests![0]).toContain('test.ts:10');
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
                  command: `echo '${outputWithDashesInError.replace(/'/g, String.raw`'\''`)}' && exit 1`,
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

      it('should use first --- separator when multiple exist', async () => {
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
                  command: `echo '${multipleYamlOutput.replace(/'/g, String.raw`'\''`)}' && exit 1`,
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
        expect(result.failedTests).toBeDefined();
        expect(result.failedTests!.length).toBe(1);
        expect(result.failedTests![0]).toContain('first.ts:1');
      });
    });
  });
});

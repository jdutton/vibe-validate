import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync, unlinkSync, existsSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { getGitTreeHash } from '@vibe-validate/git';
import {
  parseFailures,
  runStepsInParallel,
  runValidation,
  setupSignalHandlers,
} from '../src/runner.js';
import type { ValidationConfig, ValidationStep } from '../src/types.js';

// Mock git functions
vi.mock('@vibe-validate/git', () => ({
  getGitTreeHash: vi.fn(),
}));

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
        const files = require('fs').readdirSync(testDir);
        files.forEach((file: string) => {
          unlinkSync(join(testDir, file));
        });
        require('fs').rmdirSync(testDir);
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
  });
});

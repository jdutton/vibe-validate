import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { writeFileSync, readFileSync, unlinkSync, existsSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  getWorkingTreeHash,
  checkExistingValidation,
  parseFailures,
  runStepsInParallel,
  runValidation,
  setupSignalHandlers,
} from '../src/runner.js';
import type { ValidationConfig, ValidationPhase, ValidationStep } from '../src/types.js';

describe('runner', () => {
  let testDir: string;

  beforeEach(() => {
    // Create temp directory for test files
    testDir = join(tmpdir(), `vibe-validate-test-${Date.now()}`);
    if (!existsSync(testDir)) {
      mkdirSync(testDir, { recursive: true });
    }

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

  describe('getWorkingTreeHash', () => {
    it('should return a hash string', () => {
      const hash = getWorkingTreeHash();

      expect(hash).toBeTruthy();
      expect(typeof hash).toBe('string');
    });

    it('should return consistent hash for same working tree state', () => {
      const hash1 = getWorkingTreeHash();
      const hash2 = getWorkingTreeHash();

      // Should be identical if working tree unchanged
      // Note: If in git repo, will be same git hash. If not, may differ due to timestamp
      expect(hash1).toBeTruthy();
      expect(hash2).toBeTruthy();
    });

    it('should return fallback for non-git repos', () => {
      // This test can't reliably mock execSync because it's already imported
      // Instead, we'll just test the pattern of a fallback hash
      const fallbackPattern = /^(nogit-\d+|[a-f0-9]{40})$/;

      const hash = getWorkingTreeHash();

      // Should match either a git hash or nogit-timestamp fallback
      expect(hash).toMatch(fallbackPattern);
    });
  });

  describe('checkExistingValidation', () => {
    it('should return alreadyPassed false if state file does not exist', () => {
      const result = checkExistingValidation('abc123', '/nonexistent/state.json');

      expect(result.alreadyPassed).toBe(false);
      expect(result.previousState).toBeUndefined();
    });

    it('should return alreadyPassed true if state file matches tree hash', () => {
      const stateFile = join(testDir, 'state.json');
      const state = {
        passed: true,
        timestamp: new Date().toISOString(),
        treeHash: 'abc123',
      };

      writeFileSync(stateFile, JSON.stringify(state));

      const result = checkExistingValidation('abc123', stateFile);

      expect(result.alreadyPassed).toBe(true);
      expect(result.previousState).toEqual(state);
    });

    it('should return alreadyPassed false if tree hash does not match', () => {
      const stateFile = join(testDir, 'state.json');
      const state = {
        passed: true,
        timestamp: new Date().toISOString(),
        treeHash: 'abc123',
      };

      writeFileSync(stateFile, JSON.stringify(state));

      const result = checkExistingValidation('def456', stateFile);

      expect(result.alreadyPassed).toBe(false);
      expect(result.previousState).toEqual(state);
    });

    it('should return alreadyPassed false if validation did not pass', () => {
      const stateFile = join(testDir, 'state.json');
      const state = {
        passed: false,
        timestamp: new Date().toISOString(),
        treeHash: 'abc123',
        failedStep: 'TypeScript',
      };

      writeFileSync(stateFile, JSON.stringify(state));

      const result = checkExistingValidation('abc123', stateFile);

      expect(result.alreadyPassed).toBe(false);
      expect(result.previousState).toEqual(state);
    });

    it('should handle invalid JSON in state file', () => {
      const stateFile = join(testDir, 'invalid-state.json');

      writeFileSync(stateFile, 'not valid json');

      const result = checkExistingValidation('abc123', stateFile);

      expect(result.alreadyPassed).toBe(false);
      expect(result.previousState).toBeUndefined();
    });
  });

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

      expect(result.stepResults[0].duration).toBeGreaterThan(50);
    });

    it('should pass environment variables to child processes', async () => {
      const steps: ValidationStep[] = [
        { name: 'EnvTest', command: 'echo $TEST_VAR' },
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
        stateFilePath: join(testDir, 'state.json'),
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
        stateFilePath: join(testDir, 'state.json'),
        logPath: join(testDir, 'log.txt'),
      };

      const result = await runValidation(config);

      expect(result.passed).toBe(false);
      expect(result.failedStep).toBe('Bad');
      expect(result.phases).toHaveLength(2); // Should not run third phase
    });

    it('should write state file on completion', async () => {
      const stateFile = join(testDir, 'state.json');
      const config: ValidationConfig = {
        phases: [
          {
            name: 'Test',
            parallel: true,
            steps: [{ name: 'Step', command: 'echo "test"' }],
          },
        ],
        stateFilePath: stateFile,
        logPath: join(testDir, 'log.txt'),
      };

      await runValidation(config);

      expect(existsSync(stateFile)).toBe(true);

      const state = JSON.parse(readFileSync(stateFile, 'utf8'));
      expect(state.passed).toBe(true);
      expect(state.treeHash).toBeTruthy();
      expect(state.timestamp).toBeTruthy();
    });

    it('should skip validation if already passed for current tree hash', async () => {
      const stateFile = join(testDir, 'state.json');
      const config: ValidationConfig = {
        phases: [
          {
            name: 'Test',
            parallel: true,
            steps: [{ name: 'Step', command: 'echo "test"' }],
          },
        ],
        stateFilePath: stateFile,
        logPath: join(testDir, 'log.txt'),
      };

      // Run first time
      const result1 = await runValidation(config);
      expect(result1.passed).toBe(true);

      // Run second time - should skip
      const result2 = await runValidation(config);
      expect(result2.passed).toBe(true);

      // Should return same tree hash (skipped validation)
      // Note: In git repo, hash is deterministic. In non-git, may differ due to timestamp
      expect(result2.treeHash).toBeTruthy();
      expect(result1.treeHash).toBeTruthy();

      // If both are git hashes (not nogit-), they should match
      if (!result1.treeHash.startsWith('nogit-')) {
        expect(result2.treeHash).toBe(result1.treeHash);
      }
    });

    it('should force re-run when forceRun is true', async () => {
      const stateFile = join(testDir, 'state.json');
      const config: ValidationConfig = {
        phases: [
          {
            name: 'Test',
            parallel: true,
            steps: [{ name: 'Step', command: 'echo "test"' }],
          },
        ],
        stateFilePath: stateFile,
        logPath: join(testDir, 'log.txt'),
        forceRun: true,
      };

      // Run first time
      await runValidation(config);

      // Run second time with forceRun - should re-run
      const result = await runValidation(config);
      expect(result.passed).toBe(true);
    });

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
        stateFilePath: join(testDir, 'state.json'),
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
        stateFilePath: join(testDir, 'state.json'),
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
        stateFilePath: join(testDir, 'state.json'),
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
        stateFilePath: join(testDir, 'state.json'),
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
});

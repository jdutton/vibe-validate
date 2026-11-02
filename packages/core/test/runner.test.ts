 
/* eslint-disable sonarjs/deprecation */
 
 
import type { ChildProcess } from 'node:child_process';
import { readFileSync, unlinkSync, existsSync, readdirSync, rmdirSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { validateConfig, type ValidationStep } from '@vibe-validate/config';
import { autoDetectAndExtract } from '@vibe-validate/extractors';
import { getGitTreeHash } from '@vibe-validate/git';
import { mkdirSyncReal, normalizedTmpdir, toForwardSlash } from '@vibe-validate/utils';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { ensureDir } from '../src/fs-utils.js';
import {
  buildStepEnv,
  parseFailures,
  runStepsInParallel,
  runValidation,
  setupSignalHandlers,
} from '../src/runner.js';
import type { ValidationConfig } from '../src/runner.js';

/** A run of a config without declared levels: every step runs */
const RUN_ALL: ValidationConfig['level'] = { name: 'full', levels: ['full'] };

const buildStepEnvBaseArgs = {
  parent: null,
  runId: 'test-run',
  treeHash: 'abc123',
  verbose: false,
} as const;

function makeStepWithEnv(env?: Record<string, string>): ValidationStep {
  return {
    name: 'test-step',
    command: 'echo hi',
    ...(env ? { env } : {}),
  };
}

// Mock git functions
vi.mock('@vibe-validate/git', async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports -- Dynamic import in mock
  const actual = await importOriginal<typeof import('@vibe-validate/git')>();
  return {
    ...actual,
    getGitTreeHash: vi.fn(),
  };
});

// Wrap ensureDir so a test can make step output-file creation fail
vi.mock('../src/fs-utils.js', async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports -- Dynamic import in mock
  const actual = await importOriginal<typeof import('../src/fs-utils.js')>();
  return { ...actual, ensureDir: vi.fn(actual.ensureDir) };
});

// Wrap autoDetectAndExtract so a test can make the parallel close handler throw
vi.mock('@vibe-validate/extractors', async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports -- Dynamic import in mock
  const actual = await importOriginal<typeof import('@vibe-validate/extractors')>();
  return { ...actual, autoDetectAndExtract: vi.fn(actual.autoDetectAndExtract) };
});

/**
 * Helper to make the next step output-file creation fail
 */
function mockFailingOutputFiles(errorMessage: string): void {
  vi.mocked(ensureDir).mockRejectedValueOnce(new Error(errorMessage));
}

/**
 * Helper to create validation config for async error tests
 */
function createAsyncErrorConfig(options: { verbose?: boolean; parallel?: boolean } = {}): ValidationConfig {
  return {
    level: RUN_ALL,
    phases: [
      {
        name: 'Test Phase',
        parallel: options.parallel ?? true,
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

/**
 * Helper to test signal handler cleanup behavior
 */
async function testSignalHandler(signalName: 'SIGTERM' | 'SIGINT'): Promise<void> {
  const activeProcesses: Set<ChildProcess> = new Set();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const processExitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

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

/**
 * Run a single-step validation that echoes VV_PARENT_CONTEXT to stdout, then
 * read back the captured context for assertion.
 */
async function runEchoContextStep(parallel: boolean, phaseName: string, stepName: string) {
  const config: ValidationConfig = {
    level: RUN_ALL,
    phases: [{
      name: phaseName,
      parallel,
      steps: [{
        name: stepName,
        command: 'node -e "process.stdout.write(process.env.VV_PARENT_CONTEXT || \'NONE\')"',
      }],
    }],
    env: {},
    verbose: false,
    yaml: false,
    debug: true,
  };

  const result = await runValidation(config);
  const phases = result.phases;
  if (!phases) throw new Error('expected phases on result');
  const stepOutput = phases[0].steps[0];
  const stdoutPath = stepOutput.outputFiles?.stdout;
  if (!stdoutPath) throw new Error('expected outputFiles.stdout on step');
  const captured = await readFile(stdoutPath, 'utf-8');
  return { stepOutput, parsed: JSON.parse(captured), stdoutPath };
}

function expectParentContext(
  result: Awaited<ReturnType<typeof runEchoContextStep>>,
  expected: { stepName: string; phaseName: string },
) {
  expect(result.stepOutput.passed).toBe(true);
  expect(result.parsed.stepName).toBe(expected.stepName);
  expect(result.parsed.phaseName).toBe(expected.phaseName);
  expect(result.parsed.depth).toBe(1);
  expect(result.parsed.capturing).toBe(true);
  // Advertised ParentContext.outputDir must match where the outer-captured
  // step output files actually live (Task 3 / I1: alignment).
  expect(toForwardSlash(result.stdoutPath).startsWith(toForwardSlash(result.parsed.outputDir))).toBe(true);
}

/** These tests spawn node and wait on fail-fast kills; a loaded machine needs headroom. */
const SPAWN_TEST_TIMEOUT = 30_000;

/**
 * A step that prints a realistic amount of output, then runs for `ms` before
 * passing — the shape of a long ESLint run that a fail-fast kill interrupts.
 */
function makeLongRunningStep(name: string, ms: number): ValidationStep {
  const script = `console.log('Linting 412 files across 9 packages with the project config...'); setTimeout(() => process.exit(0), ${ms})`;
  return { name, command: `node -e ${JSON.stringify(script)}` };
}

/** A step that fails on its own after `ms`, with a recognisable error line. */
function makeFailingStep(name: string, ms: number, exitCode = 1): ValidationStep {
  const script = `setTimeout(() => { console.error('Error: ${name} found a real problem in src/index.ts'); process.exit(${exitCode}); }, ${ms})`;
  return { name, command: `node -e ${JSON.stringify(script)}` };
}

/**
 * A step still running when another step's failure is handled: it waits for
 * `marker`, which writeMarkerOnceFailed writes only after the runner has
 * handled that failure, then passes (or fails on its own). A fail-fast stop
 * triggered by that failure therefore always lands while it runs.
 */
function makeStepAfterMarker(name: string, marker: string, outcome: 'passes' | 'fails'): ValidationStep {
  const finish = outcome === 'fails'
    ? `console.error('Error: ${name} found a real problem in src/index.ts'); process.exit(1)`
    : 'process.exit(0)';
  const script = `const fs = require('fs'); console.log('Waiting for the build to settle...'); const t = setInterval(() => { if (fs.existsSync('${toForwardSlash(marker)}')) { clearInterval(t); ${finish}; } }, 20)`;
  return { name, command: `node -e ${JSON.stringify(script)}` };
}

/**
 * Write `marker` once the runner has logged `stepName` as FAILED. The runner
 * applies fail-fast synchronously right after that log line, and the marker is
 * written on a later turn, so by then any stop has already been recorded.
 */
function writeMarkerOnceFailed(stepName: string, marker: string): void {
  vi.mocked(console.log).mockImplementation((msg?: unknown) => {
    const line = String(msg);
    if (line.includes(stepName) && line.includes('- FAILED')) {
      setImmediate(() => writeFileSync(marker, ''));
    }
  });
}

/** Lines the runner printed through the (spied) console.log */
function loggedLines(): string[] {
  return vi.mocked(console.log).mock.calls.map(call => String(call[0]));
}

function findStepResult(result: Awaited<ReturnType<typeof runValidation>>, name: string) {
  const step = result.phases?.flatMap(p => p.steps).find(s => s.name === name);
  if (!step) throw new Error(`expected a step result for ${name}`);
  return step;
}

/** Run `command` as a fail-fast phase's only step; it must fail as itself, not be stopped */
async function runKilledStep(testDir: string, command: string, parallel: boolean) {
  const result = await runValidation({
    level: RUN_ALL,
    phases: [{ name: 'Checks', parallel, steps: [{ name: 'Killed', command }] }],
    enableFailFast: true,
    logPath: join(testDir, 'log.txt'),
  });
  const step = findStepResult(result, 'Killed');
  expect(step.stoppedByFailFast).toBeUndefined();
  expect(step.passed).toBe(false);
  return step;
}

/** Run one failing step whose output is exactly `output` */
function runStepPrinting(name: string, output: string) {
  return runValidation({
    level: RUN_ALL,
    phases: [
      {
        name: 'Test Phase',
        // JSON.stringify quotes and escapes the script for shell:true
        steps: [{ name, command: 'node -e ' + JSON.stringify(`console.log(${JSON.stringify(output)}); process.exit(1)`) }],
      },
    ],
    env: {},
    enableFailFast: false,
  });
}

/** Run one parallel step that prints and exits `exitCode` */
function runOneDebugStep(exitCode: number, debug: boolean) {
  return runValidation({
    level: RUN_ALL,
    phases: [
      {
        name: 'Test Phase',
        parallel: true,
        steps: [{ name: 'Only Step', command: `node -e "console.log('output'); process.exit(${exitCode})"` }],
      },
    ],
    env: {},
    enableFailFast: false,
    debug,
  });
}

type StoredRun = NonNullable<ValidationConfig['previousRun']>;
type StoredStep = NonNullable<StoredRun['result']['phases']>[number]['steps'][number];

const CACHED_OUTPUT_FILES = {
  // eslint-disable-next-line sonarjs/publicly-writable-directories -- Test fixture data only
  stdout: '/tmp/stdout.log',
  // eslint-disable-next-line sonarjs/publicly-writable-directories -- Test fixture data only
  stderr: '/tmp/stderr.log',
  // eslint-disable-next-line sonarjs/publicly-writable-directories -- Test fixture data only
  combined: '/tmp/combined.jsonl',
};

/** A stored step that took 2.5s and passed only when it exited 0 */
function storedStep(name: string, command: string, exitCode: number): StoredStep {
  return { name, command, exitCode, durationSecs: 2.5, passed: exitCode === 0 };
}

/** A stored run whose result holds one phase made of `steps` */
function previousRunOf(runPassed: boolean, phaseName: string, steps: StoredStep[]): StoredRun {
  const timestamp = '2026-02-12T10:00:00Z';
  return {
    id: 'run-123',
    timestamp,
    duration: 5000,
    passed: runPassed,
    branch: 'main',
    headCommit: 'abc123',
    uncommittedChanges: false,
    result: {
      passed: runPassed,
      timestamp,
      treeHash: 'tree-abc',
      phases: [{
        name: phaseName,
        passed: steps.every(step => step.passed),
        durationSecs: steps.reduce((total, step) => total + step.durationSecs, 0),
        steps,
      }],
    },
  };
}
const TWO_LEVELS = ['commit', 'full'] as const;

/** Two phases: one mixed, one holding only a full-level step */
function leveledPhases(): ValidationConfig['phases'] {
  return [
    {
      name: 'Fast',
      steps: [
        { name: 'Lint', command: 'node -e "console.log(\'lint\')"', level: 'commit' },
        { name: 'Unit', command: 'node -e "console.log(\'unit\')"', level: 'full' },
      ],
    },
    {
      name: 'Slow',
      steps: [{ name: 'System', command: 'node -e "console.log(\'system\')"', level: 'full' }],
    },
  ];
}

function stepNames(result: Awaited<ReturnType<typeof runValidation>>): string[] {
  return (result.phases ?? []).flatMap(phase => phase.steps.map(step => step.name));
}


describe('runner', () => {
  let testDir: string;

  beforeEach(() => {
    // Create temp directory for test files
    testDir = join(normalizedTmpdir(), `vibe-validate-test-${Date.now()}`);
    if (!existsSync(testDir)) {
      mkdirSyncReal(testDir, { recursive: true });
    }

    // Mock git tree hash to return consistent value
    vi.mocked(getGitTreeHash).mockResolvedValue({
      hash: 'test-tree-hash-abc123' as any,
    });

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

  describe('buildStepEnv', () => {
    it('merges per-step env into the returned env', () => {
      const { env } = buildStepEnv({
        ...buildStepEnvBaseArgs,
        step: makeStepWithEnv({ FOO: 'bar' }),
        baseEnv: {},
      });
      expect(env.FOO).toBe('bar');
    });

    it('lets per-step env override baseEnv on key conflict', () => {
      const { env } = buildStepEnv({
        ...buildStepEnvBaseArgs,
        step: makeStepWithEnv({ NODE_ENV: 'test' }),
        baseEnv: { NODE_ENV: 'production' },
      });
      expect(env.NODE_ENV).toBe('test');
    });

    it('returns baseEnv unchanged when step has no env', () => {
      const { env } = buildStepEnv({
        ...buildStepEnvBaseArgs,
        step: makeStepWithEnv(),
        baseEnv: { FOO: 'bar' },
      });
      expect(env.FOO).toBe('bar');
    });

    it('always sets VV_PARENT_CONTEXT regardless of step env', () => {
      const { env } = buildStepEnv({
        ...buildStepEnvBaseArgs,
        step: makeStepWithEnv({ FOO: 'bar' }),
        baseEnv: {},
      });
      expect(env.VV_PARENT_CONTEXT).toBeDefined();
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
      expect(killedStep!.stoppedByFailFast).toBe(true);
      expect(result.failedStep?.name).toBe('Fast Fail');

      // Should have meaningful extraction, not "0 errors"
      expect(killedStep!.extraction).toBeDefined();
      expect(killedStep!.extraction!.summary).toBe('Stopped by fail-fast after Fast Fail failed');
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
        level: RUN_ALL,
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
        level: RUN_ALL,
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
        level: RUN_ALL,
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
        level: RUN_ALL,
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
        level: RUN_ALL,
        phases: [
          {
            name: 'Fail',
            parallel: true,
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
        level: RUN_ALL,
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

  describe('precomputed tree hash', () => {
    it.each([true, false])('never hashes the worktree when the caller supplied the hash, even for failing steps (parallel: %s)', async (parallel) => {
      vi.mocked(getGitTreeHash).mockClear();

      const result = await runValidation({
        level: RUN_ALL,
        phases: [{
          name: 'Checks',
          parallel,
          failFast: false,
          steps: [{ name: 'Ok', command: 'node -e "console.log(\'ok\')"' }, makeFailingStep('Bad', 0)],
        }],
        treeHash: 'caller-tree-hash',
        logPath: join(testDir, 'log.txt'),
      });

      expect(getGitTreeHash).not.toHaveBeenCalled();
      expect(result.treeHash).toBe('caller-tree-hash');
      expect(findStepResult(result, 'Bad').outputFiles?.combined).toContain('caller');
    }, SPAWN_TEST_TIMEOUT);
  });

  describe('fail-fast attribution (parallel phases)', { timeout: SPAWN_TEST_TIMEOUT }, () => {
    it('names the step whose own command failed, not the first sibling it stopped', async () => {
      const result = await runValidation({
        level: RUN_ALL,
        phases: [{
          name: 'Checks',
          parallel: true,
          steps: [makeLongRunningStep('ESLint', 10_000), makeFailingStep('Typecheck', 300)],
        }],
        enableFailFast: true,
        logPath: join(testDir, 'log.txt'),
      });

      expect(result.passed).toBe(false);
      expect(result.failedStep).toBe('Typecheck');
      expect(result.summary).toBe('Typecheck failed');

      const failed = findStepResult(result, 'Typecheck');
      expect(failed.passed).toBe(false);
      expect(failed.stoppedByFailFast).toBeUndefined();
      expect(failed.extraction?.summary).not.toContain('fail-fast');

      const stopped = findStepResult(result, 'ESLint');
      expect(stopped.passed).toBe(false);
      expect(stopped.stoppedByFailFast).toBe(true);
      expect(stopped.extraction?.summary).toBe('Stopped by fail-fast after Typecheck failed');
      expect(stopped.extraction?.totalErrors).toBe(0);
    });

    it('marks the stopped sibling in the log file, and only the real failure as FAILED', async () => {
      const logFile = join(testDir, 'log.txt');
      await runValidation({
        level: RUN_ALL,
        phases: [{
          name: 'Checks',
          parallel: true,
          steps: [makeLongRunningStep('ESLint', 10_000), makeFailingStep('Typecheck', 300)],
        }],
        enableFailFast: true,
        logPath: logFile,
      });

      const logContent = readFileSync(logFile, 'utf8');
      expect(logContent).toContain('Typecheck - FAILED');
      expect(logContent).toContain('ESLint - STOPPED (fail-fast)');
      expect(logContent).not.toContain('ESLint - FAILED');
    });

    it.each([true, false])('names the exit code of a real failure with no output (parallel: %s)', async (parallel) => {
      const result = await runValidation({
        level: RUN_ALL,
        phases: [{
          name: 'Checks',
          parallel,
          steps: [{ name: 'Silent Failure', command: 'node -e "process.exit(3)"' }],
        }],
        enableFailFast: true,
        logPath: join(testDir, 'log.txt'),
      });

      const step = findStepResult(result, 'Silent Failure');
      expect(step.stoppedByFailFast).toBeUndefined();
      expect(step.extraction?.summary).toBe('Exited with code 3 and produced no output');
    });

    // Windows has no SIGTERM handler for the step to exit 0 from
    it.skipIf(process.platform === 'win32')('does not count a stopped sibling as passed when it exits 0 on SIGTERM', async () => {
      const ready = toForwardSlash(join(testDir, 'graceful-ready'));
      const stoppedGracefully = toForwardSlash(join(testDir, 'graceful-stopped'));
      // The handler is installed before the ready marker, and the failing sibling
      // waits for that marker, so the stop always takes the exit-0 path.
      const graceful = `const fs = require('fs'); process.on('SIGTERM', () => { fs.writeFileSync('${stoppedGracefully}', ''); process.exit(0); }); fs.writeFileSync('${ready}', ''); console.log('watching for changes...'); setInterval(() => {}, 1000)`;
      const failsOnceReady = `const fs = require('fs'); const t = setInterval(() => { if (fs.existsSync('${ready}')) { clearInterval(t); console.error('Error: Typecheck found a real problem in src/index.ts'); process.exit(1); } }, 20)`;
      const result = await runValidation({
        level: RUN_ALL,
        phases: [{
          name: 'Checks',
          parallel: true,
          steps: [
            { name: 'Graceful', command: `node -e ${JSON.stringify(graceful)}` },
            { name: 'Typecheck', command: `node -e ${JSON.stringify(failsOnceReady)}` },
          ],
        }],
        enableFailFast: true,
        logPath: join(testDir, 'log.txt'),
      });

      const stopped = findStepResult(result, 'Graceful');
      expect(stopped.stoppedByFailFast).toBe(true);
      expect(stopped.passed).toBe(false);
      expect(existsSync(stoppedGracefully)).toBe(true);
      // vibe-validate <= 0.20.1 reuses a step on --retry-failed when exitCode is 0
      expect(stopped.exitCode).not.toBe(0);
      expect(result.failedStep).toBe('Typecheck');
    });

    // A signal from outside (OOM killer, CI timeout) is neither a fail-fast stop nor exit 1.
    // `exec` makes the killed process the one the runner spawned on every POSIX sh:
    // Ubuntu's dash keeps itself alive around the last command and exits 137 instead.
    it.skipIf(process.platform === 'win32').each([true, false])('names the signal that killed a step with no output (parallel: %s)', async (parallel) => {
      const step = await runKilledStep(testDir, `exec node -e "process.kill(process.pid, 'SIGKILL')"`, parallel);
      expect(step.exitCode).toBe(1);
      expect(step.extraction?.summary).toBe('Terminated by SIGKILL and produced no output');
    });

    it.skipIf(process.platform === 'win32').each([true, false])('names the signal that killed a step after it printed (parallel: %s)', async (parallel) => {
      // Kill only once the write is flushed: a pipe write is asynchronous on macOS
      const script = String.raw`process.stderr.write('Error: Killed found a real problem in src/index.ts\n', () => process.kill(process.pid, 'SIGKILL'))`;
      const step = await runKilledStep(testDir, `exec node -e ${JSON.stringify(script)}`, parallel);
      expect(step.exitCode).toBe(1);
      expect(step.extraction?.summary).toMatch(/^Terminated by SIGKILL: /);
      expect(step.extraction?.guidance).toContain('Something outside the command sent it SIGKILL');
      // The parsed errors survive the signal summary
      expect(step.extraction?.errorSummary).toContain('Killed found a real problem');
    });

    // A shell between the runner and the killed process (a compound command, a
    // pnpm script) hides the signal and exits 128+N; the command is not its last,
    // so no sh execs it
    it.skipIf(process.platform === 'win32').each([true, false])('notes the likely signal when a shell reports 128+N (parallel: %s)', async (parallel) => {
      const step = await runKilledStep(testDir, `node -e "process.kill(process.pid, 'SIGKILL')"; exit $?`, parallel);
      expect(step.exitCode).toBe(137);
      expect(step.extraction?.summary).toContain('likely killed by SIGKILL');
      expect(step.extraction?.guidance).toContain('Something outside the command sent it SIGKILL');
    });
  });

  describe('per-phase failFast', { timeout: SPAWN_TEST_TIMEOUT }, () => {
    it('runs every parallel step to completion and reports each failure when the phase sets failFast: false', async () => {
      writeMarkerOnceFailed('Fast Failure', join(testDir, 'fast-failed'));
      const result = await runValidation({
        level: RUN_ALL,
        phases: [{
          name: 'Checks',
          parallel: true,
          failFast: false,
          steps: [
            makeStepAfterMarker('Slow Failure', join(testDir, 'fast-failed'), 'fails'),
            makeFailingStep('Fast Failure', 0),
            makeStepAfterMarker('Passes', join(testDir, 'fast-failed'), 'passes'),
          ],
        }],
        enableFailFast: true,
        logPath: join(testDir, 'log.txt'),
      });

      expect(result.passed).toBe(false);
      expect(result.failedStep).toBe('Slow Failure');
      for (const name of ['Slow Failure', 'Fast Failure']) {
        const step = findStepResult(result, name);
        expect(step.passed).toBe(false);
        expect(step.stoppedByFailFast).toBeUndefined();
        expect(step.extraction?.errorSummary).toContain(`${name} found a real problem`);
      }
      expect(findStepResult(result, 'Passes').passed).toBe(true);

      const logContent = readFileSync(join(testDir, 'log.txt'), 'utf8');
      expect(logContent).toContain('Slow Failure - FAILED');
      expect(logContent).toContain('Fast Failure - FAILED');
      expect(logContent).not.toContain('Passes - FAILED');
    });

    it('runs every sequential step when the phase sets failFast: false', async () => {
      const result = await runValidation({
        level: RUN_ALL,
        phases: [{
          name: 'Ordered',
          parallel: false,
          failFast: false,
          steps: [makeFailingStep('First', 0), makeLongRunningStep('Second', 0)],
        }],
        enableFailFast: true,
        logPath: join(testDir, 'log.txt'),
      });

      expect(result.failedStep).toBe('First');
      expect(findStepResult(result, 'Second').passed).toBe(true);
    });

    it('keeps fail-fast when the phase leaves failFast unset and the run enables it', async () => {
      const result = await runValidation({
        level: RUN_ALL,
        phases: [{
          name: 'Checks',
          parallel: true,
          steps: [makeLongRunningStep('ESLint', 10_000), makeFailingStep('Typecheck', 100)],
        }],
        enableFailFast: true,
        logPath: join(testDir, 'log.txt'),
      });

      expect(findStepResult(result, 'ESLint').stoppedByFailFast).toBe(true);
    });

    it('lets a phase turn fail-fast on when the run leaves it off', async () => {
      const result = await runValidation({
        level: RUN_ALL,
        phases: [{
          name: 'Checks',
          parallel: true,
          failFast: true,
          steps: [makeLongRunningStep('ESLint', 10_000), makeFailingStep('Typecheck', 100)],
        }],
        enableFailFast: false,
        logPath: join(testDir, 'log.txt'),
      });

      expect(findStepResult(result, 'ESLint').stoppedByFailFast).toBe(true);
    });

    it('honours the run-level setting for phases a loaded config leaves unset', async () => {
      writeMarkerOnceFailed('Typecheck', join(testDir, 'typecheck-failed'));
      const { validation } = validateConfig({
        validation: {
          phases: [{
            name: 'Checks',
            parallel: true,
            steps: [
              makeStepAfterMarker('Slow', join(testDir, 'typecheck-failed'), 'passes'),
              makeFailingStep('Typecheck', 0),
            ],
          }],
        },
      });

      const result = await runValidation({
        level: RUN_ALL,
        phases: validation.phases,
        enableFailFast: false,
        logPath: join(testDir, 'log.txt'),
      });

      expect(findStepResult(result, 'Slow').stoppedByFailFast).toBeUndefined();
      expect(findStepResult(result, 'Slow').passed).toBe(true);
    });
  });

  describe('setupSignalHandlers', () => {
    it('should register SIGTERM handler', () => {
      const activeProcesses = new Set<ChildProcess>();
      const onSpy = vi.spyOn(process, 'on');

      setupSignalHandlers(activeProcesses);

      expect(onSpy).toHaveBeenCalledWith('SIGTERM', expect.any(Function));
    });

    it('should register SIGINT handler', () => {
      const activeProcesses = new Set<ChildProcess>();
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
          level: RUN_ALL,
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
        // extractionQuality field was removed in v0.15.0
        // Extraction metadata is now in extraction.metadata
      });
    });

    describe('developerFeedback=true', () => {
      it('should include extraction metadata when developerFeedback is true and test fails', async () => {
        // When developerFeedback is enabled, extractors include metadata
        // Runner no longer adds redundant extractionQuality field
        const config: ValidationConfig = {
          level: RUN_ALL,
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
        // extractionQuality field was removed in v0.15.0 - now uses extraction.metadata
      });

      it('should NOT include extractionQuality for passing tests', async () => {
        // TDD: This test should FAIL initially
        // Rationale: Passing tests have no failures to extract, score would always be 0 (meaningless)
        const config: ValidationConfig = {
          level: RUN_ALL,
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
        // extractionQuality field was removed in v0.15.0
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

        const result = await runStepPrinting('ESLint with YAML', yamlOutput);

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

        const result = await runStepPrinting('Invalid YAML', invalidYamlOutput);

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

        const result = await runStepPrinting('Windows YAML', windowsYamlOutput);

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

        const result = await runStepPrinting('Dashes in error', outputWithDashesInError);

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

        const result = await runStepPrinting('Multiple separators', multipleYamlOutput);

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
        level: RUN_ALL,
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
      // eslint-disable-next-line unicorn/prefer-string-replace-all -- Using replace for ES2020 compatibility
      const normalizedPath = outputFiles?.combined?.replace(/\\/g, '/');
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
        level: RUN_ALL,
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
        level: RUN_ALL,
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
        level: RUN_ALL,
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
        level: RUN_ALL,
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
        level: RUN_ALL,
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
    const outcomes = [
      { outcome: 'passing', exitCode: 0, passed: true },
      { outcome: 'failing', exitCode: 1, passed: false },
    ];

    it.each(outcomes)('should include top-level outputFiles with debug mode enabled ($outcome)', async ({ exitCode, passed }) => {
      const result = await runOneDebugStep(exitCode, true);

      expect(result.passed).toBe(passed);
      expect(result.outputFiles).toBeDefined();
      expect(result.outputFiles?.combined).toBeDefined();
      expect(toForwardSlash(result.outputFiles!.combined)).toContain('/validation-');
      expect(result.outputFiles?.combined).toContain('.log');
      expect(existsSync(result.outputFiles!.combined)).toBe(true);
    });

    it.each(outcomes)('should NOT include top-level outputFiles without debug mode ($outcome)', async ({ exitCode, passed }) => {
      const result = await runOneDebugStep(exitCode, false);

      expect(result.passed).toBe(passed);
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
        level: RUN_ALL,
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
        level: RUN_ALL,
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
        level: RUN_ALL,
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
    it.each([true, false])('records the step when processing its result throws (parallel: %s)', async (parallel) => {
      vi.mocked(autoDetectAndExtract).mockImplementationOnce(() => {
        throw new Error('extractor blew up');
      });

      const result = await runValidation(createAsyncErrorConfig({ parallel }));

      expect(result.passed).toBe(false);
      expect(result.failedStep).toBe('Failing Step');
      const step = findStepResult(result, 'Failing Step');
      expect(step.passed).toBe(false);
      expect(step.exitCode).toBe(1);
      expect(step.extraction?.summary).toContain('extractor blew up');
      // Its command already printed FAILED: no second line for it
      expect(loggedLines().filter(line => line.includes('Failing Step') && line.includes('FAILED'))).toHaveLength(1);
    });

    it.each([true, false])('records a step whose setup throws before it spawns (parallel: %s)', { timeout: SPAWN_TEST_TIMEOUT }, async (parallel) => {
      const result = await runValidation({
        level: RUN_ALL,
        phases: [{
          name: 'Checks',
          parallel,
          steps: [
            { name: 'Escapes', command: 'node -e "process.exit(0)"', cwd: '../'.repeat(40) + 'outside-the-repo' },
            makeLongRunningStep('Slow', 10_000),
          ],
        }],
        enableFailFast: true,
        logPath: join(testDir, 'log.txt'),
      });

      expect(result.passed).toBe(false);
      expect(result.failedStep).toBe('Escapes');
      const step = findStepResult(result, 'Escapes');
      expect(step.passed).toBe(false);
      expect(step.exitCode).toBe(1);
      expect(step.extraction?.summary).toContain('must be within git repository');
      // Parallel: fail-fast stops the sibling. Sequential: it never starts.
      const slow = result.phases?.flatMap(p => p.steps).find(s => s.name === 'Slow');
      expect(slow ? slow.stoppedByFailFast : 'never started').toBe(parallel ? true : 'never started');
      // A step that never ran prints its own status line, padded and timed like the others
      expect(loggedLines().some(line => /❌ Escapes +- FAILED \([\d.]+s\) — vibe-validate could not start this step/.test(line))).toBe(true);
    });

    it('should log warning when output file creation fails', async () => {
      const consoleLogSpy = vi.spyOn(console, 'log');
      mockFailingOutputFiles('Simulated async error');

      await runValidation(createAsyncErrorConfig({ verbose: true }));

      const logOutput = consoleLogSpy.mock.calls.map(call => call.join(' ')).join('\n');
      expect(logOutput).toContain('Could not create output files');
    });
  });

  describe('signal handler error paths', () => {
    it('should handle SIGTERM cleanup errors', async () => {
      await testSignalHandler('SIGTERM');
    });

    it('should handle SIGINT cleanup errors', async () => {
      await testSignalHandler('SIGINT');
    });
  });

  describe('retry-failed: step matching and cache logic', () => {
    describe('findPreviousStepResult', () => {
      it('should find step by name in previous run', async () => {
        const { findPreviousStepResult } = await import('../src/runner.js');

        const previousRun = {
          id: 'run-123',
          timestamp: '2026-02-12T10:00:00Z',
          duration: 5000,
          passed: false,
          branch: 'main',
          headCommit: 'abc123',
          uncommittedChanges: false,
          result: {
            passed: false,
            timestamp: '2026-02-12T10:00:00Z',
            treeHash: 'tree-abc',
            phases: [
              {
                name: 'Phase 1',
                passed: true,
                durationSecs: 2.5,
                steps: [
                  {
                    name: 'TypeCheck',
                    command: 'tsc --noEmit',
                    exitCode: 0,
                    durationSecs: 2.5,
                    passed: true,
                  },
                ],
              },
              {
                name: 'Phase 2',
                passed: false,
                durationSecs: 2.5,
                steps: [
                  {
                    name: 'Tests',
                    command: 'npm test',
                    exitCode: 1,
                    durationSecs: 2.5,
                    passed: false,
                  },
                ],
              },
            ],
          },
        };

        const found = findPreviousStepResult(previousRun, 'Tests');
        expect(found).toBeDefined();
        expect(found?.name).toBe('Tests');
        expect(found?.exitCode).toBe(1);
      });

      it('should return null when step not found', async () => {
        const { findPreviousStepResult } = await import('../src/runner.js');

        const previousRun = {
          id: 'run-123',
          timestamp: '2026-02-12T10:00:00Z',
          duration: 5000,
          passed: true,
          branch: 'main',
          headCommit: 'abc123',
          uncommittedChanges: false,
          result: {
            passed: true,
            timestamp: '2026-02-12T10:00:00Z',
            treeHash: 'tree-abc',
            phases: [
              {
                name: 'Phase 1',
                passed: true,
                durationSecs: 2.5,
                steps: [
                  {
                    name: 'TypeCheck',
                    command: 'tsc --noEmit',
                    exitCode: 0,
                    durationSecs: 2.5,
                    passed: true,
                  },
                ],
              },
            ],
          },
        };

        const found = findPreviousStepResult(previousRun, 'NonExistent');
        expect(found).toBeNull();
      });

      it('should return null when previous run has no phases', async () => {
        const { findPreviousStepResult } = await import('../src/runner.js');

        const previousRun = {
          id: 'run-123',
          timestamp: '2026-02-12T10:00:00Z',
          duration: 5000,
          passed: true,
          branch: 'main',
          headCommit: 'abc123',
          uncommittedChanges: false,
          result: {
            passed: true,
            timestamp: '2026-02-12T10:00:00Z',
            treeHash: 'tree-abc',
          },
        };

        const found = findPreviousStepResult(previousRun, 'Tests');
        expect(found).toBeNull();
      });

      it('should find step across multiple phases', async () => {
        const { findPreviousStepResult } = await import('../src/runner.js');

        const previousRun = {
          id: 'run-123',
          timestamp: '2026-02-12T10:00:00Z',
          duration: 5000,
          passed: false,
          branch: 'main',
          headCommit: 'abc123',
          uncommittedChanges: false,
          result: {
            passed: false,
            timestamp: '2026-02-12T10:00:00Z',
            treeHash: 'tree-abc',
            phases: [
              {
                name: 'Quick Checks',
                passed: true,
                durationSecs: 1,
                steps: [
                  {
                    name: 'Lint',
                    command: 'eslint',
                    exitCode: 0,
                    durationSecs: 1,
                    passed: true,
                  },
                ],
              },
              {
                name: 'Tests',
                passed: false,
                durationSecs: 30,
                steps: [
                  {
                    name: 'E2E',
                    command: 'npm run e2e',
                    exitCode: 1,
                    durationSecs: 30,
                    passed: false,
                  },
                ],
              },
            ],
          },
        };

        const found = findPreviousStepResult(previousRun, 'E2E');
        expect(found).toBeDefined();
        expect(found?.name).toBe('E2E');
        expect(found?.exitCode).toBe(1);
      });
    });

    describe('shouldUseCachedResult', () => {
      it('should return true when step passed and retry mode enabled', async () => {
        const { shouldUseCachedResult } = await import('../src/runner.js');

        const previousStep = {
          name: 'TypeCheck',
          command: 'tsc --noEmit',
          exitCode: 0,
          durationSecs: 2.5,
          passed: true,
        };

        const result = shouldUseCachedResult(previousStep, true);
        expect(result).toBe(true);
      });

      it('should return false when step failed', async () => {
        const { shouldUseCachedResult } = await import('../src/runner.js');

        const previousStep = {
          name: 'Tests',
          command: 'npm test',
          exitCode: 1,
          durationSecs: 2.5,
          passed: false,
        };

        const result = shouldUseCachedResult(previousStep, true);
        expect(result).toBe(false);
      });

      it('should return false when not in retry mode', async () => {
        const { shouldUseCachedResult } = await import('../src/runner.js');

        const previousStep = {
          name: 'TypeCheck',
          command: 'tsc --noEmit',
          exitCode: 0,
          durationSecs: 2.5,
          passed: true,
        };

        const result = shouldUseCachedResult(previousStep, false);
        expect(result).toBe(false);
      });

      it('should return false when previous step is null', async () => {
        const { shouldUseCachedResult } = await import('../src/runner.js');

        const result = shouldUseCachedResult(null, true);
        expect(result).toBe(false);
      });

      it('should return false when step was killed (exitCode 143)', async () => {
        const { shouldUseCachedResult } = await import('../src/runner.js');

        const previousStep = {
          name: 'SlowTest',
          command: 'npm run slow',
          exitCode: 143,
          durationSecs: 2.5,
          passed: false,
        };

        const result = shouldUseCachedResult(previousStep, true);
        expect(result).toBe(false);
      });

      it('should return false when fail-fast stopped the step even though it exited 0', async () => {
        const { shouldUseCachedResult } = await import('../src/runner.js');

        const previousStep = {
          name: 'Watcher',
          command: 'npm run watch',
          exitCode: 0,
          durationSecs: 2.5,
          passed: false,
          stoppedByFailFast: true,
        };

        expect(shouldUseCachedResult(previousStep, true)).toBe(false);
      });
    });

    describe('runValidation with previousRun (cache logic integration)', () => {
      it('should use cached result for passed steps when retryFailed enabled', async () => {
        const previousRun = previousRunOf(false, 'Test Phase', [storedStep('Quick Step', 'node -e "console.log(\'cached\')"', 0), storedStep('Failing Step', 'node -e "process.exit(1)"', 1)]);

        const config: ValidationConfig = {
          level: RUN_ALL,
          phases: [
            {
              name: 'Test Phase',
              parallel: true,
              steps: [
                { name: 'Quick Step', command: 'node -e "console.log(\'new run\')"' },
                { name: 'Failing Step', command: 'node -e "console.log(\'fixed\'); process.exit(0)"' },
              ],
            },
          ],
          previousRun,
          env: {},
          enableFailFast: false,
        };

        const result = await runValidation(config);

        expect(result.passed).toBe(true);
        expect(result.phases).toBeDefined();

        // eslint-disable-next-line sonarjs/no-nested-functions -- Test helper for finding steps
        const quickStep = result.phases![0].steps.find(s => s.name === 'Quick Step');
        // eslint-disable-next-line sonarjs/no-nested-functions -- Test helper for finding steps
        const failingStep = result.phases![0].steps.find(s => s.name === 'Failing Step');

        // Quick Step should use cache
        expect(quickStep?.isCachedResult).toBe(true);
        expect(quickStep?.exitCode).toBe(0);
        expect(quickStep?.durationSecs).toBe(2.5); // Original duration

        // Failing Step should execute fresh
        expect(failingStep?.isCachedResult).toBeUndefined();
        expect(failingStep?.exitCode).toBe(0);
        expect(failingStep?.passed).toBe(true);
      });

      it('should execute all steps when previous run had no matching step', async () => {
        const previousRun = previousRunOf(false, 'Old Phase', [storedStep('Old Step', 'node -e "console.log(\'old\')"', 0)]);

        const config: ValidationConfig = {
          level: RUN_ALL,
          phases: [
            {
              name: 'New Phase',
              steps: [
                { name: 'New Step', command: 'node -e "console.log(\'new\')"' },
              ],
            },
          ],
          previousRun,
          env: {},
          enableFailFast: false,
        };

        const result = await runValidation(config);

        expect(result.passed).toBe(true);
        expect(result.phases![0].steps[0].isCachedResult).toBeUndefined();
        expect(result.phases![0].steps[0].name).toBe('New Step');
      });

      it('should copy extraction and outputFiles from cached step', async () => {
        const previousRun = previousRunOf(true, 'Test Phase', [
          { ...storedStep('Step With Output', 'node -e "console.log(\'output\')"', 0), outputFiles: CACHED_OUTPUT_FILES },
        ]);

        const config: ValidationConfig = {
          level: RUN_ALL,
          phases: [
            {
              name: 'Test Phase',
              steps: [
                { name: 'Step With Output', command: 'node -e "console.log(\'new\')"' },
              ],
            },
          ],
          previousRun,
          env: {},
          enableFailFast: false,
        };

        const result = await runValidation(config);

        expect(result.passed).toBe(true);
        const step = result.phases![0].steps[0];

        expect(step.isCachedResult).toBe(true);
        expect(step.outputFiles).toEqual(CACHED_OUTPUT_FILES);
      });

      it('should log cache usage with timestamp in verbose mode', async () => {
        const previousRun = previousRunOf(false, 'Test Phase', [storedStep('Cached Step', 'node -e "console.log(\'cached\')"', 0)]);

        // eslint-disable-next-line sonarjs/no-nested-functions -- Test spy mock function
        const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

        const config: ValidationConfig = {
          level: RUN_ALL,
          phases: [
            {
              name: 'Test Phase',
              steps: [
                { name: 'Cached Step', command: 'node -e "console.log(\'new\')"' },
              ],
            },
          ],
          previousRun,
          verbose: true,
          yaml: true, // stderr output
          env: {},
          enableFailFast: false,
        };

        const result = await runValidation(config);

        expect(result.passed).toBe(true);

        // eslint-disable-next-line sonarjs/no-nested-functions -- Test helper for extracting stderr output
        const stderrOutput = stderrSpy.mock.calls.map(call => call[0]).join('');
        expect(stderrOutput).toContain('⚡ Cached from 2026-02-12 10:00');

        stderrSpy.mockRestore();
      });

      it('should show retry indicator for failed steps being re-executed', async () => {
        const previousRun = previousRunOf(false, 'Test Phase', [storedStep('Failed Step', 'node -e "console.log(\'fail\'); process.exit(1)"', 1), storedStep('Passed Step', 'node -e "console.log(\'pass\')"', 0)]);

        // eslint-disable-next-line sonarjs/no-nested-functions -- Test spy mock function
        const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

        const config: ValidationConfig = {
          level: RUN_ALL,
          phases: [
            {
              name: 'Test Phase',
              steps: [
                { name: 'Failed Step', command: 'node -e "console.log(\'fixed\'); process.exit(0)"' },
                { name: 'Passed Step', command: 'node -e "console.log(\'pass\')"' },
              ],
            },
          ],
          previousRun,
          verbose: true,
          yaml: true, // stderr output
          env: {},
          enableFailFast: false,
        };

        const result = await runValidation(config);

        expect(result.passed).toBe(true);

        // eslint-disable-next-line sonarjs/no-nested-functions -- Test helper for extracting stderr output
        const stderrOutput = stderrSpy.mock.calls.map(call => call[0]).join('');

        // Failed step should show retry indicator
        expect(stderrOutput).toContain('🔄 Retrying...');

        // Passed step should show cache indicator (not retry)
        expect(stderrOutput).toContain('⚡ Cached from 2026-02-12 10:00');

        stderrSpy.mockRestore();
      });
    });
  });

  describe('validation levels', () => {
    const originalCI = process.env.CI;

    afterEach(() => {
      if (originalCI === undefined) {
        delete process.env.CI;
      } else {
        process.env.CI = originalCI;
      }
    });


    it('a commit run executes only commit steps and omits the phase it empties', async () => {
      const result = await runValidation({
        phases: leveledPhases(),
        level: { name: 'commit', levels: TWO_LEVELS },
      });

      expect(result.passed).toBe(true);
      expect(result.level).toBe('commit');
      expect(stepNames(result)).toEqual(['Lint']);
      expect(result.phases?.map(phase => phase.name)).toEqual(['Fast']);
    });

    it('a full run executes every step and records its level', async () => {
      const result = await runValidation({
        phases: leveledPhases(),
        level: { name: 'full', levels: TWO_LEVELS },
      });

      expect(result.level).toBe('full');
      expect(stepNames(result)).toEqual(['Lint', 'Unit', 'System']);
    });

    it('CI being set selects nothing: a commit run still leaves out full steps', async () => {
      process.env.CI = 'true';

      const result = await runValidation({
        phases: leveledPhases(),
        level: { name: 'commit', levels: TWO_LEVELS },
      });

      expect(stepNames(result)).toEqual(['Lint']);
    });

    it('a failed run records the level it ran at', async () => {
      const result = await runValidation({
        phases: [{ name: 'Fast', steps: [{ name: 'Bad', command: 'node -e "process.exit(1)"', level: 'commit' }] }],
        level: { name: 'commit', levels: TWO_LEVELS },
      });

      expect(result.passed).toBe(false);
      expect(result.level).toBe('commit');
    });

    it('rejects a level the config does not declare', async () => {
      await expect(runValidation({
        phases: leveledPhases(),
        level: { name: 'push', levels: TWO_LEVELS },
      })).rejects.toMatchObject({ code: 'UNKNOWN_LEVEL' });
    });

    it('rejects a step with no level instead of guessing one', async () => {
      await expect(runValidation({
        phases: [{ name: 'Fast', steps: [{ name: 'Unlevelled', command: 'node -e "process.exit(0)"' }] }],
        level: { name: 'full', levels: TWO_LEVELS },
      })).rejects.toMatchObject({ code: 'MISSING_STEP_LEVEL' });
    });
  });

  describe('ParentContext propagation', () => {
    it('sets VV_PARENT_CONTEXT in spawned step environment (sequential)', async () => {
      const result = await runEchoContextStep(false, 'TestPhase', 'echo-context');
      expectParentContext(result, { stepName: 'echo-context', phaseName: 'TestPhase' });
    });

    it('sets VV_PARENT_CONTEXT in spawned step environment (parallel)', async () => {
      const result = await runEchoContextStep(true, 'ParallelPhase', 'echo-context-parallel');
      expectParentContext(result, { stepName: 'echo-context-parallel', phaseName: 'ParallelPhase' });
    });
  });
});

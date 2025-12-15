import * as childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { runCommand } from '../../src/commands/run.js';
import { setupCommanderTest, type CommanderTestEnv } from '../helpers/commander-test-setup.js';
import { createMockChildProcess } from '../helpers/mock-helpers.js';

// Mock child_process.spawn
vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

describe('run command', () => {
  let env: CommanderTestEnv;

  beforeEach(() => {
    env = setupCommanderTest();
  });

  afterEach(() => {
    env.cleanup();
  });

  describe('command registration', () => {
    it('should register run command with correct name', () => {
      runCommand(env.program);

      const commands = env.program.commands;
      const runCmd = commands.find(cmd => cmd.name() === 'run');

      expect(runCmd).toBeDefined();
      expect(runCmd?.description()).toContain('Run a command and extract LLM-friendly errors');
    });

    it('should require a command argument', () => {
      runCommand(env.program);

      const runCmd = env.program.commands.find(cmd => cmd.name() === 'run');
      const args = runCmd?._args;

      expect(args).toBeDefined();
      expect(args?.length).toBeGreaterThan(0);
      expect(args?.[0].required).toBe(true);
    });
  });

  describe('command execution', () => {
    it('should execute the provided command', async () => {
      const mockSpawn = vi.mocked(childProcess.spawn);
      const mockProcess = createMockChildProcess('test output', '', 0);
      mockSpawn.mockReturnValue(mockProcess as any);

      runCommand(env.program);

      try {
        await env.program.parseAsync(['run', 'echo test'], { from: 'user' });
      } catch (error: unknown) {
        // Commander.js throws on exitOverride - verify it's the expected error
        expect(error).toBeDefined();
        // Expected exit
      }

      expect(mockSpawn).toHaveBeenCalledWith(
        'echo test',
        [],
        expect.objectContaining({
          shell: true,
          stdio: ['ignore', 'pipe', 'pipe']
        })
      );
    });

    it('should capture stdout and stderr', async () => {
      const mockSpawn = vi.mocked(childProcess.spawn);
      const mockProcess = createMockChildProcess('stdout output', 'stderr output', 0);
      mockSpawn.mockReturnValue(mockProcess as any);

      runCommand(env.program);

      try {
        await env.program.parseAsync(['run', 'echo test'], { from: 'user' });
      } catch (error: unknown) {
        // Commander.js throws on exitOverride - verify it's the expected error
        expect(error).toBeDefined();
        // Expected exit
      }

      // Verify output was captured (tested via YAML output)
      expect(process.stdout.write).toHaveBeenCalled();
    });

    it('should pass through exit code 0 for successful commands', async () => {
      const mockSpawn = vi.mocked(childProcess.spawn);
      const mockProcess = createMockChildProcess('success', '', 0);
      mockSpawn.mockReturnValue(mockProcess as any);

      runCommand(env.program);

      try {
        await env.program.parseAsync(['run', 'echo success'], { from: 'user' });
      } catch (err: unknown) {
        if (err && typeof err === 'object' && 'exitCode' in err) {
          expect(err.exitCode).toBe(0);
        }
      }
    });

    it('should pass through non-zero exit code for failed commands', async () => {
      const mockSpawn = vi.mocked(childProcess.spawn);
      const mockProcess = createMockChildProcess('', 'error output', 1);
      mockSpawn.mockReturnValue(mockProcess as any);

      runCommand(env.program);

      try {
        await env.program.parseAsync(['run', 'exit 1'], { from: 'user' });
      } catch (err: unknown) {
        if (err && typeof err === 'object' && 'exitCode' in err) {
          expect(err.exitCode).toBe(1);
        }
      }
    });
  });

  describe('error extraction', () => {
    it('should extract vitest errors from test output', async () => {
      const vitestOutput = `
 FAIL  packages/extractors/test/vitest-extractor.test.ts
 ❯ Vitest Extractor > should extract failed tests
   AssertionError: expected 5 to equal 3

 Test Files  1 failed (1)
      Tests  1 failed (5)
`;

      const mockSpawn = vi.mocked(childProcess.spawn);
      const mockProcess = createMockChildProcess(vitestOutput, '', 1);
      mockSpawn.mockReturnValue(mockProcess as any);

      runCommand(env.program);

      try {
        await env.program.parseAsync(['run', 'npx vitest'], { from: 'user' });
      } catch (error: unknown) {
        // Commander.js throws on exitOverride - verify it's the expected error
        expect(error).toBeDefined();
        // Expected exit with code 1
      }

      // Verify YAML output contains extracted errors
      const stdoutCalls = vi.mocked(process.stdout.write).mock.calls
        .map(call => call[0])
        .join('');
      expect(stdoutCalls).toContain('---\n');
      expect(stdoutCalls).toContain('exitCode: 1');
      expect(stdoutCalls).toContain('errors:');
    });

    it('should detect typescript errors from tsc output', async () => {
      const tscOutput = `
src/index.ts(10,5): error TS2322: Type 'string' is not assignable to type 'number'.
src/utils.ts(42,12): error TS2345: Argument of type 'number' is not assignable to parameter of type 'string'.
`;

      const mockSpawn = vi.mocked(childProcess.spawn);
      const mockProcess = createMockChildProcess(tscOutput, '', 1);
      mockSpawn.mockReturnValue(mockProcess as any);

      runCommand(env.program);

      try {
        await env.program.parseAsync(['run', 'npx tsc --noEmit'], { from: 'user' });
      } catch (error: unknown) {
        // Commander.js throws on exitOverride - verify it's the expected error
        expect(error).toBeDefined();
        // Expected exit with code 1
      }

      // Verify YAML output contains typescript errors
      const stdoutCalls = vi.mocked(process.stdout.write).mock.calls
        .map(call => call[0])
        .join('');
      expect(stdoutCalls).toContain('errors:');
      expect(stdoutCalls).toContain('TS2322');
      expect(stdoutCalls).toContain('TS2345');
    });
  });

  describe('YAML output', () => {
    it('should output YAML format with command and exitCode (no extraction for successful runs)', async () => {
      const mockSpawn = vi.mocked(childProcess.spawn);
      const mockProcess = createMockChildProcess('test passed', '', 0);
      mockSpawn.mockReturnValue(mockProcess as any);

      runCommand(env.program);

      try {
        await env.program.parseAsync(['run', 'echo test'], { from: 'user' });
      } catch (error: unknown) {
        // Commander.js throws on exitOverride - verify it's the expected error
        expect(error).toBeDefined();
        // Expected exit
      }

      const stdoutCalls = vi.mocked(process.stdout.write).mock.calls
        .map(call => call[0])
        .join('');

      expect(stdoutCalls).toContain('---\n'); // YAML separator
      expect(stdoutCalls).toContain('command:');
      expect(stdoutCalls).toContain('exitCode:');
      // Token optimization: extraction omitted when exitCode=0 and no errors
      expect(stdoutCalls).not.toContain('extraction:');
    });

    it('should include both opening and closing YAML separators', async () => {
      const mockSpawn = vi.mocked(childProcess.spawn);
      const mockProcess = createMockChildProcess('test passed', '', 0);
      mockSpawn.mockReturnValue(mockProcess as any);

      runCommand(env.program);

      try {
        await env.program.parseAsync(['run', 'echo test'], { from: 'user' });
      } catch (error: unknown) {
        expect(error).toBeDefined();
      }

      const stdoutCalls = vi.mocked(process.stdout.write).mock.calls
        .map(call => call[0])
        .join('');

      // Verify YAML document boundaries
      expect(stdoutCalls).toMatch(/^---\n/); // Opening separator
      expect(stdoutCalls).toMatch(/---\n$/); // Closing separator

      // Count occurrences - should have exactly 2 (opening and closing)
      const separatorCount = (stdoutCalls.match(/^---$/gm) || []).length;
      expect(separatorCount).toBe(2);
    });

    it('should include summary and guidance from extractor', async () => {
      const mockOutput = 'Some test output with errors';
      const mockSpawn = vi.mocked(childProcess.spawn);
      const mockProcess = createMockChildProcess(mockOutput, '', 1);
      mockSpawn.mockReturnValue(mockProcess as any);

      runCommand(env.program);

      try {
        await env.program.parseAsync(['run', 'npx vitest'], { from: 'user' });
      } catch (error: unknown) {
        // Commander.js throws on exitOverride - verify it's the expected error
        expect(error).toBeDefined();
        // Expected exit
      }

      const stdoutCalls = vi.mocked(process.stdout.write).mock.calls
        .map(call => call[0])
        .join('');

      expect(stdoutCalls).toContain('summary:');
      expect(stdoutCalls).toContain('guidance:');
    });
  });

  describe('error handling', () => {
    it('should handle spawn errors gracefully', async () => {
      const mockSpawn = vi.mocked(childProcess.spawn);
      const mockProcess = new EventEmitter() as any;
      mockProcess.stdout = new EventEmitter();
      mockProcess.stderr = new EventEmitter();
      mockSpawn.mockReturnValue(mockProcess);

      runCommand(env.program);

      const parsePromise = env.program.parseAsync(['run', 'nonexistent-command'], { from: 'user' });

      // Emit error immediately
      process.nextTick(() => {
        mockProcess.emit('error', new Error('Command not found'));
      });

      try {
        await parsePromise;
      } catch (error: unknown) {
        // Commander.js throws on exitOverride - verify it's the expected error
        expect(error).toBeDefined();
        // Expected error
      }

      expect(console.error).toHaveBeenCalledWith(
        'Failed to execute command:',
        expect.any(Error)
      );
    });
  });

  describe('recursive run detection', () => {
    it('should detect and merge nested run command (2 levels)', async () => {
      // Inner run output (what vibe-validate run "npm test" would produce)
      const innerYaml = `---
command: "npm test"
exitCode: 1
extraction:
  errors:
    - file: "test.ts"
      line: 42
      message: "expected 5 to equal 3"
  summary: "1 test failed"
  guidance: "Review test assertions"
rawOutput: "test output..."
---
`;

      const mockSpawn = vi.mocked(childProcess.spawn);
      const mockProcess = createMockChildProcess(innerYaml, '', 1);
      mockSpawn.mockReturnValue(mockProcess as any);

      runCommand(env.program);

      try {
        await env.program.parseAsync(['run', 'vibe-validate run "npm test"'], { from: 'user' });
      } catch (error: unknown) {
        // Commander.js throws on exitOverride - verify it's the expected error
        expect(error).toBeDefined();
        // Expected exit with code 1
      }

      const stdoutCalls = vi.mocked(process.stdout.write).mock.calls
        .map(call => call[0])
        .join('');

      // Should preserve inner data
      expect(stdoutCalls).toContain('exitCode: 1');
      expect(stdoutCalls).toContain('expected 5 to equal 3');
      expect(stdoutCalls).toContain('1 test failed');

      // Command should be unwrapped to show actual command
      expect(stdoutCalls).toContain('command: npm test');
    });

    it('should detect and merge nested run command (3 levels)', async () => {
      // 3 levels deep: run → run → run → npm test
      const innerYaml = `---
command: "npm test"
exitCode: 1
extraction:
  errors:
    - file: "test.ts"
      line: 10
      message: "test error"
  summary: "1 test failed"
---
`;

      const mockSpawn = vi.mocked(childProcess.spawn);
      const mockProcess = createMockChildProcess(innerYaml, '', 1);
      mockSpawn.mockReturnValue(mockProcess as any);

      runCommand(env.program);

      try {
        await env.program.parseAsync(['run', String.raw`vibe-validate run "vibe-validate run \"npm test\""`], { from: 'user' });
      } catch (error: unknown) {
        // Commander.js throws on exitOverride - verify it's the expected error
        expect(error).toBeDefined();
        // Expected exit
      }

      const stdoutCalls = vi.mocked(process.stdout.write).mock.calls
        .map(call => call[0])
        .join('');

      // Should unwrap to innermost command
      expect(stdoutCalls).toContain('command: npm test');
      expect(stdoutCalls).toContain('npm test');
      expect(stdoutCalls).toContain('test error');
    });

    it('should preserve validate output when run wraps validate', async () => {
      // Simulate vibe-validate validate output
      const validateYaml = `---
tree_hash: "abc123"
result: "failed"
phases:
  - name: "test"
    status: "failed"
    exitCode: 1
    errors:
      - file: "src/index.ts"
        line: 100
        message: "type error"
summary: "Validation failed: 1 phase failed"
guidance: "Fix the test phase errors"
---
`;

      const mockSpawn = vi.mocked(childProcess.spawn);
      const mockProcess = createMockChildProcess(validateYaml, '', 1);
      mockSpawn.mockReturnValue(mockProcess as any);

      runCommand(env.program);

      try {
        await env.program.parseAsync(['run', 'vibe-validate validate'], { from: 'user' });
      } catch (error: unknown) {
        // Commander.js throws on exitOverride - verify it's the expected error
        expect(error).toBeDefined();
        // Expected exit
      }

      const stdoutCalls = vi.mocked(process.stdout.write).mock.calls
        .map(call => call[0])
        .join('');

      // Should preserve ALL validate fields
      expect(stdoutCalls).toContain('tree_hash:');
      expect(stdoutCalls).toContain('abc123');
      expect(stdoutCalls).toContain('phases:');
      expect(stdoutCalls).toContain('type error');

      // Should preserve validate command (not unwrapped since it's not nested run)
      expect(stdoutCalls).toContain('command: vibe-validate validate');
      expect(stdoutCalls).toContain('vibe-validate validate');
    });

    it('should handle test:llm script (uses run internally)', async () => {
      // Simulate pnpm test:llm output (which wraps vibe-validate run)
      const innerYaml = `---
command: "vitest run"
exitCode: 0
extraction:
  errors: []
  summary: "All tests passed"
  guidance: ""
---
`;

      const mockSpawn = vi.mocked(childProcess.spawn);
      const mockProcess = createMockChildProcess(innerYaml, '', 0);
      mockSpawn.mockReturnValue(mockProcess as any);

      runCommand(env.program);

      try {
        await env.program.parseAsync(['run', 'pnpm test:llm'], { from: 'user' });
      } catch (error: unknown) {
        // Commander.js throws on exitOverride - verify it's the expected error
        expect(error).toBeDefined();
        // Expected exit with code 0
      }

      const stdoutCalls = vi.mocked(process.stdout.write).mock.calls
        .map(call => call[0])
        .join('');

      expect(stdoutCalls).toContain('exitCode: 0');
      expect(stdoutCalls).toContain('All tests passed');
      expect(stdoutCalls).toContain('command: vitest run');
      expect(stdoutCalls).toContain('vitest run');
    });

    it('should preserve ALL inner YAML fields (errors, summary, guidance)', async () => {
      const innerYaml = `---
command: "npm test"
exitCode: 1
extraction:
  errors:
    - file: "a.ts"
      line: 1
      message: "error 1"
    - file: "b.ts"
      line: 2
      message: "error 2"
  summary: "2 tests failed"
  guidance: "Fix both errors"
  errorSummary: "cleaned output here"
  metadata:
    framework: "vitest"
    confidence: 95
rawOutput: "raw output here"
customField: "should be preserved"
---
`;

      const mockSpawn = vi.mocked(childProcess.spawn);
      const mockProcess = createMockChildProcess(innerYaml, '', 1);
      mockSpawn.mockReturnValue(mockProcess as any);

      runCommand(env.program);

      try {
        await env.program.parseAsync(['run', 'vibe-validate run "npm test"'], { from: 'user' });
      } catch (error: unknown) {
        // Commander.js throws on exitOverride - verify it's the expected error
        expect(error).toBeDefined();
        // Expected exit
      }

      const stdoutCalls = vi.mocked(process.stdout.write).mock.calls
        .map(call => call[0])
        .join('');

      // Verify ALL fields are preserved
      expect(stdoutCalls).toContain('error 1');
      expect(stdoutCalls).toContain('error 2');
      expect(stdoutCalls).toContain('2 tests failed');
      expect(stdoutCalls).toContain('Fix both errors');
      expect(stdoutCalls).toContain('cleaned output here');
      expect(stdoutCalls).toContain('framework: vitest');
      expect(stdoutCalls).toContain('confidence: 95');
      expect(stdoutCalls).toContain('raw output here');
      expect(stdoutCalls).toContain('customField:');
      expect(stdoutCalls).toContain('should be preserved');
    });

    it('should unwrap command field for nested vibe-validate calls', async () => {
      const innerYaml = `---
command: "npx vitest"
exitCode: 0
extraction:
  errors: []
  summary: "Tests passed"
---
`;

      const mockSpawn = vi.mocked(childProcess.spawn);
      const mockProcess = createMockChildProcess(innerYaml, '', 0);
      mockSpawn.mockReturnValue(mockProcess as any);

      runCommand(env.program);

      try {
        await env.program.parseAsync(['run', 'vibe-validate run "npx vitest"'], { from: 'user' });
      } catch (error: unknown) {
        // Commander.js throws on exitOverride - verify it's the expected error
        expect(error).toBeDefined();
        // Expected exit
      }

      const stdoutCalls = vi.mocked(process.stdout.write).mock.calls
        .map(call => call[0])
        .join('');

      // Parse YAML output - strip both opening and closing delimiters
      expect(stdoutCalls).toMatch(/^---\n/);
      const yamlContent = stdoutCalls.replace(/^---\n/, '').replace(/\n---\n?$/, '');

      const yaml = require('yaml');
      const parsed = yaml.parse(yamlContent);

      // Command should be unwrapped (showing actual command, not wrapper)
      expect(parsed.command).toBe('npx vitest');
    });

    it('should preserve exit codes through all nesting levels', async () => {
      const innerYaml = `---
command: "failing-command"
exitCode: 42
extraction:
  errors:
    - message: "custom error"
  summary: "Command failed with code 42"
---
`;

      const mockSpawn = vi.mocked(childProcess.spawn);
      const mockProcess = createMockChildProcess(innerYaml, '', 42);
      mockSpawn.mockReturnValue(mockProcess as any);

      runCommand(env.program);

      try {
        await env.program.parseAsync(['run', 'vibe-validate run "failing-command"'], { from: 'user' });
      } catch (err: unknown) {
        if (err && typeof err === 'object' && 'exitCode' in err) {
          expect(err.exitCode).toBe(42);
        }
      }

      const stdoutCalls = vi.mocked(process.stdout.write).mock.calls
        .map(call => call[0])
        .join('');

      expect(stdoutCalls).toContain('exitCode: 42');
    });

    it('should handle non-YAML output normally (extract errors)', async () => {
      // Regular test output (not YAML) should be extracted normally
      const regularOutput = `
 FAIL  test.ts
 ❯ should work
   AssertionError: expected false to be true
`;

      const mockSpawn = vi.mocked(childProcess.spawn);
      const mockProcess = createMockChildProcess(regularOutput, '', 1);
      mockSpawn.mockReturnValue(mockProcess as any);

      runCommand(env.program);

      try {
        await env.program.parseAsync(['run', 'npm test'], { from: 'user' });
      } catch (error: unknown) {
        // Commander.js throws on exitOverride - verify it's the expected error
        expect(error).toBeDefined();
        // Expected exit
      }

      const stdoutCalls = vi.mocked(process.stdout.write).mock.calls
        .map(call => call[0])
        .join('');

      // Should extract errors normally (not treat as nested YAML)
      expect(stdoutCalls).toContain('---\n');
      expect(stdoutCalls).toContain('errors:');
      // Non-YAML output should use original command (not unwrapped)
      expect(stdoutCalls).toContain('command: npm test');
    });
  });

  describe('edge cases', () => {
    it('should handle Windows line endings in YAML output', async () => {
      // YAML with \r\n instead of \n
      const windowsYaml = `---\r\ncommand: "npm test"\r\nexitCode: 0\r\nextraction:\r\n  errors: []\r\n  summary: "All tests passed"\r\n`;

      const mockSpawn = vi.mocked(childProcess.spawn);
      const mockProcess = createMockChildProcess(windowsYaml, '', 0);
      mockSpawn.mockReturnValue(mockProcess as any);

      runCommand(env.program);

      try {
        await env.program.parseAsync(['run', 'vibe-validate run "npm test"'], { from: 'user' });
      } catch (error: unknown) {
        // Commander.js throws on exitOverride - verify it's the expected error
        expect(error).toBeDefined();
        // Expected exit
      }

      const stdoutCalls = vi.mocked(process.stdout.write).mock.calls
        .map(call => call[0])
        .join('');

      // Should detect Windows-style YAML and unwrap command
      expect(stdoutCalls).toContain('command: npm test');
      expect(stdoutCalls).toContain('npm test');
    });

    it('should handle malformed YAML gracefully', async () => {
      // Invalid YAML (missing colon, broken structure)
      const malformedYaml = `---
command "npm test"
exitCode: 1
extraction
  errors: [
    - file: "test.ts
---
`;

      const mockSpawn = vi.mocked(childProcess.spawn);
      const mockProcess = createMockChildProcess(malformedYaml, '', 1);
      mockSpawn.mockReturnValue(mockProcess as any);

      runCommand(env.program);

      try {
        await env.program.parseAsync(['run', 'vibe-validate run "npm test"'], { from: 'user' });
      } catch (error: unknown) {
        // Commander.js throws on exitOverride - verify it's the expected error
        expect(error).toBeDefined();
        // Expected exit
      }

      const stdoutCalls = vi.mocked(process.stdout.write).mock.calls
        .map(call => call[0])
        .join('');

      // Should fallback to extraction (not crash)
      expect(stdoutCalls).toContain('---\n');
      expect(stdoutCalls).toContain('extraction:');
      // Malformed YAML should use original wrapper command (not unwrapped)
      expect(stdoutCalls).toContain('command: vibe-validate run');
    });

    it('should handle empty YAML output', async () => {
      const emptyYaml = `---
---
`;

      const mockSpawn = vi.mocked(childProcess.spawn);
      const mockProcess = createMockChildProcess(emptyYaml, '', 0);
      mockSpawn.mockReturnValue(mockProcess as any);

      runCommand(env.program);

      try {
        await env.program.parseAsync(['run', 'echo ---'], { from: 'user' });
      } catch (error: unknown) {
        // Commander.js throws on exitOverride - verify it's the expected error
        expect(error).toBeDefined();
        // Expected exit
      }

      const stdoutCalls = vi.mocked(process.stdout.write).mock.calls
        .map(call => call[0])
        .join('');

      // Should handle gracefully
      expect(stdoutCalls).toContain('---\n');
    });

    it('should handle YAML with special characters in strings', async () => {
      const specialCharsYaml = `---
command: 'npm test -- --grep "should handle: special chars (quotes, colons)"'
exitCode: 0
extraction:
  errors: []
  summary: 'Test passed: "success" with 100% coverage'
  guidance: 'Keep going!'
---
`;

      const mockSpawn = vi.mocked(childProcess.spawn);
      const mockProcess = createMockChildProcess(specialCharsYaml, '', 0);
      mockSpawn.mockReturnValue(mockProcess as any);

      runCommand(env.program);

      try {
        await env.program.parseAsync(['run', 'vibe-validate run "npm test"'], { from: 'user' });
      } catch (error: unknown) {
        // Commander.js throws on exitOverride - verify it's the expected error
        expect(error).toBeDefined();
        // Expected exit
      }

      const stdoutCalls = vi.mocked(process.stdout.write).mock.calls
        .map(call => call[0])
        .join('');

      // Should handle special characters in unwrapped command
      expect(stdoutCalls).toContain('command:');
      expect(stdoutCalls).toContain('special chars');
    });

    it('should handle mixed output (text before YAML separator)', async () => {
      const mixedOutput = `Loading configuration...
Starting tests...
---
command: "npm test"
exitCode: 0
extraction:
  errors: []
  summary: "Tests passed"
`;

      const mockSpawn = vi.mocked(childProcess.spawn);
      const mockProcess = createMockChildProcess(mixedOutput, '', 0);
      mockSpawn.mockReturnValue(mockProcess as any);

      runCommand(env.program);

      try {
        await env.program.parseAsync(['run', 'npm test'], { from: 'user' });
      } catch (error: unknown) {
        // Commander.js throws on exitOverride - verify it's the expected error
        expect(error).toBeDefined();
        // Expected exit
      }

      const stdoutCalls = vi.mocked(process.stdout.write).mock.calls
        .map(call => call[0])
        .join('');

      // NEW BEHAVIOR: SHOULD detect YAML even with preamble and unwrap command
      expect(stdoutCalls).toContain('extraction:');
      expect(stdoutCalls).toContain('command: npm test');
      expect(stdoutCalls).toContain('npm test');

      // Verify preamble was routed to stderr
      const stderrCalls = vi.mocked(process.stderr.write).mock.calls
        .map(call => call[0])
        .join('');
      expect(stderrCalls).toContain('Loading configuration');
      expect(stderrCalls).toContain('Starting tests');
    });

    it('should handle YAML with null values', async () => {
      const nullYaml = `---
command: "npm test"
exitCode: 0
extraction:
  errors: []
  summary: null
  guidance: null
customField: null
---
`;

      const mockSpawn = vi.mocked(childProcess.spawn);
      const mockProcess = createMockChildProcess(nullYaml, '', 0);
      mockSpawn.mockReturnValue(mockProcess as any);

      runCommand(env.program);

      try {
        await env.program.parseAsync(['run', 'vibe-validate run "npm test"'], { from: 'user' });
      } catch (error: unknown) {
        // Commander.js throws on exitOverride - verify it's the expected error
        expect(error).toBeDefined();
        // Expected exit
      }

      const stdoutCalls = vi.mocked(process.stdout.write).mock.calls
        .map(call => call[0])
        .join('');

      // Should handle null values and unwrap command
      expect(stdoutCalls).toContain('command: npm test');
      expect(stdoutCalls).toContain('npm test');
    });

    it('should handle very deep nesting (10 levels)', async () => {
      const deepYaml = `---
command: "npm test"
exitCode: 0
extraction:
  errors: []
  summary: "Tests passed"
---
`;

      const mockSpawn = vi.mocked(childProcess.spawn);
      const mockProcess = createMockChildProcess(deepYaml, '', 0);
      mockSpawn.mockReturnValue(mockProcess as any);

      runCommand(env.program);

      try {
        await env.program.parseAsync(['run', String.raw`vibe-validate run "vibe-validate run \"...\"" (10 levels)`], { from: 'user' });
      } catch (error: unknown) {
        // Commander.js throws on exitOverride - verify it's the expected error
        expect(error).toBeDefined();
        // Expected exit
      }

      const stdoutCalls = vi.mocked(process.stdout.write).mock.calls
        .map(call => call[0])
        .join('');

      // Should unwrap to innermost command
      expect(stdoutCalls).toContain('command: npm test');
      expect(stdoutCalls).toContain('npm test');
    });
  });

  describe('error recovery', () => {
    it('should handle YAML missing command field', async () => {
      const missingCommandYaml = `---
exitCode: 1
extraction:
  errors:
    - message: "error"
  summary: "Failed"
---
`;

      const mockSpawn = vi.mocked(childProcess.spawn);
      const mockProcess = createMockChildProcess(missingCommandYaml, '', 1);
      mockSpawn.mockReturnValue(mockProcess as any);

      runCommand(env.program);

      try {
        await env.program.parseAsync(['run', 'vibe-validate run "npm test"'], { from: 'user' });
      } catch (error: unknown) {
        // Commander.js throws on exitOverride - verify it's the expected error
        expect(error).toBeDefined();
        // Expected exit
      }

      const stdoutCalls = vi.mocked(process.stdout.write).mock.calls
        .map(call => call[0])
        .join('');

      // Should use 'unknown' treeHash when command field is missing
      expect(stdoutCalls).toContain('treeHash: unknown');
      expect(stdoutCalls).toContain('unknown');
    });

    it('should handle YAML with non-string command field', async () => {
      const nonStringCommandYaml = `---
command: 123
exitCode: 0
extraction:
  errors: []
  summary: "Passed"
---
`;

      const mockSpawn = vi.mocked(childProcess.spawn);
      const mockProcess = createMockChildProcess(nonStringCommandYaml, '', 0);
      mockSpawn.mockReturnValue(mockProcess as any);

      runCommand(env.program);

      try {
        await env.program.parseAsync(['run', 'vibe-validate run "npm test"'], { from: 'user' });
      } catch (error: unknown) {
        // Commander.js throws on exitOverride - verify it's the expected error
        expect(error).toBeDefined();
        // Expected exit
      }

      const stdoutCalls = vi.mocked(process.stdout.write).mock.calls
        .map(call => call[0])
        .join('');

      // Should use 'unknown' treeHash when command field is non-string
      expect(stdoutCalls).toContain('treeHash: unknown');
      expect(stdoutCalls).toContain('unknown');
    });

    it('should handle corrupted YAML structure', async () => {
      const corruptedYaml = `---
command: "npm test"
extraction: "this should be an object"
exitCode: "not a number"
---
`;

      const mockSpawn = vi.mocked(childProcess.spawn);
      const mockProcess = createMockChildProcess(corruptedYaml, '', 0);
      mockSpawn.mockReturnValue(mockProcess as any);

      runCommand(env.program);

      try {
        await env.program.parseAsync(['run', 'vibe-validate run "npm test"'], { from: 'user' });
      } catch (error: unknown) {
        // Commander.js throws on exitOverride - verify it's the expected error
        expect(error).toBeDefined();
        // Expected exit
      }

      const stdoutCalls = vi.mocked(process.stdout.write).mock.calls
        .map(call => call[0])
        .join('');

      // Should unwrap command even with corrupted types
      expect(stdoutCalls).toContain('command: npm test');
    });

    it('should handle YAML parsing exceptions gracefully', async () => {
      // Intentionally broken YAML that will throw on parse
      const brokenYaml = `---
  invalid: yaml: structure:
    - with: [unclosed
---
`;

      const mockSpawn = vi.mocked(childProcess.spawn);
      const mockProcess = createMockChildProcess(brokenYaml, '', 1);
      mockSpawn.mockReturnValue(mockProcess as any);

      runCommand(env.program);

      try {
        await env.program.parseAsync(['run', 'vibe-validate run "npm test"'], { from: 'user' });
      } catch (error: unknown) {
        // Commander.js throws on exitOverride - verify it's the expected error
        expect(error).toBeDefined();
        // Expected exit
      }

      // Should fallback to extraction (no warning - nested vv run is normal)
      const stdoutCalls = vi.mocked(process.stdout.write).mock.calls
        .map(call => call[0])
        .join('');

      expect(stdoutCalls).toContain('extraction:');
    });
  });

  describe('boundary conditions', () => {
    it('should handle very large YAML output (1MB+)', async () => {
      // Create large YAML with many errors
      const largeErrors = Array.from({ length: 10000 }, (_, i) => ({
        file: `test${i}.ts`,
        line: i + 1,
        message: `Error ${i}: This is a detailed error message that adds to the total size`
      }));

      const largeYaml = `---
command: "npm test"
exitCode: 1
extraction:
  errors:
${largeErrors.map(e => `    - file: "${e.file}"\n      line: ${e.line}\n      message: "${e.message}"`).join('\n')}
  summary: "10000 test failures"
---
`;

      const mockSpawn = vi.mocked(childProcess.spawn);
      const mockProcess = createMockChildProcess(largeYaml, '', 1);
      mockSpawn.mockReturnValue(mockProcess as any);

      runCommand(env.program);

      try {
        await env.program.parseAsync(['run', 'vibe-validate run "npm test"'], { from: 'user' });
      } catch (error: unknown) {
        // Commander.js throws on exitOverride - verify it's the expected error
        expect(error).toBeDefined();
        // Expected exit
      }

      const stdoutCalls = vi.mocked(process.stdout.write).mock.calls
        .map(call => call[0])
        .join('');

      // Should handle large output without crashing and unwrap command
      expect(stdoutCalls).toContain('command:');
      expect(stdoutCalls).toContain('10000 test failures');
    });

    it('should handle very long command strings', async () => {
      const longCommand = 'vibe-validate run "' + 'a'.repeat(5000) + '"';
      const innerYaml = `---
command: "${'npm test with very long arguments '.repeat(100)}"
exitCode: 0
extraction:
  errors: []
  summary: "Passed"
---
`;

      const mockSpawn = vi.mocked(childProcess.spawn);
      const mockProcess = createMockChildProcess(innerYaml, '', 0);
      mockSpawn.mockReturnValue(mockProcess as any);

      runCommand(env.program);

      try {
        await env.program.parseAsync(['run', longCommand], { from: 'user' });
      } catch (error: unknown) {
        // Commander.js throws on exitOverride - verify it's the expected error
        expect(error).toBeDefined();
        // Expected exit
      }

      const stdoutCalls = vi.mocked(process.stdout.write).mock.calls
        .map(call => call[0])
        .join('');

      // Should handle very long commands and unwrap
      expect(stdoutCalls).toContain('command:');
      expect(stdoutCalls).toContain('npm test with very long arguments');
    });

    it('should handle multiple YAML separators in output', async () => {
      const multiSeparatorOutput = `---
command: "npm test"
exitCode: 0
extraction:
  errors: []
  summary: "Passed"
  rawOutput: |
    Some output with --- in it
    And another --- here
`;

      const mockSpawn = vi.mocked(childProcess.spawn);
      const mockProcess = createMockChildProcess(multiSeparatorOutput, '', 0);
      mockSpawn.mockReturnValue(mockProcess as any);

      runCommand(env.program);

      try {
        await env.program.parseAsync(['run', 'vibe-validate run "npm test"'], { from: 'user' });
      } catch (error: unknown) {
        // Commander.js throws on exitOverride - verify it's the expected error
        expect(error).toBeDefined();
        // Expected exit
      }

      const stdoutCalls = vi.mocked(process.stdout.write).mock.calls
        .map(call => call[0])
        .join('');

      // Should parse correctly (YAML parser handles this) and unwrap command
      expect(stdoutCalls).toContain('command: npm test');
    });
  });

  describe('real-world scenarios', () => {
    it('should handle commands that produce both stdout and stderr', async () => {
      const yamlOnStdout = `---
command: "npm test"
exitCode: 1
extraction:
  errors:
    - message: "test failed"
  summary: "1 failure"
`;
      const stderrOutput = 'npm WARN deprecated package@1.0.0';

      const mockSpawn = vi.mocked(childProcess.spawn);
      const mockProcess = createMockChildProcess(yamlOnStdout, stderrOutput, 1);
      mockSpawn.mockReturnValue(mockProcess as any);

      runCommand(env.program);

      try {
        await env.program.parseAsync(['run', 'vibe-validate run "npm test"'], { from: 'user' });
      } catch (error: unknown) {
        // Commander.js throws on exitOverride - verify it's the expected error
        expect(error).toBeDefined();
        // Expected exit
      }

      const stdoutCalls = vi.mocked(process.stdout.write).mock.calls
        .map(call => call[0])
        .join('');

      // NEW BEHAVIOR: Check stdout only for YAML (stderr doesn't corrupt)
      // Should successfully detect and unwrap command despite stderr warnings
      expect(stdoutCalls).toContain('command: npm test');
      expect(stdoutCalls).toContain('npm test');
    });

    it('should handle commands with non-standard exit codes', async () => {
      const innerYaml = `---
command: "custom-tool"
exitCode: 42
extraction:
  errors:
    - message: "custom error"
  summary: "Custom failure"
---
`;

      const mockSpawn = vi.mocked(childProcess.spawn);
      const mockProcess = createMockChildProcess(innerYaml, '', 42);
      mockSpawn.mockReturnValue(mockProcess as any);

      runCommand(env.program);

      try {
        await env.program.parseAsync(['run', 'vibe-validate run "custom-tool"'], { from: 'user' });
      } catch (err: unknown) {
        if (err && typeof err === 'object' && 'exitCode' in err) {
          expect(err.exitCode).toBe(42);
        }
      }

      const stdoutCalls = vi.mocked(process.stdout.write).mock.calls
        .map(call => call[0])
        .join('');

      expect(stdoutCalls).toContain('exitCode: 42');
    });

    it('should handle exit code mismatches between inner and outer', async () => {
      // Inner reports 0, but outer got 1
      const innerYaml = `---
command: "npm test"
exitCode: 0
extraction:
  errors: []
  summary: "Passed"
---
`;

      const mockSpawn = vi.mocked(childProcess.spawn);
      const mockProcess = createMockChildProcess(innerYaml, '', 1); // Outer exit code is 1
      mockSpawn.mockReturnValue(mockProcess as any);

      runCommand(env.program);

      try {
        await env.program.parseAsync(['run', 'vibe-validate run "npm test"'], { from: 'user' });
      } catch (error: unknown) {
        // Commander.js throws on exitOverride - verify it's the expected error
        expect(error).toBeDefined();
        // Expected exit
      }

      const stdoutCalls = vi.mocked(process.stdout.write).mock.calls
        .map(call => call[0])
        .join('');

      // Should use outer exit code
      expect(stdoutCalls).toContain('exitCode: 1');
    });
  });

  describe('preamble extraction and stderr routing', () => {
    it('should extract preamble before YAML and route to stderr (pnpm)', async () => {
      const pnpmOutput = `> vibe-validate@0.13.0 validate /Users/jeff/Workspaces/vibe-validate
> node packages/cli/dist/bin.js validate "--yaml"

---
command: "npm test"
exitCode: 0
extraction:
  errors: []
  summary: "All tests passed"
`;

      const mockSpawn = vi.mocked(childProcess.spawn);
      const mockProcess = createMockChildProcess(pnpmOutput, '', 0);
      mockSpawn.mockReturnValue(mockProcess as any);

      runCommand(env.program);

      try {
        await env.program.parseAsync(['run', 'pnpm validate --yaml'], { from: 'user' });
      } catch (error: unknown) {
        // Commander.js throws on exitOverride - verify it's the expected error
        expect(error).toBeDefined();
        // Expected exit
      }

      // Verify stdout contains ONLY clean YAML
      const stdoutCalls = vi.mocked(process.stdout.write).mock.calls
        .map(call => call[0])
        .join('');
      expect(stdoutCalls).toContain('---\n');
      expect(stdoutCalls).toContain('command:');
      expect(stdoutCalls).toContain('npm test');
      // Preamble should NOT be in stdout
      expect(stdoutCalls).not.toContain('vibe-validate@0.13.0 validate');

      // Verify stderr contains preamble
      const stderrCalls = vi.mocked(process.stderr.write).mock.calls
        .map(call => call[0])
        .join('');
      expect(stderrCalls).toContain('vibe-validate@0.13.0 validate');
      expect(stderrCalls).toContain('node packages/cli/dist/bin.js');
    });

    it('should extract preamble before YAML and route to stderr (npm)', async () => {
      const npmOutput = `
> packagename@1.0.0 test
> vitest run

---
command: "vitest run"
exitCode: 0
extraction:
  errors: []
  summary: "Tests passed"
`;

      const mockSpawn = vi.mocked(childProcess.spawn);
      const mockProcess = createMockChildProcess(npmOutput, '', 0);
      mockSpawn.mockReturnValue(mockProcess as any);

      runCommand(env.program);

      try {
        await env.program.parseAsync(['run', 'npm test'], { from: 'user' });
      } catch (error: unknown) {
        // Commander.js throws on exitOverride - verify it's the expected error
        expect(error).toBeDefined();
        // Expected exit
      }

      const stdoutCalls = vi.mocked(process.stdout.write).mock.calls
        .map(call => call[0])
        .join('');
      expect(stdoutCalls).not.toContain('packagename@1.0.0');

      const stderrCalls = vi.mocked(process.stderr.write).mock.calls
        .map(call => call[0])
        .join('');
      expect(stderrCalls).toContain('packagename@1.0.0 test');
    });

    it('should extract preamble before YAML and route to stderr (yarn)', async () => {
      const yarnOutput = `$ vitest run
---
command: "vitest run"
exitCode: 0
extraction:
  errors: []
  summary: "Tests passed"
`;

      const mockSpawn = vi.mocked(childProcess.spawn);
      const mockProcess = createMockChildProcess(yarnOutput, '', 0);
      mockSpawn.mockReturnValue(mockProcess as any);

      runCommand(env.program);

      try {
        await env.program.parseAsync(['run', 'yarn test'], { from: 'user' });
      } catch (error: unknown) {
        // Commander.js throws on exitOverride - verify it's the expected error
        expect(error).toBeDefined();
        // Expected exit
      }

      const stdoutCalls = vi.mocked(process.stdout.write).mock.calls
        .map(call => call[0])
        .join('');
      expect(stdoutCalls).not.toContain('$ vitest run');

      const stderrCalls = vi.mocked(process.stderr.write).mock.calls
        .map(call => call[0])
        .join('');
      expect(stderrCalls).toContain('$ vitest run');
    });

    it('should combine preamble with original stderr', async () => {
      const outputWithPreamble = `> package@1.0.0 test
> npm test

---
command: "npm test"
exitCode: 1
extraction:
  errors:
    - message: "test failed"
  summary: "1 failure"
`;
      const originalStderr = 'npm WARN deprecated package@1.0.0';

      const mockSpawn = vi.mocked(childProcess.spawn);
      const mockProcess = createMockChildProcess(outputWithPreamble, originalStderr, 1);
      mockSpawn.mockReturnValue(mockProcess as any);

      runCommand(env.program);

      try {
        await env.program.parseAsync(['run', 'npm test'], { from: 'user' });
      } catch (error: unknown) {
        // Commander.js throws on exitOverride - verify it's the expected error
        expect(error).toBeDefined();
        // Expected exit
      }

      const stderrCalls = vi.mocked(process.stderr.write).mock.calls
        .map(call => call[0])
        .join('');

      // Should contain both preamble and original stderr
      expect(stderrCalls).toContain('package@1.0.0 test');
      expect(stderrCalls).toContain('npm WARN deprecated');
    });

    it('should handle output with no preamble (clean YAML from start)', async () => {
      const cleanYaml = `---
command: "npm test"
exitCode: 0
extraction:
  errors: []
  summary: "Passed"
---
`;

      const mockSpawn = vi.mocked(childProcess.spawn);
      const mockProcess = createMockChildProcess(cleanYaml, '', 0);
      mockSpawn.mockReturnValue(mockProcess as any);

      runCommand(env.program);

      try {
        await env.program.parseAsync(['run', 'vibe-validate run "npm test"'], { from: 'user' });
      } catch (error: unknown) {
        // Commander.js throws on exitOverride - verify it's the expected error
        expect(error).toBeDefined();
        // Expected exit
      }

      const stdoutCalls = vi.mocked(process.stdout.write).mock.calls
        .map(call => call[0])
        .join('');
      expect(stdoutCalls).toContain('---\n');
      expect(stdoutCalls).toContain('command:');

      // No preamble to write to stderr
      const stderrCalls = vi.mocked(process.stderr.write).mock.calls;
      // Should either be empty or not contain YAML content
      const allStderr = stderrCalls.map(call => call[0]).join('');
      expect(allStderr).not.toContain('command:');
    });

    it('should handle postamble after YAML', async () => {
      const outputWithPostamble = `---
command: "npm test"
exitCode: 0
extraction:
  errors: []
  summary: "Passed"

Done in 5.2s
`;

      const mockSpawn = vi.mocked(childProcess.spawn);
      const mockProcess = createMockChildProcess(outputWithPostamble, '', 0);
      mockSpawn.mockReturnValue(mockProcess as any);

      runCommand(env.program);

      try {
        await env.program.parseAsync(['run', 'npm test'], { from: 'user' });
      } catch (error: unknown) {
        // Commander.js throws on exitOverride - verify it's the expected error
        expect(error).toBeDefined();
        // Expected exit
      }

      const stdoutCalls = vi.mocked(process.stdout.write).mock.calls
        .map(call => call[0])
        .join('');

      // Stdout should be clean YAML
      expect(stdoutCalls).toContain('---\n');
      expect(stdoutCalls).toContain('command:');

      // Postamble handling - for now we'll include it in YAML parse
      // (YAML parser will stop at end of document)
      // This is acceptable behavior
    });

    it('should preserve YAML with preamble and errors', async () => {
      const pnpmWithErrors = `> package@1.0.0 test
> vitest run

---
command: "vitest run"
exitCode: 1
extraction:
  errors:
    - file: "test.ts"
      line: 42
      message: "expected 5 to equal 3"
  summary: "1 test failed"
  guidance: "Fix assertion"
`;

      const mockSpawn = vi.mocked(childProcess.spawn);
      const mockProcess = createMockChildProcess(pnpmWithErrors, '', 1);
      mockSpawn.mockReturnValue(mockProcess as any);

      runCommand(env.program);

      try {
        await env.program.parseAsync(['run', 'pnpm test'], { from: 'user' });
      } catch (error: unknown) {
        // Commander.js throws on exitOverride - verify it's the expected error
        expect(error).toBeDefined();
        // Expected exit with code 1
      }

      const stdoutCalls = vi.mocked(process.stdout.write).mock.calls
        .map(call => call[0])
        .join('');

      // All error details should be in stdout YAML
      expect(stdoutCalls).toContain('expected 5 to equal 3');
      expect(stdoutCalls).toContain('1 test failed');
      expect(stdoutCalls).toContain('exitCode: 1');

      const stderrCalls = vi.mocked(process.stderr.write).mock.calls
        .map(call => call[0])
        .join('');
      expect(stderrCalls).toContain('package@1.0.0 test');
    });
  });
});


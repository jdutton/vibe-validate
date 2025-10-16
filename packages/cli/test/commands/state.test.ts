import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Command } from 'commander';
import { stateCommand } from '../../src/commands/state.js';

describe('state command', () => {
  let testDir: string;
  let originalCwd: string;
  let program: Command;

  beforeEach(() => {
    // Create temp directory for test files
    testDir = join(tmpdir(), `vibe-validate-state-test-${Date.now()}`);
    if (!existsSync(testDir)) {
      mkdirSync(testDir, { recursive: true });
    }

    // Save original cwd and change to test directory
    originalCwd = process.cwd();
    process.chdir(testDir);

    // Create fresh Commander instance
    program = new Command();
    program.exitOverride(); // Prevent process.exit() from killing tests

    // Spy on console methods to capture output
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    // Restore cwd
    process.chdir(originalCwd);

    // Clean up test files
    if (existsSync(testDir)) {
      try {
        rmSync(testDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }

    vi.restoreAllMocks();
  });

  describe('command registration', () => {
    it('should register state command with correct name', () => {
      stateCommand(program);

      const commands = program.commands;
      const stateCmd = commands.find(cmd => cmd.name() === 'state');

      expect(stateCmd).toBeDefined();
      expect(stateCmd?.description()).toBe('Show current validation state');
    });

    it('should register --format option', () => {
      stateCommand(program);

      const stateCmd = program.commands.find(cmd => cmd.name() === 'state');
      const options = stateCmd?.options;

      expect(options?.some(opt => opt.flags === '--format <format>')).toBe(true);
    });

    it('should register --file option', () => {
      stateCommand(program);

      const stateCmd = program.commands.find(cmd => cmd.name() === 'state');
      const options = stateCmd?.options;

      expect(options?.some(opt => opt.flags === '--file <path>')).toBe(true);
    });
  });

  describe('no state file', () => {
    it('should handle missing state file in human format', async () => {
      stateCommand(program);

      try {
        await program.parseAsync(['state'], { from: 'user' });
      } catch (error: unknown) {
        // Commander throws when exitOverride is set
        // We expect exit code 0 for missing state file
        if (error && typeof error === 'object' && 'exitCode' in error) {
          expect(error.exitCode).toBe(0);
        }
      }

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('No validation state found'));
    });

    it('should handle missing state file in json format', async () => {
      stateCommand(program);

      try {
        await program.parseAsync(['state', '--format', 'json'], { from: 'user' });
      } catch (error: unknown) {
        if (error && typeof error === 'object' && 'exitCode' in error) {
          expect(error.exitCode).toBe(0);
        }
      }

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('"exists": false'));
    });

    it('should handle missing state file in yaml format', async () => {
      stateCommand(program);

      try {
        await program.parseAsync(['state', '--format', 'yaml'], { from: 'user' });
      } catch (error: unknown) {
        if (error && typeof error === 'object' && 'exitCode' in error) {
          expect(error.exitCode).toBe(0);
        }
      }

      expect(console.log).toHaveBeenCalledWith('exists: false');
    });
  });

  describe('passed validation state', () => {
    beforeEach(() => {
      const stateContent = {
        passed: true,
        timestamp: '2025-10-16T12:00:00.000Z',
        treeHash: 'abc123def456',
      };

      writeFileSync(
        join(testDir, '.vibe-validate-state.yaml'),
        JSON.stringify(stateContent, null, 2)
      );
    });

    it('should display passed state in human format', async () => {
      stateCommand(program);

      try {
        await program.parseAsync(['state'], { from: 'user' });
      } catch (error: unknown) {
        if (error && typeof error === 'object' && 'exitCode' in error) {
          expect(error.exitCode).toBe(0);
        }
      }

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('PASSED'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Safe to commit'));
    });

    it('should display state in json format', async () => {
      stateCommand(program);

      try {
        await program.parseAsync(['state', '--format', 'json'], { from: 'user' });
      } catch (error: unknown) {
        if (error && typeof error === 'object' && 'exitCode' in error) {
          expect(error.exitCode).toBe(0);
        }
      }

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('"passed": true'));
    });
  });

  describe('failed validation state', () => {
    beforeEach(() => {
      const stateContent = {
        passed: false,
        timestamp: '2025-10-16T12:00:00.000Z',
        treeHash: 'abc123def456',
        failedStep: 'TypeScript Type Check',
        failedStepOutput: 'Error: Type mismatch\nExpected string, got number',
        agentPrompt: 'Fix TypeScript type errors in src/index.ts',
      };

      writeFileSync(
        join(testDir, '.vibe-validate-state.yaml'),
        JSON.stringify(stateContent, null, 2)
      );
    });

    it('should display failed state in human format', async () => {
      stateCommand(program);

      try {
        await program.parseAsync(['state'], { from: 'user' });
      } catch (error: unknown) {
        if (error && typeof error === 'object' && 'exitCode' in error) {
          expect(error.exitCode).toBe(0);
        }
      }

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('FAILED'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('TypeScript Type Check'));
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Next Steps'));
    });

    it('should truncate long error output', async () => {
      const longOutput = Array(30).fill('Error line').join('\n');
      const stateContent = {
        passed: false,
        timestamp: '2025-10-16T12:00:00.000Z',
        treeHash: 'abc123def456',
        failedStep: 'Build',
        failedStepOutput: longOutput,
      };

      writeFileSync(
        join(testDir, '.vibe-validate-state.yaml'),
        JSON.stringify(stateContent, null, 2)
      );

      stateCommand(program);

      try {
        await program.parseAsync(['state'], { from: 'user' });
      } catch (error: unknown) {
        if (error && typeof error === 'object' && 'exitCode' in error) {
          expect(error.exitCode).toBe(0);
        }
      }

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('truncated'));
    });
  });

  describe('custom state file path', () => {
    it('should read from custom path when --file provided', async () => {
      const customPath = 'custom-state.yaml';
      const stateContent = {
        passed: true,
        timestamp: '2025-10-16T12:00:00.000Z',
        treeHash: 'custom123',
      };

      writeFileSync(
        join(testDir, customPath),
        JSON.stringify(stateContent, null, 2)
      );

      stateCommand(program);

      try {
        await program.parseAsync(['state', '--file', customPath], { from: 'user' });
      } catch (error: unknown) {
        if (error && typeof error === 'object' && 'exitCode' in error) {
          expect(error.exitCode).toBe(0);
        }
      }

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('custom123'));
    });
  });

  describe('error handling', () => {
    it('should handle invalid JSON in state file', async () => {
      writeFileSync(
        join(testDir, '.vibe-validate-state.yaml'),
        'this is not valid JSON!'
      );

      stateCommand(program);

      try {
        await program.parseAsync(['state'], { from: 'user' });
      } catch (error: unknown) {
        if (error && typeof error === 'object' && 'exitCode' in error) {
          expect(error.exitCode).toBe(1);
        }
      }

      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to read validation state'),
        expect.anything()
      );
    });
  });
});

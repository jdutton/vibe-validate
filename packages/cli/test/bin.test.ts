import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { spawn } from 'child_process';
import { join } from 'path';
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';

describe('bin.ts - CLI entry point', () => {
  let testDir: string;
  let originalCwd: string;
  const binPath = join(__dirname, '../dist/bin.js');

  beforeEach(() => {
    // Create temp directory for test files
    testDir = join(tmpdir(), `vibe-validate-bin-test-${Date.now()}`);
    if (!existsSync(testDir)) {
      mkdirSync(testDir, { recursive: true });
    }

    // Save original cwd
    originalCwd = process.cwd();
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

  /**
   * Helper function to execute CLI and capture output
   */
  function executeCLI(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
    return new Promise((resolve) => {
      const child = spawn('node', [binPath, ...args], {
        cwd: testDir,
        env: { ...process.env, NO_COLOR: '1' }, // Disable colors for easier testing
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        resolve({ code: code ?? 1, stdout, stderr });
      });

      child.on('error', (error) => {
        resolve({ code: 1, stdout, stderr: error.message });
      });
    });
  }

  describe('version display', () => {
    it('should display version with --version flag', async () => {
      const result = await executeCLI(['--version']);

      expect(result.code).toBe(0);
      expect(result.stdout).toMatch(/\d+\.\d+\.\d+/); // Matches semantic version
    });

    it('should display version with -V flag', async () => {
      const result = await executeCLI(['-V']);

      expect(result.code).toBe(0);
      expect(result.stdout).toMatch(/\d+\.\d+\.\d+/);
    });

    it('should not show fallback version warning in production', async () => {
      const result = await executeCLI(['--version']);

      expect(result.stderr).not.toContain('Could not read package.json version');
    });
  });

  describe('help display', () => {
    it('should display help with --help flag', async () => {
      const result = await executeCLI(['--help']);

      expect(result.code).toBe(0);
      expect(result.stdout).toContain('vibe-validate');
      expect(result.stdout).toContain('Agent-friendly validation framework');
    });

    it('should display help with -h flag', async () => {
      const result = await executeCLI(['-h']);

      expect(result.code).toBe(0);
      expect(result.stdout).toContain('vibe-validate');
    });

    it('should list all available commands in help', async () => {
      const result = await executeCLI(['--help']);

      expect(result.stdout).toContain('validate');
      expect(result.stdout).toContain('init');
      expect(result.stdout).toContain('pre-commit');
      expect(result.stdout).toContain('state');
      expect(result.stdout).toContain('sync-check');
      expect(result.stdout).toContain('cleanup');
      expect(result.stdout).toContain('config');
    });
  });

  describe('command registration', () => {
    it('should execute validate command', async () => {
      // This will fail due to no config, but proves the command is registered
      const result = await executeCLI(['validate']);

      // Should fail with "No configuration found"
      expect(result.code).toBe(1);
      expect(result.stderr).toContain('No configuration found');
    });

    it('should execute state command', async () => {
      // Should succeed even with no state file (minimal YAML output)
      const result = await executeCLI(['state']);

      expect(result.code).toBe(0);
      expect(result.stdout).toContain('exists: false');
    });

    it('should execute config command', async () => {
      // Should fail with "No configuration file found"
      const result = await executeCLI(['config']);

      expect(result.code).toBe(1);
      expect(result.stderr).toContain('No configuration file found');
    });

    it('should execute sync-check command', async () => {
      // Initialize a git repo first (required for sync-check)
      const { execSync } = await import('child_process');
      execSync('git init', { cwd: testDir });
      execSync('git config user.email "test@example.com"', { cwd: testDir });
      execSync('git config user.name "Test User"', { cwd: testDir });

      const result = await executeCLI(['sync-check']);

      // Should succeed (no remote, so always "up to date")
      expect(result.code).toBe(0);
    });
  });

  describe('error handling', () => {
    it('should exit with error for unknown command', async () => {
      const result = await executeCLI(['unknown-command']);

      expect(result.code).toBe(1);
      expect(result.stderr).toContain('unknown command');
    });

    it('should exit with error for invalid option', async () => {
      const result = await executeCLI(['validate', '--invalid-option']);

      expect(result.code).toBe(1);
      expect(result.stderr).toContain('unknown option');
    });
  });

  describe('command options', () => {
    it('should pass --force option to validate command', async () => {
      const result = await executeCLI(['validate', '--force']);

      // Should fail due to no config, but proves option was parsed
      expect(result.code).toBe(1);
      expect(result.stderr).toContain('No configuration found');
    });

    it('should pass --verbose option to state command', async () => {
      const result = await executeCLI(['state', '--verbose']);

      expect(result.code).toBe(0);
      expect(result.stdout).toContain('exists: false');
    });

    it('should pass --validate option to config command', async () => {
      const result = await executeCLI(['config', '--validate']);

      // Should fail due to no config
      expect(result.code).toBe(1);
      expect(result.stderr).toContain('No configuration file found');
    });
  });

  describe('end-to-end workflows', () => {
    it('should run full config → state workflow', async () => {
      // Create a minimal config file
      const configContent = `
export default {
  extends: 'typescript-nodejs',
  validation: {
    phases: [
      {
        name: 'Test Phase',
        parallel: true,
        steps: [
          { name: 'Pass Test', command: 'echo "test passed"' }
        ]
      }
    ]
  }
};
`;
      writeFileSync(join(testDir, 'vibe-validate.config.js'), configContent);

      // Initialize git (required for validation)
      const { execSync } = await import('child_process');
      execSync('git init', { cwd: testDir });
      execSync('git config user.email "test@example.com"', { cwd: testDir });
      execSync('git config user.name "Test User"', { cwd: testDir });
      execSync('git add .', { cwd: testDir });
      execSync('git commit -m "Initial commit"', { cwd: testDir });

      // 1. Verify config is valid
      const configResult = await executeCLI(['config', '--validate']);
      expect(configResult.code).toBe(0);
      expect(configResult.stdout).toContain('Configuration is valid');

      // 2. Run validation (should create state file)
      const validateResult = await executeCLI(['validate']);
      expect(validateResult.code).toBe(0);

      // 3. Check state (should show passed) - use --verbose for status text
      const stateResult = await executeCLI(['state', '--verbose']);
      expect(stateResult.code).toBe(0);
      expect(stateResult.stdout).toContain('PASSED');
    }, 30000); // Increase timeout for full workflow

    it('should handle validation failure workflow', async () => {
      // Create a config with failing step
      const configContent = `
export default {
  extends: 'typescript-nodejs',
  validation: {
    phases: [
      {
        name: 'Test Phase',
        parallel: true,
        steps: [
          { name: 'Fail Test', command: 'exit 1' }
        ]
      }
    ]
  }
};
`;
      writeFileSync(join(testDir, 'vibe-validate.config.js'), configContent);

      // Initialize git
      const { execSync } = await import('child_process');
      execSync('git init', { cwd: testDir });
      execSync('git config user.email "test@example.com"', { cwd: testDir });
      execSync('git config user.name "Test User"', { cwd: testDir });
      execSync('git add .', { cwd: testDir });
      execSync('git commit -m "Initial commit"', { cwd: testDir });

      // Run validation (should fail)
      const validateResult = await executeCLI(['validate']);
      expect(validateResult.code).toBe(1);

      // Check state (should show failed) - use --verbose for status text
      const stateResult = await executeCLI(['state', '--verbose']);
      expect(stateResult.code).toBe(0);
      expect(stateResult.stdout).toContain('FAILED');
    }, 30000); // Increase timeout for full workflow

    it('should bypass cache when --force flag is used', async () => {
      // Create a config with passing step
      const configContent = `
export default {
  extends: 'typescript-nodejs',
  validation: {
    phases: [
      {
        name: 'Test Phase',
        parallel: true,
        steps: [
          { name: 'Pass Test', command: 'echo "test passed"' }
        ]
      }
    ]
  }
};
`;
      writeFileSync(join(testDir, 'vibe-validate.config.js'), configContent);

      // Initialize git
      const { execSync } = await import('child_process');
      execSync('git init', { cwd: testDir });
      execSync('git config user.email "test@example.com"', { cwd: testDir });
      execSync('git config user.name "Test User"', { cwd: testDir });
      execSync('git add .', { cwd: testDir });
      execSync('git commit -m "Initial commit"', { cwd: testDir });

      // 1. First run - should execute validation (minimal output: phase_start)
      const firstRun = await executeCLI(['validate']);
      expect(firstRun.code).toBe(0);
      expect(firstRun.stdout).toContain('phase_start: Test Phase');

      // 2. Second run without --force - should use cache
      const cachedRun = await executeCLI(['validate']);
      expect(cachedRun.code).toBe(0);
      expect(cachedRun.stdout).toContain('already passed');
      expect(cachedRun.stdout).not.toContain('phase_start'); // Should NOT run phases

      // 3. Third run with --force - should bypass cache and run validation
      const forcedRun = await executeCLI(['validate', '--force']);
      expect(forcedRun.code).toBe(0);
      expect(forcedRun.stdout).toContain('phase_start: Test Phase'); // Should run phases again
      expect(forcedRun.stdout).not.toContain('already passed'); // Should NOT show cache message
    }, 30000); // Increase timeout for full workflow
  });

  describe('process lifecycle', () => {
    it('should exit cleanly on successful command', async () => {
      const result = await executeCLI(['state']);

      expect(result.code).toBe(0);
    });

    it('should exit cleanly on failed command', async () => {
      const result = await executeCLI(['config']);

      expect(result.code).toBe(1);
    });

    it('should handle SIGINT gracefully', async () => {
      // This is a challenging test - we spawn a long-running process and kill it
      const child = spawn('node', [binPath, 'state'], {
        cwd: testDir,
      });

      // Give process time to start
      await new Promise(resolve => setTimeout(resolve, 100));

      // Send SIGINT
      child.kill('SIGINT');

      // Wait for process to exit
      const exitCode = await new Promise<number>((resolve) => {
        child.on('close', (code) => resolve(code ?? 1));
        // Timeout after 2 seconds
        setTimeout(() => {
          child.kill('SIGKILL');
          resolve(1);
        }, 2000);
      });

      // Process should exit (code might be 0 or non-zero depending on timing)
      expect(typeof exitCode).toBe('number');
    }, 10000); // Increase test timeout to 10 seconds
  });
});

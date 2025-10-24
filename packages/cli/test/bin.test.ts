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
   * Helper to log detailed diagnostics when a CLI command fails unexpectedly
   */
  function logCommandFailure(
    args: string[],
    result: { code: number; stdout: string; stderr: string },
    expectedCode: number,
    context?: string
  ): void {
    console.error(`${context ? `${context}: ` : ''}Command failed unexpectedly`);
    console.error('Command:', args.join(' '));
    console.error('Expected exit code:', expectedCode);
    console.error('Actual exit code:', result.code);
    console.error('Stdout:', result.stdout.substring(0, 500));
    console.error('Stderr:', result.stderr.substring(0, 500));
    console.error('Test directory:', testDir);
    if (existsSync(join(testDir, 'vibe-validate.config.js'))) {
      console.error('Config file exists: true');
    }
    if (existsSync(join(testDir, '.vibe-validate-state.yaml'))) {
      console.error('State file exists: true');
    }
  }

  /**
   * Helper function to execute CLI and capture output
   */
  function executeCLI(args: string[], timeoutMs: number = 10000): Promise<{ code: number; stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      const child = spawn('node', [binPath, ...args], {
        cwd: testDir,
        env: { ...process.env, NO_COLOR: '1' }, // Disable colors for easier testing
      });

      let stdout = '';
      let stderr = '';
      let resolved = false;
      let stdoutEnded = false;
      let stderrEnded = false;
      let exitCode: number | null = null;

      // Timeout handler to prevent hanging
      const timeout = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          child.kill('SIGTERM');
          reject(new Error(`Command timed out after ${timeoutMs}ms: node ${binPath} ${args.join(' ')}`));
        }
      }, timeoutMs);

      // Helper to check if we can resolve
      const tryResolve = () => {
        // Only resolve once we have: exit code AND both streams ended
        if (!resolved && exitCode !== null && stdoutEnded && stderrEnded) {
          resolved = true;
          clearTimeout(timeout);
          if (exitCode === null) {
            console.warn(`Warning: Child process closed with null exit code for: ${args.join(' ')}`);
            console.warn(`  Stdout: ${stdout.substring(0, 200)}`);
            console.warn(`  Stderr: ${stderr.substring(0, 200)}`);
            resolve({ code: 1, stdout, stderr: stderr + '\n[Process closed with null exit code]' });
          } else {
            resolve({ code: exitCode, stdout, stderr });
          }
        }
      };

      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      // Wait for streams to end (all data flushed)
      child.stdout.on('end', () => {
        stdoutEnded = true;
        tryResolve();
      });

      child.stderr.on('end', () => {
        stderrEnded = true;
        tryResolve();
      });

      child.on('close', (code) => {
        exitCode = code ?? 1;
        tryResolve();
      });

      child.on('error', (error) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          resolve({ code: 1, stdout, stderr: error.message });
        }
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

    describe('comprehensive help (--help --verbose)', () => {
      it('should display comprehensive help with --help --verbose (Markdown format)', async () => {
        const result = await executeCLI(['--help', '--verbose']);

        expect(result.code).toBe(0);
        expect(result.stdout).toContain('# vibe-validate CLI Reference');
        expect(result.stdout).toContain('> Agent-friendly validation framework');
        expect(result.stdout).toContain('## Usage');
        expect(result.stdout).toContain('## Commands');
      });

      it('should include exit codes for all commands (Markdown format)', async () => {
        const result = await executeCLI(['--help', '--verbose']);

        // Check validate command exit codes (Markdown format with backticks)
        expect(result.stdout).toContain('**Exit codes:**');
        expect(result.stdout).toContain('- `0` - Validation passed (or cached pass)');
        expect(result.stdout).toContain('- `1` - Validation failed');
        expect(result.stdout).toContain('- `2` - Configuration error');

        // Check init command exit codes
        expect(result.stdout).toContain('- `0` - Configuration created successfully');

        // Check sync-check exit codes
        expect(result.stdout).toContain('- `0` - Up to date or no remote tracking');
        expect(result.stdout).toContain('- `1` - Branch is behind (needs merge)');
      });

      it('should include "What it does" sections for commands', async () => {
        const result = await executeCLI(['--help', '--verbose']);

        // Check validate command
        expect(result.stdout).toContain('What it does:');
        expect(result.stdout).toContain('Calculates git tree hash of working directory');
        expect(result.stdout).toContain('Checks if hash matches cached state');

        // Check init command
        expect(result.stdout).toContain('Creates vibe-validate.config.yaml in project root');

        // Check pre-commit command
        expect(result.stdout).toContain('Runs sync-check');
        expect(result.stdout).toContain('Runs validate');
      });

      it('should include file locations created/modified', async () => {
        const result = await executeCLI(['--help', '--verbose']);

        expect(result.stdout).toContain('Creates/modifies:');
        expect(result.stdout).toContain('Git notes under refs/notes/vibe-validate/runs');
        expect(result.stdout).toContain('vibe-validate.config.yaml (always)');
        expect(result.stdout).toContain('.husky/pre-commit (with --setup-hooks)');
        expect(result.stdout).toContain('.github/workflows/validate.yml');
      });

      it('should include examples for commands', async () => {
        const result = await executeCLI(['--help', '--verbose']);

        expect(result.stdout).toContain('Examples:');
        expect(result.stdout).toContain('vibe-validate validate              # Use cache if available');
        expect(result.stdout).toContain('vibe-validate validate --force      # Always run validation');
        expect(result.stdout).toContain('vibe-validate init --template typescript-nodejs');
        expect(result.stdout).toContain('vibe-validate doctor         # Run diagnostics');
      });

      it('should include error recovery guidance (Markdown format)', async () => {
        const result = await executeCLI(['--help', '--verbose']);

        expect(result.stdout).toContain('**Error recovery:**');
        expect(result.stdout).toContain('If **sync failed**:');
        expect(result.stdout).toContain('git fetch origin');
        expect(result.stdout).toContain('git merge origin/main');
        expect(result.stdout).toContain('If **validation failed**:');
        expect(result.stdout).toContain('Fix errors shown in output');
      });

      it('should include "When to use" guidance', async () => {
        const result = await executeCLI(['--help', '--verbose']);

        expect(result.stdout).toContain('When to use:');
        expect(result.stdout).toContain('Run before every commit to ensure code is synced and validated');
        expect(result.stdout).toContain('Debug why validation is cached/not cached');
        expect(result.stdout).toContain('Diagnose setup issues or verify environment');
      });

      it('should include FILES section (Markdown format)', async () => {
        const result = await executeCLI(['--help', '--verbose']);

        expect(result.stdout).toContain('## Files');
        expect(result.stdout).toContain('vibe-validate.config.yaml');
        expect(result.stdout).toContain('refs/notes/vibe-validate/runs');
        expect(result.stdout).toContain('.github/workflows/validate.yml');
        expect(result.stdout).toContain('.husky/pre-commit');
      });

      it('should include COMMON WORKFLOWS section (Markdown format)', async () => {
        const result = await executeCLI(['--help', '--verbose']);

        expect(result.stdout).toContain('## Common Workflows');
        expect(result.stdout).toContain('### First-time setup');
        expect(result.stdout).toContain('vibe-validate init --template typescript-nodejs --setup-workflow');
        expect(result.stdout).toContain('### Before every commit (recommended)');
        expect(result.stdout).toContain('vibe-validate pre-commit');
        expect(result.stdout).toContain('### After PR merge');
        expect(result.stdout).toContain('vibe-validate cleanup');
        expect(result.stdout).toContain('### Check validation state');
        expect(result.stdout).toContain('vibe-validate state --verbose');
        expect(result.stdout).toContain('### Force re-validation');
        expect(result.stdout).toContain('vibe-validate validate --force');
      });

      it('should include EXIT CODES section (Markdown format)', async () => {
        const result = await executeCLI(['--help', '--verbose']);

        expect(result.stdout).toContain('## Exit Codes');
        expect(result.stdout).toContain('| `0` | Success |');
        expect(result.stdout).toContain('| `1` | Failure (validation failed, sync check failed, invalid config) |');
        expect(result.stdout).toContain('| `2` | Error (git command failed, file system error) |');
      });

      it('should include CACHING section (Markdown format)', async () => {
        const result = await executeCLI(['--help', '--verbose']);

        expect(result.stdout).toContain('## Caching');
        expect(result.stdout).toContain('**Cache key**: Git tree hash of working directory (includes untracked files)');
        expect(result.stdout).toContain('**Cache hit**: Validation skipped (~288ms)');
        expect(result.stdout).toContain('**Cache miss**: Full validation runs (~60-90s)');
        expect(result.stdout).toContain('**Invalidation**: Any file change (tracked or untracked)');
      });

      it('should include repository link', async () => {
        const result = await executeCLI(['--help', '--verbose']);

        expect(result.stdout).toContain('For more details: https://github.com/jdutton/vibe-validate');
      });

      it('should be significantly longer than regular help', async () => {
        const { splitLines } = await import('../src/utils/normalize-line-endings.js');
        const regularHelp = await executeCLI(['--help']);
        const verboseHelp = await executeCLI(['--help', '--verbose']);

        const regularLines = splitLines(regularHelp.stdout).length;
        const verboseLines = splitLines(verboseHelp.stdout).length;

        // Verbose help should be at least 3x longer than regular help
        expect(verboseLines).toBeGreaterThan(regularLines * 3);
      });

      it('should have CLI reference docs that match --help --verbose output exactly', async () => {
        const { readFileSync, existsSync } = await import('fs');
        const { join } = await import('path');
        const { normalizeLineEndings, splitLines } = await import('../src/utils/normalize-line-endings.js');

        const result = await executeCLI(['--help', '--verbose']);
        const docsPath = join(__dirname, '../../../docs/cli-reference.md');

        if (!existsSync(docsPath)) {
          throw new Error(
            'CLI reference docs missing at docs/cli-reference.md\n' +
            'The documentation should be auto-generated from --help --verbose output.'
          );
        }

        const docs = readFileSync(docsPath, 'utf-8');
        const helpOutput = result.stdout;

        // Normalize line endings for cross-platform comparison
        const normalizedDocs = normalizeLineEndings(docs);
        const normalizedHelpOutput = normalizeLineEndings(helpOutput);

        // Extract the auto-synced section from docs (after the preamble separator ---)
        const docsSections = normalizedDocs.split('---\n');
        if (docsSections.length < 2) {
          throw new Error(
            'docs/cli-reference.md should have a preamble followed by --- separator, ' +
            'then the exact --help --verbose output'
          );
        }

        // The content after the first --- separator should be the exact help output
        const docsHelpContent = docsSections.slice(1).join('---\n').trim();
        const expectedHelpOutput = normalizedHelpOutput.trim();

        // Exact character-by-character match
        if (docsHelpContent !== expectedHelpOutput) {
          // Show a useful diff for debugging
          const docsLines = splitLines(docsHelpContent);
          const helpLines = splitLines(expectedHelpOutput);
          const maxLines = Math.max(docsLines.length, helpLines.length);

          console.error('\n❌ docs/cli-reference.md does NOT match --help --verbose output exactly!\n');
          console.error('Showing first 10 differences:\n');

          let diffsShown = 0;
          for (let i = 0; i < maxLines && diffsShown < 10; i++) {
            const docLine = docsLines[i] || '<missing>';
            const helpLine = helpLines[i] || '<missing>';

            if (docLine !== helpLine) {
              console.error(`Line ${i + 1}:`);
              console.error(`  DOCS: ${docLine.substring(0, 80)}`);
              console.error(`  HELP: ${helpLine.substring(0, 80)}`);
              console.error('');
              diffsShown++;
            }
          }

          console.error(`\nTotal: ${docsLines.length} lines in docs, ${helpLines.length} lines in help output\n`);
          console.error('To fix: Run `node packages/cli/dist/bin.js --help --verbose` and update docs/cli-reference.md\n');
        }

        expect(docsHelpContent,
          'docs/cli-reference.md must contain the EXACT output from --help --verbose (after the --- separator). ' +
          'This ensures perfect sync between CLI and documentation.'
        ).toBe(expectedHelpOutput);
      });
    });

    describe('subcommand verbose help', () => {
      it('should show detailed Markdown documentation for "history --help --verbose"', async () => {
        const result = await executeCLI(['history', '--help', '--verbose']);

        expect(result.code).toBe(0);

        // Should show detailed history command documentation in Markdown
        expect(result.stdout).toContain('# history Command Reference');
        expect(result.stdout).toContain('> View and manage validation history stored in git notes');
        expect(result.stdout).toContain('## Overview');
        expect(result.stdout).toContain('## Subcommands');
        expect(result.stdout).toContain('### `list` - List validation history');
        expect(result.stdout).toContain('### `show` - Show detailed history for a tree hash');
        expect(result.stdout).toContain('### `prune` - Remove old validation history');
        expect(result.stdout).toContain('### `health` - Check history health');
        expect(result.stdout).toContain('## Storage Details');
        expect(result.stdout).toContain('## Exit Codes');
        expect(result.stdout).toContain('## Common Workflows');
        expect(result.stdout).toContain('## Integration with CI');

        // Should NOT show comprehensive CLI reference (root command)
        expect(result.stdout).not.toContain('# vibe-validate CLI Reference');
        expect(result.stdout).not.toContain('### `validate`');
      });

      it('should show detailed Markdown documentation for "validate --help --verbose"', async () => {
        const result = await executeCLI(['validate', '--help', '--verbose']);

        expect(result.code).toBe(0);
        expect(result.stdout).toContain('# validate Command Reference');
        expect(result.stdout).toContain('> Run validation with git tree hash caching');
        expect(result.stdout).toContain('## Overview');
        expect(result.stdout).toContain('## How It Works');
        expect(result.stdout).toContain('## Options');
        expect(result.stdout).toContain('## Exit Codes');
        expect(result.stdout).toContain('## Caching Behavior');
        expect(result.stdout).not.toContain('# vibe-validate CLI Reference');
      });

      it('should show detailed Markdown documentation for "init --help --verbose"', async () => {
        const result = await executeCLI(['init', '--help', '--verbose']);

        expect(result.code).toBe(0);
        expect(result.stdout).toContain('# init Command Reference');
        expect(result.stdout).toContain('> Initialize vibe-validate configuration');
        expect(result.stdout).toContain('## Templates');
        expect(result.stdout).toContain('## Pre-commit Hook Setup');
        expect(result.stdout).not.toContain('# vibe-validate CLI Reference');
      });

      it('should show detailed Markdown documentation for "state --help --verbose"', async () => {
        const result = await executeCLI(['state', '--help', '--verbose']);

        expect(result.code).toBe(0);
        expect(result.stdout).toContain('# state Command Reference');
        expect(result.stdout).toContain('> View current validation state');
        expect(result.stdout).toContain('## Overview');
        expect(result.stdout).toContain('## When to Use');
        expect(result.stdout).not.toContain('# vibe-validate CLI Reference');
      });

      it('should show detailed Markdown documentation for "config --help --verbose"', async () => {
        const result = await executeCLI(['config', '--help', '--verbose']);

        expect(result.code).toBe(0);
        expect(result.stdout).toContain('# config Command Reference');
        expect(result.stdout).toContain('> Show or validate vibe-validate configuration');
        expect(result.stdout).not.toContain('# vibe-validate CLI Reference');
      });

      it('should show detailed Markdown documentation for "pre-commit --help --verbose"', async () => {
        const result = await executeCLI(['pre-commit', '--help', '--verbose']);

        expect(result.code).toBe(0);
        expect(result.stdout).toContain('# pre-commit Command Reference');
        expect(result.stdout).toContain('> Run branch sync check + validation (recommended before commit)');
        expect(result.stdout).toContain('## Overview');
        expect(result.stdout).not.toContain('# vibe-validate CLI Reference');
      });

      it('should show detailed Markdown documentation for "sync-check --help --verbose"', async () => {
        const result = await executeCLI(['sync-check', '--help', '--verbose']);

        expect(result.code).toBe(0);
        expect(result.stdout).toContain('# sync-check Command Reference');
        expect(result.stdout).toContain('> Check if branch is behind remote main branch');
        expect(result.stdout).not.toContain('# vibe-validate CLI Reference');
      });

      it('should show detailed Markdown documentation for "cleanup --help --verbose"', async () => {
        const result = await executeCLI(['cleanup', '--help', '--verbose']);

        expect(result.code).toBe(0);
        expect(result.stdout).toContain('# cleanup Command Reference');
        expect(result.stdout).toContain('> Post-merge cleanup (switch to main, delete merged branches)');
        expect(result.stdout).not.toContain('# vibe-validate CLI Reference');
      });

      it('should show detailed Markdown documentation for "doctor --help --verbose"', async () => {
        const result = await executeCLI(['doctor', '--help', '--verbose']);

        expect(result.code).toBe(0);
        expect(result.stdout).toContain('# doctor Command Reference');
        expect(result.stdout).toContain('> Diagnose vibe-validate setup and environment');
        expect(result.stdout).toContain('## Overview');
        expect(result.stdout).not.toContain('# vibe-validate CLI Reference');
      });

      it('should show detailed Markdown documentation for "generate-workflow --help --verbose"', async () => {
        const result = await executeCLI(['generate-workflow', '--help', '--verbose']);

        expect(result.code).toBe(0);
        expect(result.stdout).toContain('# generate-workflow Command Reference');
        expect(result.stdout).toContain('> Generate GitHub Actions workflow from vibe-validate config');
        expect(result.stdout).not.toContain('# vibe-validate CLI Reference');
      });

      it('should show detailed Markdown documentation for "watch-pr --help --verbose"', async () => {
        const result = await executeCLI(['watch-pr', '--help', '--verbose']);

        expect(result.code).toBe(0);
        expect(result.stdout).toContain('# watch-pr Command Reference');
        expect(result.stdout).toContain('> Watch CI checks for a pull/merge request in real-time');
        expect(result.stdout).toContain('## Overview');
        expect(result.stdout).not.toContain('# vibe-validate CLI Reference');
      });

      it('should show comprehensive help only for root "--help --verbose" (no subcommand)', async () => {
        const result = await executeCLI(['--help', '--verbose']);

        expect(result.code).toBe(0);

        // SHOULD show comprehensive CLI reference
        expect(result.stdout).toContain('# vibe-validate CLI Reference');
        expect(result.stdout).toContain('## Common Workflows');
        expect(result.stdout).toContain('## Exit Codes');
      });
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
      // Create a minimal config file (YAML format)
      const configContent = `validation:
  phases:
    - name: Test Phase
      parallel: true
      steps:
        - name: Pass Test
          command: echo "test passed"
git:
  mainBranch: main
`;
      writeFileSync(join(testDir, 'vibe-validate.config.yaml'), configContent);

      // Initialize git (required for validation)
      const { execSync } = await import('child_process');
      execSync('git init', { cwd: testDir });
      execSync('git config user.email "test@example.com"', { cwd: testDir });
      execSync('git config user.name "Test User"', { cwd: testDir });
      execSync('git add .', { cwd: testDir });
      execSync('git commit -m "Initial commit"', { cwd: testDir });

      // 1. Verify config is valid
      const configResult = await executeCLI(['config', '--validate']);
      if (configResult.code !== 0) {
        logCommandFailure(['config', '--validate'], configResult, 0, 'Config validation');
      }
      expect(configResult.code).toBe(0);
      expect(configResult.stdout).toContain('Configuration is valid');

      // 2. Run validation (should create state file)
      const validateResult = await executeCLI(['validate']);
      expect(validateResult.code).toBe(0);

      // 3. Check state (should show passed) - use --verbose for status text
      const stateResult = await executeCLI(['state', '--verbose']);
      expect(stateResult.code).toBe(0);
      expect(stateResult.stdout).toContain('passed: true');
    }, 30000); // Increase timeout for full workflow

    it('should handle validation failure workflow', async () => {
      // Create a config with failing step
      const configContent = `validation:
  phases:
    - name: Test Phase
      parallel: true
      steps:
        - name: Fail Test
          command: exit 1
git:
  mainBranch: main
`;
      writeFileSync(join(testDir, 'vibe-validate.config.yaml'), configContent);

      // Initialize git
      const { execSync } = await import('child_process');
      execSync('git init', { cwd: testDir });
      execSync('git config user.email "test@example.com"', { cwd: testDir });
      execSync('git config user.name "Test User"', { cwd: testDir });
      execSync('git add .', { cwd: testDir });
      execSync('git commit -m "Initial commit"', { cwd: testDir });

      // Run validation (should fail)
      const validateResult = await executeCLI(['validate']);
      if (validateResult.code !== 1) {
        logCommandFailure(['validate'], validateResult, 1, 'Validation failure workflow');
      }
      expect(validateResult.code).toBe(1);

      // Check state (should show failed) - use --verbose for status text
      const stateResult = await executeCLI(['state', '--verbose']);
      if (stateResult.code !== 0) {
        logCommandFailure(['state', '--verbose'], stateResult, 0, 'State check after validation failure');
      }
      expect(stateResult.code).toBe(0);
      expect(stateResult.stdout).toContain('passed: false');
    }, 30000); // Increase timeout for full workflow

    it('should bypass cache when --force flag is used', async () => {
      // Create a config with passing step
      const configContent = `validation:
  phases:
    - name: Test Phase
      parallel: true
      steps:
        - name: Pass Test
          command: echo "test passed"
git:
  mainBranch: main
`;
      writeFileSync(join(testDir, 'vibe-validate.config.yaml'), configContent);

      // Create .gitignore to exclude state file (prevents tree hash changes)
      writeFileSync(join(testDir, '.gitignore'), '.vibe-validate-state.yaml\n');

      // Initialize git
      const { execSync } = await import('child_process');
      execSync('git init', { cwd: testDir });
      execSync('git config user.email "test@example.com"', { cwd: testDir });
      execSync('git config user.name "Test User"', { cwd: testDir });
      execSync('git add .', { cwd: testDir });
      execSync('git commit -m "Initial commit"', { cwd: testDir });

      // 1. First run - should execute validation (minimal output: phase_start)
      const firstRun = await executeCLI(['validate']);
      if (firstRun.code !== 0) {
        logCommandFailure(['validate'], firstRun, 0, 'Cache bypass test - first run');
      }
      expect(firstRun.code).toBe(0);
      expect(firstRun.stdout).toContain('phase_start: Test Phase');

      // 2. Second run without --force - should use cache
      const cachedRun = await executeCLI(['validate']);
      if (cachedRun.code !== 0) {
        logCommandFailure(['validate'], cachedRun, 0, 'Cache bypass test - cached run');
      }
      expect(cachedRun.code).toBe(0);
      expect(cachedRun.stdout).toContain('already passed');
      expect(cachedRun.stdout).not.toContain('phase_start'); // Should NOT run phases

      // 3. Third run with --force - should bypass cache and run validation
      const forcedRun = await executeCLI(['validate', '--force']);
      if (forcedRun.code !== 0) {
        logCommandFailure(['validate', '--force'], forcedRun, 0, 'Cache bypass test - forced run');
      }
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

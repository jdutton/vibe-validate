/* eslint-disable sonarjs/slow-regex -- Simple test regex patterns, not user-facing */
import { rmSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { executeGitCommand } from '@vibe-validate/git';
import { mkdirSyncReal, normalizedTmpdir } from '@vibe-validate/utils';
import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from 'vitest';

// In-process command imports (no spawn needed for registration/option tests)
import { configCommand } from '../src/commands/config.js';
import { stateCommand } from '../src/commands/state.js';
import { syncCheckCommand } from '../src/commands/sync-check.js';
import { validateCommand } from '../src/commands/validate.js';

import {
  setupCommanderTest,
  getCommandByName,
  hasOption,
  type CommanderTestEnv,
} from './helpers/commander-test-setup.js';
import { initializeGitRepo } from './helpers/integration-setup-helpers.js';
import { executeCommandWithSeparateStreams } from './helpers/test-command-runner.js';

/**
 * Helper to send SIGINT to a process after a delay
 */
function sendSigintAfterDelay(child: { kill: (_signal: string) => void }, delayMs: number): void {
  setTimeout(() => child.kill('SIGINT'), delayMs);
}

/**
 * Helper to initialize git repo and create initial commit
 */
function setupGitRepo(testDir: string, configContent: string): void {
  writeFileSync(join(testDir, 'vibe-validate.config.yaml'), configContent);
  initializeGitRepo(testDir);
  executeGitCommand(['-C', testDir, 'add', '.'], { suppressStderr: true });
  executeGitCommand(['-C', testDir, 'commit', '-m', 'Initial commit'], { suppressStderr: true });
}

/**
 * Helper to log detailed diagnostics when a CLI command fails unexpectedly
 */
function logCommandFailure(
  testDir: string,
  args: string[],
  result: { code: number; stdout: string; stderr: string },
  expectedCode: number,
  context?: string
): void {
  const prefix = context ? `${context}: ` : '';
  console.error(`${prefix}Command failed unexpectedly`);
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

/** CLI result type for shared spawn results */
type CliResult = { code: number; stdout: string; stderr: string };

/**
 * Helper function to execute CLI and capture output
 * Uses shared test-command-runner helper for cross-platform compatibility
 */
async function executeCLI(
  binPath: string,
  testDir: string,
  args: string[],
  timeoutMs: number = 30000,
  customEnv?: Record<string, string>
): Promise<CliResult> {
  const result = await executeCommandWithSeparateStreams(binPath, args, {
    cwd: testDir,
    timeout: timeoutMs,
    env: { NO_COLOR: '1', ...customEnv },
  });
  return { code: result.exitCode, stdout: result.stdout, stderr: result.stderr };
}

/**
 * Run `<cmd> --help --verbose` in parallel for each subcommand and collect results.
 * Extracted to module scope so the .map arrow stays shallow enough for sonarjs/no-nested-functions.
 */
async function fetchSubcommandHelpResults(
  binPath: string,
  sharedDir: string,
  subcommands: readonly string[],
): Promise<Record<string, CliResult>> {
  const entries = await Promise.all(
    subcommands.map(async (cmd) => [
      cmd,
      await executeCLI(binPath, sharedDir, [cmd, '--help', '--verbose']),
    ] as const),
  );
  return Object.fromEntries(entries);
}

describe('bin.ts - CLI entry point', () => {
  const binPath = join(__dirname, '../dist/bin.js');

  // Shared temp dir for read-only CLI tests (version, help) — created once
  let sharedDir: string;

  beforeAll(() => {
    sharedDir = mkdirSyncReal(
      join(normalizedTmpdir(), `vv-bin-shared-${Date.now()}`),
      { recursive: true },
    );
  });

  afterAll(() => {
    if (existsSync(sharedDir)) {
      try { rmSync(sharedDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });

  // ────────────────────────────────────────────
  // Version display — 2 parallel spawns, 3 tests
  // ────────────────────────────────────────────
  describe('version display', () => {
    let versionResult: CliResult;
    let vFlagResult: CliResult;

    beforeAll(async () => {
      [versionResult, vFlagResult] = await Promise.all([
        executeCLI(binPath, sharedDir, ['--version']),
        executeCLI(binPath, sharedDir, ['-V']),
      ]);
    });

    it('should display version with --version flag', () => {
      expect(versionResult.code).toBe(0);
      expect(versionResult.stdout).toMatch(/\d+\.\d+\.\d+/);
    });

    it('should display version with -V flag', () => {
      expect(vFlagResult.code).toBe(0);
      expect(vFlagResult.stdout).toMatch(/\d+\.\d+\.\d+/);
    });

    it('should not show fallback version warning in production', () => {
      expect(versionResult.stderr).not.toContain('Could not read package.json version');
    });
  });

  // ────────────────────────────────────────────────────────
  // Help display — 3 parallel spawns, 18 tests (basic + comprehensive)
  // ────────────────────────────────────────────────────────
  describe('help display', () => {
    let helpResult: CliResult;
    let helpShortResult: CliResult;
    let verboseResult: CliResult;

    beforeAll(async () => {
      [helpResult, helpShortResult, verboseResult] = await Promise.all([
        executeCLI(binPath, sharedDir, ['--help']),
        executeCLI(binPath, sharedDir, ['-h']),
        executeCLI(binPath, sharedDir, ['--help', '--verbose']),
      ]);
    });

    it('should display help with --help flag', () => {
      expect(helpResult.code).toBe(0);
      expect(helpResult.stdout).toContain('vibe-validate');
      expect(helpResult.stdout).toContain('Agent-friendly validation framework');
    });

    it('should display help with -h flag', () => {
      expect(helpShortResult.code).toBe(0);
      expect(helpShortResult.stdout).toContain('vibe-validate');
    });

    it('should list all available commands in help', () => {
      expect(helpResult.stdout).toContain('validate');
      expect(helpResult.stdout).toContain('init');
      expect(helpResult.stdout).toContain('pre-commit');
      expect(helpResult.stdout).toContain('state');
      expect(helpResult.stdout).toContain('sync-check');
      expect(helpResult.stdout).toContain('cleanup');
      expect(helpResult.stdout).toContain('config');
    });

    describe('comprehensive help (--help --verbose)', () => {
      it('should display comprehensive help with --help --verbose (Markdown format)', () => {
        expect(verboseResult.code).toBe(0);
        expect(verboseResult.stdout).toContain('# vibe-validate CLI Reference');
        expect(verboseResult.stdout).toContain('> Agent-friendly validation framework');
        expect(verboseResult.stdout).toContain('## Usage');
        expect(verboseResult.stdout).toContain('## Commands');
      });

      it('should include exit codes for all commands (Markdown format)', () => {
        expect(verboseResult.stdout).toContain('**Exit codes:**');
        expect(verboseResult.stdout).toContain('- `0` - Validation passed (or cached pass)');
        expect(verboseResult.stdout).toContain('- `1` - Validation failed');
        expect(verboseResult.stdout).toContain('- `2` - Configuration error');
        expect(verboseResult.stdout).toContain('- `0` - Configuration created successfully');
        expect(verboseResult.stdout).toContain('- `0` - Up to date or no remote tracking');
        expect(verboseResult.stdout).toContain('- `1` - Branch is behind (needs merge)');
      });

      it('should include "What it does" sections for commands', () => {
        expect(verboseResult.stdout).toContain('What it does:');
        expect(verboseResult.stdout).toContain('Calculates git tree hash of working directory');
        expect(verboseResult.stdout).toContain('Checks if hash matches cached state');
        expect(verboseResult.stdout).toContain('Creates vibe-validate.config.yaml in project root');
        expect(verboseResult.stdout).toContain('Runs sync-check');
        expect(verboseResult.stdout).toContain('Runs validate');
      });

      it('should include file locations created/modified', () => {
        expect(verboseResult.stdout).toContain('Creates/modifies:');
        expect(verboseResult.stdout).toContain('Git notes under refs/notes/vibe-validate/validate');
        expect(verboseResult.stdout).toContain('vibe-validate.config.yaml (always)');
        expect(verboseResult.stdout).toContain('.husky/pre-commit (with --setup-hooks)');
        expect(verboseResult.stdout).toContain('.github/workflows/validate.yml');
      });

      it('should include examples for commands', () => {
        expect(verboseResult.stdout).toContain('Examples:');
        expect(verboseResult.stdout).toContain('vibe-validate validate              # Use cache if available');
        expect(verboseResult.stdout).toContain('vibe-validate validate --force      # Always run validation');
        expect(verboseResult.stdout).toContain('vibe-validate init --template typescript-nodejs');
        expect(verboseResult.stdout).toContain('vibe-validate doctor         # Run diagnostics');
      });

      it('should include error recovery guidance (Markdown format)', () => {
        expect(verboseResult.stdout).toContain('**Error recovery:**');
        expect(verboseResult.stdout).toContain('If **sync failed**:');
        expect(verboseResult.stdout).toContain('git fetch origin');
        expect(verboseResult.stdout).toContain('git merge origin/main');
        expect(verboseResult.stdout).toContain('If **validation failed**:');
        expect(verboseResult.stdout).toContain('Fix errors shown in output');
      });

      it('should include "When to use" guidance', () => {
        expect(verboseResult.stdout).toContain('When to use:');
        expect(verboseResult.stdout).toContain('Run before every commit to ensure code is synced and validated');
        expect(verboseResult.stdout).toContain('Debug why validation is cached/not cached');
        expect(verboseResult.stdout).toContain('Diagnose setup issues or verify environment');
      });

      it('should include FILES section (Markdown format)', () => {
        expect(verboseResult.stdout).toContain('## Files');
        expect(verboseResult.stdout).toContain('vibe-validate.config.yaml');
        expect(verboseResult.stdout).toContain('refs/notes/vibe-validate/validate');
        expect(verboseResult.stdout).toContain('.github/workflows/validate.yml');
        expect(verboseResult.stdout).toContain('.husky/pre-commit');
      });

      it('should include COMMON WORKFLOWS section (Markdown format)', () => {
        expect(verboseResult.stdout).toContain('## Common Workflows');
        expect(verboseResult.stdout).toContain('### First-time setup');
        expect(verboseResult.stdout).toContain('vibe-validate init --template typescript-nodejs --setup-workflow');
        expect(verboseResult.stdout).toContain('### Before every commit (recommended)');
        expect(verboseResult.stdout).toContain('vibe-validate pre-commit');
        expect(verboseResult.stdout).toContain('### After PR merge');
        expect(verboseResult.stdout).toContain('vibe-validate cleanup');
        expect(verboseResult.stdout).toContain('### Check validation state');
        expect(verboseResult.stdout).toContain('vibe-validate state --verbose');
        expect(verboseResult.stdout).toContain('### Force re-validation');
        expect(verboseResult.stdout).toContain('vibe-validate validate --force');
      });

      it('should include EXIT CODES section (Markdown format)', () => {
        expect(verboseResult.stdout).toContain('## Exit Codes');
        expect(verboseResult.stdout).toContain('| `0` | Success |');
        expect(verboseResult.stdout).toContain('| `1` | Failure (validation failed, sync check failed, invalid config) |');
        expect(verboseResult.stdout).toContain('| `2` | Error (git command failed, file system error) |');
      });

      it('should include CACHING section (Markdown format)', () => {
        expect(verboseResult.stdout).toContain('## Caching');
        expect(verboseResult.stdout).toContain('**Cache key**: Git tree hash of working directory (includes untracked files)');
        expect(verboseResult.stdout).toContain('**Cache hit**: Validation skipped (sub-second)');
        expect(verboseResult.stdout).toContain('**Cache miss**: Full validation runs (~60-90s)');
        expect(verboseResult.stdout).toContain('**Invalidation**: Any file change (tracked or untracked)');
      });

      it('should include repository link', () => {
        expect(verboseResult.stdout).toContain('For more details: https://github.com/jdutton/vibe-validate');
      });

      it('should be significantly longer than regular help', async () => {
        const { splitLines } = await import('../src/utils/normalize-line-endings.js');
        const regularLines = splitLines(helpResult.stdout).length;
        const verboseLines = splitLines(verboseResult.stdout).length;
        expect(verboseLines).toBeGreaterThan(regularLines * 3);
      });

      it('should have CLI reference docs that match --help --verbose output exactly', async () => {
        const { normalizeLineEndings, splitLines } = await import('../src/utils/normalize-line-endings.js');

        const docsPath = join(__dirname, '../../../docs/skills/vibe-validate/cli-reference.md');

        if (!existsSync(docsPath)) {
          throw new Error(
            'CLI reference docs missing at docs/skills/vibe-validate/cli-reference.md\n' +
            'The documentation should be auto-generated from --help --verbose output.'
          );
        }

        const docs = readFileSync(docsPath, 'utf-8');
        const helpOutput = verboseResult.stdout;

        const normalizedDocs = normalizeLineEndings(docs);
        const normalizedHelpOutput = normalizeLineEndings(helpOutput);

        const docsSections = normalizedDocs.split('---\n');
        if (docsSections.length < 2) {
          throw new Error(
            'docs/skills/vibe-validate/cli-reference.md should have a preamble followed by --- separator, ' +
            'then the exact --help --verbose output'
          );
        }

        const docsHelpContent = docsSections.slice(1).join('---\n').trim();
        const expectedHelpOutput = normalizedHelpOutput.trim();

        if (docsHelpContent !== expectedHelpOutput) {
          const docsLines = splitLines(docsHelpContent);
          const helpLines = splitLines(expectedHelpOutput);
          const maxLines = Math.max(docsLines.length, helpLines.length);

          console.error('\nCLI reference docs do NOT match --help --verbose output!\n');
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
          console.error('To fix: Run `node packages/cli/dist/bin.js --help --verbose` and update docs/skills/vibe-validate/cli-reference.md\n');
        }

        expect(docsHelpContent,
          'docs/skills/vibe-validate/cli-reference.md must contain the EXACT output from --help --verbose (after the --- separator). ' +
          'This ensures perfect sync between CLI and documentation.'
        ).toBe(expectedHelpOutput);
      });
    });

    // ────────────────────────────────────────────────────────
    // Subcommand verbose help — 11 parallel spawns, 12 tests
    // ────────────────────────────────────────────────────────
    describe('subcommand verbose help', () => {
      const subcommands = [
        'history', 'validate', 'init', 'state', 'config',
        'pre-commit', 'sync-check', 'cleanup', 'doctor',
        'generate-workflow', 'watch-pr',
      ] as const;

      let results: Record<string, CliResult>;

      beforeAll(async () => {
        results = await fetchSubcommandHelpResults(binPath, sharedDir, subcommands);
      });

      it('should show detailed Markdown documentation for "history --help --verbose"', () => {
        expect(results.history.code).toBe(0);
        expect(results.history.stdout).toContain('# history Command Reference');
        expect(results.history.stdout).toContain('> View and manage validation history stored in git notes');
        expect(results.history.stdout).toContain('## Overview');
        expect(results.history.stdout).toContain('## Subcommands');
        expect(results.history.stdout).toContain('### `list` - List validation history');
        expect(results.history.stdout).toContain('### `show` - Show detailed history for a tree hash');
        expect(results.history.stdout).toContain('### `prune` - Remove old validation history');
        expect(results.history.stdout).toContain('### `health` - Check history health');
        expect(results.history.stdout).toContain('## Storage Details');
        expect(results.history.stdout).toContain('## Exit Codes');
        expect(results.history.stdout).toContain('## Common Workflows');
        expect(results.history.stdout).toContain('## Integration with CI');
        expect(results.history.stdout).not.toContain('# vibe-validate CLI Reference');
        expect(results.history.stdout).not.toContain('### `validate`');
      });

      it('should show detailed Markdown documentation for "validate --help --verbose"', () => {
        expect(results.validate.code).toBe(0);
        expect(results.validate.stdout).toContain('# validate Command Reference');
        expect(results.validate.stdout).toContain('> Run validation with git tree hash caching');
        expect(results.validate.stdout).toContain('## Overview');
        expect(results.validate.stdout).toContain('## How It Works');
        expect(results.validate.stdout).toContain('## Options');
        expect(results.validate.stdout).toContain('## Exit Codes');
        expect(results.validate.stdout).toContain('## Caching Behavior');
        expect(results.validate.stdout).not.toContain('# vibe-validate CLI Reference');
      });

      it('should show detailed Markdown documentation for "init --help --verbose"', () => {
        expect(results.init.code).toBe(0);
        expect(results.init.stdout).toContain('# init Command Reference');
        expect(results.init.stdout).toContain('> Initialize vibe-validate configuration');
        expect(results.init.stdout).toContain('## Templates');
        expect(results.init.stdout).toContain('## Pre-commit Hook Setup');
        expect(results.init.stdout).not.toContain('# vibe-validate CLI Reference');
      });

      it('should show detailed Markdown documentation for "state --help --verbose"', () => {
        expect(results.state.code).toBe(0);
        expect(results.state.stdout).toContain('# state Command Reference');
        expect(results.state.stdout).toContain('> View current validation state');
        expect(results.state.stdout).toContain('## Overview');
        expect(results.state.stdout).toContain('## When to Use');
        expect(results.state.stdout).not.toContain('# vibe-validate CLI Reference');
      });

      it('should show detailed Markdown documentation for "config --help --verbose"', () => {
        expect(results.config.code).toBe(0);
        expect(results.config.stdout).toContain('# config Command Reference');
        expect(results.config.stdout).toContain('> Show or validate vibe-validate configuration');
        expect(results.config.stdout).not.toContain('# vibe-validate CLI Reference');
      });

      it('should show detailed Markdown documentation for "pre-commit --help --verbose"', () => {
        expect(results['pre-commit'].code).toBe(0);
        expect(results['pre-commit'].stdout).toContain('# pre-commit Command Reference');
        expect(results['pre-commit'].stdout).toContain('> Run branch sync check + validation (recommended before commit)');
        expect(results['pre-commit'].stdout).toContain('## Overview');
        expect(results['pre-commit'].stdout).not.toContain('# vibe-validate CLI Reference');
      });

      it('should show detailed Markdown documentation for "sync-check --help --verbose"', () => {
        expect(results['sync-check'].code).toBe(0);
        expect(results['sync-check'].stdout).toContain('# sync-check Command Reference');
        expect(results['sync-check'].stdout).toContain('> Check if branch is behind remote main branch');
        expect(results['sync-check'].stdout).not.toContain('# vibe-validate CLI Reference');
      });

      it('should show detailed Markdown documentation for "cleanup --help --verbose"', () => {
        expect(results.cleanup.code).toBe(0);
        expect(results.cleanup.stdout).toContain('# cleanup Command Reference');
        expect(results.cleanup.stdout).toContain('> Comprehensive branch cleanup with GitHub integration (v0.18.0)');
        expect(results.cleanup.stdout).not.toContain('# vibe-validate CLI Reference');
      });

      it('should show detailed Markdown documentation for "doctor --help --verbose"', () => {
        expect(results.doctor.code).toBe(0);
        expect(results.doctor.stdout).toContain('# doctor Command Reference');
        expect(results.doctor.stdout).toContain('> Diagnose vibe-validate setup and environment');
        expect(results.doctor.stdout).toContain('## Overview');
        expect(results.doctor.stdout).not.toContain('# vibe-validate CLI Reference');
      });

      it('should show detailed Markdown documentation for "generate-workflow --help --verbose"', () => {
        expect(results['generate-workflow'].code).toBe(0);
        expect(results['generate-workflow'].stdout).toContain('# generate-workflow Command Reference');
        expect(results['generate-workflow'].stdout).toContain('> Generate GitHub Actions workflow from vibe-validate config');
        expect(results['generate-workflow'].stdout).not.toContain('# vibe-validate CLI Reference');
      });

      it('should show detailed Markdown documentation for "watch-pr --help --verbose"', () => {
        expect(results['watch-pr'].code).toBe(0);
        expect(results['watch-pr'].stdout).toContain('# watch-pr Command Reference');
        expect(results['watch-pr'].stdout).toContain('> Monitor PR checks with auto-polling, error extraction, and flaky test detection');
        expect(results['watch-pr'].stdout).toContain('## Overview');
        expect(results['watch-pr'].stdout).not.toContain('# vibe-validate CLI Reference');
      });

      it('should show comprehensive help only for root "--help --verbose" (no subcommand)', () => {
        // Uses the shared verboseResult from parent describe
        expect(verboseResult.code).toBe(0);
        expect(verboseResult.stdout).toContain('# vibe-validate CLI Reference');
        expect(verboseResult.stdout).toContain('## Common Workflows');
        expect(verboseResult.stdout).toContain('## Exit Codes');
      });
    });
  });

  // ────────────────────────────────────────────────────────
  // Command registration — in-process, 0 spawns
  // ────────────────────────────────────────────────────────
  describe('command registration', () => {
    let env: CommanderTestEnv;

    beforeEach(() => { env = setupCommanderTest(); });
    afterEach(() => { env.cleanup(); });

    it('should register validate command', () => {
      validateCommand(env.program);
      const cmd = getCommandByName(env.program, 'validate');
      expect(cmd).toBeDefined();
      expect(cmd?.name()).toBe('validate');
    });

    it('should register state command', () => {
      stateCommand(env.program);
      const cmd = getCommandByName(env.program, 'state');
      expect(cmd).toBeDefined();
      expect(cmd?.name()).toBe('state');
    });

    it('should register config command', () => {
      configCommand(env.program);
      const cmd = getCommandByName(env.program, 'config');
      expect(cmd).toBeDefined();
      expect(cmd?.name()).toBe('config');
    });

    it('should register sync-check command', () => {
      syncCheckCommand(env.program);
      const cmd = getCommandByName(env.program, 'sync-check');
      expect(cmd).toBeDefined();
      expect(cmd?.name()).toBe('sync-check');
    });
  });

  // ────────────────────────────────────────────────────────
  // Error handling — in-process, 0 spawns
  // ────────────────────────────────────────────────────────
  describe('error handling', () => {
    let env: CommanderTestEnv;

    beforeEach(() => { env = setupCommanderTest(); });
    afterEach(() => { env.cleanup(); });

    it('should exit with error for unknown command', async () => {
      validateCommand(env.program);
      try {
        await env.program.parseAsync(['unknown-command'], { from: 'user' });
        expect.fail('Should have thrown for unknown command');
      } catch (err: unknown) {
        if (err && typeof err === 'object' && 'exitCode' in err) {
          expect((err as { exitCode: number }).exitCode).toBe(1);
        }
      }
    });

    it('should exit with error for invalid option', async () => {
      validateCommand(env.program);
      try {
        await env.program.parseAsync(['validate', '--invalid-option'], { from: 'user' });
        expect.fail('Should have thrown for invalid option');
      } catch (err: unknown) {
        if (err && typeof err === 'object' && 'exitCode' in err) {
          expect((err as { exitCode: number }).exitCode).toBe(1);
        }
      }
    });
  });

  // ────────────────────────────────────────────────────────
  // Command options — in-process, 0 spawns
  // ────────────────────────────────────────────────────────
  describe('command options', () => {
    let env: CommanderTestEnv;

    beforeEach(() => { env = setupCommanderTest(); });
    afterEach(() => { env.cleanup(); });

    it('should have --force option on validate command', () => {
      validateCommand(env.program);
      expect(hasOption(env.program, 'validate', '-f, --force')).toBe(true);
    });

    it('should have --verbose option on state command', () => {
      stateCommand(env.program);
      expect(hasOption(env.program, 'state', '-v, --verbose')).toBe(true);
    });

    it('should have --validate option on config command', () => {
      configCommand(env.program);
      expect(hasOption(env.program, 'config', '--validate')).toBe(true);
    });
  });

  // ────────────────────────────────────────────────────────
  // End-to-end workflows — real process spawns (genuine integration)
  // ────────────────────────────────────────────────────────
  describe('end-to-end workflows', () => {
    let testDir: string;
    let originalCwd: string;

    beforeEach(() => {
      testDir = mkdirSyncReal(
        join(normalizedTmpdir(), `vv-bin-e2e-${Date.now()}`),
        { recursive: true },
      );
      originalCwd = process.cwd();
    });

    afterEach(() => {
      process.chdir(originalCwd);
      if (existsSync(testDir)) {
        try { rmSync(testDir, { recursive: true, force: true }); } catch { /* ignore */ }
      }
      vi.restoreAllMocks();
    });

    it('should run full config -> state workflow', async () => {
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
      setupGitRepo(testDir, configContent);

      // 1. Verify config is valid
      const configResult = await executeCLI(binPath, testDir, ['config', '--validate']);
      if (configResult.code !== 0) {
        logCommandFailure(testDir, ['config', '--validate'], configResult, 0, 'Config validation');
      }
      expect(configResult.code).toBe(0);
      expect(configResult.stdout).toContain('Configuration is valid');

      // 2. Run validation (should create state file)
      const validateResult = await executeCLI(binPath, testDir, ['validate'], 60000);
      expect(validateResult.code).toBe(0);

      // 3. Check state (should show passed) - use --verbose for status text
      const stateResult = await executeCLI(binPath, testDir, ['state', '--verbose']);
      expect(stateResult.code).toBe(0);
      expect(stateResult.stdout).toContain('passed: true');
    }, 120000);

    it('should handle validation failure workflow', async () => {
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
      setupGitRepo(testDir, configContent);

      const validateResult = await executeCLI(binPath, testDir, ['validate'], 60000);
      if (validateResult.code !== 1) {
        logCommandFailure(testDir, ['validate'], validateResult, 1, 'Validation failure workflow');
      }
      expect(validateResult.code).toBe(1);

      const stateResult = await executeCLI(binPath, testDir, ['state', '--verbose']);
      if (stateResult.code !== 0) {
        logCommandFailure(testDir, ['state', '--verbose'], stateResult, 0, 'State check after validation failure');
      }
      expect(stateResult.code).toBe(0);
      expect(stateResult.stdout).toContain('passed: false');
    }, 120000);

    it('should bypass cache when --force flag is used', async () => {
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
      writeFileSync(join(testDir, '.gitignore'), '.vibe-validate-state.yaml\n');
      setupGitRepo(testDir, configContent);

      // 1. First run - should execute validation
      const firstRun = await executeCLI(binPath, testDir, ['validate'], 60000);
      if (firstRun.code !== 0) {
        logCommandFailure(testDir, ['validate'], firstRun, 0, 'Cache bypass test - first run');
      }
      expect(firstRun.code).toBe(0);
      expect(firstRun.stdout).toContain('phase_start: Test Phase');

      // 2. Second run without --force - should use cache
      const cachedRun = await executeCLI(binPath, testDir, ['validate']);
      if (cachedRun.code !== 0) {
        logCommandFailure(testDir, ['validate'], cachedRun, 0, 'Cache bypass test - cached run');
      }
      expect(cachedRun.code).toBe(0);
      expect(cachedRun.stdout).toContain('passed for this code');
      expect(cachedRun.stdout).not.toContain('phase_start');

      // 3. Third run with --force - should bypass cache
      const forcedRun = await executeCLI(binPath, testDir, ['validate', '--force'], 60000);
      if (forcedRun.code !== 0) {
        logCommandFailure(testDir, ['validate', '--force'], forcedRun, 0, 'Cache bypass test - forced run');
      }
      expect(forcedRun.code).toBe(0);
      expect(forcedRun.stdout).toContain('phase_start: Test Phase');
      expect(forcedRun.stdout).not.toContain('passed for this code');
    }, 180000);

    it('should set VV_FORCE_EXECUTION=1 when validate --force is used', async () => {
      const envCheckFile = join(testDir, 'env-check.txt');
      const configContent = `validation:
  phases:
    - name: Test Phase
      parallel: false
      steps:
        - name: Check Env Var
          command: node -e "require('fs').writeFileSync('${envCheckFile.replaceAll('\\', '\\\\')}', process.env.VV_FORCE_EXECUTION || 'NOT_SET')"
git:
  mainBranch: main
`;
      setupGitRepo(testDir, configContent);

      const forcedRun = await executeCLI(binPath, testDir, ['validate', '--force'], 60000);
      expect(forcedRun.code).toBe(0);

      const envValue = readFileSync(envCheckFile, 'utf-8');
      expect(envValue).toBe('1');
    }, 120000);

    it('should bypass cache when VV_FORCE_EXECUTION=1 env var is set', async () => {
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
      writeFileSync(join(testDir, '.gitignore'), '.vibe-validate-state.yaml\n');
      setupGitRepo(testDir, configContent);

      // 1. First run - should execute validation
      const firstRun = await executeCLI(binPath, testDir, ['validate'], 60000);
      expect(firstRun.code).toBe(0);
      expect(firstRun.stdout).toContain('phase_start: Test Phase');

      // 2. Second run without force - should use cache
      const cachedRun = await executeCLI(binPath, testDir, ['validate'], 60000);
      expect(cachedRun.code).toBe(0);
      expect(cachedRun.stdout).toContain('passed for this code');
      expect(cachedRun.stdout).not.toContain('phase_start');

      // 3. Third run with VV_FORCE_EXECUTION=1 env var - should bypass cache
      const forceRun = await executeCLI(binPath, testDir, ['validate'], 60000, { VV_FORCE_EXECUTION: '1' });
      expect(forceRun.code).toBe(0);
      expect(forceRun.stdout + forceRun.stderr).toContain('phase_start: Test Phase');
      expect(forceRun.stdout + forceRun.stderr).not.toContain('passed for this code');
    }, 180000);

    it('should propagate VV_FORCE_EXECUTION to nested vv run commands in validation', async () => {
      const configContent = `validation:
  phases:
    - name: Test Phase
      parallel: false
      steps:
        - name: Nested VV Run
          command: node ${binPath} run echo "nested command executed"
git:
  mainBranch: main
`;
      setupGitRepo(testDir, configContent);

      // First run - cache the nested vv run command
      const firstRun = await executeCLI(binPath, testDir, ['validate'], 60000);
      expect(firstRun.code).toBe(0);

      // Second run without force - nested command should hit cache
      const cachedRun = await executeCLI(binPath, testDir, ['validate'], 60000);
      expect(cachedRun.code).toBe(0);
      expect(cachedRun.stdout).toContain('passed for this code');

      // Third run with --force - should propagate to nested vv run
      const forcedRun = await executeCLI(binPath, testDir, ['validate', '--force'], 60000);
      expect(forcedRun.code).toBe(0);
      expect(forcedRun.stdout).toContain('phase_start: Test Phase');
    }, 180000);
  });

  // ────────────────────────────────────────────────────────
  // Process lifecycle — real process spawns
  // ────────────────────────────────────────────────────────
  describe('process lifecycle', () => {
    it('should exit cleanly on successful command', async () => {
      const result = await executeCLI(binPath, sharedDir, ['state']);
      expect(result.code).toBe(0);
    });

    it('should exit cleanly on failed command', async () => {
      const result = await executeCLI(binPath, sharedDir, ['config']);
      expect(result.code).toBe(1);
    });

    it('should handle SIGINT gracefully', async () => {
      const result = await executeCommandWithSeparateStreams(binPath, ['state'], {
        cwd: sharedDir,
        timeout: 30000,
        onSpawn: (child) => sendSigintAfterDelay(child, 100),
      });
      expect(typeof result.exitCode).toBe('number');
    });
  });
});

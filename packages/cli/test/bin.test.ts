/* eslint-disable sonarjs/slow-regex -- Simple test regex patterns, not user-facing */
import { rmSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { executeGitCommand } from '@vibe-validate/git';
import { mkdirSyncReal, normalizedTmpdir } from '@vibe-validate/utils';
import type { Command } from 'commander';
import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from 'vitest';

// In-process command imports (no spawn needed for registration/option tests)
import {
  COMMAND_MODULES,
  loadAndRegisterAllCommands,
  loadAndRegisterCommand,
  selectCommandsToLoad,
  type LoadPlan,
} from '../src/command-registry.js';
import { configCommand } from '../src/commands/config.js';
import { stateCommand } from '../src/commands/state.js';
import { syncCheckCommand } from '../src/commands/sync-check.js';
import { validateCommand } from '../src/commands/validate.js';

import {
  setupCommanderTest,
  setupCommanderTestWithCapture,
  getCommandByName,
  hasOption,
  type CommanderTestEnv,
  type CommanderTestEnvWithCapture,
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

function expectContainsAll(text: string, needles: readonly string[]): void {
  for (const needle of needles) expect(text).toContain(needle);
}

/**
 * Run program.parseAsync expecting it to reject, and return the caught value.
 * Fails the calling test if parseAsync resolves cleanly (so a regression
 * where Commander stops throwing on bad input can't pass silently).
 */
async function captureParseError(
  program: Command,
  args: readonly string[],
): Promise<unknown> {
  let caught: unknown;
  let resolved = false;
  try {
    await program.parseAsync([...args], { from: 'user' });
    resolved = true;
  } catch (err) {
    caught = err;
  }
  if (resolved) {
    throw new Error(
      `parseAsync(${JSON.stringify(args)}) should have rejected but resolved cleanly`,
    );
  }
  return caught;
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
      it('should display comprehensive help with --help --verbose (Markdown format) and exit 0', () => {
        expect(verboseResult.code).toBe(0);
      });

      // Section name → substrings that must appear in the verbose-help output.
      // Inlined as a flat Record (one entry per line) so SonarCloud's CPD can't
      // sliding-match repeated `{ name:, needles: [...] }` object shapes.
      const sections: Record<string, readonly string[]> = {
        'Markdown headers': ['# vibe-validate CLI Reference', '> Agent-friendly validation framework', '## Usage', '## Commands'],
        'exit codes for all commands': ['**Exit codes:**', '- `0` - Validation passed (or cached pass)', '- `1` - Validation failed', '- `2` - Configuration error', '- `0` - Configuration created successfully', '- `0` - Up to date or no remote tracking', '- `1` - Branch is behind (needs merge)'],
        '"What it does" sections': ['What it does:', 'Calculates git tree hash of working directory', 'Checks if hash matches cached state', 'Creates vibe-validate.config.yaml in project root', 'Runs sync-check', 'Runs validate'],
        'file locations created/modified': ['Creates/modifies:', 'Git notes under refs/notes/vibe-validate/validate', 'vibe-validate.config.yaml (always)', '.husky/pre-commit (with --setup-hooks)', '.github/workflows/validate.yml'],
        'examples for commands': ['Examples:', 'vibe-validate validate              # Use cache if available', 'vibe-validate validate --force      # Always run validation', 'vibe-validate init --template typescript-nodejs', 'vibe-validate doctor         # Run diagnostics'],
        'error recovery guidance': ['**Error recovery:**', 'If **sync failed**:', 'git fetch origin', 'git merge origin/main', 'If **validation failed**:', 'Fix errors shown in output'],
        '"When to use" guidance': ['When to use:', 'Run before every commit to ensure code is synced and validated', 'Debug why validation is cached/not cached', 'Diagnose setup issues or verify environment'],
        'FILES section': ['## Files', 'vibe-validate.config.yaml', 'refs/notes/vibe-validate/validate', '.github/workflows/validate.yml', '.husky/pre-commit'],
        'COMMON WORKFLOWS section': ['## Common Workflows', '### First-time setup', 'vibe-validate init --template typescript-nodejs --setup-workflow', '### Before every commit (recommended)', 'vibe-validate pre-commit', '### After PR merge', 'vibe-validate cleanup', '### Check validation state', 'vibe-validate state --verbose', '### Force re-validation', 'vibe-validate validate --force'],
        'EXIT CODES section': ['## Exit Codes', '| `0` | Success |', '| `1` | Failure (validation failed, sync check failed, invalid config) |', '| `2` | Error (git command failed, file system error) |'],
        'CACHING section': ['## Caching', '**Cache key**: Git tree hash of working directory (includes untracked files)', '**Cache hit**: Validation skipped (sub-second)', '**Cache miss**: Full validation runs (~60-90s)', '**Invalidation**: Any file change (tracked or untracked)'],
        'repository link': ['For more details: https://github.com/jdutton/vibe-validate'],
      };

      it.each(Object.entries(sections))('should include %s', (_name, needles) => {
        expectContainsAll(verboseResult.stdout, needles);
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

      // Each entry verifies: exit 0, the per-command header appears, every
      // "contains" needle is present, and the root CLI-reference marker is
      // absent (so we know we're getting per-command docs, not the root help).
      // Tuple shape `[header, contains[]]` with one entry per line so adjacent
      // entries don't share an object-literal structure that CPD can slide-match.
      type SubHelpRow = readonly [header: string, contains: readonly string[]];
      const subcommandHelpCases: Record<typeof subcommands[number], SubHelpRow> = {
        'history': ['# history Command Reference', ['> View and manage validation history stored in git notes', '## Overview', '## Subcommands', '### `list` - List validation history', '### `show` - Show detailed history for a tree hash', '### `prune` - Remove old validation history', '### `health` - Check history health', '## Storage Details', '## Exit Codes', '## Common Workflows', '## Integration with CI']],
        'validate': ['# validate Command Reference', ['> Run validation with git tree hash caching', '## Overview', '## How It Works', '## Options', '## Exit Codes', '## Caching Behavior']],
        'init': ['# init Command Reference', ['> Initialize vibe-validate configuration', '## Templates', '## Pre-commit Hook Setup']],
        'state': ['# state Command Reference', ['> View current validation state', '## Overview', '## When to Use']],
        'config': ['# config Command Reference', ['> Show or validate vibe-validate configuration']],
        'pre-commit': ['# pre-commit Command Reference', ['> Run branch sync check + validation (recommended before commit)', '## Overview']],
        'sync-check': ['# sync-check Command Reference', ['> Check if branch is behind remote main branch']],
        'cleanup': ['# cleanup Command Reference', ['> Comprehensive branch cleanup with GitHub integration (v0.18.0)']],
        'doctor': ['# doctor Command Reference', ['> Diagnose vibe-validate setup and environment', '## Overview']],
        'generate-workflow': ['# generate-workflow Command Reference', ['> Generate GitHub Actions workflow from vibe-validate config']],
        'watch-pr': ['# watch-pr Command Reference', ['> Monitor PR checks with auto-polling, error extraction, and flaky test detection', '## Overview']],
      };

      const ROOT_CLI_REFERENCE_MARKER = '# vibe-validate CLI Reference';

      it.each(Object.entries(subcommandHelpCases) as Array<[typeof subcommands[number], SubHelpRow]>)(
        'should show detailed Markdown docs for "%s --help --verbose"',
        (cmd, [header, contains]) => {
          const r = results[cmd];
          expect(r.code).toBe(0);
          expect(r.stdout).toContain(header);
          expectContainsAll(r.stdout, contains);
          expect(r.stdout).not.toContain(ROOT_CLI_REFERENCE_MARKER);
        },
      );

      // history's docs additionally must NOT enumerate other top-level commands
      // (was: notContains: ['### `validate`'] on the history table entry — split
      // out so the main table can stay uniform).
      it('history --help --verbose should not enumerate other top-level commands', () => {
        expect(results.history.stdout).not.toContain('### `validate`');
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
  // Lazy-load registry guard — in-process, 0 spawns
  // ────────────────────────────────────────────────────────
  // Because command modules are imported dynamically by string key, a rename
  // like stateCommand → stateCmd (or a typo in the registry value) compiles
  // cleanly but crashes at runtime the first time someone runs `vv state`.
  // These tests run the real loader against every entry so any registry/export
  // drift fails here instead.
  describe('COMMAND_MODULES registry', () => {
    const entries = Object.entries(COMMAND_MODULES);
    let env: CommanderTestEnv;

    beforeEach(() => { env = setupCommanderTest(); });
    afterEach(() => { env.cleanup(); });

    it('should not be empty', () => {
      expect(entries.length).toBeGreaterThan(0);
    });

    it.each(entries)(
      'loadAndRegisterCommand("%s") should register a command on the program',
      async (name, _entry) => {
        await loadAndRegisterCommand(name, env.program);
        const registered = env.program.commands.find((c) => c.name() === name);
        expect(registered).toBeDefined();
      },
    );

    // Some register functions legitimately add more than one top-level
    // command (e.g. cleanupCommand registers both `cleanup` and `cleanup-temp`).
    // Enumerate them here so the count assertion stays strict and any future
    // unintended extra registration fails this test loudly.
    const EXTRAS_FROM_GROUPED_REGISTRATIONS = ['cleanup-temp'];

    it('loadAndRegisterAllCommands should register every entry plus known extras', async () => {
      await loadAndRegisterAllCommands(env.program);
      for (const [name] of entries) {
        expect(env.program.commands.find((c) => c.name() === name)).toBeDefined();
      }
      for (const extra of EXTRAS_FROM_GROUPED_REGISTRATIONS) {
        expect(env.program.commands.find((c) => c.name() === extra)).toBeDefined();
      }
      expect(env.program.commands.length).toBe(
        entries.length + EXTRAS_FROM_GROUPED_REGISTRATIONS.length,
      );
    });

    it('loadAndRegisterCommand should throw a helpful error for an unknown name', async () => {
      await expect(
        loadAndRegisterCommand('definitely-not-a-real-command', env.program),
      ).rejects.toThrow(/not a registered command/);
    });

    it('loadAndRegisterCommand should throw TypeError when entry.fn names a non-function export', async () => {
      // Inject a registry entry whose module exists but whose named export does
      // not, so the loader has to take the `typeof fn !== 'function'` branch.
      // Cleaned up in a finally block to avoid leaking state to other tests.
      const bogusKey = '__test_bad_fn_export__';
      COMMAND_MODULES[bogusKey] = {
        path: './commands/validate.js',
        fn: 'thisExportDoesNotExist',
      };
      try {
        await expect(
          loadAndRegisterCommand(bogusKey, env.program),
        ).rejects.toThrow(TypeError);
      } finally {
        delete COMMAND_MODULES[bogusKey];
      }
    });
  });

  // ────────────────────────────────────────────────────────
  // Dispatch decision — pure function, in-process, 0 spawns
  // ────────────────────────────────────────────────────────
  // selectCommandsToLoad is what bin.ts uses to decide whether to load no
  // command modules (just printing --version), all of them (--help or unknown
  // input), or one (a recognized command name). Testing the function directly
  // covers code that otherwise only runs when bin.js is the entry point and
  // therefore wouldn't show up in istanbul coverage.
  describe('selectCommandsToLoad', () => {
    const cases: ReadonlyArray<{ name: string; args: readonly string[]; expected: LoadPlan }> = [
      { name: '--version alone',          args: ['--version'],            expected: { kind: 'none' } },
      { name: '-V alone',                 args: ['-V'],                   expected: { kind: 'none' } },
      { name: '--version with extra arg', args: ['--version', 'foo'],     expected: { kind: 'none' } },
      { name: '--help alone',             args: ['--help'],               expected: { kind: 'all' } },
      { name: '-h alone',                 args: ['-h'],                   expected: { kind: 'all' } },
      { name: 'known command alone',      args: ['validate'],             expected: { kind: 'one', name: 'validate' } },
      { name: 'known command + flag',     args: ['validate', '--force'],  expected: { kind: 'one', name: 'validate' } },
      { name: 'multi-word command name',  args: ['watch-pr', '123'],      expected: { kind: 'one', name: 'watch-pr' } },
      { name: 'unknown command alone',    args: ['unknown-thing'],        expected: { kind: 'all' } },
      { name: 'no command, only flags',   args: ['--verbose'],            expected: { kind: 'all' } },
      { name: 'empty args',               args: [],                       expected: { kind: 'all' } },
      // Precedence
      { name: 'version beats help',       args: ['--version', '--help'],  expected: { kind: 'none' } },
      { name: 'help beats command',       args: ['validate', '--help'],   expected: { kind: 'all' } },
      { name: 'version beats command',    args: ['validate', '--version'],expected: { kind: 'none' } },
    ];

    it.each(cases)('$name → $expected.kind', ({ args, expected }) => {
      expect(selectCommandsToLoad(args)).toEqual(expected);
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
  // Each case asserts three orthogonal things on the failure:
  //   1. The thrown value is an Error instance (catches non-Error throws
  //      like strings, plain objects, or `throw 42`).
  //   2. It carries exitCode === 1 (the user-mistake → exit 1 contract).
  //   3. Stderr received the human-readable message users rely on.
  describe('error handling', () => {
    let env: CommanderTestEnvWithCapture;

    beforeEach(() => { env = setupCommanderTestWithCapture(); });
    afterEach(() => { env.cleanup(); });

    it('unknown command: throws Error with exitCode 1 and writes "unknown command" to stderr', async () => {
      validateCommand(env.program);
      const caught = await captureParseError(env.program, ['unknown-command']);

      expect(caught).toBeInstanceOf(Error);
      expect(caught).toMatchObject({ exitCode: 1 });
      expect(env.capturedStderr.join('')).toContain('unknown command');
    });

    it('unknown option: throws Error with exitCode 1 and writes "unknown option" to stderr', async () => {
      validateCommand(env.program);
      const caught = await captureParseError(env.program, ['validate', '--invalid-option']);

      expect(caught).toBeInstanceOf(Error);
      expect(caught).toMatchObject({ exitCode: 1 });
      expect(env.capturedStderr.join('')).toContain('unknown option');
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

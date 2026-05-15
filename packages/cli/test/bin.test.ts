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

function expectNotContainsAny(text: string, needles: readonly string[]): void {
  for (const needle of needles) expect(text).not.toContain(needle);
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

      // Driven by a table so the assertion shape isn't duplicated across many it() blocks
      // (SonarCloud/jscpd flagged the previous one-it-per-section layout as duplication).
      const sections: ReadonlyArray<{ name: string; needles: readonly string[] }> = [
        {
          name: 'Markdown headers',
          needles: [
            '# vibe-validate CLI Reference',
            '> Agent-friendly validation framework',
            '## Usage',
            '## Commands',
          ],
        },
        {
          name: 'exit codes for all commands',
          needles: [
            '**Exit codes:**',
            '- `0` - Validation passed (or cached pass)',
            '- `1` - Validation failed',
            '- `2` - Configuration error',
            '- `0` - Configuration created successfully',
            '- `0` - Up to date or no remote tracking',
            '- `1` - Branch is behind (needs merge)',
          ],
        },
        {
          name: '"What it does" sections',
          needles: [
            'What it does:',
            'Calculates git tree hash of working directory',
            'Checks if hash matches cached state',
            'Creates vibe-validate.config.yaml in project root',
            'Runs sync-check',
            'Runs validate',
          ],
        },
        {
          name: 'file locations created/modified',
          needles: [
            'Creates/modifies:',
            'Git notes under refs/notes/vibe-validate/validate',
            'vibe-validate.config.yaml (always)',
            '.husky/pre-commit (with --setup-hooks)',
            '.github/workflows/validate.yml',
          ],
        },
        {
          name: 'examples for commands',
          needles: [
            'Examples:',
            'vibe-validate validate              # Use cache if available',
            'vibe-validate validate --force      # Always run validation',
            'vibe-validate init --template typescript-nodejs',
            'vibe-validate doctor         # Run diagnostics',
          ],
        },
        {
          name: 'error recovery guidance',
          needles: [
            '**Error recovery:**',
            'If **sync failed**:',
            'git fetch origin',
            'git merge origin/main',
            'If **validation failed**:',
            'Fix errors shown in output',
          ],
        },
        {
          name: '"When to use" guidance',
          needles: [
            'When to use:',
            'Run before every commit to ensure code is synced and validated',
            'Debug why validation is cached/not cached',
            'Diagnose setup issues or verify environment',
          ],
        },
        {
          name: 'FILES section',
          needles: [
            '## Files',
            'vibe-validate.config.yaml',
            'refs/notes/vibe-validate/validate',
            '.github/workflows/validate.yml',
            '.husky/pre-commit',
          ],
        },
        {
          name: 'COMMON WORKFLOWS section',
          needles: [
            '## Common Workflows',
            '### First-time setup',
            'vibe-validate init --template typescript-nodejs --setup-workflow',
            '### Before every commit (recommended)',
            'vibe-validate pre-commit',
            '### After PR merge',
            'vibe-validate cleanup',
            '### Check validation state',
            'vibe-validate state --verbose',
            '### Force re-validation',
            'vibe-validate validate --force',
          ],
        },
        {
          name: 'EXIT CODES section',
          needles: [
            '## Exit Codes',
            '| `0` | Success |',
            '| `1` | Failure (validation failed, sync check failed, invalid config) |',
            '| `2` | Error (git command failed, file system error) |',
          ],
        },
        {
          name: 'CACHING section',
          needles: [
            '## Caching',
            '**Cache key**: Git tree hash of working directory (includes untracked files)',
            '**Cache hit**: Validation skipped (sub-second)',
            '**Cache miss**: Full validation runs (~60-90s)',
            '**Invalidation**: Any file change (tracked or untracked)',
          ],
        },
        {
          name: 'repository link',
          needles: ['For more details: https://github.com/jdutton/vibe-validate'],
        },
      ];

      it.each(sections)('should include $name', ({ needles }) => {
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

      // Per-subcommand verbose-help assertions, driven by a table so the same
      // shape isn't repeated across 11 it() blocks (SonarCloud/jscpd flagged
      // this previously). Every subcommand verifies: exit 0, the header is
      // present, all expected "contains" needles appear, and the root CLI
      // reference markers do NOT appear (so we know we're getting per-command
      // docs, not the comprehensive root help).
      const subcommandHelpCases: ReadonlyArray<{
        cmd: typeof subcommands[number];
        header: string;
        contains: readonly string[];
        notContains?: readonly string[];
      }> = [
        {
          cmd: 'history',
          header: '# history Command Reference',
          contains: [
            '> View and manage validation history stored in git notes',
            '## Overview',
            '## Subcommands',
            '### `list` - List validation history',
            '### `show` - Show detailed history for a tree hash',
            '### `prune` - Remove old validation history',
            '### `health` - Check history health',
            '## Storage Details',
            '## Exit Codes',
            '## Common Workflows',
            '## Integration with CI',
          ],
          notContains: ['### `validate`'],
        },
        {
          cmd: 'validate',
          header: '# validate Command Reference',
          contains: [
            '> Run validation with git tree hash caching',
            '## Overview',
            '## How It Works',
            '## Options',
            '## Exit Codes',
            '## Caching Behavior',
          ],
        },
        {
          cmd: 'init',
          header: '# init Command Reference',
          contains: [
            '> Initialize vibe-validate configuration',
            '## Templates',
            '## Pre-commit Hook Setup',
          ],
        },
        {
          cmd: 'state',
          header: '# state Command Reference',
          contains: [
            '> View current validation state',
            '## Overview',
            '## When to Use',
          ],
        },
        {
          cmd: 'config',
          header: '# config Command Reference',
          contains: ['> Show or validate vibe-validate configuration'],
        },
        {
          cmd: 'pre-commit',
          header: '# pre-commit Command Reference',
          contains: [
            '> Run branch sync check + validation (recommended before commit)',
            '## Overview',
          ],
        },
        {
          cmd: 'sync-check',
          header: '# sync-check Command Reference',
          contains: ['> Check if branch is behind remote main branch'],
        },
        {
          cmd: 'cleanup',
          header: '# cleanup Command Reference',
          contains: ['> Comprehensive branch cleanup with GitHub integration (v0.18.0)'],
        },
        {
          cmd: 'doctor',
          header: '# doctor Command Reference',
          contains: [
            '> Diagnose vibe-validate setup and environment',
            '## Overview',
          ],
        },
        {
          cmd: 'generate-workflow',
          header: '# generate-workflow Command Reference',
          contains: ['> Generate GitHub Actions workflow from vibe-validate config'],
        },
        {
          cmd: 'watch-pr',
          header: '# watch-pr Command Reference',
          contains: [
            '> Monitor PR checks with auto-polling, error extraction, and flaky test detection',
            '## Overview',
          ],
        },
      ];

      const ROOT_CLI_REFERENCE_MARKER = '# vibe-validate CLI Reference';

      it.each(subcommandHelpCases)(
        'should show detailed Markdown docs for "$cmd --help --verbose"',
        ({ cmd, header, contains, notContains }) => {
          const r = results[cmd];
          expect(r.code).toBe(0);
          expect(r.stdout).toContain(header);
          expectContainsAll(r.stdout, contains);
          expectNotContainsAny(r.stdout, [ROOT_CLI_REFERENCE_MARKER, ...(notContains ?? [])]);
        },
      );

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
  // Replaces the compile-time export-existence check that static imports
  // used to provide. Without this, a rename like stateCommand → stateCmd
  // (or a typo in the registry value) would pass tsc but crash at runtime
  // the first time someone runs `vv state`. By driving these tests through
  // loadAndRegisterCommand / loadAndRegisterAllCommands, we also cover
  // src/command-registry.ts (so the extraction doesn't worsen patch coverage).
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

    it('loadAndRegisterAllCommands should register every entry', async () => {
      await loadAndRegisterAllCommands(env.program);
      for (const [name] of entries) {
        expect(env.program.commands.find((c) => c.name() === name)).toBeDefined();
      }
      expect(env.program.commands.length).toBeGreaterThanOrEqual(entries.length);
    });

    it('loadAndRegisterCommand should throw a helpful error for an unknown name', async () => {
      await expect(
        loadAndRegisterCommand('definitely-not-a-real-command', env.program),
      ).rejects.toThrow(/not a registered command/);
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
  // Each test asserts THREE orthogonal things on the failure:
  //   1. The thrown value is an Error instance (catches non-Error throws
  //      like strings, plain objects, or `throw 42`).
  //   2. It carries exitCode === 1 (the contract for "user mistake → exit 1").
  //   3. Stderr received the human-readable message users rely on.
  // Each assertion fails loudly and independently — the previous
  // `if ('exitCode' in err) expect(...).toBe(1)` shape could silently pass
  // when Commander threw any other error type.
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

/**
 * End-to-end integration test for nested `vv run` pass-through.
 *
 * Exercises the full chain:
 *   `vv validate` (outer, capturing) → step.command runs `vv run` (inner) →
 *   the inner detects VV_PARENT_CONTEXT.capturing=true and execs the underlying
 *   command with inherited stdio, no YAML wrapping, no extraction, no caching.
 *
 * The outer captures the REAL underlying command output and writes it to its
 * own outputFiles. We assert the captured stdout file contains the marker
 * emitted by the deepest command, NOT the inner's YAML/extraction summary.
 *
 * NOTE on shell quoting (cross-platform): the step command is executed via
 * `spawnCommand` with `shell: true`. To avoid nested shell-quoting traps on
 * cmd.exe (Windows) and POSIX shells alike, the step uses `vv run` with a
 * multi-arg variadic command (no inner quotes required) that invokes a
 * marker script we write to the temp project directory.
 */

import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import {
  initTestRepo,
  configTestUser,
  stageTestFiles,
  commitTestChanges,
} from '@vibe-validate/git';
import { normalizedTmpdir } from '@vibe-validate/utils';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import yaml from 'yaml';

import { executeVibeValidateCommand, getCliPath } from '../helpers/cli-execution-helpers.js';

const MARKER = 'FROM_INNER_CMD_3F4A2B7C';

/**
 * Find an outputFiles.stdout path inside a parsed validate ValidationResult.
 * Walks phases→steps; returns the first non-null match.
 */
function findStdoutFile(parsed: unknown): string | undefined {
  if (!parsed || typeof parsed !== 'object') return undefined;
  const phases = (parsed as { phases?: unknown }).phases;
  if (!Array.isArray(phases)) return undefined;
  for (const phase of phases) {
    const steps = (phase as { steps?: unknown }).steps;
    if (!Array.isArray(steps)) continue;
    for (const step of steps) {
      const stdoutPath = (step as { outputFiles?: { stdout?: string } }).outputFiles?.stdout;
      if (typeof stdoutPath === 'string' && stdoutPath.length > 0) return stdoutPath;
    }
  }
  return undefined;
}

/**
 * Extract the YAML document from validate --yaml output.
 * Output format: human progress on stderr; stdout has `---\n<yaml>\n---\n`.
 */
function parseValidateYaml(stdout: string): unknown {
  const start = stdout.indexOf('---\n');
  if (start === -1) return undefined;
  const rest = stdout.slice(start + 4);
  const end = rest.indexOf('\n---\n');
  const body = end === -1 ? rest : rest.slice(0, end + 1);
  try {
    return yaml.parse(body);
  } catch {
    return undefined;
  }
}

describe('end-to-end: nested vv run pass-through', () => {
  let testDir: string;
  const cliPath = getCliPath('vibe-validate');

  beforeEach(() => {
    testDir = mkdtempSync(join(normalizedTmpdir(), 'vv-nested-e2e-'));

    // Initialize git repo
    initTestRepo(testDir);
    configTestUser(testDir);

    // Marker script: writes the marker to stdout and exits 0.
    // Plain JS file → no shell quoting needed when passed as variadic args.
    const markerScript = String.raw`// auto-generated test fixture
process.stdout.write(${JSON.stringify(MARKER)});
process.stdout.write('\n');
`;
    writeFileSync(join(testDir, 'marker.js'), markerScript);

    // Config: single step that invokes `vv run` with `node marker.js` as
    // variadic args. `vv run` reads VV_PARENT_CONTEXT from the outer and
    // switches to pass-through mode (inherited stdio, no YAML wrapping).
    //
    // Using variadic args (no inner quotes) sidesteps cross-platform shell
    // quoting issues. The step.command is parsed by the host shell once
    // (spawnCommand shell: true), then `vv run` joins remaining argv into
    // the inner commandString itself.
    const config = `validation:
  phases:
    - name: Nested
      parallel: false
      steps:
        - name: inner-vv-run
          command: node ${JSON.stringify(cliPath)} run node marker.js
`;
    writeFileSync(join(testDir, 'vibe-validate.config.yaml'), config);

    // Dummy file so commit produces a stable tree hash.
    writeFileSync(join(testDir, 'README.md'), '# nested-passthrough test\n');

    stageTestFiles(testDir);
    commitTestChanges(testDir, 'init');
  });

  afterEach(() => {
    if (testDir && existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it(
    'outer captures real underlying command output (not inner YAML)',
    async () => {
      // --debug forces outputFiles to be created even for passing steps so we
      // can inspect what the outer captured. We also defensively strip any
      // VV_PARENT_CONTEXT inherited from the test runner (the outer must be
      // the top of the chain).
      const childEnv: Record<string, string> = {};
      for (const [key, value] of Object.entries(process.env)) {
        if (key === 'VV_PARENT_CONTEXT') continue;
        if (value !== undefined) childEnv[key] = value;
      }

      const result = await executeVibeValidateCommand(
        ['validate', '--yaml', '--debug', '--force', '--no-lock'],
        { cwd: testDir, timeout: 60_000, env: childEnv }
      );

      // The outer validate must succeed — inner pass-through forwards the
      // marker script's exit code 0 verbatim.
      expect(result.exitCode).toBe(0);

      // Parse the YAML document from stdout and locate the captured stdout
      // file the outer wrote for the step. The outer pipes the inner's
      // stdio into its own buffers (not back out to its own stdout/stderr),
      // so the marker should NOT appear in result.stdout/stderr — only in
      // the outer's captured outputFiles.
      const parsed = parseValidateYaml(result.stdout);
      expect(parsed).toBeDefined();
      const stdoutFile = findStdoutFile(parsed);
      expect(stdoutFile, 'expected step.outputFiles.stdout in YAML output').toBeDefined();
      expect(existsSync(stdoutFile!)).toBe(true);

      const captured = readFileSync(stdoutFile!, 'utf-8');

      // The captured file must hold the REAL inner command output, NOT the
      // inner `vv run`'s YAML wrapper / extraction summary.
      expect(captured).toContain(MARKER);
      expect(captured).not.toMatch(/^---$/m); // no YAML doc separator
      expect(captured).not.toContain('extraction:');
      expect(captured).not.toContain('exitCode:');
    },
    60_000
  );
});

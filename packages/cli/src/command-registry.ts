/**
 * Lazy-load registry for vibe-validate CLI commands.
 *
 * Maps each command name to the relative module path and the named export
 * function that registers it on a Commander program. `bin.ts` consults this
 * registry to import only the command modules the current invocation needs,
 * which avoids paying the ~10-30 s cost of importing all 14 command modules
 * on every run (especially noticeable on Windows/NTFS).
 *
 * This module has no top-level side effects so tests can import it directly
 * and verify each entry resolves to a real exported function — the
 * compile-time guarantee that static imports used to give us.
 */

import type { Command } from 'commander';

export interface CommandModuleEntry {
  /** Path passed to `await import()` — resolved relative to this module. */
  path: string;
  /** Named export expected on the imported module; must be a (program) => void. */
  fn: string;
}

export const COMMAND_MODULES: Record<string, CommandModuleEntry> = {
  validate:            { path: './commands/validate.js',            fn: 'validateCommand' },
  init:                { path: './commands/init.js',                fn: 'initCommand' },
  'pre-commit':        { path: './commands/pre-commit.js',          fn: 'preCommitCommand' },
  state:               { path: './commands/state.js',               fn: 'stateCommand' },
  snapshot:            { path: './commands/snapshot.js',            fn: 'snapshotCommand' },
  'sync-check':        { path: './commands/sync-check.js',          fn: 'syncCheckCommand' },
  cleanup:             { path: './commands/cleanup.js',             fn: 'cleanupCommand' },
  config:              { path: './commands/config.js',              fn: 'configCommand' },
  'generate-workflow': { path: './commands/generate-workflow.js',   fn: 'generateWorkflowCommand' },
  doctor:              { path: './commands/doctor.js',              fn: 'doctorCommand' },
  'watch-pr':          { path: './commands/watch-pr.js',            fn: 'registerWatchPRCommand' },
  history:             { path: './commands/history.js',             fn: 'historyCommand' },
  run:                 { path: './commands/run.js',                 fn: 'runCommand' },
  'create-extractor':  { path: './commands/create-extractor.js',    fn: 'createExtractorCommand' },
};

export async function loadAndRegisterCommand(name: string, program: Command): Promise<void> {
  const entry = COMMAND_MODULES[name];
  if (!entry) {
    throw new Error(
      `loadAndRegisterCommand: "${name}" is not a registered command. ` +
      `Known commands: ${Object.keys(COMMAND_MODULES).sort((a, b) => a.localeCompare(b)).join(', ')}.`,
    );
  }
  const mod = await import(entry.path);
  const fn = mod[entry.fn];
  if (typeof fn !== 'function') {
    throw new TypeError(
      `loadAndRegisterCommand: registry entry "${name}" points at export "${entry.fn}" ` +
      `in ${entry.path}, but that export is ${typeof fn}, not a function. ` +
      `Likely cause: the export was renamed or the registry's "fn" value has a typo.`,
    );
  }
  (fn as (p: Command) => void)(program);
}

export async function loadAndRegisterAllCommands(program: Command): Promise<void> {
  for (const name of Object.keys(COMMAND_MODULES)) {
    await loadAndRegisterCommand(name, program);
  }
}

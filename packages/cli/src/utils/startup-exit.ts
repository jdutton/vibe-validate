/**
 * Startup Exit
 *
 * How a command reports that it cannot start (no or invalid config, unknown
 * level). One contract for every such exit, so `validate --check` cannot give
 * one of them the code it reserves for "the run failed".
 */

import { outputYamlResult } from './yaml-output.js';

/** A command's exit when it cannot start */
export interface StartupExit {
  /** 1 for a command that runs; 2 for `validate --check`, whose 1 means "the run failed" */
  code: 1 | 2;
  /** Whether stdout carries a YAML error document (`--yaml`) */
  yaml: boolean;
}

/**
 * Exit with the command's startup code; the human message is already on stderr
 *
 * @param exit - The command's startup exit
 * @param error - The error, for the YAML document
 * @param extra - More fields for the YAML document
 */
export async function exitAtStartup(exit: StartupExit, error: string, extra: Record<string, unknown> = {}): Promise<never> {
  if (exit.yaml) {
    await outputYamlResult({ exists: false, error, ...extra });
  }
  process.exit(exit.code);
}

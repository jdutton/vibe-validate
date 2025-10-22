/**
 * Gitignore Setup Check (DEPRECATED)
 *
 * @deprecated Since v0.12.0 - State file (.vibe-validate-state.yaml) is deprecated.
 * Validation history is now stored in git notes instead of a state file.
 * This check always passes and does not modify .gitignore.
 *
 * Use `vibe-validate doctor` to detect and remove deprecated state file entries.
 */

import type {
  SetupCheck,
  CheckResult,
  FixResult,
  PreviewResult,
  FixOptions,
} from '../setup-engine.js';

export class GitignoreSetupCheck implements SetupCheck {
  readonly id = 'gitignore';
  readonly name = 'Gitignore Setup (deprecated)';

  async check(_options?: FixOptions): Promise<CheckResult> {
    // DEPRECATED: State file is no longer used (git notes replaced it in v0.12.0)
    // Always return passed - no .gitignore modifications needed
    return {
      passed: true,
      message: '.gitignore check skipped (state file deprecated in v0.12.0)',
    };
  }

  async preview(_options?: FixOptions): Promise<PreviewResult> {
    // DEPRECATED: No .gitignore modifications needed (state file deprecated)
    return {
      description: 'Gitignore check deprecated (state file no longer used)',
      filesAffected: [],
      changes: [],
    };
  }

  async fix(_options?: FixOptions): Promise<FixResult> {
    // DEPRECATED: No .gitignore modifications needed (state file deprecated)
    return {
      success: true,
      message: 'Gitignore check deprecated (state file no longer used)',
      filesChanged: [],
    };
  }
}

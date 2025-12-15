/**
 * @vibe-validate/utils
 *
 * Common utilities for vibe-validate packages.
 * This is the foundational package with NO dependencies on other vibe-validate packages.
 *
 * @package @vibe-validate/utils
 */

// Safe command execution (security-critical)
export {
  safeExecSync,
  safeExecFromString,
  safeExecResult,
  isToolAvailable,
  getToolVersion,
  hasShellSyntax,
  CommandExecutionError,
  type SafeExecOptions,
  type SafeExecResult
} from './safe-exec.js';

// Cross-platform path helpers (Windows 8.3 short name handling)
export {
  normalizedTmpdir,
  mkdirSyncReal,
  normalizePath
} from './path-helpers.js';

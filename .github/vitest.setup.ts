/**
 * Global Vitest Setup
 *
 * Runs ONCE at test suite startup to ensure clean initial environment.
 * Critical for deterministic tests regardless of invocation context
 * (e.g., `pnpm test` vs `pnpm validate --force`).
 *
 * After this initial cleanup, tests start from a clean slate and can set
 * env vars as needed to test environment variable behavior.
 */

// One-time cleanup: Clear all VV_* environment variables at startup
// This prevents env vars from the parent process (like VV_FORCE_EXECUTION=1
// from `pnpm validate --force`) from polluting test execution.
for (const key of Object.keys(process.env)) {
  if (key.startsWith('VV_')) {
    delete process.env[key];
  }
}

// Also clear other vibe-validate-related env vars that might affect behavior
delete process.env.CLAUDE_CODE;

// FORCE_COLOR is inherited by every child process a test spawns, and Node
// colorizes `console.log` of a non-string when it believes colour is wanted —
// so `node -e 'console.log(123)'` returns "[33m123[39m" instead of
// "123". Any developer running under a colourising wrapper (several AI coding
// harnesses set FORCE_COLOR=3) sees command-output assertions fail for a reason
// that has nothing to do with their change. Same rationale as the VV_* sweep
// above: the suite must not depend on how it was invoked.
delete process.env.FORCE_COLOR;

// Note: CI env var is preserved - it's a legitimate system environment variable
// that tests should respect and handle appropriately.

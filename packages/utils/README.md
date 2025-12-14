# @vibe-validate/utils

Common utilities for vibe-validate packages - the foundational package with NO dependencies on other vibe-validate packages.

## Purpose

`@vibe-validate/utils` provides generic, non-domain-specific utilities used across multiple vibe-validate packages. It serves as the foundation layer that other packages can depend on without creating circular dependencies.

## When to Use

Use `@vibe-validate/utils` for:

- **Security-critical command execution** (`safeExec*`) - When you need to spawn processes safely without shell injection vulnerabilities
- **Cross-platform path normalization** - When working with Windows 8.3 short names that cause path mismatches
- **Generic utilities** - Functionality needed by multiple packages that doesn't belong to a specific domain

## When NOT to Use

DO NOT use `@vibe-validate/utils` for:

- **Domain-specific utilities** - Use the appropriate domain package instead:
  - Git utilities → `@vibe-validate/git`
  - Config utilities → `@vibe-validate/config`
  - Extractor utilities → `@vibe-validate/extractors`
  - Validation utilities → `@vibe-validate/core`

- **Test utilities** - Keep test-specific mocks/helpers in each package's `test/helpers/` directory

## Installation

```bash
# Production dependency
pnpm add @vibe-validate/utils

# Development dependency (for tests)
pnpm add -D @vibe-validate/utils
```

## API Reference

### Safe Command Execution

Secure command execution using `spawnSync` + `which` pattern. Prevents command injection by:
- Resolving PATH once using pure Node.js (`which` package)
- Executing with absolute path and `shell: false` (except Windows-specific cases)
- No shell interpreter = no command injection risk

#### `safeExecSync(command, args?, options?): Buffer | string`

Execute a command synchronously and return output (throws on error).

**Parameters:**
- `command` (string) - Command name (e.g., 'git', 'node', 'pnpm')
- `args` (string[]) - Array of arguments
- `options` (SafeExecOptions) - Execution options

**Returns:** Buffer (default) or string (if `encoding` specified)

**Example:**
```typescript
import { safeExecSync } from '@vibe-validate/utils';

// Get output as Buffer
const versionBuffer = safeExecSync('node', ['--version']);

// Get output as string
const version = safeExecSync('node', ['--version'], { encoding: 'utf8' });

// Custom environment variables
safeExecSync('git', ['add', '--all'], {
  env: { ...process.env, GIT_INDEX_FILE: tempFile }
});
```

#### `safeExecResult(command, args?, options?): SafeExecResult`

Execute a command and return detailed result (doesn't throw on error).

Use this when you need to handle errors programmatically.

**Returns:**
```typescript
{
  status: number;        // Exit code (0 = success)
  stdout: Buffer | string;
  stderr: Buffer | string;
  error?: Error;         // If command failed to spawn
}
```

**Example:**
```typescript
import { safeExecResult } from '@vibe-validate/utils';

const result = safeExecResult('git', ['status']);
if (result.status === 0) {
  console.log(result.stdout.toString());
} else {
  console.error(`Failed: ${result.stderr.toString()}`);
}
```

#### `safeExecFromString(commandString, options?): Buffer | string`

Execute a command from a command string (convenience wrapper).

**WARNING:** This function parses command strings using simple whitespace splitting. It does NOT handle shell quoting, escaping, or complex command syntax. Use only for simple commands.

**Example:**
```typescript
import { safeExecFromString } from '@vibe-validate/utils';

// ✅ Simple command
safeExecFromString('git status --short');

// ❌ Complex shell features won't work
// Use safeExecSync() with explicit args array instead
```

#### `isToolAvailable(toolName): boolean`

Check if a command-line tool is available.

**Example:**
```typescript
import { isToolAvailable } from '@vibe-validate/utils';

if (isToolAvailable('gh')) {
  console.log('GitHub CLI is installed');
}
```

#### `getToolVersion(toolName, versionArg?): string | null`

Get tool version if available.

**Parameters:**
- `toolName` (string) - Tool name (e.g., 'node', 'pnpm')
- `versionArg` (string) - Version argument (default: '--version')

**Returns:** Version string or null if not available

**Example:**
```typescript
import { getToolVersion } from '@vibe-validate/utils';

const nodeVersion = getToolVersion('node');
console.log(nodeVersion); // "v20.11.0"

const gitVersion = getToolVersion('git', 'version');
console.log(gitVersion); // "git version 2.39.2"
```

#### `CommandExecutionError`

Error thrown when command execution fails (extends Error).

**Properties:**
- `status` (number) - Exit code
- `stdout` (Buffer | string) - Standard output
- `stderr` (Buffer | string) - Standard error

### Cross-Platform Path Helpers

Windows-safe path utilities that handle 8.3 short names (e.g., `RUNNER~1`). These prevent "works on Mac, fails on Windows CI" bugs.

#### `normalizedTmpdir(): string`

Get normalized temp directory path.

On Windows, `tmpdir()` may return 8.3 short names like `C:\Users\RUNNER~1\AppData\Local\Temp`. This function returns the real (long) path.

**Why this matters:**
- Node.js operations create directories with LONG names
- Tests using SHORT paths from `tmpdir()` will fail `existsSync()` checks

**Example:**
```typescript
import { normalizedTmpdir } from '@vibe-validate/utils';
import { join } from 'node:path';

// ❌ WRONG - May return short path on Windows
const testDir = join(tmpdir(), 'test-dir');

// ✅ RIGHT - Always returns real path
const testDir = join(normalizedTmpdir(), 'test-dir');
```

#### `mkdirSyncReal(path, options?): string`

Create directory and return normalized path.

Combines `mkdirSync` + `realpathSync` to ensure the returned path matches the actual filesystem path (resolves Windows short names).

**Example:**
```typescript
import { mkdirSyncReal, normalizedTmpdir } from '@vibe-validate/utils';
import { join } from 'node:path';

// ✅ RIGHT - Normalized path guaranteed
const testDir = mkdirSyncReal(
  join(normalizedTmpdir(), 'test-dir'),
  { recursive: true }
);
// testDir is now: C:\Users\runneradmin\...\test-dir (real path)
```

#### `normalizePath(path): string`

Normalize any path (resolve short names on Windows).

Utility to normalize paths without creating directories. Useful when you have an existing path that might contain short names.

**Example:**
```typescript
import { normalizePath } from '@vibe-validate/utils';

const shortPath = 'C:\\PROGRA~1\\nodejs';
const longPath = normalizePath(shortPath);
// Result: 'C:\\Program Files\\nodejs'
```

## Security

### Command Injection Prevention

All `safeExec*` functions prevent command injection by:

1. **No shell interpreter** - Uses `spawnSync` with `shell: false` (except Windows-specific cases)
2. **Arguments as array** - Never string interpolation
3. **PATH resolution via `which`** - Resolved before execution, not during

This is more secure than `execSync()` which uses shell by default.

**Example of safe execution:**
```typescript
import { safeExecSync } from '@vibe-validate/utils';

// Malicious input is treated as literal argument, not executed
const maliciousArg = '; rm -rf / #';
const result = safeExecSync('echo', [maliciousArg], { encoding: 'utf8' });
// Output: "; rm -rf / #" (literal string, not executed)
```

## Development

```bash
# Build
pnpm build

# Test
pnpm test

# Watch mode
pnpm test:watch
```

## License

MIT

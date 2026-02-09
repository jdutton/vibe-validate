# CLI Testing Guide for AI Agents

This guide provides context-specific testing patterns for the vibe-validate CLI package.

## Testing Philosophy

**DRY Enforcement in Tests**
- Tests must follow the same < 3% duplication limit as production code
- Extract duplicated patterns into helper functions at module scope
- Test duplication is NOT acceptable unless it is unavoidable
- Tests are documentation - helpers should have clear, descriptive names
- Each helper should handle a single concern (setup, assertion, execution)

**Test Independence**
- Each test should run in isolation
- Don't share mutable state between tests
- Use beforeEach/afterEach for clean slate

## Project-Specific Patterns

### Commander.js Testing

**Setup Pattern** (see `helpers/commander-test-setup.js`):
```typescript
import { setupCommanderTest } from '../helpers/commander-test-setup.js';

let env: CommanderTestEnv;
beforeEach(() => {
  env = setupCommanderTest();
});
afterEach(() => {
  env.cleanup();
});
```

**Command Execution:**
```typescript
// Register command
validateCommand(env.program);

// Execute
await env.program.parseAsync(['validate', '--yaml'], { from: 'user' });

// Handle expected exits (Commander throws on exitOverride)
try {
  await env.program.parseAsync(['validate'], { from: 'user' });
} catch (err: unknown) {
  if (err && typeof err === 'object' && 'exitCode' in err) {
    expect(err.exitCode).toBe(1);
  }
}
```

### Cross-Platform Testing

**CRITICAL: CLI tests must work on Windows AND Linux**

**File Paths:**
```typescript
// ✅ Good - cross-platform
import { join } from 'node:path';
const path = join('foo', 'bar', 'file.txt');

// ❌ Bad - Unix-only
const path = 'foo/bar/file.txt';
```

**Command Execution in Tests:**
```typescript
// ✅ Good - cross-platform
import { spawn } from 'node:child_process';
spawn('node', ['./dist/bin/vv', 'validate']);

// ❌ Bad - shell-specific
execSync('vv validate');
```

**Temp Directories:**
```typescript
// ✅ Good - use project utility
import { normalizedTmpdir } from '@vibe-validate/utils';
const tmpDir = normalizedTmpdir();

// ❌ Bad - Unix-only
const tmpDir = '/tmp/test';
```

## Available Test Helpers

### CLI Execution Helpers (`helpers/test-command-runner.ts`) **[MANDATORY]**

**CRITICAL: Always use these helpers instead of raw spawn/spawnSync calls**

ESLint will enforce this (`local/no-direct-cli-bin-execution`).

**For executing vv commands:**
```typescript
import { executeWrapperSync, executeWrapperCommand } from '../helpers/test-command-runner.js';

// ✅ Synchronous execution
const result = executeWrapperSync(['validate', '--force'], {
  cwd: testDir,
  env: { VV_TEST_RESULT: 'pass' },
});
expect(result.status).toBe(0);
expect(result.stdout).toContain('PASSED');

// ✅ Async with separate stdout/stderr
const result = await executeWrapperCommand(['watch-pr', '123'], {
  cwd: testDir,
  timeout: 30000,
});
expect(result.exitCode).toBe(0);

// ❌ NEVER do this (ESLint will catch it)
const result = spawnSync('node', [vvBin, 'validate'], { cwd: testDir });
```

**For executing arbitrary commands:**
```typescript
import { executeCommand } from '../helpers/test-command-runner.js';

// ✅ Good - uses safeExecSync internally
const result = executeCommand('npx vitest test.test.ts', {
  cwd: testDir,
  timeout: 30000,
});
```

**Why mandatory:**
- ✅ **Windows compatibility**: Uses spawn pattern that works cross-platform
- ✅ **Security**: Uses safeExecSync (no shell injection)
- ✅ **DRY**: Single source of truth for CLI execution
- ✅ **Consistent**: Same environment handling everywhere

### Validate Command Helpers (`commands/validate-test-helpers.ts`)

**When to Use:**
- ✅ Replacing 48-line mock objects
- ✅ Repetitive console assertions (3+ similar lines)
- ✅ Common command registration checks
- ❌ One-off test-specific setup
- ❌ When inline code is clearer

**Console Assertions:**
```typescript
// ✅ Good - use helper
expectConsoleLog('Validation passed');
expectConsoleError('Configuration invalid');
expectNoConsoleError('Not this message');

// ❌ Avoid - too much abstraction
expectAllConsoleCalls({ logs: [...], errors: [...] });
```

**Mock Factories:**
```typescript
// ✅ Good - complex reusable mocks
const mockNote = createFlakyHistoryNote(); // 48 lines → 1 line

// ❌ Bad - simple inline is clearer
const mockNote = createMockHistoryNote(); // Only saves 5 lines, hides what's being tested
```

**Command Registration:**
```typescript
// ✅ Good - repetitive pattern
expectValidateOption(env, '-f, --force');

// ✅ Also good - need the command object
const cmd = getValidateCommand(env);
expect(cmd.description()).toBe('...');
```

## Common Anti-Patterns

### ❌ Over-Abstraction
```typescript
// ❌ Bad - what does this test?
await runValidateScenario({ cached: true, passed: false, yaml: true });

// ✅ Good - clear test intent
vi.mocked(history.readHistoryNote).mockResolvedValue(
  createMockHistoryNote({ passed: false })
);
await env.program.parseAsync(['validate', '--yaml']);
expect(process.stdout.write).toHaveBeenCalledWith('---\n');
```

### ❌ Shared Mutable State
```typescript
// ❌ Bad - tests can interfere
let sharedMock: any;
beforeEach(() => { sharedMock = {...}; });
it('test 1', () => { sharedMock.foo = 'bar'; });
it('test 2', () => { expect(sharedMock.foo).toBeUndefined(); }); // Flaky!

// ✅ Good - each test gets fresh state
it('test 1', () => {
  const mock = createMock();
  mock.foo = 'bar';
});
```

### ❌ Shell Commands in Tests
```typescript
// ❌ Bad - shell-specific, platform issues
execSync('echo test > file.txt');

// ✅ Good - use Node APIs or spawn
import { writeFileSync } from 'node:fs';
writeFileSync('file.txt', 'test');
```

### ❌ Testing Implementation Details
```typescript
// ❌ Bad - brittle, testing internals
expect(validateCommand.toString()).toContain('runValidation');

// ✅ Good - test behavior
await env.program.parseAsync(['validate']);
expect(core.runValidation).toHaveBeenCalled();
```

## Mock Patterns

### Vitest Mocking Strategy

**Module Mocks (top-level):**
```typescript
vi.mock('@vibe-validate/core', async () => {
  const actual = await vi.importActual<typeof core>('@vibe-validate/core');
  return {
    ...actual,
    runValidation: vi.fn(), // Override specific function
  };
});
```

**Function Mocks (in tests):**
```typescript
beforeEach(() => {
  vi.mocked(core.runValidation).mockResolvedValue({
    passed: true,
    // ... other fields
  });
});
```

**Spy Pattern:**
```typescript
// For functions you want to track AND call
const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
// ... test code ...
expect(spy).toHaveBeenCalledWith('message');
spy.mockRestore(); // Clean up
```

## Test Organization

### File Structure
```
test/
├── CLAUDE.md                          # This file
├── helpers/
│   └── commander-test-setup.ts        # Commander testing utilities
├── commands/
│   ├── validate.test.ts               # Command tests (1,128 lines, 34 tests)
│   ├── validate-test-helpers.ts       # Command-specific helpers
│   ├── doctor.test.ts                 # Other command tests
│   └── ...
```

### Test Structure (Recommended)
```typescript
describe('command name', () => {
  let env: CommanderTestEnv;

  beforeEach(() => {
    env = setupCommanderTest();
    // Reset mocks
    vi.clearAllMocks();
  });

  afterEach(() => {
    env.cleanup();
  });

  describe('feature area', () => {
    it('should do specific behavior', async () => {
      // Arrange - setup mocks and state
      vi.mocked(dependency).mockResolvedValue(expectedValue);

      // Act - execute command
      commandFunction(env.program);
      await env.program.parseAsync(['command'], { from: 'user' });

      // Assert - verify behavior
      expect(result).toBe(expected);
    });
  });
});
```

## Good Test Examples

**Best Examples to Reference:**
1. `validate.test.ts` - Lines 367-405 (command registration tests - simple, clear)
2. `validate.test.ts` - Lines 848-880 (flaky validation - uses helper effectively)
3. `validate.test.ts` - Lines 416-425 (error handling - inline setup is clear)

**Anti-Examples to Avoid:**
1. Don't create generic "runTest" helpers that hide what's being tested
2. Don't share mock objects across describe blocks
3. Don't abstract away the arrange-act-assert pattern

## Adding New Tests

### Checklist
1. ✅ Does it work on Windows AND Linux?
2. ✅ Is the test name descriptive? (`should X when Y`)
3. ✅ Is setup inline OR using documented helpers?
4. ✅ Does it follow arrange-act-assert?
5. ✅ Can you understand it without reading other tests?
6. ✅ Does it clean up after itself?

### When to Create New Helpers

**Create helper if:**
- ✅ Pattern repeats 5+ times
- ✅ Mock object is 30+ lines
- ✅ Pattern is hard to get right (cross-platform, complex setup)

**Don't create helper if:**
- ❌ Only used 2-3 times
- ❌ Simple 1-liner
- ❌ Test-specific logic
- ❌ Would hide test intent

## Cross-Platform Gotchas

### Windows-Specific Issues

**Line Endings:**
- Git normalizes to LF in repo
- Tests run with LF on all platforms
- Don't test for `\r\n` vs `\n`

**Path Separators:**
- Always use `path.join()` or `path.resolve()`
- Never hardcode `/` or `\\`

**Command Execution:**
- Use `spawn('node', [script])` not `exec('node script')`
- Shells differ (cmd.exe vs bash)

**File Permissions:**
- Windows doesn't have Unix execute bit
- Don't test file modes on Windows

## Vitest-Specific Tips

**Parallel Execution:**
```typescript
// Tests run in parallel by default
// Use describe.sequential() for dependent tests (rare)
describe.sequential('integration tests', () => {
  // These run sequentially
});
```

**Timeout for Slow Tests:**
```typescript
it('slow test', async () => {
  // Default: 5000ms
}, 10000); // 10 second timeout
```

**Watch Mode:**
```bash
pnpm test validate.test.ts --watch  # Auto-rerun on changes
```

## References

- **Commander.js Testing:** `helpers/commander-test-setup.ts`
- **Validate Helpers:** `commands/validate-test-helpers.ts`
- **Security Patterns:** `../../packages/utils/src/safe-exec.ts` (never use execSync directly)
- **Cross-Platform Paths:** `../../packages/utils/src/path-utils.ts`

## Key Takeaways

1. **DRY enforcement** - Tests follow < 3% duplication limit, create helpers at module scope
2. **Clear helper names** - Each helper should have a descriptive name and handle a single concern
3. **Cross-platform by default** - Windows is not an afterthought
4. **Test behavior, not implementation** - Mock at boundaries
5. **Each test tells a story** - Should be understandable in isolation with helper names as documentation

When in doubt, look at existing tests in `validate.test.ts` for patterns.

# TODO: Custom ESLint Rules Enhancement

This document outlines potential ESLint rules and enforcement opportunities identified from CLAUDE.md's MUST/NEVER/CRITICAL/MANDATORY requirements.

## Current Status

### ✅ Implemented Rules (v0.17.6)

**Windows Compatibility:**
- `local/no-os-tmpdir` - Enforces `normalizedTmpdir()` instead of `os.tmpdir()`
- `local/no-fs-mkdirSync` - Enforces `mkdirSyncReal()` instead of `fs.mkdirSync()`

**Security and Architecture:**
- `local/no-child-process-execSync` - Enforces `safeExecSync()` instead of `execSync()`
- `local/no-git-commands-direct` - Enforces `@vibe-validate/git` functions instead of direct git commands
- `local/no-gh-commands-direct` - Enforces `@vibe-validate/git` functions instead of direct gh commands

## Proposed Future Enhancements

### Priority 1: High Impact (Next Session)

#### 1. `local/no-hardcoded-command-name` 🎯

**Source:** CLAUDE.md:377 - "CRITICAL: All user-facing command names MUST use `getCommandName()`"

**Problem:**
- Users invoke CLI via `vv` or `vibe-validate`
- Error messages with hardcoded names confuse users
- Example: User runs `vv validate`, sees error "Usage: vibe-validate validate"

**Detection Pattern:**
```typescript
// ❌ BAD - Hardcoded command name
console.error("Usage: vibe-validate watch-pr <pr-number>");
console.log("Run: vv validate");
throw new Error("vibe-validate init failed");

// ✅ GOOD - Uses getCommandName()
const cmd = getCommandName();
console.error(`Usage: ${cmd} watch-pr <pr-number>`);
console.log(`Run: ${cmd} validate`);
```

**Implementation Details:**
- Check string literals in `packages/cli/src/commands/**/*.ts`
- Detect: `"vibe-validate"` or `"vv"` in template literals or strings
- Verify `getCommandName()` is imported from `'../utils/command-name.js'`
- Suggest: Import and use `getCommandName()` for dynamic names

**Exemptions:**
- Verbose help output (`--help --verbose`)
- Package.json `"name"` and `"bin"` fields
- README.md and documentation
- Example repository names in help text

**Impact:** High - Critical for user experience consistency

**Complexity:** Medium - Pattern detection + context awareness

**Auto-fix:** No - Requires manual refactoring (context-dependent)

---

#### 2. `local/require-error-context` ⚠️

**Source:** CLAUDE.md:370-374 - Error handling requirements

**Problem:**
- Generic error messages make debugging difficult
- Example: `throw new Error("Failed")` doesn't explain what failed or why

**Detection Pattern:**
```typescript
// ❌ BAD - No context
throw new Error("Invalid configuration");
throw new Error("Failed");
throw new Error("Not found");

// ✅ GOOD - With context
throw new Error(`Invalid configuration at ${configPath}: ${reason}`);
throw new Error(`Failed to execute ${command}: ${error.message}`);
throw new Error(`Package not found: ${packageName} (searched in ${searchPaths.join(', ')})`);
```

**Implementation Details:**
- Detect `throw new Error(...)` with simple string literals (no interpolation)
- Check if error message includes context variables or interpolation
- Flag errors with single-word messages or no contextual information
- Suggest: Add operation context, file paths, or relevant variables

**Heuristics for "good" context:**
- Error message includes variable interpolation (${...})
- Message is > 40 characters (likely has context)
- Includes common context words: "at", "in", "for", "from", "failed to"

**Impact:** Medium-High - Significantly improves debugging experience

**Complexity:** Medium - String analysis + heuristics

**Auto-fix:** No - Requires understanding what context to add

---

#### 3. Test Coverage CI Enhancement 🧪

**Source:** CLAUDE.md:362 - "Test-Driven Development (TDD) REQUIRED"

**Problem:**
- New features added without corresponding tests
- Coverage drops are only caught after merge

**Implementation Approach:**

**Option A: Git Diff Analysis Script**
```bash
#!/bin/bash
# tools/check-test-coverage-diff.sh

# Get list of new/modified source files (not tests)
NEW_SRC=$(git diff main --name-only | grep 'src/.*\.ts$' | grep -v '\.test\.ts$')

# For each source file, check if corresponding test was modified
for src_file in $NEW_SRC; do
  test_file=$(echo $src_file | sed 's/src/test/' | sed 's/\.ts$/.test.ts/')
  if ! git diff main --name-only | grep -q "$test_file"; then
    echo "⚠️  New/modified source without test: $src_file"
    echo "   Expected test file: $test_file"
  fi
done
```

**Option B: Coverage Diff Tool**
- Use `vitest --coverage` JSON output
- Compare main branch vs PR branch coverage
- Fail if coverage drops > 1%
- Flag new files with < 80% coverage

**Integration Points:**
- Add to `pnpm validate` as new phase
- Add to GitHub Actions PR checks
- Add to pre-commit hook (optional, could be slow)

**Impact:** High - Enforces TDD requirement from CLAUDE.md

**Complexity:** Medium - Requires git integration + coverage parsing

**False Positives:** Medium - Some valid cases (refactoring, moving code)

---

### Priority 2: Medium Impact

#### 4. `local/no-manual-yaml-interfaces` 🛡️

**Source:** CLAUDE.md:353 - "All YAML-serializable types MUST be Zod schemas"

**Problem:**
- Manual TypeScript interfaces for YAML data can drift from runtime validation
- Zod schemas provide both validation and type inference

**Detection Pattern:**
```typescript
// ❌ BAD - Manual interface for YAML data
interface ValidationConfig {
  phases: Phase[];
  git: GitConfig;
}

// ✅ GOOD - Zod schema with inferred type
const ValidationConfigSchema = z.object({
  phases: z.array(PhaseSchema),
  git: GitConfigSchema,
});
type ValidationConfig = z.infer<typeof ValidationConfigSchema>;
```

**Implementation Details:**
- Target files in `packages/config/` and `packages/core/src/types/`
- Detect `interface` declarations in files that import `yaml`
- Check if file imports `zod` and uses `z.infer<>`
- Look for interfaces with names matching YAML types: Config, Result, State, Options

**Heuristics:**
- Interface name ends with: Config, Result, State, Options, Schema
- File contains YAML parsing/serialization code
- File exports interface used in function signatures

**Exemptions:**
- Callback types (e.g., `interface Handler { (data: T): void }`)
- Internal types not serialized to YAML
- Types extending external library interfaces

**Impact:** Medium - Prevents type/runtime mismatches in config system

**Complexity:** High - Requires understanding type usage and serialization context

**Auto-fix:** No - Requires converting interface to Zod schema

---

#### 5. `local/require-jsdoc-for-exports` 📚

**Source:** CLAUDE.md:401 - "JSDoc comments for all exported functions"

**Problem:**
- Public API functions lack documentation
- Makes library harder to use and maintain

**Detection Pattern:**
```typescript
// ❌ BAD - No JSDoc
export function getTreeHash(): Promise<string> {
  // ...
}

// ✅ GOOD - Has JSDoc
/**
 * Calculate git tree hash for current working directory state
 *
 * Uses `git write-tree` for deterministic content-based hashing.
 *
 * @returns Git tree hash (40-character SHA-1)
 * @throws {Error} If not in a git repository
 */
export function getTreeHash(): Promise<string> {
  // ...
}
```

**Implementation Details:**
- Detect `export function`, `export class`, `export const` in `src/` (not test)
- Check for JSDoc comment (`/** ... */`) immediately before export
- Validate JSDoc has description, `@param`, `@returns`, `@throws` where applicable

**Exemptions:**
- Type-only exports (`export type`, `export interface`)
- Re-exports (`export { foo } from './foo'`)
- Internal utilities not intended for public API

**Impact:** Medium - Improves documentation quality

**Complexity:** Low-Medium - AST pattern matching

**Auto-fix:** Partial - Can add JSDoc template, requires human to fill content

---

#### 6. Pre-publish Safety Check Enhancement 🚀

**Source:** CLAUDE.md:239 - "NEVER publish individual packages"

**Problem:**
- Running `pnpm publish` on individual package bypasses version consistency checks
- Should always use `pnpm publish:all` script

**Current State:**
- Pre-publish check script exists: `tools/pre-publish-check.ts`
- Runs checks but doesn't prevent individual publishes

**Enhancement Approach:**

**Option A: Package.json Script Hook**
```json
{
  "scripts": {
    "prepublishOnly": "node ../../tools/prevent-individual-publish.js"
  }
}
```

**Option B: NPM Lifecycle Hook**
```javascript
// tools/prevent-individual-publish.js
if (process.env.npm_command === 'publish' && !process.env.PUBLISHING_ALL) {
  console.error('❌ NEVER publish individual packages!');
  console.error('   Use: pnpm publish:all');
  process.exit(1);
}
```

**Implementation:**
- Add `prepublishOnly` script to each package
- Check if being invoked from `publish:all` (via env var)
- If not, fail with clear error message

**Impact:** Medium-High - Prevents publishing mistakes

**Complexity:** Low - Simple script + package.json updates

---

### Priority 3: Low Priority (Nice to Have)

#### 7. `local/no-path-join-with-separator` 💻

**Problem:**
- Hardcoded path separators break on Windows
- Example: `'foo' + '/' + 'bar'`

**Detection:**
- String concatenation with `'/'` or `'\\'`
- Should use `path.join()` or `path.posix.join()`

**Impact:** Low - Mostly already covered by path-helpers rules

**Complexity:** Low

---

#### 8. `vv doctor` Git Hooks Validation 🔧

**Source:** CLAUDE.md:812 - "NEVER bypass validation"

**Enhancement:**
- Add check to `vv doctor` command
- Validate pre-commit hooks are installed and working
- Check if `.git/hooks/pre-commit` exists and is executable
- Verify hook runs vibe-validate

**Implementation:**
```typescript
// In doctor command checks
{
  name: 'Git pre-commit hook',
  check: () => {
    const hookPath = '.git/hooks/pre-commit';
    if (!existsSync(hookPath)) return { status: 'warning', message: 'No pre-commit hook found' };
    const content = readFileSync(hookPath, 'utf8');
    if (!content.includes('vibe-validate')) {
      return { status: 'warning', message: 'Pre-commit hook doesn\'t run vibe-validate' };
    }
    return { status: 'ok' };
  },
  fix: 'Run: echo "#!/bin/sh\\npnpm validate" > .git/hooks/pre-commit && chmod +x .git/hooks/pre-commit'
}
```

**Impact:** Low-Medium - Improves developer setup

**Complexity:** Low

---

## Implementation Plan

### Phase 1: Quick Wins (1 session)
1. Implement `local/no-hardcoded-command-name`
2. Add to eslint.config.js
3. Fix any violations found
4. Update CLAUDE.md

### Phase 2: Quality Improvements (1 session)
1. Implement `local/require-error-context`
2. Fix violations (may be many)
3. Consider adding to warning level first

### Phase 3: Testing & Publishing Safety (1 session)
1. Test coverage diff script
2. Pre-publish safety enhancement
3. Integrate into CI/validation

### Phase 4: Documentation & Types (1 session)
1. `local/no-manual-yaml-interfaces`
2. `local/require-jsdoc-for-exports`
3. May require significant refactoring

## References

- **CLAUDE.md** - Source of all requirements
- **eslint.config.js** - Current rule configuration
- **tools/eslint-local-rules/** - Custom rule implementations
- **packages/cli/src/utils/command-name.ts** - getCommandName() utility

## Notes

- Rules should follow existing patterns (see current custom rules)
- All rules should have clear error messages with fix suggestions
- Consider auto-fix capability for better DX
- Test each rule thoroughly before enabling as error
- Can start rules as "warn" before promoting to "error"
- Update CLAUDE.md documentation when adding new rules

## Decision Log

**2025-12-20**: Initial analysis completed. Identified 9 potential enhancements. Prioritized based on:
- Explicit CRITICAL/MANDATORY markings in CLAUDE.md
- User-facing impact
- Implementation complexity
- False positive risk

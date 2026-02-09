# System & Integration Test Analysis

**Date**: 2026-02-07
**Context**: System/integration tests have bitrotted because they're not in validation pipeline
**Goal**: Determine which tests to keep, fix, and add to validation

---

## Executive Summary

- **Total Tests**: 12 files (94 individual tests)
- **Current State**: 20 failed, 60 passed, 14 skipped
- **Execution Time**: ~17s (with failures)
- **Main Issues**: Missing imports, Unix-only commands, outdated expectations

---

## Test Categorization

### Category A: HIGH VALUE - Keep & Fix (Must Have)
**Tests that provide critical coverage gaps not covered by unit tests**

#### 1. ✅ **tree-hash.integration.test.ts** (git package)
- **Lines**: 306
- **Tests**: 3 integration tests
- **Coverage**: Real git repository operations with submodules
- **Time**: ~7.7s (passed successfully)
- **Value**: Tests actual git behavior that can't be mocked
- **Status**: ✅ ALREADY PASSING
- **Action**: Keep as-is, add to validation

#### 2. 🔧 **packaging.system.test.ts**
- **Lines**: 230
- **Tests**: Verify npm package integrity
- **Coverage**: Ensures published package contains required files
- **Time**: <5s estimated (after fixing tar)
- **Value**: HIGH - Catches packaging regressions before publish
- **Issues**:
  - ❌ Uses Unix `tar` command (line 47)
  - ❌ Missing `safeExecSync` import
- **Action**:
  - Replace `tar` with Node.js `tar-stream` or just test with `npm install <tarball>`
  - Add missing import
  - **CRITICAL for releases**

#### 3. 🔧 **history-recording.test.ts** (integration)
- **Lines**: 178
- **Tests**: 3 tests for git notes merge bug
- **Coverage**: Validates history tracking across multiple runs
- **Time**: ~7.7s
- **Value**: HIGH - Tests critical caching/history feature
- **Status**: ✅ All 3 tests passed
- **Action**: Keep, add to validation

---

### Category B: MEDIUM VALUE - Simplify & Keep
**Valuable coverage but need optimization/simplification**

#### 4. 🔧 **run.integration.test.ts**
- **Lines**: 811 (LARGE)
- **Tests**: Fast integration tests for `run` command
- **Coverage**: Real command execution with extractors
- **Time**: <10s (designed to be fast)
- **Value**: MEDIUM-HIGH - Tests extractor integration
- **Issues**: File is huge (811 lines), might overlap with unit tests
- **Action**:
  - Audit for duplication with unit tests
  - Keep only tests that execute REAL commands
  - Target: Reduce to <400 lines

#### 5. 🔧 **cache-manager.integration.test.ts**
- **Lines**: 187
- **Tests**: Real filesystem cache operations
- **Coverage**: Cache behavior with real files
- **Time**: <5s estimated
- **Value**: MEDIUM - Tests file system edge cases
- **Action**: Review for overlap with unit tests, keep unique scenarios

#### 6. 🔧 **watch-pr-extraction.integration.test.ts**
- **Lines**: 197
- **Tests**: Extraction pipeline with real log fixtures
- **Coverage**: Tests extraction against real GitHub Actions logs
- **Time**: <5s estimated
- **Value**: MEDIUM - Validates extractor quality
- **Action**: Keep, add to validation

---

### Category C: LOW VALUE - Evaluate/Simplify/Delete
**Duplicative or low-ROI tests**

#### 7. ❓ **doctor.system.test.ts** + **doctor-edge-cases.system.test.ts**
- **Combined Lines**: 443
- **Tests**: 7 + edge cases
- **Coverage**: Self-hosting verification
- **Time**: ~16.7s (SLOW)
- **Value**: LOW - Doctor is a diagnostic tool, not core functionality
- **Issues**:
  - Expects "17/17 checks" but got "18/18" (test outdated)
  - Slow execution
  - Tests internal diagnostic tool
- **Action**:
  - **CONSOLIDATE** into doctor.integration.test.ts (53 lines)
  - Keep only: "doctor runs without errors"
  - Delete verbose check counting tests
  - Target: <3s, <100 lines total

#### 8. ❓ **doctor.integration.test.ts**
- **Lines**: 53 (tiny)
- **Tests**: Just hits real npm registry
- **Coverage**: Tests npm registry connectivity
- **Time**: <5s
- **Value**: LOW - Only tests external dependency
- **Action**:
  - Merge with simplified doctor tests above
  - Or delete entirely (npm registry availability isn't our concern)

#### 9. 🔧 **subdirectory-behavior.system.test.ts**
- **Lines**: 443 (LARGE)
- **Tests**: All commands from subdirectories
- **Coverage**: Subdirectory execution regression tests
- **Time**: Unknown (failed with safeExecSync errors)
- **Value**: MEDIUM - Subdirectory support is important
- **Issues**:
  - ❌ Multiple `safeExecSync` missing imports
  - Very comprehensive (might be overkill)
- **Action**:
  - Fix imports
  - Reduce to core commands only (validate, run, state)
  - Delete verbose help text tests
  - Target: <200 lines, <10s

#### 10. ❓ **run.system.test.ts**
- **Lines**: 279
- **Tests**: 8 tests, 5 failed
- **Coverage**: Real extractor integration (Vitest, Jest, Playwright, TypeScript)
- **Time**: ~10.4s
- **Value**: MEDIUM - Tests real extractor behavior
- **Issues**: All tests failing with "Cannot read properties of undefined"
- **Action**:
  - Evaluate overlap with run.integration.test.ts
  - If duplicative, DELETE (keep faster integration tests)
  - If unique, fix and keep

#### 11. ❓ **generate-workflow-subdirectory.system.test.ts**
- **Lines**: 112
- **Tests**: Generate workflow from subdirectories
- **Coverage**: Subdirectory support for workflow generation
- **Time**: Unknown
- **Value**: LOW - Niche feature, likely covered by unit tests
- **Action**:
  - Check unit test coverage
  - If covered, DELETE
  - If not, fix and keep (but LOW priority)

#### 12. ❓ **worktree-safety.system.test.ts**
- **Lines**: 150
- **Tests**: Git worktree collision prevention
- **Coverage**: PID-based temp index files
- **Time**: Unknown (note says "may be slow or fragile")
- **Value**: LOW-MEDIUM - Edge case for advanced users
- **Issues**: Comment says "Can be disabled with describe.skip() if causing CI issues"
- **Action**:
  - Keep if it's fast (<5s) and stable
  - DELETE if flaky or slow
  - Consider moving to manual test suite

---

## Recommended Validation Pipeline

### Phase Structure

```yaml
validation:
  phases:
    - name: Pre-Qualification
      parallel: false
      steps:
        - name: TypeScript Type Check
          command: pnpm exec turbo run typecheck
        - name: ESLint Code Quality
          command: pnpm lint
        - name: Code Duplication Check
          command: pnpm duplication-check
        - name: Build All Packages (TypeScript)
          command: pnpm exec turbo run build

    - name: Testing
      parallel: true  # Run unit and integration in parallel
      steps:
        - name: Unit Tests with Coverage
          command: pnpm test:coverage
        - name: Integration Tests
          command: pnpm test:integration  # NEW
```

### New Test Scripts Needed

```json
{
  "test:integration": "vitest run --config vitest.config.integration.ts",
  "test:system": "vitest run --config vitest.config.system.ts"
}
```

### New Config Files

**vitest.config.integration.ts** (Fast integration tests - <30s total):
```typescript
export default defineConfig({
  test: {
    include: [
      'packages/git/test/tree-hash.integration.test.ts',
      'packages/cli/test/integration/history-recording.test.ts',
      'packages/cli/test/integration/cache-manager.integration.test.ts',
      'packages/cli/test/integration/watch-pr-extraction.integration.test.ts',
      'packages/cli/test/packaging.system.test.ts', // After fixing tar
      'packages/cli/test/commands/run.integration.test.ts', // Keep fast tests only
    ],
    testTimeout: 30000,  // 30s max per test
    fileParallelism: true,
  },
});
```

**vitest.config.system.ts** (Slow system tests - manual only):
```typescript
export default defineConfig({
  test: {
    include: [
      'packages/cli/test/commands/subdirectory-behavior.system.test.ts', // After simplifying
      'packages/cli/test/integration/doctor.integration.test.ts', // Consolidated
      // Remove slow/low-value tests
    ],
    testTimeout: 60000,
  },
});
```

---

## Action Plan

### Immediate Actions (Add to Validation)

1. **Fix ESLint rule** ✅ DONE
   - Removed test file exemption from `no-unix-shell-commands`

2. **Fix packaging.system.test.ts** (CRITICAL)
   - Replace `tar` with Node.js solution
   - Add missing imports
   - Verify package integrity

3. **Add passing integration tests**
   - tree-hash.integration.test.ts ✅
   - history-recording.test.ts ✅
   - Move to new `pnpm test:integration` script

### Short-term Actions (Fix & Add)

4. **Fix run.integration.test.ts**
   - Audit for duplication
   - Keep only real command execution tests
   - Target: <400 lines, <10s

5. **Fix cache-manager & watch-pr-extraction**
   - Review for unit test overlap
   - Add to integration suite

6. **Simplify subdirectory-behavior**
   - Fix safeExecSync imports
   - Reduce to core commands
   - Target: <200 lines, <10s

### Medium-term Actions (Cleanup)

7. **Consolidate doctor tests**
   - Merge 3 doctor test files → 1 simple test
   - Target: <100 lines, <3s
   - Just verify "doctor runs without error"

8. **Evaluate run.system.test.ts**
   - Check overlap with run.integration.test.ts
   - Keep or delete based on uniqueness

9. **Delete low-value tests**
   - generate-workflow-subdirectory (if unit tested)
   - worktree-safety (if flaky/slow)

---

## Expected Outcomes

### Before (Current State)
- ❌ System tests: Not run (bitrotted)
- ⏱️ Validation time: ~92s (unit tests only)
- 🐛 Coverage gaps: Packaging, git integration, extractors

### After (With Integration Tests)
- ✅ Integration tests: In validation pipeline
- ⏱️ Validation time: ~92s + ~30s = **~122s** (33% slower)
- ✅ Coverage: Packaging verified, git tested, extractors validated
- 🔒 Cross-platform: ESLint enforces no Unix commands

### Success Metrics
- All integration tests pass
- <30s additional validation time
- No Unix-specific commands in any test
- Critical gaps filled: packaging, git, extractors

---

## Timeline

- **Week 1**: Fix packaging.system.test.ts, add passing tests to pipeline
- **Week 2**: Fix run.integration.test.ts, add to pipeline
- **Week 3**: Simplify/consolidate doctor tests
- **Week 4**: Evaluate and cleanup remaining tests

---

## Risk Assessment

**LOW RISK**:
- Integration tests run in parallel with unit tests
- 30s increase is acceptable for better coverage
- Critical packaging/git bugs caught before release

**MITIGATIONS**:
- Start with only passing tests (tree-hash, history)
- Add more tests incrementally
- Monitor CI time, adjust if needed
- Keep system tests separate for manual runs

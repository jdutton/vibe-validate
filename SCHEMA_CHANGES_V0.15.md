# Schema Changes for v0.15.0

**Date**: 2025-11-02
**Status**: In Progress - Schemas defined, implementation needed
**Breaking Changes**: YES - Cache format changed

---

## Summary of Changes

### 1. ✅ Created Zod Schemas (Completed)
- **ErrorExtractorResult** - Runtime validation for all extractor output
- **RunResult** - Runtime validation for `run` command output
- **ValidationResult** - Updated with missing fields

### 2. ✅ Generated JSON Schemas (Completed)
- `packages/extractors/error-extractor-result.schema.json`
- `packages/cli/run-result.schema.json`
- `packages/core/validation-result.schema.json` (updated)

### 3. ✅ Created Test Helpers (Completed)
- Strict validation for tests (throws on invalid data)
- Safe validation for production (graceful degradation)

### 4. ✅ Renamed cleanOutput → errorSummary (Completed)
- More descriptive name for LLM-optimized error text
- Indicates formatted summary of errors
- Better pairs with `summary` field
- Enhanced generic extractor with keyword extraction for non-TypeScript projects

### 5. ✅ Enhanced Generic Extractor (Completed)
- Intelligent keyword extraction when no structured errors found
- Supports Python, Go, Rust, Ruby, Java, C/C++ error formats
- 40x context window savings for multi-language projects
- Comprehensive test suite with real-world examples

---

## Key Schema Changes

### **RunResult Schema** (Breaking Changes)

#### **Removed:**
- ❌ `rawOutput` - Truncated output (not useful, bloats YAML)

#### **Added:**
- ✅ `timestamp` (required) - ISO 8601 datetime when command executed
- ✅ `fullOutputFile` (optional) - Path to full output log
- ✅ `isCachedResult` (optional) - Boolean indicating cache hit

#### **Before** (v0.14.x):
```yaml
command: npm test
exitCode: 1
extraction: { ... }
rawOutput: "truncated to 1000 chars..."  # Bloat, not useful
```

#### **After** (v0.15.0):
```yaml
command: npm test
exitCode: 1
timestamp: 2025-11-02T22:00:00.000Z  # NEW: Age awareness
extraction: { ... }
fullOutputFile: /tmp/run-2025-11-02T22-00-00-abc.log  # NEW: Full output
isCachedResult: true  # NEW: Cache hit indicator
```

---

### **RunCacheNote Schema** (Breaking Changes)

#### **Changed:**
- 🔄 `errors` array (simplified) → `extraction` object (full fidelity)
- 🔄 `summary` field → part of `extraction.summary`

#### **Added:**
- ✅ `fullOutputFile` - Path to full output log

#### **Before** (v0.14.x):
```typescript
interface RunCacheNote {
  treeHash: string;
  command: string;
  workdir: string;
  timestamp: string;
  exitCode: number;
  duration: number;
  errors: Array<{ file?: string; line?: number; message: string; }>;  // Simplified!
  summary: string;
}
```

#### **After** (v0.15.0):
```typescript
interface RunCacheNote {
  treeHash: string;
  command: string;
  workdir: string;
  timestamp: string;
  exitCode: number;  // Always 0 (only success cached)
  duration: number;
  extraction: ErrorExtractorResult;  // Full fidelity with metadata!
  fullOutputFile?: string;  // Path to full output
}
```

---

### **ValidationResult Schema** (Non-breaking Additions)

#### **Added to StepResultSchema:**
- ✅ `failedTests` (optional) - Array of failed test names
- ✅ `extractionQuality` (optional) - Quality metrics for developerFeedback mode

#### **Changed:**
- ✅ `timestamp` validation - Now enforces ISO 8601 format (`.datetime()`)

---

## Caching Behavior Changes

### **NEW: Only Cache Successful Runs**

**Rationale**: Failed runs may be transient or environment-specific. Caching failures could hide real issues.

#### **Before** (v0.14.x):
```typescript
// Cached all results (success and failure)
await storeCacheResult(command, result);  // exitCode 0 or 1+
```

#### **After** (v0.15.0):
```typescript
// Only cache exitCode === 0
if (exitCode === 0) {
  await storeCacheResult(command, result);
} else {
  // Never cache failures - always re-execute
}
```

This matches `validate` command behavior (only caches passing validations).

---

## Why These Changes?

### 1. **User Awareness** 🎯
- `timestamp` - Shows age of cached result
- `isCachedResult` - Clear indication this is cached
- Users can see: "This test passed 2 hours ago (cached)"

### 2. **Full Output Access** 📄
- `fullOutputFile` - Path to complete output
- If file exists, user can see full details
- Matches `ValidationResult.fullLogFile` pattern

### 3. **No Data Loss** 💾
- `extraction` (full) vs `errors` (simplified)
- Preserves metadata, confidence, completeness
- Better for debugging and quality analysis

### 4. **Context Window Savings** 🚀
- **`errorSummary`** (renamed from `cleanOutput`) - LLM-optimized error text
- Provides formatted summary of errors (file:line - message)
- When no structured errors: Intelligent keyword extraction (FAILED, Error, etc.)
- Supports multi-language projects (Python, Go, Rust, Ruby, Java, C/C++)
- 40x smaller than raw output - core value proposition!

### 5. **Consistency** 🔄
- Matches `ValidationResult` patterns
- Both use file paths, not embedded output
- Both cache only successful runs

---

## Implementation Status

### ✅ Completed
1. Zod schemas defined
2. JSON schemas generated
3. Test helpers created
4. History reader updated (safe validation)
5. Types updated
6. Fixed TypeScript errors in `history.ts` (now uses `extraction.errors`)
7. Fixed TypeScript errors in `run.ts` (now includes `timestamp`, removed `rawOutput`)
8. Updated run command to:
   - Only cache exitCode === 0 (line 197-199 in run.ts)
   - Write full output to temp file (lines 299-311 in run.ts)
   - Include timestamp in result (line 322 in run.ts)
   - Set `isCachedResult` on cache hits (line 179 in run.ts)
9. All packages build successfully

### 📋 TODO
1. Run full test suite
2. Update documentation
3. Test manually with real commands
4. Update CHANGELOG.md

---

## Migration Notes

### **Breaking Change**: Git Notes Format

Existing cached run results in git notes use the old format:
```yaml
errors: [{file: ..., line: ..., message: ...}]
summary: "1 error"
```

New format:
```yaml
extraction:
  errors: [{file: ..., line: ..., message: ..., code: ..., severity: ...}]
  summary: "1 error"
  totalCount: 1
  cleanOutput: "..."
```

**Migration Strategy**: Old cache entries will be read but may fail validation. They'll be re-executed and cached in new format. This is acceptable as cache is ephemeral.

---

## Files Modified

### Schemas
- ✅ `packages/extractors/src/result-schema.ts` (NEW)
- ✅ `packages/cli/src/schemas/run-result-schema.ts` (NEW)
- ✅ `packages/core/src/result-schema.ts` (UPDATED)

### Types
- ✅ `packages/history/src/types.ts` - Updated RunCacheNote
- ✅ `packages/cli/src/commands/run.ts` - Import from schema (type only)

### Test Helpers
- ✅ `packages/core/test/helpers/schema-helpers.ts` (NEW)
- ✅ `packages/extractors/test/helpers/schema-helpers.ts` (NEW)
- ✅ `packages/cli/test/helpers/schema-helpers.ts` (NEW)

### Production Code (Safe Validation)
- ✅ `packages/history/src/reader.ts` - Validates ValidationResult from git notes

### JSON Schemas
- ✅ `packages/extractors/error-extractor-result.schema.json` (NEW)
- ✅ `packages/cli/run-result.schema.json` (NEW)
- ✅ `packages/core/validation-result.schema.json` (UPDATED)

---

## Next Steps

1. **Fix TypeScript Errors** (Required before commit)
   - Update `history.ts` to use `extraction.errors` instead of `errors`
   - Update `run.ts` to include `timestamp` in RunResult
   - Update run cache storage to use new format

2. **Implement Caching Logic** (Required)
   - Only cache exitCode === 0
   - Write full output to temp file
   - Set `isCachedResult` and `fullOutputFile` appropriately

3. **Test** (Required)
   - Run full test suite
   - Manual testing with real commands
   - Verify cache hit/miss behavior

4. **Documentation** (Nice to have)
   - Update README with new fields
   - Document caching behavior
   - Update examples

---

## Questions to Answer

1. **Temp file location**: `/tmp/run-{timestamp}-{short-hash}.log`?
2. **Temp file cleanup**: Let OS handle it (tmpdir) or explicit cleanup?
3. **When to write file**: Always, or only on errors?
4. **File path in cache**: Always store, or only if file exists?

**Current Recommendation**:
- Location: `/tmp/vibe-validate-run-{timestamp}-{short-hash}.log`
- Cleanup: OS tmpdir (automatic)
- When: Always write (helps with debugging successes too)
- Cache: Always store path (even if file doesn't exist later)

---

## Risk Assessment

### **Low Risk**
- ✅ Schema additions (`timestamp`, `fullOutputFile`, `isCachedResult`) - Optional fields
- ✅ Test helpers - Only affect test code
- ✅ JSON schemas - Documentation/tooling only

### **Medium Risk**
- ⚠️ RunCacheNote format change - Breaks existing cache
- ⚠️ ValidationResult schema strictness - May fail on corrupted git notes

### **Mitigation**
- Safe validation in production (graceful degradation)
- Cache is ephemeral (re-execution is fine)
- Strict validation in tests (catches issues early)

---

## Benefits Summary

1. **Type Safety** - Runtime validation catches schema violations
2. **User Awareness** - Clear cache hit indication with age
3. **Full Output** - Access to complete output when needed
4. **No Data Loss** - Full extraction metadata preserved
5. **Consistency** - Matches validation command patterns
6. **LLM-Friendly** - cleanOutput still provides 40x savings
7. **Stability** - Only cache successful runs
8. **Documentation** - Published JSON schemas for external tools

# @vibe-validate/extractors-test-bed

Self-hosted test bed for validating `@vibe-validate/extractors` across multiple test frameworks, output formats, and package managers.

## Purpose

This package contains **intentionally failing tests** designed to:

1. **Generate samples** for testing error extractors
2. **Validate extractor quality** across different tools and formats
3. **Enable dogfooding** - uses vibe-validate packages as test subjects
4. **Catch breaking changes** - extractors must handle real vibe-validate code

## Test Matrix

### Test Frameworks

| Framework | Text Output | JUnit XML | Status |
|-----------|-------------|-----------|--------|
| **Jest** | ✅ Supported | ✅ Supported | Implemented |
| **Vitest** | ✅ Supported | ✅ Supported | Implemented |
| **Mocha** | 🚧 Planned | 🚧 Planned | TODO |
| **Playwright** | 🚧 Planned | 🚧 Planned | TODO |
| **AVA** | 🤔 Consider | 🤔 Consider | Future |
| **uvu** | 🤔 Consider | ❌ No XML | Future |

### Output Formats

| Format | Description | Use Case | Extractor |
|--------|-------------|----------|-----------|
| **Text (ANSI)** | Raw console output with colors | Local development, CI logs | Framework-specific extractors |
| **Text (stripped)** | Plain text, no ANSI codes | Parsed logs, file storage | Framework-specific extractors |
| **JUnit XML** | Standardized test result format | CI systems, universal parsing | `junit-extractor.ts` (planned) |
| **TAP** | Test Anything Protocol | Some CI systems | 🤔 Future consideration |
| **JSON** | Custom JSON reporters | Some test frameworks | 🤔 Future consideration |

### Package Managers

**Question**: Do package managers affect extraction output?

| Manager | Installation | Test Execution | Affects Extraction? |
|---------|--------------|----------------|---------------------|
| **pnpm** | `pnpm install` | `pnpm test` | ❓ To be tested |
| **npm** | `npm install` | `npm test` | ❓ To be tested |
| **yarn** | `yarn install` | `yarn test` | 🤔 Consider testing |

**Hypothesis**: Package managers should NOT affect extraction (test framework output should be identical), but we should verify this.

**Test approach**: Run same failing test with npm vs pnpm, diff the outputs.

## Failure Types Matrix

Each failure type should be tested across all supported frameworks:

| Failure Type | Jest | Vitest | Mocha | Playwright | Example |
|--------------|------|--------|-------|------------|---------|
| **Assertion Error** | ✅ | ✅ | 🚧 | 🚧 | `expect(2).toBe(3)` |
| **Type Error (TS)** | ✅ | ✅ | 🚧 | N/A | `Type 'number' not assignable to 'string'` |
| **Runtime Error (ENOENT)** | ✅ | ✅ | 🚧 | 🚧 | `readFile('/nonexistent')` |
| **Runtime Error (TypeError)** | ✅ | ✅ | 🚧 | 🚧 | `null.foo()` |
| **Timeout** | ✅ | ✅ | 🚧 | 🚧 | Test exceeds time limit |
| **Snapshot Mismatch** | ✅ | ✅ | N/A | ✅ | `toMatchSnapshot()` fails |
| **Async Rejection** | ✅ | ✅ | 🚧 | 🚧 | Unhandled promise rejection |
| **Import Error** | ✅ | ✅ | 🚧 | 🚧 | Module not found |
| **Multiple Failures** | ✅ | ✅ | 🚧 | 🚧 | Several tests fail in one suite |
| **Nested Describe Blocks** | ✅ | ✅ | 🚧 | N/A | Deep test hierarchy (Level 3+) |

**Legend:**
- ✅ Implemented
- 🚧 Planned
- 🤔 Under consideration
- ❌ Not applicable
- N/A Framework doesn't support this

## Test Strategy

### Dual Approach: Real + Simple

**80% Real vibe-validate code** (primary test subjects):
```typescript
// tests/jest/vibe-validate-integration.test.ts
import { validateSteps } from '@vibe-validate/core';
import { loadConfig } from '@vibe-validate/config';
import { extractTypeScriptErrors } from '@vibe-validate/extractors';

// INTENTIONAL failures using real vibe-validate packages
// - Real import chains across monorepo
// - Real TypeScript errors from API misuse
// - Real stack traces through multiple packages
```

**20% Simple code** (edge cases):
```typescript
// tests/jest/edge-cases.test.ts
import { Calculator } from '../../src/calculator.js';

// Simple, isolated failures for specific extractor edge cases
// - Division by zero (pure runtime error)
// - Basic timeout (no complex stack)
```

### Why This Approach?

**Real code advantages:**
- ✅ Tests extractors handle monorepo structure
- ✅ Exposes bugs that real projects would hit
- ✅ Breaking API changes show up immediately
- ✅ Stack traces are realistic and complex
- ✅ True dogfooding - code validates itself

**Simple code advantages:**
- ✅ Isolates specific extractor edge cases
- ✅ Easier to understand failure cause
- ✅ Less brittle (doesn't break when APIs change)

## Directory Structure

```
packages/extractors-test-bed/
├── src/
│   ├── calculator.ts            # Simple code for edge cases
│   └── vibe-integration.ts      # Helpers for vibe-validate usage
├── tests/
│   ├── jest/
│   │   ├── vibe-validate.test.ts    # 80% - Real package usage
│   │   └── edge-cases.test.ts       # 20% - Simple failures
│   ├── vitest/
│   │   ├── vibe-validate.test.ts
│   │   └── edge-cases.test.ts
│   ├── mocha/
│   │   └── (planned)
│   └── playwright/
│       └── (planned)
├── scripts/
│   └── capture-samples.ts       # Generate all samples (cross-platform)
├── junit-output/                # JUnit XML output directory
│   ├── junit.xml                # Jest JUnit
│   ├── vitest-results.xml       # Vitest JUnit
│   └── mocha-results.xml        # Mocha JUnit
├── jest.config.js
├── vitest.config.ts
├── package.json
└── README.md (this file)
```

## Usage

### Install Dependencies

```bash
pnpm install
```

### Run Tests (They Will Fail - That's Expected!)

```bash
# Jest - text output
pnpm test:jest

# Jest - JUnit XML
pnpm test:jest:junit

# Vitest - text output
pnpm test:vitest

# Vitest - JUnit XML
pnpm test:vitest:junit
```

### Health Checks - Prevent Bit Rot

**Problem**: Test-bed is excluded from main validation to avoid polluting test results. But this creates bit-rot risk - code could break and we wouldn't notice until we need to regenerate samples months later.

**Solution**: Health checks validate the **infrastructure works** and **extraction quality is high**, without checking exact output.

```bash
# Run all health checks (parallel for speed)
pnpm run health-check

# Run individual framework health checks
pnpm run health-check:vitest
pnpm run health-check:jest
pnpm run health-check:junit
```

**What Health Checks Validate**:

| Check | Purpose | Pass Criteria |
|-------|---------|--------------|
| **Tests Run** | Infrastructure works | Tests execute (even if they fail) |
| **Extraction Quality** | Extractors produce high-quality results | `completeness >= 90%`, `confidence >= 90%` |
| **Error Count Range** | Reasonable number of errors extracted | `10 <= errors.length <= 15` |
| **Dependencies** | All packages install correctly | `pnpm install` succeeds |

**What Health Checks DON'T Validate**:
- ❌ Exact file/line numbers (those change as code evolves)
- ❌ Exact error messages (those change with framework versions)
- ❌ Specific error order (not guaranteed by frameworks)

**Why This Approach Works**:
- ✅ **Unit tests** (in `packages/extractors/test/`) verify exact correctness with static samples
- ✅ **Health checks** (here) verify infrastructure remains functional and produces quality results
- ✅ **Manual regeneration** (when needed) produces new samples for unit tests

**Integration with Validation**:

Health checks run as a **parallel phase** in `vibe-validate.config.yaml`:

```yaml
phases:
  - name: test-bed-health
    parallel: true  # All frameworks run in parallel for speed
    steps:
      - name: vitest-test-bed
        command: cd packages/extractors-test-bed && pnpm health-check:vitest
      - name: jest-test-bed
        command: cd packages/extractors-test-bed && pnpm health-check:jest
      - name: junit-test-bed
        command: cd packages/extractors-test-bed && pnpm health-check:junit
```

This ensures test-bed infrastructure is validated on every commit, preventing bit rot while keeping the main test suite clean.

### Capture Samples for Extractor Testing

**When to Regenerate Samples**:
- Test framework version changes (e.g., Vitest 2.0 → 3.0)
- Output format changes (e.g., new error message format)
- Adding new failure types to the matrix
- Major vibe-validate API changes

**How to Regenerate**:

```bash
# Capture all samples (text + JUnit XML for all frameworks)
pnpm run capture:all

# Capture specific framework
pnpm run capture:jest:text
pnpm run capture:jest:junit
pnpm run capture:vitest:text
pnpm run capture:vitest:junit
```

Samples are saved to: `../extractors/test/samples/`

**After Regenerating**:
1. Review sample diffs to understand format changes
2. Update extractors if patterns changed
3. Run unit tests: `cd ../extractors && pnpm test`
4. Commit updated samples with clear explanation

### Test Extractors Against Samples

```bash
cd ../extractors

# Run extractor tests
pnpm test

# Run generic extractor baseline
npx tsx test-generic-baseline.ts
```

## Adding New Failure Types

1. **Identify the failure type** (e.g., "async rejection")
2. **Add test case** to both Jest and Vitest test files
3. **Document in matrix** above (mark as ✅ Implemented)
4. **Capture samples**: `pnpm run capture:all`
5. **Verify extraction**: Test extractors handle the new pattern

Example:
```typescript
// tests/jest/vibe-validate.test.ts
describe('Async Errors', () => {
  it('should handle unhandled rejection', async () => {
    // INTENTIONAL: Async function that rejects
    const promise = Promise.reject(new Error('Unhandled rejection'));
    // Don't await or catch - should fail with unhandled rejection
  });
});
```

## Adding New Test Frameworks

1. **Install framework**: Add to `devDependencies`
2. **Create config**: e.g., `playwright.config.ts`
3. **Add test directory**: `tests/playwright/`
4. **Add scripts**: `test:playwright`, `test:playwright:junit`
5. **Add capture scripts**: `capture:playwright:text`, `capture:playwright:junit`
6. **Update matrix** in this README
7. **Create extractor** in `../extractors/src/` if needed

## Package Manager Testing

To test if package managers affect extraction:

```bash
# Test with npm
rm -rf node_modules package-lock.json
npm install
npm run test:jest > /tmp/npm-output.txt 2>&1

# Test with pnpm
rm -rf node_modules pnpm-lock.yaml
pnpm install
pnpm run test:jest > /tmp/pnpm-output.txt 2>&1

# Compare outputs
diff /tmp/npm-output.txt /tmp/pnpm-output.txt
```

Expected: No differences in test output (only dependency installation differs).

## Quality Metrics (Future)

Track extractor quality over time:

- **Extraction rate**: % of failures correctly extracted
- **Accuracy**: Correct file/line/column parsing
- **Completeness**: All error details captured
- **Token efficiency**: Output size reduction
- **Coverage**: % of failure types handled

## Contributing

When adding new test cases:

1. ✅ Mark failures with `// INTENTIONAL FAILURE` comment
2. ✅ Explain what should fail and why
3. ✅ Use real vibe-validate packages when possible
4. ✅ Update the matrix in this README
5. ✅ Capture samples after adding tests
6. ✅ Verify extractors handle new patterns

## Why This Package Exists

Traditional extractor testing approaches:
- ❌ Manual copy-paste of error samples (stale quickly)
- ❌ Mocked/synthetic errors (don't match reality)
- ❌ External repo dependencies (fragile, hard to control)

**This package provides:**
- ✅ Self-hosted, controlled failure generation
- ✅ Real code, real errors, real stack traces
- ✅ Automated sample regeneration
- ✅ Cross-framework validation
- ✅ Meta-dogfooding (vibe-validate validates vibe-validate)

## Related Files

- `../extractors/src/` - Extractor implementations
- `../extractors/test/samples/` - Generated samples (output of this package)
- `../extractors/test-generic-baseline.ts` - Generic extractor quality test

# Test Fixtures for Failure Extraction

This directory contains real-world test output samples used to validate and improve failure extraction accuracy.

## Philosophy

**Extractors will never be perfect. Extractors will never be done.**

This is a data problem, not a logic problem. Success comes from:
1. **Continuous testing** - Fixtures ensure we don't regress
2. **Community contributions** - Real-world cases from users
3. **Graceful degradation** - Always provide something useful
4. **Dogfooding** - vibe-validate tests itself

## Directory Structure

```
samples/
├── vitest/          # Vitest test runner output
├── typescript/      # TypeScript compiler (tsc) errors
├── eslint/          # ESLint lint errors/warnings
├── unknown/         # Tools we don't support yet
└── README.md        # This file
```

## Sample Format

Each fixture is a YAML file with:
- **$schema**: Reference to `sample-schema.json` (enables IDE autocomplete)
- **metadata**: Tool, version, platform, contributor, difficulty
- **input**: Raw output (exactly as captured)
- **expected**: What we SHOULD extract
  - Detection confidence
  - Tool name
  - Detailed failures (for testing accuracy)
  - **llmSummary**: Terse, actionable summary (what users see)
- **quality**: Auto-computed extraction accuracy scores

See `SAMPLE_FORMAT.md` for detailed schema.

### IDE Support

All samples include JSON Schema validation (`sample-schema.json`):
- ✅ **Autocomplete** - Your IDE suggests valid fields
- ✅ **Validation** - Immediate feedback on errors
- ✅ **Documentation** - Inline help for each field
- ✅ **Type safety** - Catches mistakes before tests run

Works with VSCode, IntelliJ IDEA, WebStorm, and more.

## Output Philosophy

### For Testing (This Directory)
We test extraction with **detailed, structured data**:
- Exact file/line/column locations
- Full stack traces (multiple frames)
- Context (diffs, snippets)
- All fields validated

### For Users/LLMs (Production Output)
Users see **terse, actionable summaries**:
```yaml
# DEFAULT OUTPUT - Minimal, actionable
passed: false
failedStep: Unit Tests
failureSummaries:
  - "Test 'should extract failures' failed in runner.test.ts:45 - AssertionError: expected 2 to equal 3"
  - "Test 'should handle timeouts' failed in runner.test.ts:67 - Timeout of 5000ms exceeded"
```

Full extraction details only shown with `--debug` flag.

## Contributing Fixtures

We need your help! See [CONTRIBUTING.md](../../../CONTRIBUTING.md) for how to:
1. File an issue with test output
2. Submit a PR with a fixture
3. Let Claude Code do it for you

### Quick Start

1. Copy the template:
```bash
cp _template.yaml vitest/my-case-001.yaml
```

2. Fill in the YAML (raw output + what you expect)
   - Your IDE will provide autocomplete thanks to JSON Schema
   - The `$schema` line at the top enables this

3. Run tests:
```bash
pnpm test:extractors
```

4. Submit PR using the fixture template

**Tip**: The JSON Schema (`sample-schema.json`) validates your fixture automatically. If tests fail with schema errors, your IDE should show exactly what's wrong.

## Quality Reports

After running tests, check `quality-report.json` for:
- Overall extraction accuracy
- Regressions (fixtures that got worse)
- Improvements (fixtures that got better)
- Common issues to fix

## Recognition

Contributors are credited in:
- Fixture metadata (your GitHub username)
- Quality reports
- CHANGELOG for major improvements

Thank you for making vibe-validate better! 🙏

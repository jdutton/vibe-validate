# Sample Format Specification

## Purpose

Samples are used to:
1. **Test extraction accuracy** - Validate extractors work correctly
2. **Prevent regressions** - Ensure changes don't break existing cases
3. **Document patterns** - Show what output looks like from each tool
4. **Guide improvements** - Identify gaps in extraction quality

## IDE Support

All fixture files include a JSON Schema reference for IDE autocomplete and validation:

```yaml
$schema: ../sample-schema.json
```

This provides:
- **Autocomplete** - Your IDE suggests valid field names and values
- **Validation** - Immediate feedback if sample format is wrong
- **Documentation** - Inline help text for each field
- **Type safety** - Ensures samples match expected structure

Supported IDEs: VSCode, IntelliJ IDEA, WebStorm, and others with YAML schema support.

## YAML Schema

```yaml
# Metadata about this test case
metadata:
  # Which tool produced this output (required)
  tool: vitest | typescript | eslint | jest | prettier | unknown

  # Tool version (optional but recommended)
  toolVersion: "1.0.0"

  # Test environment
  platform: linux | darwin | win32
  nodeVersion: "22.0.0"

  # Provenance
  contributor: github-username
  contributedDate: "2025-10-22"
  sourceIssue: "#123"          # GitHub issue this came from (optional)
  sourcePR: "#456"              # PR that added this fixture (optional)

  # Classification
  category: assertion-failure | type-error | lint-error | timeout | etc
  difficulty: easy | medium | hard | very-hard

  # Description
  description: |
    Brief description of what this sample tests.
    What makes it interesting or challenging?

# The raw output from the tool (EXACTLY as captured)
input:
  # Raw text output (required)
  # This is what gets fed into the extractor
  raw: |
    ❌ packages/core/test/runner.test.ts > ValidationRunner > should extract failures

      AssertionError: expected 2 to equal 3

        Expected: 3
        Received: 2

        at Object.<anonymous> (packages/core/test/runner.test.ts:45:12)
        at Promise.then.completed (node_modules/vitest/dist/chunks/runtime.js:89:5)

  # Optional: If tool supports structured output (JUnit XML, TAP, CTRF)
  structured:
    format: ctrf | junit | tap
    data: |
      {JSON or XML here}

# What we SHOULD extract (ground truth for testing)
expected:
  # Detection confidence (0-100)
  # How confident should we be this is the right tool?
  detectionConfidence: 95

  # Detected tool name
  detectedTool: vitest

  # Detailed failures (for testing extraction accuracy)
  # These fields are validated during testing
  failures:
    - tool: vitest
      type: test-failure

      # Summary for test identification (tested for accuracy)
      summary: "ValidationRunner > should extract failures"

      # Full error message (tested)
      message: "AssertionError: expected 2 to equal 3"

      # Source location (tested - exact match required)
      location:
        file: packages/core/test/runner.test.ts
        line: 45
        column: 12

      # Context (optional - tested if present)
      context: |
        Expected: 3
        Received: 2

      # Stack trace (tested - at least top frames must match)
      stackTrace:
        - file: packages/core/test/runner.test.ts
          line: 45
          column: 12
          function: "Object.<anonymous>"
        - file: node_modules/vitest/dist/chunks/runtime.js
          line: 89
          column: 5
          function: "Promise.then.completed"

      # Relevance score for ranking (0-100)
      relevance: 100

      # === CRITICAL: What users/LLMs actually see ===
      # This is the terse, actionable summary shown in production
      # Should be 1-2 lines max, highly focused
      llmSummary: |
        Test 'ValidationRunner > should extract failures' failed in packages/core/test/runner.test.ts:45
        AssertionError: expected 2 to equal 3 (received 2, expected 3)

# Extraction quality metrics (auto-computed during test runs)
# This section is updated automatically - don't edit manually
quality:
  # Timestamp of last test run
  lastTested: "2025-10-22T13:00:00Z"

  # Field-level accuracy (0.0 - 1.0)
  fields:
    tool: 1.0              # Perfect match
    type: 1.0
    summary: 0.9           # Partial match
    message: 1.0
    location: 1.0
    stackTrace: 0.8        # Missing some frames
    llmSummary: 0.95       # Close enough

  # Overall score (weighted average)
  score: 0.92

  # What's missing or wrong
  issues:
    - "Stack trace truncated to 2 frames instead of 5"
    - "Summary doesn't include full test path"

  # History (track improvements/regressions)
  scoreHistory:
    - date: "2025-10-22"
      score: 0.92
    - date: "2025-10-21"
      score: 0.85  # Improved!

# How to improve extraction for this case
# Guidance for developers fixing issues
improvementHints:
  - "Look for '>' separators to get full test path"
  - "Parse stack trace until blank line"
  - "Extract Expected/Received from assertion output"

# Related samples (for learning patterns)
relatedSamples:
  - vitest/assertion-error-002.yaml
  - vitest/assertion-error-003.yaml
```

## Field Requirements

### Required Fields
- `metadata.tool`
- `metadata.platform`
- `metadata.contributor`
- `metadata.contributedDate`
- `metadata.category`
- `metadata.difficulty`
- `metadata.description`
- `input.raw`
- `expected.detectedTool`
- `expected.failures` (at least one)
- `expected.failures[].llmSummary` ⭐ **CRITICAL**

### Optional But Recommended
- `metadata.toolVersion`
- `metadata.nodeVersion`
- `metadata.sourceIssue`
- `expected.failures[].location`
- `expected.failures[].stackTrace`
- `expected.failures[].context`

### Auto-Generated (Don't Edit)
- `quality.*` - Updated by test runs

## Output Philosophy

### Testing vs Production

**In Test Samples (this file):**
```yaml
# We test ALL extraction details for accuracy
expected:
  failures:
    - tool: vitest
      summary: "ValidationRunner > should extract failures"
      message: "AssertionError: expected 2 to equal 3"
      location:
        file: packages/core/test/runner.test.ts
        line: 45
        column: 12
      stackTrace: [...]
      context: "Expected: 3\nReceived: 2"

      # But THIS is what users see:
      llmSummary: |
        Test 'ValidationRunner > should extract failures' failed in runner.test.ts:45
        AssertionError: expected 2 to equal 3
```

**In Production Output (what users see):**
```yaml
# DEFAULT - Terse, actionable
passed: false
failedStep: Unit Tests
failureSummaries:
  - "Test 'ValidationRunner > should extract failures' failed in runner.test.ts:45 - AssertionError: expected 2 to equal 3"

# Only with --debug flag:
_debug:
  failures:
    - tool: vitest
      location: { file: ..., line: 45 }
      stackTrace: [...]
```

The detailed extraction validates our parsing accuracy. The `llmSummary` is what users get.

## Difficulty Levels

### Easy (90%+ accuracy expected)
- Standard patterns
- Clear error messages
- Obvious file/line references
- **Example**: Basic vitest assertion failure

### Medium (75%+ accuracy expected)
- Less common patterns
- Some ambiguity in parsing
- Multiple possible interpretations
- **Example**: Nested test suites, complex stack traces

### Hard (60%+ accuracy expected)
- Unusual output formats
- Heavy parsing required
- Edge cases
- **Example**: Async errors, transpiled code stack traces

### Very Hard (40%+ accuracy expected)
- Custom tools
- Non-standard formats
- Minimal structure
- **Example**: Unknown tools, custom test runners

## Testing Samples

```bash
# Run all sample tests
pnpm test:extractors

# Test specific tool
pnpm test:extractors --grep vitest

# Update quality scores
pnpm test:extractors:report

# Check for regressions
pnpm test:extractors:regression
```

## Contributing Guidelines

### From Users
1. File issue with test output → We create fixture
2. Submit PR with filled-out fixture → We validate
3. Let Claude Code auto-generate → Review and merge

### Creating a New Fixture

1. **Copy the template**:
   ```bash
   cp test/samples/_template.yaml test/samples/<tool>/<name>.yaml
   ```

2. **Fill in all fields** - The JSON Schema (`sample-schema.json`) will validate your fixture automatically

3. **Ensure IDE schema support** - Your IDE should show autocomplete. If not, the `$schema` line at the top enables this.

4. **Run tests to validate**:
   ```bash
   pnpm test:extractors
   ```

### Fixture Quality Checklist
- [ ] Includes `$schema` reference at top of file
- [ ] Real-world output (not made-up)
- [ ] Complete error (not truncated)
- [ ] Scrubbed sensitive data (no secrets, internal paths)
- [ ] Representative pattern (helps multiple people)
- [ ] Clear llmSummary (terse, actionable)
- [ ] Related samples linked (if applicable)
- [ ] Passes JSON Schema validation

### Naming Convention
```
{tool}/{category}-{sequence}.yaml

Examples:
vitest/assertion-error-001.yaml
vitest/assertion-error-002.yaml
typescript/type-error-001.yaml
eslint/lint-error-001.yaml
unknown/custom-tool-001.yaml
```

## Recognition

Contributors are credited in:
- `metadata.contributor` field
- Quality reports
- CHANGELOG for improvements
- Hall of Fame for 5+ samples

Thank you for making vibe-validate better! 🙏

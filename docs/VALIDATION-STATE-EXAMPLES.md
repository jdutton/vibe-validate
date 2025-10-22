# YAML Examples Documentation

This document defines the tagging convention for all YAML examples in vibe-validate documentation and provides validated examples.

## Tagging Convention

Use HTML comments to tag YAML code blocks that should be validated against their respective schemas:

### Validation State File Examples

```markdown
<!-- validation-result:example -->
\```yaml
passed: false
timestamp: "2025-10-20T12:00:00.000Z"
treeHash: "abc123def456..."
failedStep: "TypeScript"
\```
```

### Configuration File Examples

```markdown
<!-- config:example -->
\```yaml
git:
  mainBranch: main
validation:
  phases:
    - name: Testing
      steps:
        - name: Unit Tests
          command: npm test
\```
```

## Supported Tags

| Tag | Schema | File Type | Description |
|-----|--------|-----------|-------------|
| `validation-result:example` | ValidationResult | Validation State | State from git notes (validated) |
| `validation-result:partial` | N/A | Documentation | Partial example (not validated) |
| `state-file:example` | ValidationResult | Validation State | Alias for validation-result |
| `config:example` | VibeValidateConfig | `vibe-validate.config.yaml` | Config file (validated) |
| `config:partial` | N/A | Documentation | Partial config (not validated) |
| `vibe-config:example` | VibeValidateConfig | `vibe-validate.config.yaml` | Alias for config |

## Schema Validation

All examples tagged with `:example` are automatically validated:
- **Test file**: `packages/core/test/markdown-examples-validation.test.ts`
- **Runs on**: Every build (`pnpm test`)
- **Validates**: All `*.md` files in the repository

---

# Validation State File Examples

## Validated Examples

### Example 1: Failed Validation (Minimal)

<!-- validation-result:example -->
```yaml
passed: false
timestamp: "2025-10-20T12:00:00.000Z"
treeHash: "a1b2c3d4e5f6789abc123def456"
failedStep: "TypeScript"
rerunCommand: "pnpm typecheck"
failedStepOutput: |
  src/index.ts:42:5 - error TS2322
  Type 'string' is not assignable to type 'number'
```

### Example 2: Failed Validation (With Phases)

<!-- validation-result:example -->
```yaml
passed: false
timestamp: "2025-10-20T12:34:42.179Z"
treeHash: "920d091abbe1cdce638e01b8d54ebe68e1d16921"
phases:
  - name: "Pre-Qualification"
    durationSecs: 1.1
    passed: true
    steps:
      - name: "TypeScript Type Check"
        passed: true
        durationSecs: 0.7
      - name: "ESLint Code Quality"
        passed: true
        durationSecs: 1.1
  - name: "Testing"
    durationSecs: 26.1
    passed: false
    steps:
      - name: "Unit Tests with Coverage"
        passed: false
        durationSecs: 26.1
    output: "Test failure output here"
failedStep: "Unit Tests with Coverage"
rerunCommand: "pnpm test:coverage"
failedStepOutput: |
  FAIL packages/cli/test/example.test.ts
  × should pass (2ms)
    → Error: Expected value to be true
fullLogFile: "/tmp/validation-2025-10-20T12-34-14-730Z.log"
```

### Example 3: Successful Validation

<!-- validation-result:example -->
```yaml
passed: true
timestamp: "2025-10-20T15:00:00.000Z"
treeHash: "def456abc123xyz789"
phases:
  - name: "Pre-Qualification"
    durationSecs: 1.2
    passed: true
    steps:
      - name: "TypeScript Type Check"
        passed: true
        durationSecs: 0.8
      - name: "ESLint Code Quality"
        passed: true
        durationSecs: 0.9
  - name: "Testing"
    durationSecs: 15.3
    passed: true
    steps:
      - name: "Unit Tests"
        passed: true
        durationSecs: 15.3
```

### Example 4: Failed With Multiple Test Failures

<!-- validation-result:example -->
```yaml
passed: false
timestamp: "2025-10-20T16:30:00.000Z"
treeHash: "xyz789abc123def456"
failedStep: "Unit Tests"
rerunCommand: "npm test"
failedStepOutput: |
  FAIL src/auth.test.ts
  FAIL src/api.test.ts
failedTests:
  - "auth.test.ts: should validate user token"
  - "api.test.ts: should handle 401 errors"
```

## Partial Examples (Documentation Only)

These examples are for illustration and are NOT validated against the schema:

### Partial Example: Showing Specific Fields

<!-- validation-result:partial -->
```yaml
# This example shows only the fields relevant to error recovery
passed: false
failedStep: "TypeScript"
rerunCommand: "pnpm typecheck"
```

## Schema Validation

All examples tagged with `validation-result:example` are automatically validated against the JSON Schema:
- **Schema location**: `packages/core/validation-result.schema.json`
- **Validation test**: `packages/core/test/result-schema.test.ts`
- **Documentation test**: `packages/core/test/markdown-examples-validation.test.ts`

## For Agent Integration

Agents should expect ALL fields from the schema, but only these fields are guaranteed to be present:

**Required fields:**
- `passed` (boolean)
- `timestamp` (ISO 8601 string)
- `treeHash` (git tree hash string)

**Optional fields (present on failure):**
- `failedStep` (string)
- `rerunCommand` (string)
- `failedStepOutput` (string)
- `failedTests` (array of strings)
- `fullLogFile` (string)
- `summary` (string)

**Optional fields (always):**
- `phases` (array of phase results with steps)

---

# Configuration File Examples

## Validated Examples

### Example 1: Minimal Config

<!-- config:example -->
```yaml
git:
  mainBranch: main
validation:
  phases:
    - name: Testing
      steps:
        - name: Unit Tests
          command: npm test
```

### Example 2: Multi-Phase Config with Parallel Steps

<!-- config:example -->
```yaml
git:
  mainBranch: main
  remoteOrigin: origin
validation:
  phases:
    - name: Pre-Qualification
      parallel: true
      steps:
        - name: TypeScript
          command: pnpm typecheck
        - name: ESLint
          command: pnpm lint
    - name: Testing
      steps:
        - name: Unit Tests
          command: pnpm test
```

### Example 3: Fail-Fast Configuration

<!-- config:example -->
```yaml
git:
  mainBranch: develop
validation:
  failFast: true
  phases:
    - name: Quick Checks
      parallel: true
      steps:
        - name: Linter
          command: npm run lint
        - name: Type Check
          command: npm run typecheck
    - name: Tests
      steps:
        - name: Unit Tests
          command: npm test
```

## Related Documentation

- [Agent Integration Guide](./agent-integration-guide.md)
- [CLI Reference](./cli-reference.md)
- [Configuration Reference](./configuration-reference.md)
- [Validation Result Schema](../packages/core/validation-result.schema.json)
- [Config Schema](../packages/config/vibe-validate.schema.json)

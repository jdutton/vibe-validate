# Maven Checkstyle Extractor

Extracts style violations from Maven Checkstyle plugin output for LLM-friendly consumption.

## What It Does

Parses output from `mvn checkstyle:check` to extract:
- File path (relative to project root)
- Line and column numbers
- Violation message
- Checkstyle rule name
- Category (for Format 2 output)

## Supported Formats

Maven Checkstyle plugin produces TWO output formats:

### Format 1: Audit Output (WARN level)
```
[INFO] Starting audit...
[WARN] /absolute/path/src/main/java/Foo.java:10:5: Missing Javadoc comment. [JavadocVariable]
[WARN] /absolute/path/src/main/java/Bar.java:15:1: '{' should be on previous line. [LeftCurly]
Audit done.
```

### Format 2: Summary Output (WARNING level)
```
[WARNING] src/main/java/Foo.java:[10,5] (javadoc) JavadocVariable: Missing a Javadoc comment.
[WARNING] src/main/java/Bar.java:[15,1] (blocks) LeftCurly: '{' at column 1 should be on previous line.
[ERROR] You have 2 Checkstyle violations.
```

**Note:** Both formats report the same violations. This extractor automatically deduplicates them.

## Usage

### Standalone

```typescript
import mavenCheckstyleExtractor from '@vibe-validate/extractors/maven-checkstyle';

const output = `[INFO] Starting audit...
[WARN] /path/Foo.java:10:5: Missing Javadoc. [JavadocVariable]
Audit done.`;

const result = mavenCheckstyleExtractor.extract(output);

console.log(result.summary);
// => "1 Checkstyle violation(s) in 1 file(s)"

console.log(result.errors[0]);
// => { file: 'src/main/java/Foo.java', line: 10, column: 5, message: 'Missing Javadoc. [JavadocVariable]' }
```

### With vibe-validate

The extractor is automatically registered and will be selected based on output patterns.

```bash
vibe-validate run mvn checkstyle:check
```

Output:
```yaml
exitCode: 1
errors:
  - file: src/main/java/Foo.java
    line: 10
    column: 5
    message: "Missing Javadoc comment. [JavadocVariable]"
summary: "1 Checkstyle violation(s) in 1 file(s)"
guidance: "Fix Checkstyle violations. Run mvn checkstyle:check to see all details."
```

## Detection Strategy

### Phase 1: Fast Hints (string.includes only)
```typescript
hints: {
  required: ['[WARN]', '[INFO]'],  // Both must be present
  anyOf: [                          // At least one must be present
    'maven-checkstyle-plugin',
    'Starting audit',
    'Checkstyle violations'
  ]
}
```

### Phase 2: Confidence Scoring

| Pattern | Score | Notes |
|---------|-------|-------|
| `maven-checkstyle-plugin` | +40 | Plugin reference in output |
| `Starting audit` | +20 | Checkstyle audit start |
| `Audit done` | +20 | Checkstyle audit complete |
| Violation summary | +30 | "You have N Checkstyle violations" |
| Violation format | +10 | [WARN] or [WARNING] with file:line:col |

**Thresholds:**
- ≥70: High confidence (will extract)
- 40-69: Possible match
- <40: Not Checkstyle output

## Features

### Path Normalization

Converts absolute paths to relative paths for better readability:

```
Input:  /Users/jeff/workspace/project/src/main/java/com/example/Foo.java
Output: src/main/java/com/example/Foo.java
```

Uses shared `extractRelativePath()` utility from `maven-utils.ts`.

### Deduplication

Both output formats report the same violations. The extractor automatically deduplicates using:
```
key = ${file}:${line}:${column}:${rule}
```

### Error Limiting

Limits extracted errors to `MAX_ERRORS_IN_ARRAY` (default: 10) to prevent context window overflow, while still counting total violations in `totalErrors`.

### Structured Metadata

All results include:
```typescript
{
  metadata: {
    detection: {
      extractor: 'maven-checkstyle',
      confidence: 100,
      patterns: ['maven-checkstyle-plugin reference', ...],
      reason: 'Maven Checkstyle plugin output detected'
    },
    confidence: 100,
    completeness: 100,
    issues: []
  }
}
```

## Common Checkstyle Rules

This extractor handles all Checkstyle rules, including:

- **JavadocVariable** - Missing Javadoc comments
- **LeftCurly** - Brace placement
- **AvoidStarImport** - Import style (avoid `.*`)
- **MissingWhitespace** - Spacing violations
- **LineLength** - Line too long
- **MagicNumber** - Hard-coded constants
- And 200+ other built-in rules

## Integration

### With Maven

```bash
# Check style violations (fails build if violations found)
mvn checkstyle:check

# Generate report without failing build
mvn checkstyle:checkstyle
```

### With vibe-validate

Add to `vibe-validate.config.yaml`:

```yaml
steps:
  - name: style
    command: mvn checkstyle:check
    continueOnError: true
```

Then run:
```bash
vibe-validate run
```

## Plugin Architecture

This extractor follows the **ExtractorPlugin** interface:

```typescript
{
  metadata: { name, version, author, description, repository, tags },
  hints: { required, anyOf, forbidden },
  priority: 60,
  detect(output: string): DetectionResult,
  extract(output: string, command?: string): ErrorExtractorResult,
  samples: ExtractorSample[],
}
```

**Key properties:**
- **No file I/O** - Receives output as string parameter (sandboxing-safe)
- **Deterministic** - Same input always produces same output
- **Self-contained** - Includes samples for validation and testing

## Testing

```bash
# Run all tests for this extractor
pnpm test maven-checkstyle

# Run specific test
pnpm test maven-checkstyle -t "should extract errors"

# Watch mode during development
pnpm test:watch maven-checkstyle
```

## Related Extractors

- **maven-compiler** - Java compilation errors (shares `maven-utils.ts`)
- **maven-surefire** - JUnit test failures (shares `maven-utils.ts`)

## Resources

- [Maven Checkstyle Plugin](https://maven.apache.org/plugins/maven-checkstyle-plugin/)
- [Checkstyle Rules](https://checkstyle.sourceforge.io/checks.html)
- [ExtractorPlugin Interface](../../types.ts)

## License

MIT - See LICENSE file in repository root

# Maven Compiler Extractor

Extracts Java compilation errors from Maven compiler plugin output.

## Supported Formats

- Maven 3.x compiler plugin output
- `mvn compile` failures
- `mvn test-compile` failures
- Java compiler errors (javac)

## Detection Patterns

This extractor looks for:
- `[ERROR] COMPILATION ERROR :` marker (30 points)
- `maven-compiler-plugin` references (30 points)
- Error count summary `[INFO] N errors` (20 points)
- File:[line,column] format (20 points)
- Java error patterns: cannot find symbol, incompatible types, etc. (10 points)

**Detection threshold:** 70 points minimum for high confidence

## Example Output

### Input (Maven Compiler Failure)
```
[INFO] Compiling 45 source files to target/classes
[ERROR] COMPILATION ERROR :
[ERROR] /Users/dev/project/src/main/java/com/example/Foo.java:[42,25] cannot find symbol
  symbol:   method extractComponent()
  location: class com.example.RefactoringActions
[INFO] 1 error
[ERROR] Failed to execute goal org.apache.maven.plugins:maven-compiler-plugin:3.13.0:compile
```

### Extracted
```yaml
totalErrors: 1
summary: "1 compilation error(s) in 1 file(s)"
errors:
  - file: src/main/java/com/example/Foo.java
    line: 42
    column: 25
    message: |
      cannot find symbol
      symbol:   method extractComponent()
      location: class com.example.RefactoringActions
guidance: "Fix Java compilation errors. Run mvn compile to see all details."
```

## Features

### Multi-line Error Context

Collects additional context from subsequent lines:
```
[ERROR] /path/Foo.java:[42,25] cannot find symbol
  symbol:   method foo()     ← Captured
  location: class Bar        ← Captured
```

### Relative Path Extraction

Converts absolute Maven paths to relative project paths:
```
/Users/jeff/workspace/project/src/main/java/Foo.java
→ src/main/java/Foo.java
```

Uses shared utility: `packages/extractors/src/maven-utils.ts`

### Deduplication

Maven sometimes reports the same error multiple times. This extractor deduplicates based on file, line, column, and message.

## Testing

```bash
# Run all tests for this extractor
pnpm test maven-compiler

# Run specific test
pnpm test maven-compiler -t "should extract basic errors"
```

### Adding New Test Cases

1. Add sample output to `samples/` directory:
   ```bash
   echo "your-maven-output" > samples/new-case.txt
   ```

2. Add test case to `index.test.ts`:
   ```typescript
   it('should handle new-case scenario', () => {
     const output = readFileSync(join(__dirname, 'samples/new-case.txt'), 'utf-8');
     const result = mavenCompilerExtractor.extract(output);
     expect(result.totalErrors).toBe(expectedCount);
   });
   ```

3. Run tests to verify

## Contributing

Found a Maven compilation error that isn't extracted correctly?

1. **Copy your Maven output** to `samples/your-case.txt`
2. **Add a test** in `index.test.ts` demonstrating the issue
3. **Update detection/extraction logic** in `index.ts`
4. **Ensure all tests pass** (`pnpm test maven-compiler`)
5. **Submit a PR** with your improvements!

## Related Extractors

- **maven-checkstyle** - Checkstyle violations (shares maven-utils)
- **maven-surefire** - Test failures (shares maven-utils)

## Metadata

- **Name:** `maven-compiler`
- **Version:** `1.0.0`
- **Priority:** 70
- **Author:** Jeff Dutton
- **Repository:** https://github.com/jdutton/vibe-validate
- **Tags:** maven, java, compiler, javac

## Issues & Support

- **Bug reports:** https://github.com/jdutton/vibe-validate/issues
- **Documentation:** https://vibe-validate.dev/docs/extractors/maven-compiler

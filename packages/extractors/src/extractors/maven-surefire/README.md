# Maven Surefire/Failsafe Extractor

Extracts test failures from Maven Surefire and Failsafe plugin output.

## Supported Formats

- Maven 3.x Surefire plugin output
- Maven 3.x Failsafe plugin output
- JUnit 4 test failures
- JUnit 5 (Jupiter) test failures
- AssertJ assertion errors
- TestNG test failures

## Detection Patterns

This extractor looks for:
- Maven test plugin references (`maven-surefire-plugin`, `maven-failsafe-plugin`) - 40 points
- Test summary (`[ERROR] Tests run: N, Failures: N, Errors: N`) - 40 points
- Test failure markers (`<<< FAILURE!`, `<<< ERROR!`) - 20 points
- Test failure section headers - 15 points
- JUnit assertion errors (AssertionError, AssertionFailedError) - 10 points

**Detection threshold:** 70 points minimum for high confidence

## Example Output

### Input (Maven Test Failure)
```
[INFO] Running com.example.FooTest
[ERROR] Tests run: 5, Failures: 2, Errors: 1, Skipped: 0

[ERROR] com.example.FooTest.testBar -- Time elapsed: 0.123 s <<< FAILURE!
java.lang.AssertionError: Expected 5 but was 3
  at com.example.FooTest.testBar(FooTest.java:42)
  at java.base/java.lang.reflect.Method.invoke(Method.java:565)

[ERROR] com.example.FooTest.testNull -- Time elapsed: 0.01 s <<< ERROR!
java.lang.NullPointerException: Cannot invoke "String.length()" because "value" is null
  at com.example.FooTest.testNull(FooTest.java:77)
```

### Extracted
```yaml
totalErrors: 2
summary: "2 test failure(s): 1 failures, 1 errors"
errors:
  - file: FooTest.java
    line: 42
    message: |
      Test: com.example.FooTest.testBar
      java.lang.AssertionError: Expected 5 but was 3
        at com.example.FooTest.testBar(FooTest.java:42)

  - file: FooTest.java
    line: 77
    message: |
      Test: com.example.FooTest.testNull
      java.lang.NullPointerException: Cannot invoke "String.length()" because "value" is null
        at com.example.FooTest.testNull(FooTest.java:77)

guidance: "Fix test failures. Run mvn test to see full details."
```

## Features

### Multi-line Error Messages

Handles complex assertion messages spanning multiple lines:
```
java.lang.AssertionError:

Expecting actual:
  "Hello World"
to contain:
  "Goodbye"
```

### Stack Trace Extraction

Extracts file and line number from first stack frame:
```
at com.example.FooTest.testBar(FooTest.java:42)
→ file: FooTest.java, line: 42
```

### Exception Type Detection

Identifies exception types for better error classification:
- `AssertionError` - Test assertion failure
- `NullPointerException` - Null reference error
- `IllegalArgumentException` - Invalid argument
- Custom exceptions from application code

### Short Format Support

Handles abbreviated error format:
```
[ERROR] com.example.Test.testFoo:42 Expected foo but was bar
```

## Testing

```bash
# Run all tests for this extractor
pnpm test maven-surefire

# Run specific test
pnpm test maven-surefire -t "should extract NullPointerException"

# Watch mode
pnpm test:watch maven-surefire
```

### Test Coverage

- ✅ Basic JUnit assertion failures
- ✅ NullPointerException errors
- ✅ AssertJ multi-line assertions
- ✅ IllegalArgumentException
- ✅ Short error format
- ✅ Multiple test failures
- ✅ Stack trace parsing
- ✅ Exception type extraction

### Adding New Test Cases

1. Add sample output to `samples/` directory:
   ```bash
   echo "your-maven-test-output" > samples/new-case.txt
   ```

2. Add test case to `index.test.ts`:
   ```typescript
   it('should handle new-case scenario', () => {
     const output = readFileSync(join(__dirname, 'samples/new-case.txt'), 'utf-8');
     const result = mavenSurefireExtractor.extract(output);
     expect(result.totalErrors).toBe(expectedCount);
   });
   ```

3. Add to plugin samples array in `index.ts`:
   ```typescript
   {
     name: 'new-case',
     description: 'Description of what this tests',
     inputFile: './samples/new-case.txt',
     expected: { totalErrors: 1 }
   }
   ```

## Common Test Patterns

### JUnit 4
```
[ERROR] Tests run: 1, Failures: 1, Errors: 0
[ERROR] testFoo(com.example.Test)  Time elapsed: 0.05 sec  <<< FAILURE!
java.lang.AssertionError: expected:<5> but was:<3>
```

### JUnit 5 (Jupiter)
```
[ERROR] Tests run: 1, Failures: 1, Errors: 0
[ERROR] com.example.Test.testFoo -- Time elapsed: 0.05 s <<< FAILURE!
org.opentest4j.AssertionFailedError: expected: <5> but was: <3>
```

### AssertJ
```
[ERROR] Tests run: 1, Failures: 1, Errors: 0
[ERROR] com.example.Test.testFoo -- <<< FAILURE!
java.lang.AssertionError:
Expecting actual:
  "Hello"
to be equal to:
  "Goodbye"
```

### TestNG
```
[ERROR] Tests run: 1, Failures: 1, Errors: 0
[ERROR] com.example.Test.testFoo -- <<< FAILURE!
java.lang.AssertionError: expected [true] but found [false]
```

## Contributing

Found a Maven test output that isn't extracted correctly?

1. **Copy your Maven output** to `samples/your-case.txt`
2. **Add a test** in `index.test.ts` demonstrating the issue
3. **Update extraction logic** in `index.ts`
4. **Ensure all tests pass** (`pnpm test maven-surefire`)
5. **Submit a PR** with your improvements!

## Related Extractors

- **maven-compiler** - Java compilation errors
- **maven-checkstyle** - Checkstyle violations

## Metadata

- **Name:** `maven-surefire`
- **Version:** `1.0.0`
- **Priority:** 65
- **Author:** Jeff Dutton
- **Repository:** https://github.com/jdutton/vibe-validate
- **Tags:** maven, java, junit, testing, surefire, failsafe

## Issues & Support

- **Bug reports:** https://github.com/jdutton/vibe-validate/issues
- **Documentation:** https://vibe-validate.dev/docs/extractors/maven-surefire

# Ava Extractor

Extracts test failures from Ava test framework output.

## Supported Formats

- Ava v6+ test output
- Unicode symbols (✘, ›)
- file:// URL format
- Multi-line error context

## Detection Patterns

This extractor looks for:
- Ava failure marker `✘ [fail]:` (30 points)
- Test hierarchy with `›` separator (20 points)
- `file://` URL format (20 points)
- Timeout messages (10 points)

**Detection threshold:** 70 points minimum for high confidence

## Example Output

### Input (Ava Test Failure)
```
  ✘ [fail]: Extractors › should extract TypeScript errors correctly should have 5 errors

  Extractors › should extract TypeScript errors correctly

  tests/ava/test.js:28

   27:   // Expected: 1 error, but we assert 5
   28:   t.is(result.errors.length, 5, 'should have 5 errors');
   29: });

  should have 5 errors

  Difference (- actual, + expected):

  - 1
  + 5

  › file://tests/ava/test.js:28:5
```

### Extracted
```yaml
totalErrors: 1
summary: "1 test(s) failed"
errors:
  - file: tests/ava/test.js
    line: 28
    message: "should have 5 errors"
    context: "Extractors › should extract TypeScript errors correctly"
    guidance: "Review the assertion logic and expected vs actual values"
```

## Features

### Test Hierarchy Preservation

Preserves nested test structure using Ava's `›` separator:
```
Extractors › Assertion Errors › should validate correctly
```

### Error Type Detection

Automatically detects:
- **Assertion errors** - t.is(), t.deepEqual() failures
- **TypeErrors** - null/undefined property access
- **File not found (ENOENT)** - Missing files
- **Timeouts** - Test timeout exceeded
- **Import errors** - Module not found

### Multi-line Context

Extracts additional context from error objects:
```
TypeError {
  message: 'Cannot read properties of null',  ← Captured
}

TypeError: Cannot read properties of null     ← Also captured
    at file:///path/to/test.js:118:21         ← Location extracted
```

### Location Formats

Handles multiple file path formats:
- Regular: `tests/ava/test.js:28`
- file:// URL: `› file://tests/ava/test.js:28:5`
- Absolute: `file:///Users/jeff/project/tests/test.js:118:21`

## Testing

```bash
# Run all tests for this extractor
pnpm test ava

# Run specific test
pnpm test ava -t "should extract assertion errors"

# Watch mode
pnpm test:watch ava
```

### Adding New Test Cases

1. Add sample output to `samples/` directory:
   ```bash
   echo "your-ava-output" > samples/new-case.txt
   ```

2. Add test case to `index.test.ts`:
   ```typescript
   it('should handle new-case scenario', () => {
     const output = readFileSync(join(__dirname, 'samples/new-case.txt'), 'utf-8');
     const result = avaExtractor.extract(output);
     expect(result.totalErrors).toBe(expectedCount);
   });
   ```

3. Run tests to verify

## Contributing

Found an Ava test failure that isn't extracted correctly?

1. **Copy your Ava output** to `samples/your-case.txt`
2. **Add a test** in `index.test.ts` demonstrating the issue
3. **Update detection/extraction logic** in `index.ts`
4. **Ensure all tests pass** (`pnpm test ava`)
5. **Submit a PR** with your improvements!

## Metadata

- **Name:** `ava`
- **Version:** `1.0.0`
- **Priority:** 82
- **Author:** Jeff Dutton
- **Repository:** https://github.com/jdutton/vibe-validate
- **Tags:** ava, test, javascript, typescript

## Issues & Support

- **Bug reports:** https://github.com/jdutton/vibe-validate/issues
- **Documentation:** https://vibe-validate.dev/docs/extractors/ava

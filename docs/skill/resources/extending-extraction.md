# Creating Custom Extractors for vibe-validate

## Purpose
This guide helps you create custom error extractors when vibe-validate isn't capturing errors properly for your tools.

## When to Use This Guide

**You're in the right place if:**
1. Validation fails but no errors were extracted (exitCode !== 0 but totalErrors === 0)
2. Generic extractor is being used (extractor: "generic" in metadata)
3. You want to create a custom extractor for an unsupported tool
4. Errors aren't being captured properly

**Signs extraction is failing:**
```yaml
command: ./gradlew build
exitCode: 1
extraction:
  totalErrors: 0  # ❌ No errors despite failure
  metadata:
    detection:
      extractor: generic  # ❌ Fell back to generic
      confidence: 50
```

**Want to understand how extractors work first?** See [Error Extractors Guide](error-extractors-guide.md) for complete details on the extraction system.

## Quick Start: Using the CLI Tool

**CRITICAL**: vibe-validate includes a scaffolding command for creating extractors. **Always use this command first** before manually implementing:

```bash
vv create-extractor <tool-name> \
  --description "Brief description of the tool" \
  --author "User Name <email@example.com>" \
  --detection-pattern "ERROR_KEYWORD"
```

### Command Options

- `<tool-name>`: Name of the tool (e.g., `gradle`, `maven`, `webpack`)
- `--description`: What the extractor does
- `--author`: Author information
- `--detection-pattern`: Key pattern that appears in error output (e.g., "ERROR:", "FAILED:", "✖")
- `--force`: Overwrite existing plugin directory (optional)

### What Gets Generated

```
vibe-validate-plugin-<tool-name>/
├── package.json          # NPM package metadata
├── tsconfig.json         # TypeScript configuration
├── index.ts              # Plugin implementation (edit this!)
└── README.md             # Usage instructions
```

## Step-by-Step Workflow

### Step 1: Analyze Failed Output

When a user encounters extraction failure:

1. **Ask to see the actual error output**:
   ```
   "Can you show me the raw output from the failed command?
   I need to see what error patterns appear."
   ```

2. **Identify key patterns**:
   - Error markers: "ERROR:", "FAILED:", "Exception", "✖", etc.
   - File/line references: `file.ts:42:5`, `(file.ts:42)`, etc.
   - Message structure: How errors are formatted

### Step 2: Generate Plugin Scaffold

**Run the create-extractor command:**

```bash
vv create-extractor <tool-name> \
  --description "Extracts errors from <tool-name> output" \
  --author "User Name <user@example.com>" \
  --detection-pattern "<DETECTED_PATTERN>"
```

**Example:**
```bash
# For Gradle builds
vv create-extractor gradle \
  --description "Extracts compilation errors from Gradle build output" \
  --author "Jane Developer <jane@example.com>" \
  --detection-pattern "FAILURE: Build failed"
```

### Step 3: Customize the Generated Plugin

Open `vibe-validate-plugin-<tool-name>/index.ts` and customize:

#### Detection Logic

Update the `detect()` function to identify your tool's output:

```typescript
detect(output: string) {
  // Check for tool-specific markers
  const hasToolMarker = output.includes('> Task :') || output.includes('BUILD FAILED');
  const hasErrorMarker = /FAILURE: Build failed/.test(output);

  if (hasToolMarker && hasErrorMarker) {
    return {
      confidence: 95,  // High confidence = specific patterns
      hints: {
        required: ['FAILURE: Build failed'],  // Must have these
        optional: ['> Task :'],                 // Nice to have
      },
    };
  }

  return { confidence: 0, hints: { required: [], optional: [] } };
}
```

**Confidence Levels:**
- `95-100`: Very specific patterns (e.g., "TypeScript compilation error TS2322")
- `80-94`: Tool-specific but generic (e.g., "BUILD FAILED" + tool name)
- `60-79`: Generic patterns (e.g., "ERROR:" alone)
- `0-59`: Not confident, don't use this extractor

#### Extraction Logic

Update the `extract()` function to parse errors:

```typescript
extract(output: string) {
  const lines = output.split('\n');
  const errors: any[] = [];

  for (const line of lines) {
    // Example: Parse "file.ts:42:5 - error TS2322: Type mismatch"
    const match = line.match(/^(.+?):(\d+):(\d+) - error (\w+): (.+)$/);
    if (match) {
      errors.push({
        file: match[1],
        line: parseInt(match[2], 10),
        column: parseInt(match[3], 10),
        code: match[4],
        message: match[5],
      });
    }
  }

  return {
    errors,
    totalErrors: errors.length,
    summary: `${errors.length} error(s) in build`,
    guidance: 'Fix errors shown above',
    errorSummary: errors.map(e => `${e.file}:${e.line} - ${e.message}`).join('\n'),
  };
}
```

### Step 4: Build the Plugin

```bash
cd vibe-validate-plugin-<tool-name>
npm install
npm run build
```

### Step 5: Test with Real Output

**Move to the auto-discovery location:**
```bash
cd ..
mkdir -p vibe-validate-local-plugins
mv vibe-validate-plugin-<tool-name> vibe-validate-local-plugins/
```

**Run the command that was failing:**
```bash
vv run <failing-command>
```

**Check if extraction worked:**
```bash
vv state

# Look for:
# metadata:
#   detection:
#     extractor: <tool-name>  # Your plugin!
#     confidence: 95
#   errors:
#     - file: ...
#       line: ...
#       message: ...
```

### Step 6: Iterate and Refine

**If extraction isn't working:**

1. **Check detection**:
   - Is confidence high enough? (should be 60+)
   - Are the patterns matching?
   - Add debug logging to `detect()` function

2. **Check extraction**:
   - Are regex patterns matching the actual output format?
   - Test regex patterns in isolation first
   - Handle multi-line errors if needed

3. **Add more examples**:
   - Collect multiple failure samples
   - Ensure patterns match all cases

## Common Patterns

### Pattern: Line-based Errors

```typescript
// Format: "ERROR: Something went wrong at line 42"
const errorPattern = /ERROR: (.+?) at line (\d+)/;
const match = line.match(errorPattern);
if (match) {
  errors.push({
    message: match[1],
    line: parseInt(match[2], 10),
  });
}
```

### Pattern: File:Line:Column Errors

```typescript
// Format: "src/index.ts:42:5 - Type mismatch"
const errorPattern = /^(.+?):(\d+):(\d+) - (.+)$/;
const match = line.match(errorPattern);
if (match) {
  errors.push({
    file: match[1],
    line: parseInt(match[2], 10),
    column: parseInt(match[3], 10),
    message: match[4],
  });
}
```

### Pattern: Multi-line Context

```typescript
// Errors span multiple lines
let currentError: any = null;

for (const line of lines) {
  if (line.startsWith('ERROR:')) {
    if (currentError) errors.push(currentError);
    currentError = { message: line.replace('ERROR:', '').trim(), details: [] };
  } else if (currentError && line.trim()) {
    currentError.details.push(line.trim());
  }
}

if (currentError) errors.push(currentError);
```

## Plugin Discovery

**Automatic discovery locations:**
1. `vibe-validate-local-plugins/` directory (relative to project root)
2. Directories matching `vibe-validate-plugin-*` pattern in project root

**Manual registration (optional):**
```yaml
# vibe-validate.config.yaml
extractors:
  - path: ./vibe-validate-local-plugins/vibe-validate-plugin-gradle
    trust: sandbox  # Run in sandboxed environment (recommended)
```

## Security Considerations

**Sandboxing:**
- By default, plugins run in a sandboxed environment
- Limited access to Node.js APIs (no `fs`, `child_process`, network)
- Can only parse strings and return structured data

**Trust levels:**
- `sandbox` (default): Safe, limited APIs
- `trusted`: Full access (requires explicit user consent)

**Best practices:**
- Use only string operations, regex, and array/object manipulation
- Don't try to execute commands or access files
- Don't use `eval()` or `Function()` constructor

## Troubleshooting

### Plugin Not Loading

**Check:**
1. Is the plugin in the right location? (`vibe-validate-local-plugins/` or `vibe-validate-plugin-*` name)
2. Did you build it? (`npm run build` in plugin directory)
3. Is the compiled JS present? (check `dist/` directory)
4. Are there any warnings when running `vv run`? (look for plugin loading errors)

### Detection Not Working

**Debug detection:**
```typescript
detect(output: string) {
  const hasMarker = output.includes('YOUR_PATTERN');
  console.log('[DEBUG] hasMarker:', hasMarker);  // Shows in vv output
  // ... rest of detection
}
```

**Common issues:**
- Pattern is case-sensitive but output varies
- Pattern includes ANSI color codes (strip them first)
- Pattern appears in success cases too (add more specificity)

### Extraction Returning No Errors

**Debug extraction:**
```typescript
extract(output: string) {
  const lines = output.split('\n');
  console.log('[DEBUG] Total lines:', lines.length);

  for (const line of lines) {
    console.log('[DEBUG] Testing line:', line.substring(0, 100));
    // ... rest of extraction
  }
}
```

**Common issues:**
- Regex pattern doesn't match actual output format
- Output has unexpected whitespace or formatting
- Error lines are multi-line but code assumes single-line

## Testing Your Plugin

### Why Test?

Testing ensures your extractor:
- Correctly identifies tool output (detection)
- Accurately parses errors (extraction)
- Handles edge cases (empty output, malformed data)
- Maintains quality over time (regression prevention)

### Using the Test Helpers

vibe-validate provides universal test helpers to make testing consistent and simple.

**Import the helpers:**
```typescript
import { describe, it, expect } from 'vitest';
import {
  expectPluginMetadata,
  expectDetection,
  expectExtractionResult,
  expectEmptyExtraction,
  expectErrorObject,
} from '@vibe-validate/extractors/testing';

import myPlugin from './index.js';
```

### Test Helper Reference

#### 1. `expectPluginMetadata(plugin, expected)`

Verifies plugin metadata (name, priority, hints, tags).

```typescript
describe('metadata', () => {
  it('should have correct plugin metadata', () => {
    expectPluginMetadata(myPlugin, {
      name: 'my-tool',
      priority: 85,
      requiredHints: ['ERROR:', 'FAILED'],
      tags: ['build', 'compiler'],
    });
    expect(myPlugin).toBeDefined();
  });
});
```

**Parameters:**
- `name`: Plugin name (must match metadata.name)
- `priority`: Detection priority (10-100, higher = checked first)
- `requiredHints`: Patterns that must appear in output (optional)
- `tags`: Plugin tags for categorization (optional)

#### 2. `expectDetection(plugin, output, expected)`

Verifies detection logic returns correct confidence and reasoning.

```typescript
describe('detect', () => {
  it('should detect tool output with high confidence', () => {
    expectDetection(
      myPlugin,
      'ERROR: Build failed at line 42',
      {
        confidence: 90,
        patterns: ['ERROR:', 'Build failed'],
        reasonContains: 'Tool-specific error format detected',
      }
    );
    expect(myPlugin).toBeDefined();
  });

  it('should not detect non-tool output', () => {
    expectDetection(
      myPlugin,
      'Some random text',
      {
        confidence: 0,
      }
    );
    expect(myPlugin).toBeDefined();
  });
});
```

**Parameters:**
- `confidence`: Expected confidence (0-100) or `{ min: number }` for range
- `patterns`: Array of pattern descriptions (optional)
- `reasonContains`: Substring expected in detection reason (optional)

#### 3. `expectExtractionResult(result, expected)`

Verifies extraction result structure and content.

```typescript
describe('extract', () => {
  it('should extract errors from tool output', () => {
    const output = 'ERROR: Type mismatch at src/index.ts:42:5';
    const result = myPlugin.extract(output);

    expectExtractionResult(result, {
      errorCount: 1,
      summaryPattern: '1 error(s)',
    });

    expect(result.errors[0].file).toBe('src/index.ts');
  });
});
```

**Parameters:**
- `errorCount`: Expected number of errors
- `summaryPattern`: Regex or string to match against result.summary

#### 4. `expectEmptyExtraction(extractFn, expectedSummary)`

Verifies behavior when no errors are found.

```typescript
describe('extract', () => {
  it('should handle empty output', () => {
    expectEmptyExtraction(myPlugin.extract, '0 error(s)');
  });
});
```

**Parameters:**
- `extractFn`: Extract function reference
- `expectedSummary`: Expected summary for empty results

#### 5. `expectErrorObject(error, expected)`

Verifies individual error object fields.

```typescript
describe('extract', () => {
  it('should parse error details correctly', () => {
    const output = 'ERROR: Type mismatch at src/index.ts:42:5';
    const result = myPlugin.extract(output);

    expectErrorObject(result.errors[0], {
      file: 'src/index.ts',
      line: 42,
      column: 5,
      severity: 'error',
      messageContains: 'Type mismatch',
    });
  });
});
```

**Parameters:**
- `file`: Expected file path
- `line`: Expected line number
- `column`: Expected column number (optional)
- `severity`: 'error' | 'warning'
- `code`: Error code (e.g., 'TS2322') (optional)
- `messageContains`: Substring expected in error message

### Complete Test Example

```typescript
/**
 * My Tool Extractor Tests
 */
import { describe, it, expect } from 'vitest';
import {
  expectPluginMetadata,
  expectDetection,
  expectExtractionResult,
  expectEmptyExtraction,
  expectErrorObject,
} from '@vibe-validate/extractors/testing';

import myToolPlugin from './index.js';

describe('My Tool Extractor Plugin', () => {
  describe('detect', () => {
    it('should detect tool output', () => {
      expectDetection(
        myToolPlugin,
        'ERROR: Build failed',
        {
          confidence: 90,
          patterns: ['ERROR:', 'Build failed'],
          reasonContains: 'tool',
        }
      );
      expect(myToolPlugin).toBeDefined();
    });
  });

  describe('extract', () => {
    it('should extract single error', () => {
      const output = 'ERROR: Type error at src/index.ts:42:5';
      const result = myToolPlugin.extract(output);

      expectExtractionResult(result, {
        errorCount: 1,
        summaryPattern: '1 error(s)',
      });

      expectErrorObject(result.errors[0], {
        file: 'src/index.ts',
        line: 42,
        column: 5,
        severity: 'error',
        messageContains: 'Type error',
      });
    });

    it('should handle no errors', () => {
      expectEmptyExtraction(myToolPlugin.extract, '0 error(s)');
    });
  });

  describe('metadata', () => {
    it('should have correct metadata', () => {
      expectPluginMetadata(myToolPlugin, {
        name: 'my-tool',
        priority: 85,
        requiredHints: ['ERROR:'],
      });
      expect(myToolPlugin).toBeDefined();
    });
  });
});
```

### Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode
npm test -- --watch

# Run specific test file
npm test -- index.test.ts
```

## Advanced: Contributing Back

Once your plugin is working well:

1. **Prepare for contribution:**
   ```bash
   # Ensure tests are added
   npm test

   # Ensure no sensitive data in test fixtures
   # Redact any company-specific paths or identifiers
   ```

2. **Submit to vibe-validate repo:**
   - Fork the repository
   - Add plugin to `packages/extractors/src/extractors/`
   - Add tests to `packages/extractors/test/`
   - Update `extractor-registry.ts` to include in built-in list
   - Submit pull request

3. **Benefits of contributing:**
   - Other users automatically get your extractor
   - Built-in extractors are maintained and optimized
   - Community recognition

## Example Workflows

### Workflow 1: Gradle Build Failures

**Problem:** Gradle build fails but errors aren't captured

**Solution:**
```bash
# 1. Create plugin
vv create-extractor gradle \
  --description "Gradle build error extractor" \
  --author "User <user@example.com>" \
  --detection-pattern "BUILD FAILED"

# 2. Customize detection in index.ts (add "Task :" pattern)
# 3. Customize extraction (parse "error:" lines)

# 4. Build and test
cd vibe-validate-plugin-gradle
npm install && npm run build
cd ..
mv vibe-validate-plugin-gradle vibe-validate-local-plugins/

# 5. Verify
vv run ./gradlew build
vv state  # Should show extracted errors
```

### Workflow 2: Custom Internal Tool

**Problem:** Company uses proprietary build tool

**Solution:**
```bash
# 1. Capture real failure output
./company-tool build > /tmp/failure.log 2>&1

# 2. Analyze patterns in failure.log
cat /tmp/failure.log | grep -i error

# 3. Create plugin with identified pattern
vv create-extractor company-tool \
  --description "Company tool error extractor" \
  --author "Developer <dev@company.com>" \
  --detection-pattern "COMPILATION FAILURE"

# 4. Edit index.ts based on failure.log patterns
# 5. Test iteratively until all errors extracted
```

## Related Documentation

- [Error Extractors Guide](../../../docs/error-extractors-guide.md) - Comprehensive extractor documentation
- [Extractor Plugin Architecture](../../../docs/extractor-plugin-architecture.md) - Technical architecture details
- [CLI Reference](../../../docs/cli-reference.md) - Full CLI command documentation

## Quick Reference

**Create plugin:**
```bash
vv create-extractor <name> --description "..." --author "..." --detection-pattern "..."
```

**Build plugin:**
```bash
cd vibe-validate-plugin-<name> && npm run build
```

**Move to auto-discovery:**
```bash
mkdir -p vibe-validate-local-plugins
mv vibe-validate-plugin-<name> vibe-validate-local-plugins/
```

**Test:**
```bash
vv run <failing-command>
vv state  # Check extraction results
```

**Iterate:**
1. Edit `index.ts`
2. Rebuild (`npm run build`)
3. Test (`vv run ...`)
4. Repeat until errors extracted correctly

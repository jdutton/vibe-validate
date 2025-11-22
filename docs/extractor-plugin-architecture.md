# Extractor Plugin Architecture

**Status**: Approved for v0.17.0 Implementation
**Author**: Claude Code
**Date**: 2025-11-22
**Updated**: 2025-11-22 (refined based on user feedback)

## Vision

Enable users to create custom error extractors without modifying vibe-validate core code. Users should be able to:

1. **Write custom extractors locally** for proprietary tools
2. **Share extractors as npm packages** (e.g., `@mycompany/vv-extractor-gradle`)
3. **Install community extractors** from npm
4. **Use Claude Code/AI to generate extractors** using a guided skill/template

## Current State (v0.17.0-rc4)

**Registry Pattern**: All extractors defined in `extractor-registry.ts`

```typescript
export const EXTRACTOR_REGISTRY: ExtractorDescriptor[] = [
  {
    name: 'typescript',
    priority: 95,
    detect: (output: string) => ({ confidence: 95, patterns: [...], reason: '...' }),
    extract: (output: string) => ({ errors: [...], summary: '...' }),
  },
  // ... 11 more built-in extractors
];
```

**Pros**:
- Simple, type-safe
- Fast (no runtime loading)
- Easy to test

**Cons**:
- Requires forking to add extractors
- No way to add custom extractors without modifying core

---

## Plugin Architecture Options

### Option 1: Config-Based Extractor Registration (Recommended for v0.18.0)

**Concept**: Users register extractors via config file

#### vibe-validate.config.yaml
```yaml
version: 1

# Register custom extractors
extractors:
  - path: ./my-extractors/gradle-extractor.js
    priority: 90
  - package: '@mycompany/vv-extractor-custom'
    priority: 85
  - path: ./my-extractors/inline-extractor.yaml  # YAML-based extractors (simple cases)
    priority: 80

validation:
  phases:
    - name: Build
      steps:
        - name: Gradle Build
          command: ./gradlew build
          # Auto-detects using registered extractors
```

#### Custom Extractor Format (JavaScript/TypeScript)

**File**: `./my-extractors/gradle-extractor.js`

```javascript
/**
 * @type {import('@vibe-validate/extractors').ExtractorDescriptor}
 */
export default {
  name: 'gradle',
  priority: 90,

  detect(output) {
    // Pattern-based detection
    const hasGradleMarker = output.includes('> Task :');
    const hasFailureMarker = /FAILURE: Build failed/.test(output);

    if (hasGradleMarker && hasFailureMarker) {
      return {
        confidence: 95,
        patterns: ['> Task : marker', 'FAILURE: Build failed'],
        reason: 'Gradle build failure detected'
      };
    }

    return { confidence: 0, patterns: [], reason: '' };
  },

  extract(output) {
    // Parse errors from output
    const errors = [];

    // Example: Extract Gradle task failures
    const taskFailureRegex = /> Task :([\w:]+) FAILED/g;
    let match;
    while ((match = taskFailureRegex.exec(output)) !== null) {
      errors.push({
        file: match[1],
        message: `Task ${match[1]} failed`
      });
    }

    return {
      errors,
      totalErrors: errors.length,
      summary: `${errors.length} Gradle task(s) failed`,
      guidance: 'Run ./gradlew <task> --stacktrace for details',
      errorSummary: errors.map(e => e.message).join('\n')
    };
  }
};
```

#### YAML-Based Extractor (Simple Cases)

**File**: `./my-extractors/inline-extractor.yaml`

```yaml
name: my-custom-tool
priority: 80

# Pattern-based detection (no code required)
detection:
  patterns:
    - regex: "ERROR: Build failed"
      confidence: 30
    - regex: "\\[FAIL\\]"
      confidence: 40
  minimumConfidence: 70

# Error extraction rules
extraction:
  errorPattern: "^(?<file>[^:]+):(?<line>\\d+):(?<column>\\d+): (?<message>.+)$"
  summary: "{{totalErrors}} error(s) in build"
  guidance: "Fix errors shown above"
```

#### Implementation

**packages/extractors/src/plugin-loader.ts**:
```typescript
import type { ExtractorDescriptor } from './extractor-registry.js';

export interface ExtractorPlugin {
  path?: string;       // Local file path
  package?: string;    // npm package name
  priority?: number;   // Override priority
}

export async function loadExtractorPlugins(
  plugins: ExtractorPlugin[]
): Promise<ExtractorDescriptor[]> {
  const loaded: ExtractorDescriptor[] = [];

  for (const plugin of plugins) {
    try {
      let descriptor: ExtractorDescriptor;

      if (plugin.path) {
        // Load from local file (supports .js, .ts, .yaml)
        descriptor = await loadFromPath(plugin.path);
      } else if (plugin.package) {
        // Load from npm package
        descriptor = await import(plugin.package).then(m => m.default);
      } else {
        throw new Error('Plugin must specify either path or package');
      }

      // Override priority if specified
      if (plugin.priority !== undefined) {
        descriptor.priority = plugin.priority;
      }

      loaded.push(descriptor);
    } catch (error) {
      console.warn(`Failed to load extractor plugin: ${plugin.path || plugin.package}`, error);
      // Continue loading other plugins (fail-safe)
    }
  }

  return loaded;
}
```

**packages/extractors/src/smart-extractor.ts** (updated):
```typescript
import { EXTRACTOR_REGISTRY } from './extractor-registry.js';
import { loadExtractorPlugins } from './plugin-loader.js';

// Global registry includes built-in + loaded plugins
let MERGED_REGISTRY: ExtractorDescriptor[] = [...EXTRACTOR_REGISTRY];

export async function registerExtractorPlugins(plugins: ExtractorPlugin[]): Promise<void> {
  const loaded = await loadExtractorPlugins(plugins);
  MERGED_REGISTRY = [...EXTRACTOR_REGISTRY, ...loaded];
}

export function autoDetectAndExtract(input: string | ExtractorInput, exitCode?: number): ErrorExtractorResult {
  // ... use MERGED_REGISTRY instead of EXTRACTOR_REGISTRY
}
```

**Pros**:
- Simple to implement (just module loading)
- Familiar npm package model
- Supports both local and npm-distributed extractors
- Type-safe (TypeScript extractors get full IDE support)
- YAML option for simple cases (no coding required)

**Cons**:
- Requires config file changes
- Dynamic import overhead (minimal, ~1ms per plugin)

---

### Option 2: npm Package Convention (Zero-Config Plugins)

**Concept**: Auto-discover extractors from installed packages

#### Convention
Any npm package named `@vibe-validate/extractor-*` or `vv-extractor-*` is auto-discovered.

```bash
npm install @mycompany/vv-extractor-gradle
```

**vibe-validate.config.yaml** (no changes needed):
```yaml
version: 1
# Extractors auto-discovered from node_modules
validation:
  phases:
    - name: Build
      steps:
        - name: Gradle Build
          command: ./gradlew build
```

**Implementation**:
```typescript
// Auto-discover extractor packages
function discoverExtractorPackages(): string[] {
  const nodeModulesPath = path.join(process.cwd(), 'node_modules');

  // Find packages matching naming convention
  const packages = fs.readdirSync(nodeModulesPath, { withFileTypes: true })
    .filter(dirent => {
      if (dirent.isDirectory()) {
        return dirent.name.startsWith('vv-extractor-');
      }
      // Also check scoped packages
      if (dirent.isDirectory() && dirent.name.startsWith('@')) {
        // Look for @*/vv-extractor-* or @vibe-validate/extractor-*
        return true;
      }
      return false;
    })
    .map(dirent => dirent.name);

  return packages;
}
```

**Pros**:
- Zero configuration
- Natural npm workflow
- Easy discovery (npm search vv-extractor)

**Cons**:
- Requires package naming convention
- Less control over priority/ordering
- Potential security concerns (auto-loading untrusted code)

---

### Option 3: Claude Code Skill for Real-Time Extractor Generation ✅ APPROVED

**Concept**: AI-assisted extractor creation during ACTUAL validation failures

#### Real-World Workflow (The Problem)
```bash
# User runs validation
$ vv run ./gradlew build

---
command: ./gradlew build
exitCode: 1
extraction:
  totalErrors: 0  # ❌ NO ERRORS EXTRACTED despite failure!
  metadata:
    detection:
      extractor: generic  # ❌ Fell back to generic
      confidence: 50
---
```

**Current Experience**: User sees failure but no actionable errors → frustration

**With Claude Code Skill**: Claude Code detects extraction failure and offers to help

#### Interactive Fix Workflow
```
🤖 Claude Code: I notice the validation failed but no errors were extracted.
   The generic extractor couldn't parse your Gradle output.

   Would you like me to help create a Gradle extractor? (yes/no)

👤 User: yes

🤖 Claude Code: I've analyzed the REAL output from your failed build.
   I found these patterns:

   1. Build failure marker: "FAILURE: Build failed with an exception."
   2. Error location: "> Task :app:compileJava FAILED"
   3. Error details: "error: cannot find symbol"

   I'll generate an extractor that catches these patterns.

   Creating extractor...
   ✅ Created: .vibe-validate/extractors/gradle.js
   ✅ Registered in: vibe-validate.config.yaml

   Let's test it with your REAL output...

   ✅ Successfully extracted 3 errors!

   Would you like to:
   1. Save this extractor for your project
   2. Contribute it back to vibe-validate (helps the community!)
   3. Edit the extractor first

👤 User: 2

🤖 Claude Code: Great! I'll prepare a contribution...

   Before submitting:
   - Redacting any sensitive paths/data from sample output
   - Running security audit (no dangerous APIs)
   - Generating test cases

   ✅ Ready to submit PR to vibe-validate repo

   Would you like to review the changes? (yes/no)
```

#### Implementation: Claude Code Skill

**Skill Trigger**: Automatic on extraction failure
```typescript
// vibe-validate detects extraction failure
if (exitCode !== 0 && totalErrors === 0) {
  // Offer Claude Code assistance
  console.log('\n💡 Tip: Type "@Claude help me create an extractor for this output"');
}
```

**Skill Entry Point**: `@Claude create extractor`
```bash
# User can also invoke manually
@Claude create extractor for ./gradlew build

# OR: Claude Code suggests automatically
```

#### Skill Capabilities

1. **Analyze REAL output** (not sample)
   - Access actual command output from validation run
   - Identify error patterns automatically
   - Suggest confidence levels based on pattern uniqueness

2. **Generate extractor code**
   - Create working JavaScript/TypeScript extractor
   - Include comments explaining each pattern
   - Add test cases from real output

3. **Test immediately**
   - Run extractor against real output
   - Verify extraction works
   - Iterate if needed

4. **Redact sensitive data**
   - Detect paths that might contain usernames
   - Detect potential API keys/secrets in output
   - Create sanitized sample for contribution

5. **Contribute workflow**
   - Security audit (check for dangerous APIs)
   - Generate PR with tests
   - Submit to vibe-validate repo

#### User Experience Goals

**Before Plugin Architecture**:
```
❌ Validation fails
❌ No errors shown
❌ User must read raw logs
❌ User frustrated
```

**With Claude Code Skill**:
```
✅ Validation fails
✅ Claude Code offers to help
✅ Extractor created in 30 seconds
✅ Errors now visible
✅ User can optionally contribute back
✅ Next user gets extractor built-in
```

#### Privacy & Security

**Data Handling**:
- ✅ Real output stays local (never sent to Anthropic)
- ✅ Claude Code runs in your environment
- ✅ User controls what gets contributed
- ✅ Redaction tool for sensitive paths/data
- ✅ User reviews before PR submission

**Security Audit**:
- Claude Code automatically checks for:
  - Dangerous API usage (exec, fs.write, etc.)
  - Regex DoS vulnerabilities (excessive backtracking)
  - Injection risks
- Warns user if issues found
- Suggests fixes automatically

#### Skill Implementation

**packages/claude-code-skills/extractor-builder/skill.yaml**:
```yaml
name: extractor-builder
description: Interactive tool to build custom vibe-validate extractors
version: 1.0.0

prompts:
  - step: 1
    message: |
      I'll help you build a custom error extractor for vibe-validate.

      Please provide:
      1. Tool name (e.g., "gradle", "maven", "webpack")
      2. Sample error output (paste the raw output from a failed build)

  - step: 2
    message: |
      Analyzing your output...

      I've identified the following patterns:
      {{detected_patterns}}

      Does this look correct? (yes/no)

  - step: 3
    message: |
      Generating extractor code...

      ```javascript
      {{generated_code}}
      ```

      Where would you like to save this?
      1. Local file (./my-extractors/{{tool_name}}-extractor.js)
      2. Create npm package (@mycompany/vv-extractor-{{tool_name}})
      3. Test first
```

#### Generated Extractor Template
```javascript
// Generated by Claude Code Extractor Builder Skill
export default {
  name: '{{tool_name}}',
  priority: {{suggested_priority}},

  detect(output) {
    // Auto-generated detection logic
    {{detection_code}}
  },

  extract(output) {
    // Auto-generated extraction logic
    {{extraction_code}}
  }
};
```

**Pros**:
- Extremely user-friendly
- No need to understand extractor API
- Claude Code generates optimal regex/parsing logic
- Instant testing and iteration

**Cons**:
- Requires Claude Code integration
- Still needs Option 1 or 2 for registration

---

## Approved Implementation Path

### Phase 1: v0.17.0 (Foundation) ✅ APPROVED
**Goal**: Enable custom extractors via config with sandboxing

1. Implement Option 1 (Config-Based Registration)
2. Support `.js`/`.ts` extractors
3. Document extractor API
4. Provide starter templates

**Deliverables**:
- `packages/extractors/src/plugin-loader.ts`
- `docs/building-custom-extractors.md`
- `examples/custom-extractors/` directory with templates
- Tests for plugin loading

### Phase 2: v0.19.0 (Simplification)
**Goal**: Make extractor creation easier

1. Add YAML-based extractor support (for simple cases)
2. Implement Option 2 (npm package auto-discovery)
3. Create extractor generator CLI tool

**Deliverables**:
- `vibe-validate create-extractor <name>` command
- YAML extractor parser
- Auto-discovery of npm packages

### Phase 3: v0.20.0 (AI-Assisted)
**Goal**: AI-powered extractor generation

1. Implement Option 3 (Claude Code Skill)
2. Train on extractor patterns
3. One-shot extractor generation from sample output

**Deliverables**:
- Claude Code skill for extractor generation
- Extractor marketplace/registry (website)
- Community contributions

---

## Extractor API Specification

### ExtractorDescriptor (Current)
```typescript
export interface ExtractorDescriptor {
  /** Unique name identifying this extractor */
  name: string;

  /** Detection function that analyzes output and returns confidence */
  detect: (output: string) => DetectionResult;

  /** Extraction function that parses errors from output */
  extract: (output: string) => ErrorExtractorResult;

  /** Priority for detection order (higher = check first) */
  priority: number;
}

export interface DetectionResult {
  confidence: number;      // 0-100
  patterns: string[];      // Matched patterns (for debugging)
  reason: string;          // Human-readable explanation
}

export interface ErrorExtractorResult {
  errors: FormattedError[];
  totalErrors: number;
  summary: string;
  guidance: string;
  errorSummary: string;
  metadata?: ExtractionMetadata;
}
```

### Future: ExtractorDescriptor v2 (with hooks)
```typescript
export interface ExtractorDescriptorV2 {
  name: string;
  priority: number;

  // Core functions
  detect: (output: string) => DetectionResult;
  extract: (output: string) => ErrorExtractorResult;

  // Optional hooks
  hooks?: {
    beforeDetect?: (output: string) => string;  // Preprocess output
    afterExtract?: (result: ErrorExtractorResult) => ErrorExtractorResult;  // Post-process result
    onError?: (error: Error) => void;  // Handle extraction errors
  };

  // Metadata
  metadata?: {
    author?: string;
    version?: string;
    repository?: string;
    documentation?: string;
  };
}
```

---

## Example Use Cases

### Use Case 1: Proprietary Build Tool
**Scenario**: Company uses custom build tool not supported by vibe-validate

**Solution**:
```bash
# Create extractor
mkdir -p .vibe-validate/extractors
cat > .vibe-validate/extractors/custom-tool.js <<EOF
export default {
  name: 'custom-tool',
  priority: 90,
  detect(output) { /* ... */ },
  extract(output) { /* ... */ }
};
EOF

# Register in config
cat >> vibe-validate.config.yaml <<EOF
extractors:
  - path: ./.vibe-validate/extractors/custom-tool.js
EOF
```

### Use Case 2: Shared Team Extractor
**Scenario**: Team wants to share Gradle extractor across projects

**Solution**:
```bash
# Publish to private npm registry
npm publish @mycompany/vv-extractor-gradle

# Install in projects
npm install @mycompany/vv-extractor-gradle

# Register in config
cat >> vibe-validate.config.yaml <<EOF
extractors:
  - package: '@mycompany/vv-extractor-gradle'
EOF
```

### Use Case 3: Community Contribution
**Scenario**: Developer wants to contribute Bazel extractor

**Solution**:
```bash
# Create npm package
npm init @vibe-validate/extractor-bazel
cd vibe-validate-extractor-bazel

# Implement extractor
# ... (using template from examples/)

# Publish to npm
npm publish

# Users can now install
npm install @vibe-validate/extractor-bazel
```

---

## Security Considerations (CRITICAL FOR v0.17.0)

### 1. Sandboxing Strategy ✅ REQUIRED

**Problem**: Plugins execute arbitrary JavaScript that could:
- Execute shell commands (`execSync`, `spawn`)
- Access file system (`fs.writeFile`, `fs.unlink`)
- Make network requests (`fetch`, `https.get`)
- Access environment variables (`process.env.SECRET_KEY`)

**Solution**: Use `vm2` or `isolated-vm` for sandboxed execution

#### Implementation with vm2
```typescript
import { VM } from 'vm2';

function executeSandboxedExtractor(extractorCode: string, output: string) {
  const vm = new VM({
    timeout: 5000,  // 5 second timeout
    sandbox: {
      // Only provide safe APIs
      console: {
        log: (...args) => logger.debug('[extractor]', ...args),
        warn: (...args) => logger.warn('[extractor]', ...args),
        error: (...args) => logger.error('[extractor]', ...args),
      },
      // Provide output to analyze
      output,
    },
    // CRITICAL: Block dangerous Node.js APIs
    require: {
      external: false,  // Cannot require external modules
      builtin: [],      // Cannot access built-in modules (fs, child_process, etc)
    },
  });

  // Execute extractor in sandbox
  return vm.run(extractorCode);
}
```

#### Blocked APIs (SonarQube Compliant)
- ❌ `child_process.exec` / `execSync` / `spawn`
- ❌ `fs.writeFile` / `fs.unlink` / `fs.rmdir`
- ❌ `net` / `http` / `https` (network access)
- ❌ `process.exit()` / `process.kill()`
- ❌ `eval()` / `Function()` constructor
- ❌ Dynamic `require()` / `import()`

#### Allowed APIs
- ✅ String manipulation (`.slice()`, `.split()`, `.match()`)
- ✅ Regex (pattern matching only)
- ✅ Array/Object operations
- ✅ Math operations
- ✅ Read-only output analysis
- ✅ `console.log` (redirected to vibe-validate logger)

### 2. YAML Extractors (Zero Code Execution)

For simple regex-based extractors, YAML requires no sandboxing:

```yaml
# No JavaScript execution = inherently safe
name: my-tool
detection:
  patterns:
    - regex: "ERROR:"
      confidence: 50
```

**Built-in extractors that COULD be YAML**:
- ✅ **Generic extractor** - Just regex for error lines
- ⚠️ **TypeScript** - Could work but complex parsing
- ⚠️ **ESLint** - Relies on JSON parsing + complex logic
- ❌ **Maven extractors** - Too complex (multi-line context)
- ❌ **Test frameworks** - Need state machines

**Recommendation**: Start with generic-style YAML extractors, expand later

### 3. Plugin Trust Levels

```yaml
extractors:
  - path: ./my-extractor.js
    trust: sandbox  # Default: Run in VM sandbox

  - path: ./trusted-extractor.js
    trust: full     # Requires explicit user consent (prompt on first run)

  - package: '@vibe-validate/extractor-official'
    trust: builtin  # Official extractors bypass sandbox
```

### 4. Contribution Workflow (Built-in Distribution)

**Goal**: Make it easy to contribute plugins back to core

#### Step 1: User Creates Plugin Locally
```bash
# User writes extractor while fixing real issue
vv create-extractor gradle

# Claude Code guides creation with REAL output
# User tests with actual failure case
vv run ./gradlew build  # Fails, extractor catches it
```

#### Step 2: User Submits to vibe-validate
```bash
# Automated contribution workflow
vv contribute-extractor ./my-extractors/gradle.js

# This:
# 1. Runs extractor through security audit
# 2. Converts to official format
# 3. Generates PR description with sample output
# 4. Creates pull request to vibe-validate repo
```

#### Step 3: Maintainer Review
```bash
# PR includes:
# - Extractor code (audited for dangerous APIs)
# - Test cases (from user's real output)
# - Documentation (auto-generated)

# After merge: Ships in next vibe-validate release as built-in
```

#### Migration Path
```yaml
# User config BEFORE contribution
extractors:
  - path: ./my-extractors/gradle.js

# After accepted into core (next vibe-validate version)
# User removes local extractor (now built-in)
# No config changes needed!
```

### 5. Security Audit Checklist

Before accepting contributed extractors:
- [ ] No `require()` of dangerous modules
- [ ] No `eval()` or `Function()` constructor
- [ ] No file system access
- [ ] No network access
- [ ] No process execution
- [ ] No environment variable access
- [ ] SonarQube scan passes (0 security issues)
- [ ] Unit tests cover edge cases
- [ ] Sample output redacted (no secrets)

---

## Documentation Requirements

### For Users
1. **Building Custom Extractors Guide**
   - Extractor API reference
   - Step-by-step tutorial
   - Example extractors (5+ tools)
   - Testing strategies

2. **Extractor Marketplace**
   - Browse community extractors
   - Installation instructions
   - Quality ratings / reviews

### For Contributors
1. **Extractor Development Guide**
   - TypeScript template
   - Testing framework
   - Publishing to npm
   - CI/CD setup

2. **Claude Code Skill Usage**
   - How to use extractor-builder skill
   - Best practices for sample output
   - Iterating on generated extractors

---

## Next Steps

1. **Implement Phase 1** (v0.18.0):
   - [ ] Create plugin-loader.ts
   - [ ] Update smart-extractor.ts to use merged registry
   - [ ] Add config schema for extractors
   - [ ] Write documentation
   - [ ] Create example extractors

2. **Community Feedback**:
   - [ ] Share design with users
   - [ ] Gather use cases
   - [ ] Refine API based on feedback

3. **Pilot Program**:
   - [ ] Build 3-5 community extractors
   - [ ] Document pain points
   - [ ] Iterate on API

Would you like me to proceed with implementing Phase 1?

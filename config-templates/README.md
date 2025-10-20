# vibe-validate Configuration Templates

Ready-to-use YAML configuration templates optimized for specific frameworks and project types.

## What are Config Templates?

Configuration templates are battle-tested configs that provide:

- **Sensible defaults** - Pre-configured validation phases and steps
- **Performance optimization** - Parallel execution where possible
- **Fail-fast ordering** - Fast checks run first
- **Framework-specific tools** - TypeScript, ESLint, test runners, etc.
- **Easy customization** - Edit YAML directly to fit your needs

**Benefits:**
- ⚡ **Fast setup** - Copy and customize in seconds
- 🎯 **Best practices** - Based on real-world usage patterns
- 📝 **Transparent** - Everything visible in YAML (no hidden defaults)
- 🔍 **Discoverable** - Browse templates on GitHub
- 🤝 **Contributable** - Anyone can submit template PRs (no TypeScript knowledge needed)

## Available Templates

### [minimal.yaml](./minimal.yaml)
**For:** Custom projects, starting from scratch

**Validation phases:**
1. Quick Check: Lint + tests

**Use when:**
- Building non-TypeScript projects (Python, Rust, Go, etc.)
- Need complete control over validation phases
- Learning the configuration format
- Experimenting with custom workflows

---

### [typescript-library.yaml](./typescript-library.yaml)
**For:** TypeScript libraries, npm packages, shared components

**Validation phases:**
1. Pre-Qualification (parallel): TypeScript compilation, ESLint
2. Build & Test: Unit tests, then build

**Use when:**
- Publishing to npm
- Building reusable libraries
- Creating shared components

---

### [typescript-nodejs.yaml](./typescript-nodejs.yaml)
**For:** Node.js applications, backend services, APIs, CLI tools

**Validation phases:**
1. Pre-Qualification (parallel): TypeScript compilation, ESLint
2. Testing (parallel): Unit tests, integration tests
3. Build: Application build

**Use when:**
- Building REST APIs
- Creating Express/Fastify applications
- Developing backend microservices
- Building CLI tools
- Creating serverless functions

---

### [typescript-react.yaml](./typescript-react.yaml)
**For:** React applications, SPAs, Next.js apps

**Validation phases:**
1. Pre-Qualification (parallel): TypeScript compilation, ESLint
2. Testing: Unit tests with coverage
3. Build: Application build

**Use when:**
- Building React SPAs
- Creating Next.js applications
- Developing React Native apps
- Building frontend applications

---

## Using These Templates

You can use these templates by copying them directly from this directory. In the future, `vibe-validate init` will support interactive template selection.

### Option 1: Download with curl

```bash
# Choose a template and download
curl -o vibe-validate.config.yaml \
  https://raw.githubusercontent.com/jdutton/vibe-validate/main/config-templates/typescript-nodejs.yaml
```

### Option 2: Manual Copy

1. Browse templates: [`config-templates/`](https://github.com/jdutton/vibe-validate/tree/main/config-templates)
2. Open the template that fits your project
3. Click "Raw" button
4. Copy the content
5. Create `vibe-validate.config.yaml` in your project root
6. Paste the content

### Option 3: Clone and Copy

```bash
# Clone vibe-validate repo
git clone https://github.com/jdutton/vibe-validate.git

# Copy template to your project
cp vibe-validate/config-templates/typescript-nodejs.yaml \
   /path/to/your/project/vibe-validate.config.yaml

# Clean up
rm -rf vibe-validate
```

---

## Customizing Templates

All templates can be customized to match your project needs:

### Change Commands

Update step commands to match your package.json scripts:

```yaml
steps:
  - name: Tests
    command: pnpm test  # Change from: npm test
```

### Add New Steps

Add additional validation steps to any phase:

```yaml
steps:
  - name: TypeScript
    command: tsc --noEmit
  - name: ESLint
    command: eslint src/
  - name: Prettier       # ← Add this
    command: prettier --check .
```

### Add New Phases

Add entirely new validation phases:

```yaml
phases:
  - name: Pre-Qualification
    # ... existing steps

  - name: Security        # ← Add this phase
    parallel: false
    steps:
      - name: Audit
        command: npm audit --production
```

### Adjust Parallelization

```yaml
validation:
  phases:
    - name: Testing
      parallel: false  # Changed from 'true' - run sequentially
      steps:
        - name: Unit Tests
          command: npm run test:unit
        - name: Integration Tests
          command: npm run test:integration
```

### Override Git Settings

```yaml
git:
  mainBranch: develop  # Changed from 'main'
  autoSync: true       # Changed from 'false'
```

---

## Template Best Practices

### 1. Start with a Template

**Don't start from scratch** - Choose the template closest to your project type and customize it.

### 2. Keep Commands Simple

**Good:**
```yaml
- name: Tests
  command: npm test
```

**Avoid:**
```yaml
- name: Tests
  command: npm test && npm run coverage && npm run report
```

**Why:** Separate concerns into individual steps for:
- Better failure isolation
- Clearer error messages
- Easier debugging
- More granular caching

### 3. Order Steps by Speed

**Fast checks first:**
```yaml
steps:
  - name: Lint (2s)
    command: npm run lint
  - name: Type Check (5s)
    command: tsc --noEmit
  - name: Tests (30s)
    command: npm test
  - name: Build (45s)
    command: npm run build
```

**Why:** Fail-fast principle - catch errors early, save time.

### 4. Use Parallel Execution Wisely

**Parallelize when steps are independent:**
```yaml
- name: Pre-Qualification
  parallel: true  # ✅ These can run at the same time
  steps:
    - name: TypeScript
      command: tsc --noEmit
    - name: ESLint
      command: eslint .
```

**Sequential when steps depend on each other:**
```yaml
- name: Build & Deploy
  parallel: false  # ✅ Build must finish before deploy
  steps:
    - name: Build
      command: npm run build
    - name: Deploy
      command: npm run deploy
```

### 5. Keep Phases Focused

**Good:**
```yaml
validation:
  phases:
    - name: Code Quality
      steps: [lint, typecheck]
    - name: Testing
      steps: [unit tests, integration tests]
    - name: Build
      steps: [build]
```

**Avoid:**
```yaml
validation:
  phases:
    - name: Everything
      steps: [lint, typecheck, test, build, deploy, cleanup]
```

**Why:** Focused phases make:
- Failures easier to diagnose
- Logs easier to read
- Caching more granular

### 6. Document Custom Commands

If your project uses non-standard commands, add comments:

```yaml
steps:
  - name: Custom Validation
    command: ./scripts/validate-schemas.sh  # Validates JSON schemas in /config
```

### 7. Test Your Config

After customizing a template:

```bash
# Validate config syntax
vibe-validate config --validate

# Run validation once
vibe-validate validate

# Check results
vibe-validate state
```

---

## Validation

All templates in this directory are:

✅ **Valid YAML** - Syntax checked
✅ **Schema compliant** - Validated against JSON Schema
✅ **Tested** - Used in CI/CD tests
✅ **Documented** - Include helpful comments

---

## Related Documentation

- [Getting Started Guide](../docs/getting-started.md)
- [Configuration Reference](../docs/configuration-reference.md)
- [CLI Reference](../docs/cli-reference.md)

---

## Contributing

When adding new templates:

1. Follow existing naming convention: `{framework}-{type}.yaml`
2. Include header comment explaining the template's purpose
3. Add comprehensive inline comments
4. Update this README with template description
5. Add tests to verify template validity
6. Ensure JSON Schema URL is correct

**Template checklist:**
- [ ] Valid YAML syntax
- [ ] Includes `$schema` URL
- [ ] Has descriptive header comment
- [ ] Includes inline comments explaining phases
- [ ] Lists required npm scripts (if applicable)
- [ ] Added to this README
- [ ] Tested with `vibe-validate config --validate`

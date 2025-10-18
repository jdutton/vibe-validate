# Contributing to vibe-validate

Thank you for your interest in contributing to vibe-validate! This document provides guidelines and instructions for contributors.

## Table of Contents

- [Development Setup](#development-setup)
- [Project Structure](#project-structure)
- [Development Workflow](#development-workflow)
- [Testing](#testing)
- [Linking to Test Projects](#linking-to-test-projects)
- [Code Quality Standards](#code-quality-standards)
- [Submitting Changes](#submitting-changes)

## Development Setup

### Prerequisites

- **Node.js**: 20.0.0 or higher
- **pnpm**: 9.0.0 or higher
- **Git**: For version control

### Initial Setup

```bash
# Clone the repository
git clone https://github.com/jdutton/vibe-validate.git
cd vibe-validate

# Install dependencies
pnpm install

# Build all packages
pnpm -r build

# Run tests to verify setup
pnpm test
```

### Verify Installation

```bash
# Should show 243 tests passing with 92.6% coverage
pnpm test

# Should show all packages building successfully
pnpm -r build

# Should show all packages type-checking cleanly
pnpm -r typecheck
```

## Project Structure

```
vibe-validate/
├── packages/
│   ├── cli/           # Command-line interface
│   ├── config/        # Configuration system
│   ├── core/          # Validation runner engine
│   ├── formatters/    # Error formatters
│   └── git/           # Git operations
├── docs/              # Documentation
├── CONTRIBUTING.md    # This file
├── README.md          # User documentation
└── pnpm-workspace.yaml
```

### Package Dependencies

```
@vibe-validate/cli
  └── @vibe-validate/core
  └── @vibe-validate/config
  └── @vibe-validate/git
  └── @vibe-validate/formatters

@vibe-validate/core
  └── @vibe-validate/git
  └── @vibe-validate/formatters

@vibe-validate/config (standalone)
@vibe-validate/formatters (standalone)
@vibe-validate/git (standalone)
```

## Development Workflow

### Making Changes

1. **Create a feature branch**

```bash
git checkout -b feature/your-feature-name
```

2. **Make your changes**

Follow [Code Quality Standards](#code-quality-standards) below.

3. **Run validation**

```bash
# vibe-validate validates itself!
pnpm validate
```

4. **Commit your changes**

```bash
git add .
git commit -m "feat: description of your changes"
```

### Self-Hosting Validation

vibe-validate uses itself for validation! The `pnpm validate` command runs:

- **Phase 1**: Type checking, linting, unit tests, build (parallel)
- **Phase 2**: Coverage verification

Configuration: `vibe-validate.config.ts`

### Incremental Development

```bash
# Watch mode for a specific package
cd packages/core
pnpm test -- --watch

# Build specific package
pnpm build

# Run validation after changes
cd ../..
pnpm validate
```

## Testing

### Test Structure

- `packages/*/test/` - Unit and integration tests
- Coverage target: **80% minimum**, **90% preferred**
- Test framework: **Vitest** (fast, TypeScript-native)

### Running Tests

```bash
# All tests
pnpm test

# With coverage
pnpm test:coverage

# Specific package
cd packages/core
pnpm test

# Watch mode
pnpm test -- --watch

# Specific test file
pnpm test -- tree-hash.test.ts
```

### Writing Tests

Follow Test-Driven Development (TDD):

1. **Write failing test**
2. **Implement feature**
3. **Verify test passes**
4. **Refactor while keeping tests green**

Example:

```typescript
import { describe, it, expect } from 'vitest';
import { yourFunction } from '../src/your-module.js';

describe('yourFunction', () => {
  it('should handle the happy path', () => {
    expect(yourFunction('input')).toBe('expected output');
  });

  it('should handle edge cases', () => {
    expect(() => yourFunction(null)).toThrow('Invalid input');
  });
});
```

## Linking to Test Projects

### Local Development Testing

When developing vibe-validate features, you'll want to test them with real projects.

#### Option 1: Using `file:` Protocol (Recommended for Active Development)

```bash
# In your test project
cd /path/to/test-project

# Install vibe-validate from local workspace
pnpm add -D file:../vibe-validate/packages/cli

# Test your changes
pnpm validate
```

**Rebuild when making changes:**

```bash
# In vibe-validate workspace
cd /path/to/vibe-validate
pnpm -r build

# In test project - changes are now available
cd /path/to/test-project
pnpm validate
```

#### Option 2: Using `pnpm link` (For Multiple Test Projects)

```bash
# In vibe-validate workspace
cd /path/to/vibe-validate/packages/cli
pnpm link --global

# In test project
cd /path/to/test-project
pnpm link --global @vibe-validate/cli

# Test your changes
pnpm validate

# Unlink when done
pnpm unlink --global @vibe-validate/cli
```

#### Option 3: Using `workspace:*` Protocol (Monorepo-Style)

If your test project is in the same parent directory:

```json
// test-project/package.json
{
  "devDependencies": {
    "@vibe-validate/cli": "workspace:*"
  }
}
```

pnpm will automatically resolve to the local workspace.

### Testing Workflow

1. **Make changes** to vibe-validate
2. **Build packages**: `pnpm -r build`
3. **Test locally**: Use linked project to verify changes
4. **Run validation**: Ensure vibe-validate validates itself
5. **Run tests**: Verify test coverage maintained

For detailed setup instructions, see [docs/local-development.md](docs/local-development.md).

## Code Quality Standards

### Pre-Commit Checklist

Before committing, ensure:

- ✅ **All tests pass**: `pnpm test`
- ✅ **ESLint clean**: `pnpm lint` (0 errors, 0 warnings)
- ✅ **TypeScript compiles**: `pnpm typecheck`
- ✅ **Coverage maintained**: `pnpm test:coverage` (80%+ overall)
- ✅ **Builds successfully**: `pnpm -r build`
- ✅ **Validation passes**: `pnpm validate`

### ESLint Zero-Tolerance Policy

- **0 errors allowed** - ESLint must always run clean
- **0 warnings allowed** - No warnings tolerated
- Fix ESLint issues immediately

### TypeScript Standards

- **Strict mode enabled** - No `any` types without justification
- **Full type coverage** - Export all public types
- **No type assertions** - Prefer type guards

### Test Coverage Requirements

- **Minimum**: 80% overall coverage
- **Target**: 90%+ for core packages
- **Critical paths**: 100% coverage for:
  - Git tree hash calculation
  - Config validation
  - Process cleanup
  - Error formatters

## Submitting Changes

### Pull Request Process

1. **Ensure all quality checks pass**

```bash
pnpm validate  # Must pass before creating PR
```

2. **Update documentation**

- Update README.md if adding features
- Update package README.md if changing APIs
- Add/update tests for all changes

3. **Create pull request**

- Use clear, descriptive title
- Reference any related issues
- Describe what changed and why
- Include testing approach

4. **PR template** (include in description):

```markdown
## Summary
Brief description of changes

## Changes
- Bullet list of changes

## Testing
How were these changes tested?

## Coverage
- Test coverage maintained at X%
- All quality checks passing

## Breaking Changes
List any breaking changes (or "None")
```

### Commit Message Format

Follow conventional commits:

```
feat: add new feature
fix: resolve bug
docs: update documentation
test: add tests
refactor: restructure code
chore: update dependencies
```

### Review Process

1. Automated checks run on PR
2. Maintainer reviews code
3. Address feedback if needed
4. Maintainer merges when approved

## Release Process

(For maintainers)

1. Update version in all package.json files
2. Update CHANGELOG.md
3. Run full validation: `pnpm validate`
4. Tag release: `git tag v1.0.0`
5. Push to GitHub: `git push origin main --tags`
6. Publish to npm: `pnpm -r publish`

## Getting Help

- **Issues**: [GitHub Issues](https://github.com/jdutton/vibe-validate/issues)
- **Discussions**: [GitHub Discussions](https://github.com/jdutton/vibe-validate/discussions)
- **Documentation**: [docs/](docs/)

## License

By contributing to vibe-validate, you agree that your contributions will be licensed under the MIT License.

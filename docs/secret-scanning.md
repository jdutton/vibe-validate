# Secret Scanning

Prevent accidental credential commits with pre-commit secret scanning in vibe-validate.

## Overview

Secret scanning detects API keys, tokens, passwords, and other credentials **before they enter git history**. Once a secret is committed and pushed, it's already compromised and must be rotated - regardless of how quickly it's detected.

**Prevention is the only effective solution.** vibe-validate integrates secret scanning into the pre-commit workflow to catch secrets at the earliest possible point.

## Why Pre-commit Only?

GitHub and other platforms already provide post-push secret scanning. By the time these systems detect a secret, it's too late - the secret has already been exposed in your git history.

vibe-validate focuses on **prevention**, not detection after the fact.

## Quick Start

### 1. Install a Secret Scanner

**Recommended: Gitleaks** (fast, free, 160+ secret types)

```bash
# macOS
brew install gitleaks

# Docker
docker pull zricethezav/gitleaks

# Linux (binary download)
wget https://github.com/gitleaks/gitleaks/releases/latest/download/gitleaks-linux-amd64
chmod +x gitleaks-linux-amd64
sudo mv gitleaks-linux-amd64 /usr/local/bin/gitleaks

# Windows (Scoop)
scoop install gitleaks

# Windows (Chocolatey)
choco install gitleaks
```

### 2. Configure vibe-validate

Secret scanning is **enabled by default** in all config templates:

```yaml
# vibe-validate.config.yaml
hooks:
  preCommit:
    enabled: true
    secretScanning:
      enabled: true
      scanCommand: "gitleaks protect --staged --verbose"
```

### 3. Test It

Try committing a file with a fake secret:

```bash
echo "AWS_SECRET_KEY=AKIAIOSFODNN7EXAMPLE" > test.txt
git add test.txt
git commit -m "test"  # This will be blocked!
```

## Configuration

### Using Gitleaks (Recommended)

```yaml
hooks:
  preCommit:
    secretScanning:
      enabled: true
      scanCommand: "gitleaks protect --staged --verbose"
```

**Why Gitleaks?**
- ⚡ Extremely fast (Go-based, sub-second scans)
- 🆓 100% free (MIT license)
- 🎯 160+ secret types detected
- 🛠️ Excellent false positive management

### Alternative Tools

**detect-secrets** (Python-based, fewer false positives):
```yaml
hooks:
  preCommit:
    secretScanning:
      enabled: true
      scanCommand: "detect-secrets scan --staged"
```

**Semgrep** (semantic analysis, validates active secrets):
```yaml
hooks:
  preCommit:
    secretScanning:
      enabled: true
      scanCommand: "semgrep scan --config auto --secrets"
```

### Disabling Secret Scanning

```yaml
hooks:
  preCommit:
    secretScanning:
      enabled: false
```

## Managing False Positives

### Option 1: .gitleaksignore File

Create `.gitleaksignore` in your project root with secret fingerprints:

```
# .gitleaksignore
# Format: <fingerprint>:<reason>

8e94f38f9b8f4e3d2c1a0f6e5d4c3b2a1:Test sample - not a real secret
7d83e27e8a7d3c2b1a0f9e8d7c6b5a4:Example in documentation
```

To get fingerprints, run gitleaks and check the JSON output:

```bash
gitleaks protect --staged --report-format json --report-path gitleaks-report.json
```

### Option 2: Inline Comments

Add `gitleaks:allow` to the line with the false positive:

```typescript
const EXAMPLE_KEY = "not-a-real-secret"; // gitleaks:allow
```

### Option 3: Baseline for Legacy Repos

If you have an existing codebase with many legacy secrets:

1. Generate a baseline:
```bash
gitleaks detect --report-path .gitleaks-baseline.json
```

2. Use baseline in scans:
```yaml
hooks:
  preCommit:
    secretScanning:
      scanCommand: "gitleaks protect --staged --baseline-path .gitleaks-baseline.json"
```

This ignores existing secrets while catching new ones.

### Option 4: Custom Configuration

Create `.gitleaks.toml` to customize detection rules:

```toml
# .gitleaks.toml
title = "My Project Gitleaks Config"

[allowlist]
description = "Global allowlist"
paths = [
    '''tests/samples/.*''',
    '''docs/examples/.*'''
]

[[rules]]
id = "custom-api-key"
description = "My Custom API Key"
regex = '''my-api-[a-zA-Z0-9]{32}'''
```

## Doctor Check

vibe-validate doctor verifies secret scanning is configured correctly:

```bash
npx vibe-validate doctor
```

**Output examples:**

✅ **Tool installed:**
```
✅ Pre-commit secret scanning
   Secret scanning enabled with gitleaks v8.18.0
```

⚠️ **Tool missing:**
```
⚠️  Pre-commit secret scanning
   Secret scanning enabled but 'gitleaks' not found
   💡 Install: brew install gitleaks
   💡 Or disable: set hooks.preCommit.secretScanning.enabled=false
```

ℹ️ **Disabled:**
```
ℹ️  Pre-commit secret scanning
   Secret scanning disabled in config (user preference)
```

## Troubleshooting

### "Command not found: gitleaks"

**Problem**: Gitleaks not installed or not in PATH

**Solutions**:
1. Install gitleaks: `brew install gitleaks`
2. Verify installation: `gitleaks version`
3. Temporarily disable: Set `enabled: false` in config

### "Too many false positives"

**Problem**: Gitleaks flags test samples or documentation examples

**Solutions**:
1. Use `.gitleaksignore` with fingerprints (recommended)
2. Add inline `gitleaks:allow` comments
3. Create custom `.gitleaks.toml` to ignore specific paths
4. Use baseline for legacy codebases

### "I need to commit test data with fake secrets"

**Problem**: Test samples contain example secrets

**Solutions**:
1. **Best**: Use `.gitleaksignore` with fingerprints
2. **Good**: Add `gitleaks:allow` comments to each line
3. **Acceptable**: Exclude test paths in `.gitleaks.toml`:
   ```toml
   [allowlist]
   paths = ['''tests/samples/.*''']
   ```

### "Scanning is too slow"

**Problem**: Secret scanning slows down commits

**Analysis**: Gitleaks should be sub-second for staged files. If it's slow:
1. Check if you're using `gitleaks detect` (scans all files) instead of `gitleaks protect --staged` (staged only)
2. Verify you're using gitleaks, not a slower tool like Semgrep
3. Check `.gitleaks.toml` for overly complex regex patterns

**Fix**: Use the recommended command:
```yaml
scanCommand: "gitleaks protect --staged --verbose"
```

### "How do I rotate a detected secret?"

**Steps**:
1. **Remove the secret** from your code immediately
2. **Rotate the secret** via the service provider (AWS, GitHub, etc.)
3. **Commit the fix**
4. **If already pushed**: Rewrite git history (dangerous!) or accept that rotation is required

**Important**: Once a secret is in git history (even after deletion), it must be rotated. Git never forgets.

## Best Practices

### ✅ DO
- Keep secret scanning enabled (prevention is key)
- Use `.gitleaksignore` for documented false positives
- Test with fake secrets to verify scanning works
- Run `vibe-validate doctor` after setup
- Rotate secrets immediately if detected

### ❌ DON'T
- Don't commit secrets "temporarily" (they're permanent in git history)
- Don't disable scanning to "speed up" commits (it's already fast)
- Don't ignore warnings without investigating first
- Don't assume deleted secrets are safe (they're still in history)

## Integration with CI/CD

GitHub already scans repositories for secrets. vibe-validate focuses on **local pre-commit prevention** to catch secrets before they ever reach the remote repository.

If you want belt-and-suspenders protection, you can also add gitleaks to your CI pipeline, but this is optional since GitHub provides this functionality.

## Learn More

- **Gitleaks Documentation**: https://gitleaks.io/
- **Gitleaks GitHub**: https://github.com/gitleaks/gitleaks
- **Configuration Reference**: [configuration-reference.md](./skill/resources/configuration-reference.md)
- **Pre-commit Workflow**: [pre-commit command](./skill/resources/cli-reference.md#pre-commit)

## Related

- [Pre-commit Workflow](./getting-started.md#pre-commit-validation)
- [Configuration Reference](./skill/resources/configuration-reference.md)
- [Doctor Command](./skill/resources/cli-reference.md#doctor)

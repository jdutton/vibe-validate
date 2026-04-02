# Troubleshooting vibe-validate

## Common Issues

### Cache Not Working

**Symptom:** Validation always runs, even when code hasn't changed

**Diagnose:**
```bash
# Check if git is available
git --version

# Check current tree hash
git write-tree

# Check vibe-validate state
vv state
```

**Solutions:**
1. **Ensure working in a git repository**
   ```bash
   git status  # Should work
   ```

2. **Check for uncommitted changes**
   ```bash
   git status  # Should be clean for cache to work
   ```

3. **Force cache refresh**
   ```bash
   vv run --force <command>
   ```

### Errors Not Being Extracted

**Symptom:** `exitCode !== 0` but `totalErrors === 0`

**Diagnose:**
```bash
# Check what extractor was used
vv run <command>
# Look for: metadata.detection.extractor

# If "generic" → need custom extractor
```

**Solution:** Create custom extractor (see `resources/extending-extraction.md`)

### Command Always Fails

**Symptom:** Same command works without `vv run` but fails with it

**Possible causes:**
1. Command requires interactive input (not supported)
2. Command uses TTY detection
3. Command has side effects that fail in isolated execution

**Solution:** Run without vibe-validate for interactive commands

## Complete Troubleshooting Guide

See: `docs/troubleshooting.md` in the main documentation

# VV_TEMP_DIR Environment Variable

## Overview

The `VV_TEMP_DIR` environment variable allows you to customize where vibe-validate stores temporary output files (stdout, stderr, combined logs).

## Default Behavior

Without `VV_TEMP_DIR`, vibe-validate uses the operating system's temporary directory:
- **macOS/Linux**: `/tmp/vibe-validate/`
- **Windows**: `%TEMP%\vibe-validate\`

## Directory Structure

### Flat Structure (v0.20.0+)

Output files use a flat structure to minimize permission prompts in AI coding assistants:

```
${VV_TEMP_DIR}/vibe-validate/runs/2026-02-05/
  ├── abc123-14-31-10-stdout.log
  ├── abc123-14-31-10-stderr.log
  ├── abc123-14-31-10-combined.jsonl
  ├── def456-15-45-22-stdout.log
  └── ...
```

**Benefits**:
- One permission approval per day (not per run)
- Files accessed directly by path pointer
- No directory explosion
- Automatic OS cleanup after 7 days (on most systems)

**Filename Format**: `{treeHash}-{HH-mm-ss}-{suffix}.{ext}`

### Legacy Structure (v0.19.x)

Previous versions created nested directories per run:

```
/tmp/vibe-validate/runs/2026-02-05/abc123-14-31-10/
  ├── stdout.log
  ├── stderr.log
  └── combined.jsonl
```

This caused permission prompts for each unique directory.

## Usage

### Set Globally

```bash
# Bash/Zsh
export VV_TEMP_DIR="/path/to/custom/temp"

# Fish
set -x VV_TEMP_DIR "/path/to/custom/temp"

# Windows (CMD)
set VV_TEMP_DIR=C:\path\to\custom\temp

# Windows (PowerShell)
$env:VV_TEMP_DIR = "C:\path\to\custom\temp"
```

### Set Per-Command

```bash
VV_TEMP_DIR=/custom/temp vv validate
```

### Set in CI/CD

```yaml
# GitHub Actions
env:
  VV_TEMP_DIR: ${{ runner.temp }}/vibe-validate

# GitLab CI
variables:
  VV_TEMP_DIR: $CI_PROJECT_DIR/.vibe-validate-temp
```

## Use Cases

### 1. AI Coding Assistant Permissions

Configure a stable directory to reduce permission prompts:

```bash
# Claude Code - add to ~/.claude/settings.json
{
  "permissions": {
    "allow": [
      "Read(//tmp/vibe-validate/**)",
      "Write(//tmp/vibe-validate/**)"
    ]
  }
}

# Or use a custom directory
export VV_TEMP_DIR="$HOME/.vibe-validate/temp"
```

### 2. Project-Local Temp Directory

Keep temp files with your project:

```bash
export VV_TEMP_DIR="$PWD/.vibe-validate/temp"

# Add to .gitignore
echo "/.vibe-validate/temp/" >> .gitignore
```

### 3. Shared CI Build Directory

Use CI-provided temp directories:

```bash
# GitHub Actions
export VV_TEMP_DIR="${RUNNER_TEMP}/vibe-validate"

# GitLab CI
export VV_TEMP_DIR="${CI_PROJECT_DIR}/.vibe-validate-temp"
```

### 4. Network Storage

Store logs on network storage for team access:

```bash
export VV_TEMP_DIR="/mnt/shared/vibe-validate-logs"
```

## Cleanup

### Automatic OS Cleanup

When using the default OS temp directory, most operating systems automatically clean files older than 7-30 days.

### Manual Cleanup

```bash
# Clean old runs (older than 7 days)
find "${VV_TEMP_DIR:-/tmp}/vibe-validate" -type f -mtime +7 -delete

# Clean all temp files
rm -rf "${VV_TEMP_DIR:-/tmp}/vibe-validate"
```

### Custom Cleanup Script

```bash
#!/bin/bash
# cleanup-vv-temp.sh

TEMP_DIR="${VV_TEMP_DIR:-/tmp}/vibe-validate"
DAYS_OLD=7

if [ -d "$TEMP_DIR" ]; then
  echo "Cleaning files older than $DAYS_OLD days from $TEMP_DIR"
  find "$TEMP_DIR" -type f -mtime +$DAYS_OLD -delete
  find "$TEMP_DIR" -type d -empty -delete
  echo "Cleanup complete"
fi
```

## Troubleshooting

### Permission Denied Errors

If you see permission errors:

1. **Check directory exists and is writable**:
   ```bash
   mkdir -p "$VV_TEMP_DIR"
   chmod 755 "$VV_TEMP_DIR"
   ```

2. **Verify environment variable is set**:
   ```bash
   echo $VV_TEMP_DIR
   ```

3. **Use absolute paths** (avoid relative paths like `./temp`):
   ```bash
   export VV_TEMP_DIR="$(pwd)/.vibe-validate/temp"
   ```

### Disk Space Issues

Large validation runs can accumulate many log files:

```bash
# Check disk usage
du -sh "${VV_TEMP_DIR:-/tmp}/vibe-validate"

# Clean files older than 1 day
find "${VV_TEMP_DIR:-/tmp}/vibe-validate" -type f -mtime +1 -delete
```

### Files Not Being Created

If output files aren't being created:

1. **Verify directory is writable**:
   ```bash
   touch "$VV_TEMP_DIR/test.txt" && rm "$VV_TEMP_DIR/test.txt"
   ```

2. **Check for path issues**:
   ```bash
   ls -la "$VV_TEMP_DIR"
   ```

3. **Ensure directory exists**:
   ```bash
   mkdir -p "$VV_TEMP_DIR/vibe-validate/runs"
   ```

## See Also

- [Configuration Reference](configuration-reference.md)
- [Error Extractors Guide](error-extractors-guide.md)
- [Troubleshooting](troubleshooting.md)

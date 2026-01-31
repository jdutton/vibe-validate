# Tools Directory

Utility scripts for vibe-validate development and debugging.

## Available Scripts

### debug-windows.ts

Comprehensive Windows diagnostics for debugging CI issues with node path resolution.

**Purpose:** Systematically tests all aspects of node command execution on Windows to identify issues with `which`, `process.execPath`, file existence, and spawn behavior.

**Tests performed:**
1. Platform detection and environment variables
2. `process.execPath` analysis and file existence
3. `which.sync()` behavior with various options
4. Path comparison and case sensitivity
5. File extension handling (PATHEXT)
6. Spawn tests with different approaches
7. Integration with @vibe-validate/git safe-exec
8. npm and .cmd file handling on Windows
9. Case sensitivity tests
10. Integration with @vibe-validate/git safe-exec
11. jscpd (code duplication checker) availability and execution
12. Shell and environment variable behavior
13. Concurrent execution tests
14. execSync vs spawnSync comparison (tests if execSync works where spawnSync fails)
15. Exact failing test scenarios (NEW - tests shell:true vs shell:false with echo, node, and explicit cmd.exe)
    - Scenario A: `node bin.js run "echo test"` (shell built-in)
    - Scenario B: `node bin.js run "node --version"` (not a built-in)
    - Scenario C: `node bin.js run "node -e ..."`
    - Scenario D: Explicit `cmd.exe /c node ...` invocation
16. Summary and recommendations

**Usage:**
```bash
# Run locally (Windows only - will show platform warning on Mac/Linux)
pnpm debug:windows

# Run via GitHub Actions (manual trigger)
gh workflow run debug-windows.yml

# Run via GitHub Actions with specific Node version
gh workflow run debug-windows.yml -f node_version=22
```

**GitHub Actions Workflow:** `.github/workflows/debug-windows.yml`
- Manual trigger via `workflow_dispatch`
- Auto-runs on `debug/**` branches
- Tests multiple aspects of Windows environment
- Uploads diagnostic artifacts

**Output:** Comprehensive report with color-coded success/error indicators and specific recommendations for fixing detected issues.

### Other Scripts

- `bump-version.js` - Update versions across monorepo
- `duplication-check.js` - Check for code duplication (with Windows wrapper)
- `generate-cli-docs.js` - Generate CLI documentation from help output
- `pre-publish-check.js` - Validate packages before publishing
- `publish-all.js` - Publish all packages to npm
- `verify-npm-packages.js` - Verify published packages are installable

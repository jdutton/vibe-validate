/**
 * Secret Scanning Tool Detection and Execution
 *
 * Handles automatic detection and execution of secret scanning tools:
 * - gitleaks (native binary, fast)
 * - secretlint (npm-based, containerized-friendly)
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { isToolAvailable, safeExecFromString } from '@vibe-validate/utils';
import chalk from 'chalk';

/**
 * Secret scanning tool type
 */
export type SecretScanningTool = 'gitleaks' | 'secretlint';

/**
 * Tool detection result
 */
export interface ToolDetection {
  tool: SecretScanningTool;
  available: boolean;
  hasConfig: boolean;
  defaultCommand: string;
}

/**
 * Check if gitleaks config files exist
 */
export function hasGitleaksConfig(cwd: string = process.cwd()): boolean {
  return (
    existsSync(resolve(cwd, '.gitleaks.toml')) ||
    existsSync(resolve(cwd, '.gitleaksignore'))
  );
}

/**
 * Check if secretlint config exists
 */
export function hasSecretlintConfig(cwd: string = process.cwd()): boolean {
  return existsSync(resolve(cwd, '.secretlintrc.json'));
}

/**
 * Detect available secret scanning tools and their configurations
 */
export function detectSecretScanningTools(cwd: string = process.cwd()): ToolDetection[] {
  const gitleaksAvailable = isToolAvailable('gitleaks');
  const gitleaksConfigured = hasGitleaksConfig(cwd);
  const secretlintConfigured = hasSecretlintConfig(cwd);

  return [
    {
      tool: 'gitleaks',
      available: gitleaksAvailable,
      hasConfig: gitleaksConfigured,
      defaultCommand: 'gitleaks protect --staged --verbose',
    },
    {
      tool: 'secretlint',
      available: true, // Always available via npx
      hasConfig: secretlintConfigured,
      defaultCommand: 'npx secretlint .', // No glob patterns - safeExecFromString rejects them
    },
  ];
}

/**
 * Determine which tools to run based on configuration and availability
 */
export function selectToolsToRun(
  scanCommand: string | undefined,
  cwd: string = process.cwd()
): { tool: SecretScanningTool; command: string }[] {
  // If explicit scanCommand provided (not "autodetect"), use it
  if (scanCommand && scanCommand !== 'autodetect') {
    // Detect which tool the command is for
    const tool = scanCommand.includes('gitleaks') ? 'gitleaks' : 'secretlint';
    return [{ tool, command: scanCommand }];
  }

  // Autodetect mode
  const tools = detectSecretScanningTools(cwd);
  const toRun: { tool: SecretScanningTool; command: string }[] = [];

  // Check gitleaks
  const gitleaks = tools.find(t => t.tool === 'gitleaks');
  if (gitleaks?.hasConfig) {
    // Config exists - add to run list (will warn during execution if unavailable)
    toRun.push({ tool: 'gitleaks', command: gitleaks.defaultCommand });
  }

  // Check secretlint
  const secretlint = tools.find(t => t.tool === 'secretlint');
  if (secretlint?.hasConfig) {
    toRun.push({ tool: 'secretlint', command: secretlint.defaultCommand });
  }

  // Fallback if no config files present
  if (toRun.length === 0) {
    if (gitleaks?.available) {
      toRun.push({ tool: 'gitleaks', command: gitleaks.defaultCommand });
    } else if (secretlint) {
      // Always fallback to secretlint via npx
      toRun.push({ tool: 'secretlint', command: secretlint.defaultCommand });
    }
  }

  return toRun;
}

/**
 * Result of a secret scan
 */
export interface ScanResult {
  tool: SecretScanningTool;
  passed: boolean;
  duration: number;
  skipped?: boolean;
  skipReason?: string;
  output?: string;
  error?: string;
}

/**
 * Convert Buffer or string to string, avoiding [object Object] for Buffers
 */
function toSafeString(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (Buffer.isBuffer(value)) {
    return value.toString('utf-8');
  }
  if (value && typeof value === 'object') {
    // Handle objects - use JSON.stringify to avoid "[object Object]"
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  if (value) {
    return String(value);
  }
  return '';
}

/**
 * Run a secret scanning command
 */
export function runSecretScan(
  tool: SecretScanningTool,
  command: string,
  verbose: boolean = false
): ScanResult {
  const startTime = Date.now();

  // Special handling for gitleaks - skip if not installed (native binary, optional)
  // secretlint is ALWAYS available via npx - never skip, always fail loud if error
  if (tool === 'gitleaks' && !isToolAvailable('gitleaks')) {
    return {
      tool,
      passed: true, // Don't fail, just skip
      duration: Date.now() - startTime,
      skipped: true,
      skipReason: 'gitleaks command not available',
    };
  }

  try {
    // Parse and execute scanCommand string
    //
    // SECURITY: scanCommand comes from user config (vibe-validate.config.yaml)
    // Same trust model as npm scripts - users control their own config files.
    //
    // LIMITATIONS:
    // - Simple commands work: "gitleaks protect --staged"
    // - Glob patterns FAIL: "npx secretlint **/*" (prevented by safeExecFromString)
    // - Shell operators FAIL: "cmd1 && cmd2" (prevented by safeExecFromString)
    // - Complex quoting FAILS: nested quotes, escapes (prevented by safeExecFromString)
    //
    // WHY safeExecFromString:
    // - Handles simple quoted args: 'gitleaks protect --config ".gitleaks.toml"'
    // - Fails fast on complex shell syntax (prevents silent bugs)
    // - More robust than naive .split() which breaks with ANY quotes
    //
    // RECOMMENDATION for complex commands (globs, operators, etc):
    // Move to package.json script and reference it:
    //   Bad:  scanCommand: "npx secretlint **/*"  (glob patterns rejected)
    //   Bad:  scanCommand: "cmd1 && cmd2"         (shell operators rejected)
    //   Good: scanCommand: "npm run scan:secrets"
    //         package.json: { "scan:secrets": "npx secretlint '**/*'" }
    const result = safeExecFromString(command, {
      encoding: 'utf8',
      stdio: 'pipe',
    });

    const duration = Date.now() - startTime;

    return {
      tool,
      passed: true,
      duration,
      output: verbose ? toSafeString(result) : undefined,
    };
  } catch (error: unknown) {
    const duration = Date.now() - startTime;

    if (error && typeof error === 'object' && 'stderr' in error && 'stdout' in error) {
      // Safely convert stderr/stdout to strings (may be Buffer or string from child_process)
      // Handle potential undefined/null values before stringification to avoid [object Object]
      const stderr = toSafeString(error.stderr);
      const stdout = toSafeString(error.stdout);

      return {
        tool,
        passed: false,
        duration,
        output: stdout,
        error: stderr,
      };
    }

    return {
      tool,
      passed: false,
      duration,
      error: String(error),
    };
  }
}

/**
 * Format tool name for display
 */
export function formatToolName(tool: SecretScanningTool): string {
  return tool === 'gitleaks' ? 'gitleaks' : 'secretlint';
}

/**
 * Show performance warning if scan was slow
 */
export function showPerformanceWarning(
  tool: SecretScanningTool,
  duration: number,
  threshold: number,
  hasExplicitCommand: boolean = false
): void {
  if (duration <= threshold) {
    return;
  }

  const seconds = (duration / 1000).toFixed(1);

  console.warn(chalk.yellow(`\n⚠️  Secret scanning took ${seconds}s (${formatToolName(tool)})`));

  if (tool === 'secretlint') {
    console.warn(chalk.gray('   Consider installing gitleaks for faster scanning:'));
    console.warn(chalk.gray('   • macOS: brew install gitleaks'));
    console.warn(chalk.gray('   • Linux: See https://github.com/gitleaks/gitleaks#installation'));
    if (hasExplicitCommand) {
      console.warn(chalk.gray(''));
    } else {
      console.warn(chalk.gray('   • Or add explicit scanCommand in config\n'));
    }
  }
}

/**
 * Show error message when secrets are detected
 */
export function showSecretsDetectedError(results: ScanResult[]): void {
  console.error(chalk.red('\n❌ Secret scanning detected potential secrets in staged files\n'));

  for (const result of results) {
    if (!result.passed) {
      console.error(chalk.yellow(`Tool: ${formatToolName(result.tool)}`));

      if (result.output) {
        console.error(result.output);
      }
      if (result.error) {
        console.error(result.error);
      }
      console.error('');
    }
  }

  console.error(chalk.blue('💡 Fix options:'));
  console.error(chalk.gray('   1. Remove secrets from staged files'));
  console.error(chalk.gray('   2. Use .gitleaksignore to mark false positives (if using gitleaks)'));
  console.error(chalk.gray('   3. Use .secretlintignore to mark false positives (if using secretlint)'));
  console.error(chalk.gray('   4. Disable scanning: set hooks.preCommit.secretScanning.enabled=false'));
}

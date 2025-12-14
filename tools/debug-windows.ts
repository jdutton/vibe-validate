#!/usr/bin/env node
/**
 * Windows Debugging Script
 *
 * Comprehensive diagnostics for Windows CI issues with node path resolution.
 * Tests all code paths, environment variables, and file system behavior.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, statSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import which from 'which';

// ANSI colors (work on Windows Terminal)
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function section(title: string) {
  console.log('\n' + '='.repeat(80));
  console.log(`${colors.bright}${colors.cyan}${title}${colors.reset}`);
  console.log('='.repeat(80));
}

function success(message: string) {
  console.log(`${colors.green}✓${colors.reset} ${message}`);
}

function error(message: string) {
  console.log(`${colors.red}✗${colors.reset} ${message}`);
}

function info(label: string, value: any) {
  console.log(`${colors.blue}${label}:${colors.reset} ${value}`);
}

function warn(message: string) {
  console.log(`${colors.yellow}⚠${colors.reset} ${message}`);
}

// Test 1: Platform Detection
section('1. Platform Detection');
info('process.platform', process.platform);
info('process.arch', process.arch);
info('process.version', process.version);
info('process.execPath', process.execPath);
info('Is Windows?', process.platform === 'win32');
info('__dirname', __dirname);
info('__filename', __filename);

// Test 2: Environment Variables
section('2. Environment Variables');
const envVars = [
  'PATH',
  'PATHEXT',
  'COMSPEC',
  'PROCESSOR_ARCHITECTURE',
  'NUMBER_OF_PROCESSORS',
  'TEMP',
  'TMP',
  'USERPROFILE',
  'HOMEDRIVE',
  'HOMEPATH',
];
for (const varName of envVars) {
  const value = process.env[varName];
  if (value) {
    info(varName, value.length > 100 ? `${value.substring(0, 100)}...` : value);
  } else {
    warn(`${varName} not set`);
  }
}

// Test 3: process.execPath Analysis
section('3. process.execPath Analysis');
const execPath = process.execPath;
info('process.execPath', execPath);
info('Exists?', existsSync(execPath));

if (existsSync(execPath)) {
  try {
    const stats = statSync(execPath);
    success('File accessible');
    info('  Size', `${stats.size} bytes`);
    info('  Is file?', stats.isFile());
    info('  Is executable?', !!(stats.mode & 0o111));
  } catch (err) {
    error(`Cannot stat: ${err}`);
  }

  // Check parent directory
  const parentDir = dirname(execPath);
  info('Parent directory', parentDir);
  info('Parent exists?', existsSync(parentDir));

  if (existsSync(parentDir)) {
    try {
      const files = readdirSync(parentDir);
      info('Files in parent', files.join(', '));
    } catch (err) {
      error(`Cannot read parent dir: ${err}`);
    }
  }
} else {
  error('process.execPath does not exist!');
}

// Test 4: which.sync Behavior
section('4. which.sync Behavior');

// Test with default options
try {
  const nodePath = which.sync('node');
  info('which.sync("node")', nodePath);
  info('Exists?', existsSync(nodePath));

  if (existsSync(nodePath)) {
    try {
      const stats = statSync(nodePath);
      success('File accessible via which');
      info('  Size', `${stats.size} bytes`);
    } catch (err) {
      error(`Cannot stat which path: ${err}`);
    }
  } else {
    error('which.sync returned path that does not exist!');
  }
} catch (err) {
  error(`which.sync("node") threw: ${err}`);
}

// Test with nothrow
const nodePathNoThrow = which.sync('node', { nothrow: true });
info('which.sync("node", {nothrow: true})', nodePathNoThrow ?? 'null');
if (nodePathNoThrow) {
  info('NoThrow path exists?', existsSync(nodePathNoThrow));
}

// Test with all: true
try {
  const allPaths = which.sync('node', { all: true, nothrow: true }) as string[];
  info('which.sync("node", {all: true})', `Found ${allPaths?.length ?? 0} paths`);
  if (allPaths && allPaths.length > 0) {
    allPaths.forEach((p, i) => {
      info(`  [${i}]`, `${p} (exists: ${existsSync(p)})`);
    });
  }
} catch (err) {
  error(`which.sync with all:true threw: ${err}`);
}

// Test 5: Path Comparison
section('5. Path Comparison');
const whichPath = which.sync('node', { nothrow: true });
if (whichPath && execPath) {
  info('which.sync path', whichPath);
  info('process.execPath', execPath);
  info('Are equal?', whichPath === execPath);
  info('Lowercase equal?', whichPath.toLowerCase() === execPath.toLowerCase());

  // Character-by-character comparison
  if (whichPath.toLowerCase() !== execPath.toLowerCase()) {
    warn('Paths differ!');
    info('  Length diff', `which: ${whichPath.length}, exec: ${execPath.length}`);

    const maxLen = Math.max(whichPath.length, execPath.length);
    for (let i = 0; i < maxLen; i++) {
      if (whichPath[i] !== execPath[i]) {
        info(`  First diff at position ${i}`,
          `which: "${whichPath[i]}" (${whichPath.charCodeAt(i)}), ` +
          `exec: "${execPath[i]}" (${execPath.charCodeAt(i)})`);
        break;
      }
    }
  }
}

// Test 6: File Extension Handling
section('6. File Extension Handling');
const pathext = process.env.PATHEXT || '';
info('PATHEXT', pathext);

if (whichPath) {
  const whichExt = whichPath.slice(whichPath.lastIndexOf('.')).toUpperCase();
  const execExt = execPath.slice(execPath.lastIndexOf('.')).toUpperCase();
  info('which extension', whichExt);
  info('exec extension', execExt);
  info('Extensions match?', whichExt === execExt);
}

// Test 7: Spawn Tests
section('7. Spawn Tests');

// Test A: Spawn with process.execPath
try {
  const result1 = spawnSync(execPath, ['--version'], { encoding: 'utf-8' });
  if (result1.error) {
    error(`Spawn with process.execPath failed: ${result1.error.message}`);
  } else {
    success(`Spawn with process.execPath succeeded`);
    info('  Exit code', result1.status);
    info('  Output', result1.stdout?.toString().trim());
  }
} catch (err) {
  error(`Exception spawning with process.execPath: ${err}`);
}

// Test B: Spawn with which.sync path
if (whichPath) {
  try {
    const result2 = spawnSync(whichPath, ['--version'], { encoding: 'utf-8' });
    if (result2.error) {
      error(`Spawn with which.sync path failed: ${result2.error.message}`);
      info('  Error code', (result2.error as any).code);
      info('  Error errno', (result2.error as any).errno);
      info('  Error syscall', (result2.error as any).syscall);
      info('  Error path', (result2.error as any).path);
    } else {
      success(`Spawn with which.sync path succeeded`);
      info('  Exit code', result2.status);
      info('  Output', result2.stdout?.toString().trim());
    }
  } catch (err) {
    error(`Exception spawning with which.sync path: ${err}`);
  }
}

// Test C: Spawn with just 'node' (shell: false)
try {
  const result3 = spawnSync('node', ['--version'], { encoding: 'utf-8', shell: false });
  if (result3.error) {
    error(`Spawn with 'node' (no shell) failed: ${result3.error.message}`);
  } else {
    success(`Spawn with 'node' (no shell) succeeded`);
    info('  Exit code', result3.status);
    info('  Output', result3.stdout?.toString().trim());
  }
} catch (err) {
  error(`Exception spawning 'node' without shell: ${err}`);
}

// Test D: Spawn with just 'node' (shell: true)
try {
  const result4 = spawnSync('node', ['--version'], { encoding: 'utf-8', shell: true });
  if (result4.error) {
    error(`Spawn with 'node' (with shell) failed: ${result4.error.message}`);
  } else {
    success(`Spawn with 'node' (with shell) succeeded`);
    info('  Exit code', result4.status);
    info('  Output', result4.stdout?.toString().trim());
  }
} catch (err) {
  error(`Exception spawning 'node' with shell: ${err}`);
}

// Test 8: Case Sensitivity Tests
section('8. Case Sensitivity Tests');
if (whichPath) {
  const upperPath = whichPath.toUpperCase();
  const lowerPath = whichPath.toLowerCase();

  info('Original path', whichPath);
  info('UPPERCASE exists?', existsSync(upperPath));
  info('lowercase exists?', existsSync(lowerPath));
  info('MiXeDcAsE exists?', existsSync(
    whichPath.split('').map((c, i) => i % 2 ? c.toUpperCase() : c.toLowerCase()).join('')
  ));
}

// Test 9: Import safe-exec and test
section('9. Testing @vibe-validate/git safe-exec');
try {
  // Try to import the package
  const safeExecModule = await import('@vibe-validate/git');
  const { safeExecSync, safeExecResult, isToolAvailable, getToolVersion } = safeExecModule;

  success('@vibe-validate/git imported successfully');

  // Test isToolAvailable
  info('isToolAvailable("node")', isToolAvailable('node'));

  // Test getToolVersion
  const version = getToolVersion('node');
  info('getToolVersion("node")', version ?? 'null');

  // Test safeExecSync
  try {
    const syncResult = safeExecSync('node', ['--version'], { encoding: 'utf-8' });
    success('safeExecSync succeeded');
    info('  Output', syncResult.toString().trim());
  } catch (err) {
    error(`safeExecSync failed: ${err}`);
    if (err instanceof Error) {
      info('  Error name', err.name);
      info('  Error message', err.message);
      info('  Error stack', err.stack?.split('\n').slice(0, 3).join('\n'));
    }
  }

  // Test safeExecResult
  const result = safeExecResult('node', ['--version'], { encoding: 'utf-8' });
  info('safeExecResult status', result.status);
  if (result.status === 0) {
    success('safeExecResult succeeded');
    info('  Output', result.stdout.toString().trim());
  } else {
    error(`safeExecResult failed with status ${result.status}`);
    info('  Stdout', result.stdout.toString());
    info('  Stderr', result.stderr.toString());
    if (result.error) {
      info('  Error', result.error.message);
    }
  }
} catch (err) {
  error(`Failed to import or test @vibe-validate/git: ${err}`);
}

// Test 10: Summary
section('10. Summary & Recommendations');

const issues: string[] = [];
const recommendations: string[] = [];

if (!existsSync(execPath)) {
  issues.push('process.execPath does not exist on filesystem');
  recommendations.push('Use alternative node resolution method');
}

if (whichPath && !existsSync(whichPath)) {
  issues.push('which.sync returns path that does not exist');
  recommendations.push('Do not use which.sync result, use process.execPath instead');
}

if (whichPath && execPath && whichPath.toLowerCase() !== execPath.toLowerCase()) {
  issues.push('which.sync and process.execPath return different paths');
  recommendations.push('Prefer process.execPath over which.sync on Windows');
}

const whichExt = whichPath?.slice(whichPath.lastIndexOf('.')).toUpperCase();
const execExt = execPath.slice(execPath.lastIndexOf('.')).toUpperCase();
if (whichExt && execExt && whichExt !== execExt) {
  issues.push(`File extension mismatch: which uses ${whichExt}, exec uses ${execExt}`);
  recommendations.push('Normalize file extensions when comparing paths');
}

if (issues.length === 0) {
  success('No issues detected!');
} else {
  warn(`Found ${issues.length} issue(s):`);
  issues.forEach((issue, i) => {
    console.log(`  ${i + 1}. ${issue}`);
  });

  console.log();
  info('Recommendations', '');
  recommendations.forEach((rec, i) => {
    console.log(`  ${i + 1}. ${rec}`);
  });
}

console.log('\n' + '='.repeat(80));
console.log(`${colors.bright}Debug complete!${colors.reset}`);
console.log('='.repeat(80) + '\n');

// Exit with non-zero if issues found
process.exit(issues.length > 0 ? 1 : 0);

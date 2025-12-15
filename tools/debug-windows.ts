#!/usr/bin/env tsx
/**
 * Windows Debugging Script
 *
 * Comprehensive diagnostics for Windows CI issues with node path resolution.
 * Tests all code paths, environment variables, and file system behavior.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, statSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-expect-error - which is available via @vibe-validate/git dependency
import which from 'which';

// ESM compatibility for __dirname and __filename
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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
          `which: "${whichPath[i]}" (${whichPath.codePointAt(i)}), ` +
          `exec: "${execPath[i]}" (${execPath.codePointAt(i)})`);
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

// Test 8: npm and .cmd File Handling
section('8. npm and .cmd File Handling on Windows');
try {
  info('Testing npm availability', '');

  // Check for npm
  const npmWhich = which.sync('npm', { nothrow: true });
  info('which.sync("npm")', npmWhich ?? 'null');
  if (npmWhich) {
    info('  Exists?', existsSync(npmWhich));
    info('  Extension', npmWhich.slice(npmWhich.lastIndexOf('.')));
  }

  // Check for npm.cmd explicitly
  const npmCmdWhich = which.sync('npm.cmd', { nothrow: true });
  info('which.sync("npm.cmd")', npmCmdWhich ?? 'null');
  if (npmCmdWhich) {
    info('  Exists?', existsSync(npmCmdWhich));
  }

  // Try to spawn npm
  info('Testing npm spawning', '');

  // Without shell
  try {
    const npmNoShell = spawnSync('npm', ['--version'], { encoding: 'utf-8', shell: false });
    if (npmNoShell.error) {
      error('npm (no shell) failed: ' + npmNoShell.error.message);
    } else {
      success('npm (no shell) succeeded');
      info('  Output', npmNoShell.stdout?.toString().trim());
    }
  } catch (err) {
    error(`Exception with npm no shell: ${err}`);
  }

  // With shell
  try {
    const npmShell = spawnSync('npm', ['--version'], { encoding: 'utf-8', shell: true });
    if (npmShell.error) {
      error('npm (with shell) failed: ' + npmShell.error.message);
    } else {
      success('npm (with shell) succeeded');
      info('  Output', npmShell.stdout?.toString().trim());
    }
  } catch (err) {
    error(`Exception with npm with shell: ${err}`);
  }

  // Check pnpm (our actual package manager)
  info('Testing pnpm availability', '');
  const pnpmWhich = which.sync('pnpm', { nothrow: true });
  info('which.sync("pnpm")', pnpmWhich ?? 'null');
  if (pnpmWhich) {
    info('  Exists?', existsSync(pnpmWhich));
    info('  Extension', pnpmWhich.slice(pnpmWhich.lastIndexOf('.')));

    // Try to get version
    try {
      const pnpmVersion = spawnSync(pnpmWhich, ['--version'], { encoding: 'utf-8' });
      if (pnpmVersion.error) {
        error('pnpm version failed: ' + pnpmVersion.error.message);
      } else {
        success('pnpm version succeeded');
        info('  Output', pnpmVersion.stdout?.toString().trim());
      }
    } catch (err) {
      error(`Exception with pnpm: ${err}`);
    }
  }

} catch (err) {
  error(`Failed npm/cmd testing: ${err}`);
}

// Test 9: Case Sensitivity Tests
section('9. Case Sensitivity Tests');
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

// Test 10: Import safe-exec and test
section('10. Testing @vibe-validate/git safe-exec');
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

// Test 11: jscpd (Code Duplication Checker)
section('11. Testing jscpd on Windows');
try {
  // Check if jscpd is available
  const jscpdAvailable = which.sync('jscpd', { nothrow: true });
  if (jscpdAvailable) {
    success('jscpd is available in PATH');
    info('  Path', jscpdAvailable);
    info('  Exists?', existsSync(jscpdAvailable));

    // Try to run jscpd --version
    try {
      const jscpdVersion = spawnSync(jscpdAvailable, ['--version'], { encoding: 'utf-8' });
      if (jscpdVersion.error) {
        error(`jscpd --version failed: ${jscpdVersion.error.message}`);
      } else {
        success('jscpd --version succeeded');
        info('  Exit code', jscpdVersion.status);
        info('  Output', jscpdVersion.stdout?.toString().trim());
      }
    } catch (err) {
      error(`Exception running jscpd: ${err}`);
    }

    // Test with a simple directory
    info('Testing jscpd on tools directory', '');
    try {
      const jscpdTest = spawnSync(jscpdAvailable, ['tools', '--min-tokens', '50', '--format', 'json'], {
        encoding: 'utf-8',
        timeout: 10000,
      });
      if (jscpdTest.error) {
        error(`jscpd test failed: ${jscpdTest.error.message}`);
        info('  Error code', (jscpdTest.error as any).code);
      } else {
        success('jscpd test completed');
        info('  Exit code', jscpdTest.status);
        if (jscpdTest.stdout) {
          const outputLines = jscpdTest.stdout.toString().split('\n').length;
          info('  Output lines', outputLines);
        }
        if (jscpdTest.stderr) {
          warn('  Stderr present');
          info('  Stderr lines', jscpdTest.stderr.toString().split('\n').length);
        }
      }
    } catch (err) {
      error(`Exception testing jscpd: ${err}`);
    }
  } else {
    warn('jscpd not found in PATH');
    info('This is expected on fresh Windows CI - jscpd is installed as dev dependency');

    // Try via node_modules
    const nodeModulesJscpd = join(process.cwd(), 'node_modules', '.bin', 'jscpd.cmd');
    info('Checking node_modules/.bin/jscpd.cmd', nodeModulesJscpd);
    info('  Exists?', existsSync(nodeModulesJscpd));

    if (existsSync(nodeModulesJscpd)) {
      try {
        const jscpdTest = spawnSync(nodeModulesJscpd, ['--version'], {
          encoding: 'utf-8',
          shell: true, // .cmd files need shell on Windows
        });
        if (jscpdTest.error) {
          error(`node_modules jscpd failed: ${jscpdTest.error.message}`);
        } else {
          success('node_modules jscpd works');
          info('  Output', jscpdTest.stdout?.toString().trim());
        }
      } catch (err) {
        error(`Exception with node_modules jscpd: ${err}`);
      }
    }
  }
} catch (err) {
  error(`Failed to test jscpd: ${err}`);
}

// Test 12: Shell and Environment Variable Behavior
section('12. Shell and Environment Variable Behavior');
try {
  info('Testing environment variable expansion', '');

  // Test with shell: false (our default)
  const noShellResult = spawnSync('node', ['-e', 'console.log("$PATH")'], {
    encoding: 'utf-8',
    shell: false,
  });
  info('With shell: false', noShellResult.stdout?.toString().trim());

  // Test with shell: true
  const shellResult = spawnSync('node', ['-e', 'console.log("$PATH")'], {
    encoding: 'utf-8',
    shell: true,
  });
  info('With shell: true', shellResult.stdout?.toString().trim());

  // Test ${PATH} syntax
  const bracesResult = spawnSync('node', ['-e', 'console.log("${PATH}")'], {
    encoding: 'utf-8',
    shell: false,
  });
  info('With braces ${PATH}', bracesResult.stdout?.toString().trim());

  // Check PowerShell vs cmd behavior
  info('Default shell on Windows', process.env.COMSPEC || 'unknown');
  info('PowerShell available?', which.sync('pwsh', { nothrow: true }) ? 'yes' : 'no');

} catch (err) {
  error(`Failed environment variable tests: ${err}`);
}

// Test 13: Concurrent Execution
section('13. Concurrent Execution Tests');
try {
  info('Testing concurrent which.sync calls', '');

  const start = Date.now();
  const promises = [];

  for (let i = 0; i < 10; i++) {
    promises.push(
      Promise.resolve().then(() => {
        try {
          const path = which.sync('node', { nothrow: true });
          return { success: true, path, index: i };
        } catch (err) {
          return { success: false, error: String(err), index: i };
        }
      })
    );
  }

  const results = await Promise.all(promises);
  const successes = results.filter(r => r.success).length;
  const failures = results.filter(r => !r.success).length;
  const duration = Date.now() - start;

  info('Completed in', `${duration}ms`);
  info('Successes', successes);
  info('Failures', failures);

  if (failures > 0) {
    warn('Some concurrent calls failed:');
    results.filter(r => !r.success).forEach(r => {
      info(`  [${r.index}]`, (r as any).error);
    });
  }

  // Synchronous version (for comparison)
  info('Testing synchronous which.sync calls', '');
  const syncStart = Date.now();
  let syncFailures = 0;

  for (let i = 0; i < 10; i++) {
    try {
      which.sync('node', { nothrow: true });
    } catch (_err) {
      // Intentionally count failures without logging - comparing failure rates between async/sync
      syncFailures++;
    }
  }

  const syncDuration = Date.now() - syncStart;
  info('Synchronous duration', `${syncDuration}ms`);
  info('Synchronous failures', syncFailures);

} catch (err) {
  error(`Failed concurrent execution tests: ${err}`);
}

// Test 14: execSync vs spawnSync Comparison
section('14. execSync vs spawnSync Comparison');
try {
  info('Testing if execSync works where spawnSync fails', '');

  // Import execSync
  const { execSync } = await import('node:child_process');

  // Test 1: execSync with 'node --version' (same as failing tests)
  try {
    const execSyncResult = execSync('node --version', { encoding: 'utf-8' });
    success('execSync("node --version") succeeded');
    info('  Output', execSyncResult.trim());
  } catch (err) {
    error(`execSync("node --version") failed: ${err}`);
  }

  // Test 2: spawnSync with which.sync path
  if (whichPath) {
    try {
      const spawnResult = spawnSync(whichPath, ['--version'], {
        encoding: 'utf-8',
        shell: false,
      });
      if (spawnResult.error) {
        error(`spawnSync(which.sync, ["--version"], {shell: false}) failed: ${spawnResult.error.message}`);
        info('  Error code', (spawnResult.error as any).code);
        info('  Error path', (spawnResult.error as any).path);
      } else {
        success('spawnSync(which.sync, ["--version"], {shell: false}) succeeded');
        info('  Output', spawnResult.stdout?.toString().trim());
      }
    } catch (err) {
      error(`spawnSync exception: ${err}`);
    }
  }

  // Test 3: spawnSync with process.execPath
  try {
    const spawnExecResult = spawnSync(execPath, ['--version'], {
      encoding: 'utf-8',
      shell: false,
    });
    if (spawnExecResult.error) {
      error(`spawnSync(process.execPath, ["--version"], {shell: false}) failed: ${spawnExecResult.error.message}`);
    } else {
      success('spawnSync(process.execPath, ["--version"], {shell: false}) succeeded');
      info('  Output', spawnExecResult.stdout?.toString().trim());
    }
  } catch (err) {
    error(`spawnSync(process.execPath) exception: ${err}`);
  }

  // Test 4: spawnSync with 'node' and shell: true
  try {
    const spawnShellResult = spawnSync('node', ['--version'], {
      encoding: 'utf-8',
      shell: true,
    });
    if (spawnShellResult.error) {
      error('spawnSync("node", ["--version"], {shell: true}) failed');
    } else {
      success('spawnSync("node", ["--version"], {shell: true}) succeeded');
      info('  Output', spawnShellResult.stdout?.toString().trim());
    }
  } catch (err) {
    error(`spawnSync shell:true exception: ${err}`);
  }

  // Test 5: Test the exact command from failing CLI integration tests
  section('Testing Exact Failing Test Scenarios');

  const CLI_BIN = 'packages/cli/dist/bin.js';
  const testCommand = whichPath || which.sync('node');

  // Scenario A: Test with 'echo' (shell built-in) - THE ACTUAL FAILING TEST
  info('Scenario A: node bin.js run "echo test" (shell built-in)', '');

  try {
    // Test A1: shell:false with echo (should fail - echo is shell built-in)
    const echoArgs = [CLI_BIN, 'run', 'echo test'];
    const echoNoShell = spawnSync(testCommand, echoArgs, {
      encoding: 'utf-8',
      shell: false,
    });

    if (echoNoShell.error) {
      error(`  A1. shell:false + echo: FAILED - ${echoNoShell.error.message}`);
      info('     Error code', (echoNoShell.error as any).code);
      info('     This matches the CI failure!', '');
    } else {
      success(`  A1. shell:false + echo: SUCCESS`);
      info('     Exit code', echoNoShell.status);
    }
  } catch (err) {
    error(`  A1 exception: ${err}`);
  }

  try {
    // Test A2: shell:true with echo (should work)
    const echoArgs = [CLI_BIN, 'run', 'echo test'];
    const echoWithShell = spawnSync(testCommand, echoArgs, {
      encoding: 'utf-8',
      shell: true,
    });

    if (echoWithShell.error) {
      error(`  A2. shell:true + echo: FAILED - ${echoWithShell.error.message}`);
    } else {
      success(`  A2. shell:true + echo: SUCCESS`);
      info('     Exit code', echoWithShell.status);
    }
  } catch (err) {
    error(`  A2 exception: ${err}`);
  }

  // Scenario B: Test with 'node --version' (NOT a shell built-in)
  info('\nScenario B: node bin.js run "node --version" (not built-in)', '');

  try {
    // Test B1: shell:false with node --version (should work if node spawning works)
    const nodeArgs = [CLI_BIN, 'run', 'node --version'];
    const nodeNoShell = spawnSync(testCommand, nodeArgs, {
      encoding: 'utf-8',
      shell: false,
    });

    if (nodeNoShell.error) {
      error(`  B1. shell:false + node: FAILED - ${nodeNoShell.error.message}`);
      info('     Error code', (nodeNoShell.error as any).code);
    } else {
      success(`  B1. shell:false + node: SUCCESS`);
      info('     Exit code', nodeNoShell.status);
    }
  } catch (err) {
    error(`  B1 exception: ${err}`);
  }

  try {
    // Test B2: shell:true with node --version
    const nodeArgs = [CLI_BIN, 'run', 'node --version'];
    const nodeWithShell = spawnSync(testCommand, nodeArgs, {
      encoding: 'utf-8',
      shell: true,
    });

    if (nodeWithShell.error) {
      error(`  B2. shell:true + node: FAILED - ${nodeWithShell.error.message}`);
    } else {
      success(`  B2. shell:true + node: SUCCESS`);
      info('     Exit code', nodeWithShell.status);
    }
  } catch (err) {
    error(`  B2 exception: ${err}`);
  }

  // Scenario C: Test with 'node -e' (JavaScript execution)
  info('\nScenario C: node bin.js run "node -e \\"console.log(...)\\"', '');

  try {
    // Test C1: shell:false with node -e
    const jsArgs = [CLI_BIN, 'run', 'node -e "console.log(\'hello\')"'];
    const jsNoShell = spawnSync(testCommand, jsArgs, {
      encoding: 'utf-8',
      shell: false,
    });

    if (jsNoShell.error) {
      error(`  C1. shell:false + node -e: FAILED - ${jsNoShell.error.message}`);
    } else {
      success(`  C1. shell:false + node -e: SUCCESS`);
      info('     Exit code', jsNoShell.status);
    }
  } catch (err) {
    error(`  C1 exception: ${err}`);
  }

  try {
    // Test C2: shell:true with node -e
    const jsArgs = [CLI_BIN, 'run', 'node -e "console.log(\'hello\')"'];
    const jsWithShell = spawnSync(testCommand, jsArgs, {
      encoding: 'utf-8',
      shell: true,
    });

    if (jsWithShell.error) {
      error(`  C2. shell:true + node -e: FAILED - ${jsWithShell.error.message}`);
    } else {
      success(`  C2. shell:true + node -e: SUCCESS`);
      info('     Exit code', jsWithShell.status);
    }
  } catch (err) {
    error(`  C2 exception: ${err}`);
  }

  // Scenario D: Explicit cmd.exe invocation (Windows-specific)
  if (process.platform === 'win32') {
    info('\nScenario D: Explicit cmd.exe invocation (Windows only)', '');

    try {
      // Test D1: Explicitly call cmd.exe /c node ...
      const cmdPath = process.env.COMSPEC || String.raw`C:\Windows\System32\cmd.exe`;
      const cmdArgs = ['/c', 'node', CLI_BIN, 'run', 'echo test'];
      const cmdResult = spawnSync(cmdPath, cmdArgs, {
        encoding: 'utf-8',
        shell: false,
      });

      if (cmdResult.error) {
        error(`  D1. cmd.exe /c node: FAILED - ${cmdResult.error.message}`);
      } else {
        success(`  D1. cmd.exe /c node: SUCCESS`);
        info('     Exit code', cmdResult.status);
      }
    } catch (err) {
      error(`  D1 exception: ${err}`);
    }
  }

} catch (err) {
  error(`Failed execSync vs spawnSync comparison: ${err}`);
}

// Test 15: tmpdir() and Path Normalization (Windows 8.3 Short Names)
section('15. tmpdir() and Path Normalization (Windows 8.3 Short Names)');
try {
  info('Understanding Windows path behavior', '');

  // Import tmpdir and realpathSync
  const { tmpdir } = await import('node:os');
  const { realpathSync, mkdirSync, rmSync } = await import('node:fs');

  // Get tmpdir path
  const tempPath = tmpdir();
  info('tmpdir() returns', tempPath);
  info('Contains ~ (8.3 short name)?', tempPath.includes('~'));

  // Check if it exists
  if (existsSync(tempPath)) {
    success('tmpdir() path exists');

    // Get real path (resolves short names to long names)
    try {
      const realTemp = realpathSync(tempPath);
      info('realpathSync(tmpdir())', realTemp);
      info('Paths are identical?', tempPath === realTemp);
      info('Paths differ?', tempPath !== realTemp);

      if (tempPath !== realTemp) {
        warn('tmpdir() returns SHORT path, realpathSync() returns LONG path');
        info('  This is the root cause of test failures on Windows!');
        info('  Length diff', `short: ${tempPath.length}, long: ${realTemp.length}`);
      } else {
        success('tmpdir() already returns normalized path');
      }
    } catch (err) {
      error(`realpathSync failed: ${err}`);
    }
  } else {
    error('tmpdir() path does not exist!');
  }

  // Test directory creation and path resolution
  info('\nTesting directory creation and resolution', '');

  // Create a test directory with timestamp
  const testDirName = `vibe-test-${Date.now()}`;
  const testDirShort = join(tempPath, testDirName);

  try {
    mkdirSync(testDirShort, { recursive: true });
    success(`Created directory: ${testDirName}`);

    // Check if directory exists at SHORT path
    info('existsSync(SHORT path)?', existsSync(testDirShort));

    // Get real (long) path
    const testDirLong = realpathSync(testDirShort);
    info('realpathSync(SHORT path)', testDirLong);
    info('existsSync(LONG path)?', existsSync(testDirLong));

    // Check if they're different
    if (testDirShort !== testDirLong) {
      warn('Created directory has DIFFERENT short vs long paths!');
      info('  SHORT', testDirShort);
      info('  LONG ', testDirLong);
      info('  Both exist?', existsSync(testDirShort) && existsSync(testDirLong));

      // Test file creation with both paths
      const testFile = 'test.txt';
      const { writeFileSync } = await import('node:fs');

      writeFileSync(join(testDirShort, testFile), 'test content');
      success('Created file using SHORT path');

      info('File exists via SHORT path?', existsSync(join(testDirShort, testFile)));
      info('File exists via LONG path?', existsSync(join(testDirLong, testFile)));

      if (!existsSync(join(testDirLong, testFile))) {
        error('❌ File NOT accessible via LONG path!');
        error('   This is the bug! Tests use SHORT path, command creates LONG path');
      } else {
        success('✅ File accessible via both SHORT and LONG paths');
      }
    } else {
      success('Paths are already normalized (no short names)');
    }

    // Clean up
    rmSync(testDirShort, { recursive: true, force: true });
    success('Cleaned up test directory');
  } catch (err) {
    error(`Test directory operations failed: ${err}`);
  }

  // Test common path operations
  info('\nTesting common path operations', '');

  const testPaths = [
    tempPath,
    'C:\\Windows\\System32',
    'C:\\PROGRA~1', // Common short name for Program Files
    'C:\\PROGRA~2', // Common short name for Program Files (x86)
  ];

  for (const testPath of testPaths) {
    if (existsSync(testPath)) {
      try {
        const real = realpathSync(testPath);
        if (testPath === real) {
          success(`${testPath} → already normalized`);
        } else {
          warn(`${testPath} → ${real}`);
        }
      } catch (err) {
        error(`realpathSync(${testPath}) failed: ${err}`);
      }
    } else {
      info(`${testPath}`, 'does not exist (skipped)');
    }
  }

  // Key insights summary
  info('\n📚 Key Insights for Windows Testing', '');
  info('1. tmpdir() may return 8.3 short names', 'e.g., RUNNER~1 instead of runneradmin');
  info('2. Node.js operations create directories with LONG names', '');
  info('3. existsSync() checks EXACT path', 'not case-insensitive!');
  info('4. realpathSync() normalizes to LONG path', 'ALWAYS use after tmpdir()!');
  info('5. Windows file system is case-insensitive', 'but path strings are case-sensitive');
  info('\n💡 Fix Pattern', '');
  info('  WRONG:', 'testDir = join(tmpdir(), "test-dir")');
  info('  RIGHT:', 'testDir = realpathSync(join(tmpdir(), "test-dir"))');
  info('  BETTER:', 'mkdirSync(testDir); testDir = realpathSync(testDir);');

} catch (err) {
  error(`Failed tmpdir/path normalization tests: ${err}`);
}

// Test 16: Summary
section('16. Summary & Recommendations');

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

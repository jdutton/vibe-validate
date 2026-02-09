/**
 * ESLint rule: no-unix-shell-commands
 *
 * Prevents usage of Unix-specific commands in exec/spawn calls that break cross-platform compatibility.
 *
 * Why: Commands like 'tar', 'ls', 'touch', 'grep' are Unix-specific and fail on Windows.
 * Use cross-platform alternatives: Node.js fs APIs, or cross-platform npm packages.
 *
 * Detects Unix commands in:
 * - safeExecSync('tar', ...)
 * - safeExecResult('ls', ...)
 * - spawn('grep', ...)
 * - spawnSync('find', ...)
 * - execSync('tar xzf file.tar.gz')
 */

/**
 * Unix-specific commands that should not be used
 * Categorized for better documentation
 */
const UNIX_COMMANDS = {
  // File operations
  fileOps: ['ls', 'touch', 'rm', 'mv', 'cp', 'ln', 'chmod', 'chown', 'chgrp'],

  // Archiving/compression
  archive: ['tar', 'gzip', 'gunzip', 'zip', 'unzip', 'bzip2'],

  // Text processing
  text: ['grep', 'sed', 'awk', 'cat', 'head', 'tail', 'wc', 'cut', 'sort', 'uniq', 'tr'],

  // File searching
  search: ['find', 'locate'],

  // System info
  system: ['ps', 'top', 'kill', 'df', 'du', 'who', 'uname'],

  // Networking
  network: ['curl', 'wget', 'ping', 'netstat', 'ifconfig'],

  // Shell utilities
  shell: ['sh', 'bash', 'zsh', 'source', 'export', 'env'],
};

// Flatten to single array for easier checking
const ALL_UNIX_COMMANDS = Object.values(UNIX_COMMANDS).flat();

/**
 * Check if execSync command string starts with a Unix command
 */
function commandMatchesExecSync(firstArg, unixCommands) {
  // Check string literals: execSync('tar xzf file.tar.gz')
  if (firstArg.type === 'Literal' && typeof firstArg.value === 'string') {
    const cmd = firstArg.value.trim().split(/\s+/)[0];
    return unixCommands.includes(cmd);
  }

  // Check template literals: execSync(`grep ${pattern}`)
  if (firstArg.type === 'TemplateLiteral' && firstArg.quasis.length > 0) {
    const firstQuasi = firstArg.quasis[0].value.cooked || firstArg.quasis[0].value.raw;
    const cmd = firstQuasi.trim().split(/\s+/)[0];
    return unixCommands.includes(cmd);
  }

  return false;
}

/**
 * Get cross-platform alternatives for common Unix commands
 */
function getAlternatives(command) {
  const alternatives = {
    ls: 'fs.readdirSync() or Glob tool',
    touch: 'fs.writeFileSync(path, "") or fs.utimesSync()',
    rm: 'fs.unlinkSync() or fs.rmSync()',
    mv: 'fs.renameSync()',
    cp: 'fs.copyFileSync()',
    cat: 'fs.readFileSync() or Read tool',
    grep: 'Grep tool or string.includes()',
    find: 'Glob tool or fs.readdirSync() with recursion',
    tar: 'tar-fs or tar-stream npm package',
    gzip: 'zlib module',
    chmod: 'fs.chmodSync()',
    chown: 'fs.chownSync()',
    head: 'Read tool with limit parameter',
    tail: 'Read tool with offset parameter',
    sed: 'Edit tool or string.replace()',
    awk: 'string.split() and array methods',
  };

  return alternatives[command] || 'Node.js fs module or cross-platform npm package';
}

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Prevent Unix-specific commands that break Windows compatibility',
      category: 'Cross-Platform',
      recommended: true,
    },
    fixable: null, // No auto-fix - requires manual refactoring
    schema: [],
    messages: {
      noUnixCommand:
        'Unix-specific command "{{command}}" breaks Windows compatibility. Use: {{alternative}}',
    },
  },

  create(context) {
    const factory = require('./no-command-direct-factory.cjs');
    const { createCommandChecker } = factory;

    return {
      CallExpression: createCommandChecker({
        context,
        shouldReport: (node, firstArg, matchesExecSync) => {
          // For shell-free execution (safeExecSync, spawn, etc.)
          if (!matchesExecSync) {
            if (typeof firstArg.value === 'string' && ALL_UNIX_COMMANDS.includes(firstArg.value)) {
              return {
                command: firstArg.value,
                alternative: getAlternatives(firstArg.value),
              };
            }
            return false;
          }

          // For execSync (shell-based) - check if any Unix command is in the string
          for (const unixCmd of ALL_UNIX_COMMANDS) {
            if (matchesExecSync(firstArg, unixCmd)) {
              // Extract command name for better error message
              let command = unixCmd;
              if (firstArg.type === 'Literal') {
                command = firstArg.value.trim().split(/\s+/)[0];
              } else if (firstArg.type === 'TemplateLiteral') {
                const firstQuasi = firstArg.quasis[0].value.cooked || firstArg.quasis[0].value.raw;
                command = firstQuasi.trim().split(/\s+/)[0];
              }

              return {
                command,
                alternative: getAlternatives(command),
              };
            }
          }

          return false;
        },
        messageId: 'noUnixCommand',
      }),
    };
  },
};

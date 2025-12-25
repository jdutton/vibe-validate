/**
 * ESLint rule: no-direct-cli-bin-execution
 *
 * Prevents direct execution of CLI bin.js via node in test files.
 * Enforces using shared CLI execution helpers instead.
 *
 * Why:
 * - Windows compatibility (shared helpers use spawn pattern that works on Windows)
 * - Single source of truth for CLI execution
 * - Easier maintenance (update one place instead of dozens of tests)
 * - Consistent environment variable handling
 *
 * Detects patterns like:
 * - safeExecSync('node', [CLI_BIN, ...])
 * - safeExecResult('node', [CLI_BIN, ...])
 * - spawn('node', [cliPath, ...]) where cliPath looks like a CLI binary
 *
 * Use instead:
 * - executeVvCommand(args, options) from cli-execution-helpers.ts
 * - executeVibeValidateCommand(args, options) from cli-execution-helpers.ts
 *
 * NO AUTO-FIX: Manual refactoring required to use shared helpers.
 */

/**
 * Check if an AST node looks like a CLI binary path reference
 * @param {Object} element - AST node to check
 * @returns {boolean} - True if looks like a CLI binary path
 */
function looksLikeCliBinaryPath(element) {
  if (!element) {
    return false;
  }

  // Check for CLI_BIN identifier or CLI binary path variables
  if (element.type === 'Identifier') {
    const name = element.name.toLowerCase();
    if (
      element.name === 'CLI_BIN' ||
      name.includes('clipath') ||
      name.includes('binpath') ||
      name === 'binpath'
    ) {
      return true;
    }
  }

  // Check for member expressions (e.g., path.join(..., 'bin.js'))
  if (element.type === 'MemberExpression') {
    return true;
  }

  // Check for function calls that resolve paths (resolve, join, normalizePath, getCliPath)
  if (
    element.type === 'CallExpression' &&
    element.callee.name &&
    ['resolve', 'join', 'normalizePath', 'getCliPath'].includes(element.callee.name)
  ) {
    return true;
  }

  return false;
}

/**
 * Check if a call expression matches the pattern: functionName('node', [cliPath, ...])
 * @param {Object} node - AST node to check
 * @param {string[]} functionNames - Function names to match
 * @returns {boolean} - True if pattern matches
 */
function matchesNodeCliPattern(node, functionNames) {
  if (!functionNames.includes(node.callee.name) || node.arguments.length < 2) {
    return false;
  }

  const firstArg = node.arguments[0];
  const secondArg = node.arguments[1];

  // Check if first argument is string literal 'node'
  if (firstArg.type !== 'Literal' || firstArg.value !== 'node') {
    return false;
  }

  // Check if second argument is an array containing a CLI binary path
  if (secondArg.type !== 'ArrayExpression' || secondArg.elements.length === 0) {
    return false;
  }

  return looksLikeCliBinaryPath(secondArg.elements[0]);
}

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Enforce use of shared CLI execution helpers instead of direct node + bin.js execution',
      category: 'Architecture',
      recommended: true,
    },
    fixable: null, // No auto-fix - requires manual refactoring
    schema: [],
    messages: {
      noDirectCliBin: 'Use executeVvCommand() or executeVibeValidateCommand() from cli-execution-helpers.ts instead of directly executing node + CLI_BIN. This ensures Windows compatibility and maintains a single source of truth for CLI execution.',
    },
  },

  create(context) {
    const filename = context.getFilename();

    // Only apply to test files
    if (!filename.includes('.test.ts')) {
      return {};
    }

    // Exempt the shared helper files themselves
    if (
      filename.includes('cli-execution-helpers.ts') ||
      filename.includes('test-command-runner.ts')
    ) {
      return {};
    }

    return {
      CallExpression(node) {
        // Check for safeExecSync('node', ...) or safeExecResult('node', ...)
        if (matchesNodeCliPattern(node, ['safeExecSync', 'safeExecResult'])) {
          context.report({
            node,
            messageId: 'noDirectCliBin',
          });
        }

        // Check for spawn('node', [cliPath, ...])
        if (matchesNodeCliPattern(node, ['spawn'])) {
          context.report({
            node,
            messageId: 'noDirectCliBin',
          });
        }
      },
    };
  },
};

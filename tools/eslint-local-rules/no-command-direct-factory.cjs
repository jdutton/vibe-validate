/**
 * ESLint Rule Factory - Command Execution Checking
 *
 * Single source of truth for:
 * 1. How commands can be executed (safeExecSync, spawn, execSync, etc.)
 * 2. How to check those execution patterns
 * 3. Creating rules that enforce command restrictions
 *
 * This module exports both the factory function and helper utilities
 * so all command-checking rules reference the same execution patterns.
 */

// ============================================================================
// COMMAND EXECUTION PATTERNS - Single Source of Truth
// ============================================================================
// If we add new execution methods (e.g., safeExecAsync), update this list
// and all dependent rules automatically benefit.

/**
 * Check if execSync command string starts with the target command
 *
 * @param {Object} firstArg - AST node for first argument
 * @param {string} command - Command to check for (e.g., 'git')
 * @returns {boolean} True if command matches
 */
function commandMatchesExecSync(firstArg, command) {
  // Check string literals: execSync('git status')
  if (firstArg.type === 'Literal' && typeof firstArg.value === 'string') {
    return firstArg.value.startsWith(`${command} `) || firstArg.value === command;
  }

  // Check template literals: execSync(`git ${args}`)
  if (firstArg.type === 'TemplateLiteral' && firstArg.quasis.length > 0) {
    const firstQuasi = firstArg.quasis[0].value.cooked || firstArg.quasis[0].value.raw;
    return firstQuasi.startsWith(`${command} `) || firstQuasi === command;
  }

  return false;
}

/**
 * Check shell-free command execution (safeExecSync, spawn, etc.)
 * @private
 */
function checkShellFreeExecution(node, context, shouldReport, messageId) {
  const firstArg = node.arguments[0];

  if (firstArg.type !== 'Literal') {
    return;
  }

  const result = shouldReport(node, firstArg);
  if (result) {
    context.report({
      node,
      messageId,
      data: typeof result === 'object' ? result : undefined,
    });
  }
}

/**
 * Check execSync command execution (shell-based)
 * @private
 */
function checkExecSyncExecution(node, context, shouldReport, messageId) {
  const firstArg = node.arguments[0];
  const result = shouldReport(node, firstArg, commandMatchesExecSync);

  if (result) {
    context.report({
      node,
      messageId,
      data: typeof result === 'object' ? result : undefined,
    });
  }
}

/**
 * Check if function is a shell-free execution method
 * @private
 */
function isShellFreeExecution(functionName) {
  return (
    functionName === 'safeExecSync' ||
    functionName === 'safeExecResult' ||
    functionName === 'spawn' ||
    functionName === 'spawnSync'
  );
}

/**
 * Create a CallExpression checker that validates command execution calls
 *
 * This centralizes the logic for detecting command execution patterns across
 * different ESLint rules, eliminating code duplication.
 *
 * @param {Object} options - Configuration options
 * @param {Object} options.context - ESLint rule context
 * @param {Function} options.shouldReport - Predicate that determines if violation should be reported
 *   Can return:
 *   - boolean: true to report with default messageData
 *   - object: messageData to use for error message
 *   - falsy: don't report
 *   Signature: (node, firstArg, matchesExecSync) => boolean | object | falsy
 * @param {string} options.messageId - ESLint message ID to report
 * @returns {Object} ESLint CallExpression visitor
 *
 * @example
 * // Simple boolean check:
 * return {
 *   CallExpression: createCommandChecker({
 *     context,
 *     shouldReport: (node, firstArg) => firstArg.value === 'git',
 *     messageId: 'noGitDirect',
 *   }),
 * };
 *
 * @example
 * // With dynamic messageData:
 * return {
 *   CallExpression: createCommandChecker({
 *     context,
 *     shouldReport: (node, firstArg) => {
 *       if (UNIX_COMMANDS.includes(firstArg.value)) {
 *         return { command: firstArg.value, alternative: getAlt(firstArg.value) };
 *       }
 *       return false;
 *     },
 *     messageId: 'unixCommand',
 *   }),
 * };
 */
function createCommandChecker(options) {
  const { context, shouldReport, messageId } = options;

  return function CallExpression(node) {
    const functionName = node.callee.name;

    if (node.arguments.length === 0) {
      return;
    }

    // Check for shell-free command execution patterns:
    // - safeExecSync('cmd', ...)
    // - safeExecResult('cmd', ...)
    // - spawn('cmd', ...)
    // - spawnSync('cmd', ...)
    if (isShellFreeExecution(functionName)) {
      checkShellFreeExecution(node, context, shouldReport, messageId);
      return;
    }

    // Check for execSync('cmd ...') or execSync(`cmd ...`)
    // Note: execSync is discouraged for security reasons (uses shell)
    if (functionName === 'execSync') {
      checkExecSyncExecution(node, context, shouldReport, messageId);
    }
  };
}

// ============================================================================
// FACTORY FUNCTION - Create Rules for Specific Commands
// ============================================================================

/**
 * Factory: Create rule that prevents direct command execution
 *
 * @param {Object} config - Rule configuration
 * @param {string} config.command - Command name to detect (e.g., 'git', 'gh')
 * @param {string} config.packageName - Package containing wrappers (e.g., '@vibe-validate/git')
 * @param {string[]} config.availableFunctions - List of available wrapper functions
 * @param {string} [config.exemptPackage] - Package to exempt (e.g., 'packages/git/')
 * @returns {Object} ESLint rule definition
 *
 * @example
 * // no-git-commands-direct.cjs
 * const { createNoCommandDirectRule } = require('./no-command-direct-factory.cjs');
 * module.exports = createNoCommandDirectRule({
 *   command: 'git',
 *   packageName: '@vibe-validate/git',
 *   availableFunctions: ['executeGitCommand()', 'getTreeHash()', 'addNote()'],
 *   exemptPackage: 'packages/git/',
 * });
 */

function createNoCommandDirectRule(config) {
  const { command, packageName, availableFunctions, exemptPackage } = config;

  const functionList = availableFunctions.join(', ');
  const messageId = `no${command.charAt(0).toUpperCase()}${command.slice(1)}Direct`;

  return {
    meta: {
      type: 'problem',
      docs: {
        description: `Enforce use of ${packageName} functions instead of direct ${command} command execution`,
        category: 'Architecture',
        recommended: true,
      },
      fixable: null, // No auto-fix - requires manual refactoring
      schema: [],
      messages: {
        [messageId]: `Use functions from ${packageName} instead of calling ${command} commands directly. Available functions: ${functionList}.`,
      },
    },

    create(context) {
      const filename = context.getFilename();

      // Exempt the package itself (where centralization happens)
      if (exemptPackage && filename.includes(exemptPackage)) {
        return {};
      }

      return {
        CallExpression: createCommandChecker({
          context,
          shouldReport: (node, firstArg, matchesExecSync) => {
            // For shell-free execution (safeExecSync, spawn, etc.)
            if (!matchesExecSync) {
              return firstArg.value === command;
            }
            // For execSync (shell-based)
            return matchesExecSync(firstArg, command);
          },
          messageId,
        }),
      };
    },
  };
}

// ============================================================================
// EXPORTS - Factory + Helpers
// ============================================================================
// Export factory as default (for backward compatibility with existing rules)
// and attach helpers as properties (for new rules like no-unix-shell-commands)

module.exports = createNoCommandDirectRule;
module.exports.createCommandChecker = createCommandChecker;
module.exports.commandMatchesExecSync = commandMatchesExecSync;

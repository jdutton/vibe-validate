/**
 * ESLint Rule Factory - No Direct Command Execution
 *
 * Creates ESLint rules that prevent direct command execution and enforce
 * using centralized wrapper functions instead.
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
 * const factory = require('./no-command-direct-factory.cjs');
 * module.exports = factory({
 *   command: 'git',
 *   packageName: '@vibe-validate/git',
 *   availableFunctions: ['executeGitCommand()', 'getTreeHash()', 'addNote()'],
 *   exemptPackage: 'packages/git/',
 * });
 */

/**
 * Check if execSync command string starts with the target command
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

module.exports = function createNoCommandDirectRule(config) {
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
        CallExpression(node) {
          const functionName = node.callee.name;

          // Check for all command execution patterns:
          // - safeExecSync('cmd', ...)
          // - safeExecResult('cmd', ...)
          // - spawn('cmd', ...)
          // - spawnSync('cmd', ...)
          if (
            (functionName === 'safeExecSync' ||
             functionName === 'safeExecResult' ||
             functionName === 'spawn' ||
             functionName === 'spawnSync') &&
            node.arguments.length > 0
          ) {
            const firstArg = node.arguments[0];

            // Check if first argument is string literal matching command
            if (firstArg.type === 'Literal' && firstArg.value === command) {
              context.report({
                node,
                messageId,
              });
            }
          }

          // Check for execSync('cmd ...') or execSync(`cmd ...`)
          if (functionName === 'execSync' && node.arguments.length > 0) {
            const firstArg = node.arguments[0];

            if (commandMatchesExecSync(firstArg, command)) {
              context.report({
                node,
                messageId,
              });
            }
          }
        },
      };
    },
  };
};

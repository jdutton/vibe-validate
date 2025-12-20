/**
 * ESLint rule: no-gh-commands-direct
 *
 * Prevents direct execution of gh (GitHub CLI) commands via safeExecSync/safeExecResult.
 * Enforces using centralized functions from @vibe-validate/git instead.
 *
 * Why:
 * - Architectural consistency (all gh commands in one place)
 * - Easy mocking in tests (mock @vibe-validate/git instead of utils)
 * - Better error handling and validation
 *
 * NO AUTO-FIX: Manual refactoring required to use appropriate @vibe-validate/git function.
 */

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Enforce use of @vibe-validate/git functions instead of direct gh command execution',
      category: 'Architecture',
      recommended: true,
    },
    fixable: null, // No auto-fix - requires manual refactoring
    schema: [],
    messages: {
      noGhDirect: 'Use functions from @vibe-validate/git instead of calling gh commands directly. Available functions: fetchPRDetails(), listPullRequests(), etc.',
    },
  },

  create(context) {
    return {
      CallExpression(node) {
        // Check for safeExecSync('gh', ...) or safeExecResult('gh', ...)
        if (
          (node.callee.name === 'safeExecSync' || node.callee.name === 'safeExecResult') &&
          node.arguments.length > 0
        ) {
          const firstArg = node.arguments[0];

          // Check if first argument is string literal 'gh'
          if (firstArg.type === 'Literal' && firstArg.value === 'gh') {
            context.report({
              node,
              messageId: 'noGhDirect',
            });
          }
        }
      },
    };
  },
};

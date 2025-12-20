/**
 * ESLint rule: no-git-commands-direct
 *
 * Prevents direct execution of git commands via safeExecSync/safeExecResult.
 * Enforces using centralized functions from @vibe-validate/git instead.
 *
 * Why:
 * - Architectural consistency (all git commands in one place)
 * - Easy mocking in tests (mock @vibe-validate/git instead of utils)
 * - Better error handling and validation
 *
 * NO AUTO-FIX: Manual refactoring required to use appropriate @vibe-validate/git function.
 */

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Enforce use of @vibe-validate/git functions instead of direct git command execution',
      category: 'Architecture',
      recommended: true,
    },
    fixable: null, // No auto-fix - requires manual refactoring
    schema: [],
    messages: {
      noGitDirect: 'Use functions from @vibe-validate/git instead of calling git commands directly. Available functions: executeGitCommand(), getTreeHash(), addNote(), listNotesRefs(), etc.',
    },
  },

  create(context) {
    return {
      CallExpression(node) {
        // Check for safeExecSync('git', ...) or safeExecResult('git', ...)
        if (
          (node.callee.name === 'safeExecSync' || node.callee.name === 'safeExecResult') &&
          node.arguments.length > 0
        ) {
          const firstArg = node.arguments[0];

          // Check if first argument is string literal 'git'
          if (firstArg.type === 'Literal' && firstArg.value === 'git') {
            context.report({
              node,
              messageId: 'noGitDirect',
            });
          }
        }
      },
    };
  },
};

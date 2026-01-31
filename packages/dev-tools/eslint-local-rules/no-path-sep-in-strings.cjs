/**
 * ESLint rule to disallow using path.sep in string operations
 *
 * path.sep is '\\' on Windows and '/' on Unix, which causes cross-platform issues
 * when used in string operations. Use toForwardSlash() to normalize paths instead.
 *
 * @example
 * // ❌ BAD - path.sep varies by platform
 * const parts = filePath.split(path.sep);
 * if (filePath.includes(path.sep)) { ... }
 *
 * // ✅ GOOD - normalize then split
 * import { toForwardSlash } from '@vibe-validate/utils';
 * const parts = toForwardSlash(filePath).split('/');
 * if (toForwardSlash(filePath).includes('/')) { ... }
 */

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow using path.sep in string operations',
      category: 'Cross-platform compatibility',
      recommended: true,
    },
    messages: {
      noPathSep:
        'Avoid using path.sep in string operations (split, includes, indexOf, etc.). ' +
        'Use toForwardSlash() from @vibe-validate/utils to normalize paths to forward slashes first.',
    },
    schema: [],
  },

  create(context) {
    // String methods that take a separator/search argument
    const stringMethodsWithSeparator = new Set([
      'split',
      'includes',
      'indexOf',
      'lastIndexOf',
      'startsWith',
      'endsWith',
      'replace',
      'replaceAll',
    ]);

    return {
      CallExpression(node) {
        // Check if this is a string method call
        if (
          node.callee.type !== 'MemberExpression' ||
          node.callee.property.type !== 'Identifier' ||
          !stringMethodsWithSeparator.has(node.callee.property.name)
        ) {
          return;
        }

        // Check if any argument is path.sep
        const hasPathSepArg = node.arguments.some(
          (arg) =>
            arg.type === 'MemberExpression' &&
            arg.object.type === 'Identifier' &&
            arg.object.name === 'path' &&
            arg.property.type === 'Identifier' &&
            arg.property.name === 'sep',
        );

        if (hasPathSepArg) {
          context.report({
            node,
            messageId: 'noPathSep',
          });
        }
      },

      // Also catch template literals and binary expressions using path.sep
      TemplateLiteral(node) {
        const hasPathSep = node.expressions.some(
          (expr) =>
            expr.type === 'MemberExpression' &&
            expr.object.type === 'Identifier' &&
            expr.object.name === 'path' &&
            expr.property.type === 'Identifier' &&
            expr.property.name === 'sep',
        );

        if (hasPathSep) {
          context.report({
            node,
            messageId: 'noPathSep',
          });
        }
      },

      BinaryExpression(node) {
        // Check for string concatenation with path.sep
        if (node.operator === '+') {
          const hasPathSep =
            (node.left.type === 'MemberExpression' &&
              node.left.object.type === 'Identifier' &&
              node.left.object.name === 'path' &&
              node.left.property.type === 'Identifier' &&
              node.left.property.name === 'sep') ||
            (node.right.type === 'MemberExpression' &&
              node.right.object.type === 'Identifier' &&
              node.right.object.name === 'path' &&
              node.right.property.type === 'Identifier' &&
              node.right.property.name === 'sep');

          if (hasPathSep) {
            context.report({
              node,
              messageId: 'noPathSep',
            });
          }
        }
      },
    };
  },
};

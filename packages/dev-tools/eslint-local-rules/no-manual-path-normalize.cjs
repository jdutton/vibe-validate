/**
 * ESLint rule to enforce using toForwardSlash() instead of manual normalization
 *
 * Detects manual path normalization patterns and suggests using the utility function.
 *
 * @example
 * // ❌ BAD - manual normalization
 * const normalized = relativePath.split(path.sep).join('/');
 * const normalized = somePath.split('\\').join('/');
 *
 * // ✅ GOOD - use utility function
 * import { toForwardSlash } from '@vibe-validate/utils';
 * const normalized = toForwardSlash(relativePath);
 */

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow manual path normalization patterns',
      category: 'Cross-platform compatibility',
      recommended: true,
    },
    fixable: 'code',
    messages: {
      useToForwardSlash:
        'Use toForwardSlash() from @vibe-validate/utils instead of manual path normalization. ' +
        'Manual normalization is error-prone and less maintainable.',
    },
    schema: [],
  },

  create(context) {
    const sourceCode = context.getSourceCode();
    let hasToForwardSlashImport = false;
    let utilsImportNode = null;

    return {
      ImportDeclaration(node) {
        if (node.source.value === '@vibe-validate/utils') {
          utilsImportNode = node;
          node.specifiers.forEach((spec) => {
            if (spec.type === 'ImportSpecifier' && spec.imported.name === 'toForwardSlash') {
              hasToForwardSlashImport = true;
            }
          });
        }
      },

      CallExpression(node) {
        // Check for .split(...).join('/') pattern
        if (
          node.callee.type === 'MemberExpression' &&
          node.callee.property.name === 'join' &&
          node.arguments.length === 1 &&
          node.arguments[0].type === 'Literal' &&
          node.arguments[0].value === '/'
        ) {
          // Check if the object is a .split() call
          const splitCall = node.callee.object;
          if (
            splitCall.type === 'CallExpression' &&
            splitCall.callee.type === 'MemberExpression' &&
            splitCall.callee.property.name === 'split' &&
            splitCall.arguments.length === 1
          ) {
            const splitArg = splitCall.arguments[0];

            // Check if splitting by path.sep, '\\', or '\\\\'
            const isSplittingByPathSep =
              (splitArg.type === 'MemberExpression' &&
                splitArg.object.name === 'path' &&
                splitArg.property.name === 'sep') ||
              (splitArg.type === 'Literal' && (splitArg.value === '\\' || splitArg.value === '\\\\'));

            if (isSplittingByPathSep) {
              const variableBeingSplit = splitCall.callee.object;

              context.report({
                node,
                messageId: 'useToForwardSlash',
                fix(fixer) {
                  const fixes = [];

                  // Replace the entire .split(...).join('/') with toForwardSlash(...)
                  const originalVar = sourceCode.getText(variableBeingSplit);
                  fixes.push(fixer.replaceText(node, `toForwardSlash(${originalVar})`));

                  // Add import if needed
                  if (!hasToForwardSlashImport) {
                    if (utilsImportNode) {
                      // Add to existing utils import
                      const lastSpecifier = utilsImportNode.specifiers[utilsImportNode.specifiers.length - 1];
                      fixes.push(fixer.insertTextAfter(lastSpecifier, ', toForwardSlash'));
                    } else {
                      // Create new import at the top
                      const firstNode = sourceCode.ast.body[0];
                      const newImport = `import { toForwardSlash } from '@vibe-validate/utils';\n`;
                      fixes.push(fixer.insertTextBefore(firstNode, newImport));
                    }
                  }

                  return fixes;
                },
              });
            }
          }
        }
      },
    };
  },
};

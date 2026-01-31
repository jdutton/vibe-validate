/**
 * ESLint rule to enforce normalizing path operations before string comparisons
 *
 * path.relative(), path.dirname(), path.basename(), path.join() return OS-specific separators.
 * When comparing with literal strings (especially in markdown), normalize to forward slashes.
 *
 * @example
 * // ❌ BAD - path.relative() returns backslashes on Windows
 * const relativePath = path.relative(baseDir, filePath);
 * if (content.includes(relativePath)) { ... }  // FAILS on Windows!
 *
 * // ✅ GOOD - normalize before comparison
 * import { toForwardSlash } from '@vibe-validate/utils';
 * const relativePath = toForwardSlash(path.relative(baseDir, filePath));
 * if (content.includes(relativePath)) { ... }
 */

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow using path operations directly in string comparisons',
      category: 'Cross-platform compatibility',
      recommended: true,
    },
    messages: {
      normalizePathOperation:
        'Wrap path.{{method}}() with toForwardSlash() from @vibe-validate/utils before using in string operations. ' +
        'Path operations return OS-specific separators that fail in cross-platform comparisons.',
    },
    schema: [],
  },

  create(context) {
    // Path methods that return paths with OS-specific separators
    const pathMethodsReturningPaths = new Set([
      'relative',
      'dirname',
      'basename',
      'join',
      'resolve',
      'normalize',
    ]);

    // String methods that compare/search strings
    const stringComparisonMethods = new Set([
      'includes',
      'indexOf',
      'lastIndexOf',
      'startsWith',
      'endsWith',
      'split',
      'replace',
      'replaceAll',
      'match',
      'search',
    ]);

    // Track variables that hold unwrapped path operation results
    const unwrappedPathVariables = new Set();
    const wrappedPathVariables = new Set();

    return {
      VariableDeclarator(node) {
        if (!node.init) return;

        // Check if initializer is a path operation
        if (
          node.init.type === 'CallExpression' &&
          node.init.callee.type === 'MemberExpression' &&
          node.init.callee.object.type === 'Identifier' &&
          node.init.callee.object.name === 'path' &&
          pathMethodsReturningPaths.has(node.init.callee.property.name)
        ) {
          // Check if it's wrapped in toForwardSlash()
          if (node.id.type === 'Identifier') {
            unwrappedPathVariables.add(node.id.name);
          }
        }

        // Check if initializer is toForwardSlash(path.operation())
        if (
          node.init.type === 'CallExpression' &&
          node.init.callee.type === 'Identifier' &&
          node.init.callee.name === 'toForwardSlash' &&
          node.init.arguments.length === 1
        ) {
          if (node.id.type === 'Identifier') {
            wrappedPathVariables.add(node.id.name);
          }
        }
      },

      CallExpression(node) {
        // Check for direct path operation in string method argument
        // e.g., content.includes(path.relative(...))
        if (
          node.callee.type === 'MemberExpression' &&
          stringComparisonMethods.has(node.callee.property.name)
        ) {
          node.arguments.forEach((arg) => {
            if (
              arg.type === 'CallExpression' &&
              arg.callee.type === 'MemberExpression' &&
              arg.callee.object.type === 'Identifier' &&
              arg.callee.object.name === 'path' &&
              pathMethodsReturningPaths.has(arg.callee.property.name)
            ) {
              context.report({
                node: arg,
                messageId: 'normalizePathOperation',
                data: {
                  method: arg.callee.property.name,
                },
              });
            }

            // Check if using unwrapped path variable
            if (
              arg.type === 'Identifier' &&
              unwrappedPathVariables.has(arg.name) &&
              !wrappedPathVariables.has(arg.name)
            ) {
              context.report({
                node: arg,
                messageId: 'normalizePathOperation',
                data: {
                  method: 'operation',
                },
              });
            }
          });
        }

        // Check for path operations in template literals used in string methods
        if (
          node.callee.type === 'MemberExpression' &&
          stringComparisonMethods.has(node.callee.property.name)
        ) {
          node.arguments.forEach((arg) => {
            if (arg.type === 'TemplateLiteral') {
              arg.expressions.forEach((expr) => {
                if (
                  expr.type === 'CallExpression' &&
                  expr.callee.type === 'MemberExpression' &&
                  expr.callee.object.type === 'Identifier' &&
                  expr.callee.object.name === 'path' &&
                  pathMethodsReturningPaths.has(expr.callee.property.name)
                ) {
                  context.report({
                    node: expr,
                    messageId: 'normalizePathOperation',
                    data: {
                      method: expr.callee.property.name,
                    },
                  });
                }
              });
            }
          });
        }
      },
    };
  },
};

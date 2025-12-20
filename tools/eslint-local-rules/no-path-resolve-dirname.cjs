/**
 * ESLint rule: no-path-resolve-dirname
 *
 * Prevents usage of path.resolve(__dirname, ...) in test files.
 * Enforces normalizePath() from @vibe-validate/utils instead.
 *
 * Why:
 * - path.resolve() doesn't normalize Windows 8.3 short paths (RUNNER~1)
 * - This causes test failures on Windows CI where paths contain short names
 * - normalizePath() handles Windows 8.3 resolution consistently
 * - Tests should use getCliPath() or normalizePath() for CLI binary paths
 *
 * Applies to:
 * - Test files (*.test.ts, *.test.js, test/**, __tests__/**)
 * - Only when first argument is __dirname
 *
 * Auto-fix: Replaces path.resolve(__dirname, ...) with normalizePath(__dirname, ...)
 */

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Enforce normalizePath() instead of path.resolve(__dirname) in tests',
      category: 'Best Practices',
      recommended: true,
    },
    fixable: 'code',
    schema: [],
    messages: {
      noPathResolveDirname:
        'Use normalizePath() from @vibe-validate/utils instead of path.resolve(__dirname) for Windows 8.3 path compatibility. Consider using getCliPath() for CLI binary paths.',
    },
  },

  create(context) {
    const filename = context.getFilename();
    const sourceCode = context.getSourceCode();

    // Only apply to test files
    const isTestFile =
      filename.includes('.test.') ||
      filename.includes('/test/') ||
      filename.includes('\\test\\') ||
      filename.includes('__tests__');

    if (!isTestFile) {
      return {};
    }

    // Exempt cli-execution-helpers.ts since it implements the helper functions
    if (filename.includes('cli-execution-helpers.ts')) {
      return {};
    }

    let pathImportNode = null;
    let hasNormalizePathImport = false;
    let normalizePathImportNode = null;

    return {
      ImportDeclaration(node) {
        // Track path module imports
        if (node.source.value === 'node:path' || node.source.value === 'path') {
          pathImportNode = node;
        }

        // Track normalizePath imports
        if (node.source.value === '@vibe-validate/utils') {
          normalizePathImportNode = node;
          node.specifiers.forEach((spec) => {
            if (spec.type === 'ImportSpecifier' && spec.imported.name === 'normalizePath') {
              hasNormalizePathImport = true;
            }
          });
        }
      },

      CallExpression(node) {
        // Check for path.resolve(__dirname, ...)
        if (
          node.callee.type === 'MemberExpression' &&
          node.callee.object.name === 'path' &&
          node.callee.property.name === 'resolve' &&
          node.arguments.length > 0 &&
          node.arguments[0].name === '__dirname'
        ) {
          context.report({
            node,
            messageId: 'noPathResolveDirname',
            fix(fixer) {
              const fixes = [];

              // Replace path.resolve with normalizePath
              fixes.push(fixer.replaceText(node.callee, 'normalizePath'));

              // Add normalizePath import if needed
              if (!hasNormalizePathImport) {
                if (normalizePathImportNode) {
                  // Add to existing @vibe-validate/utils import
                  const lastSpecifier =
                    normalizePathImportNode.specifiers[normalizePathImportNode.specifiers.length - 1];
                  fixes.push(fixer.insertTextAfter(lastSpecifier, ', normalizePath'));
                } else {
                  // Create new import after path import or at the top
                  const targetNode = pathImportNode || sourceCode.ast.body[0];
                  const newImport = `import { normalizePath } from '@vibe-validate/utils';\n`;
                  fixes.push(fixer.insertTextAfter(targetNode, newImport));
                }
              }

              return fixes;
            },
          });
        }
      },
    };
  },
};

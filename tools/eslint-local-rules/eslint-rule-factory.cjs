/**
 * ESLint Rule Factory - Shared implementation for unsafe operation rules
 *
 * Creates ESLint rules that detect unsafe operations and suggest safe alternatives.
 * Supports auto-fixing with import management.
 *
 * @param {Object} config - Rule configuration
 * @param {string} config.unsafeFn - Name of unsafe function (e.g., 'tmpdir', 'mkdirSync')
 * @param {string} config.unsafeModule - Module containing unsafe function (e.g., 'node:os', 'node:fs')
 * @param {string} config.safeFn - Name of safe replacement function (e.g., 'normalizedTmpdir')
 * @param {string} config.safeModule - Module containing safe function (e.g., '@vibe-validate/utils')
 * @param {string} config.message - Error message to display
 * @param {string} [config.exemptFile] - Filename pattern to exempt (e.g., 'safe-exec.ts')
 * @param {boolean} [config.checkMemberExpression] - Check for obj.method() calls (default: false)
 * @returns {Object} ESLint rule definition
 *
 * @example
 * // no-os-tmpdir.cjs
 * const factory = require('./eslint-rule-factory.cjs');
 * module.exports = factory({
 *   unsafeFn: 'tmpdir',
 *   unsafeModule: 'node:os',
 *   safeFn: 'normalizedTmpdir',
 *   safeModule: '@vibe-validate/utils',
 *   message: 'Use normalizedTmpdir() for Windows compatibility',
 * });
 */

/**
 * Helper function to filter unsafe import specifiers
 * Extracted to reduce nesting depth for code quality
 */
function filterUnsafeSpecifiers(importNode, unsafeFn) {
  return importNode.specifiers.filter((s) => s.imported && s.imported.name === unsafeFn);
}

/**
 * Helper function to remove unsafe import specifiers
 * Extracted to reduce nesting depth for code quality
 */
function removeUnsafeImportSpecifiers(fixer, sourceCode, unsafeImportNode, unsafeSpecs) {
  const fixes = [];
  unsafeSpecs.forEach((spec) => {
    const comma = sourceCode.getTokenAfter(spec);
    if (comma && comma.value === ',') {
      fixes.push(fixer.removeRange([spec.range[0], comma.range[1]]));
    } else {
      const commaBefore = sourceCode.getTokenBefore(spec);
      if (commaBefore && commaBefore.value === ',') {
        fixes.push(fixer.removeRange([commaBefore.range[0], spec.range[1]]));
      } else {
        fixes.push(fixer.remove(spec));
      }
    }
  });
  return fixes;
}

module.exports = function createNoUnsafeRule(config) {
  const {
    unsafeFn,
    unsafeModule,
    safeFn,
    safeModule,
    message,
    exemptFile,
    checkMemberExpression = false,
  } = config;

  // Normalize module names (support both 'node:os' and 'os')
  const moduleVariants = [unsafeModule];
  if (unsafeModule.startsWith('node:')) {
    moduleVariants.push(unsafeModule.replace('node:', ''));
  } else {
    moduleVariants.push(`node:${unsafeModule}`);
  }

  return {
    meta: {
      type: 'problem',
      docs: {
        description: `Enforce use of ${safeFn}() instead of ${unsafeFn}()`,
        category: 'Best Practices',
        recommended: true,
      },
      fixable: 'code',
      schema: [],
      messages: {
        noUnsafeOperation: message,
      },
    },

    create(context) {
      const filename = context.getFilename();
      const sourceCode = context.getSourceCode();

      // Check if this file is exempt
      if (exemptFile && filename.includes(exemptFile)) {
        return {};
      }

      let hasUnsafeImport = false;
      let hasSafeImport = false;
      let unsafeImportNode = null;
      let safeImportNode = null;

      return {
        ImportDeclaration(node) {
          // Track unsafe module imports
          if (moduleVariants.includes(node.source.value)) {
            unsafeImportNode = node;
            node.specifiers.forEach((spec) => {
              if (spec.type === 'ImportSpecifier' && spec.imported.name === unsafeFn) {
                hasUnsafeImport = true;
              }
            });
          }

          // Track safe module imports
          if (node.source.value === safeModule) {
            safeImportNode = node;
            node.specifiers.forEach((spec) => {
              if (spec.type === 'ImportSpecifier' && spec.imported.name === safeFn) {
                hasSafeImport = true;
              }
            });
          }
        },

        CallExpression(node) {
          let isUnsafeCall = false;

          // Check for direct function call: unsafeFn()
          if (node.callee.name === unsafeFn) {
            isUnsafeCall = true;
          }

          // Check for member expression: obj.unsafeFn()
          if (
            checkMemberExpression &&
            node.callee.type === 'MemberExpression' &&
            node.callee.property.name === unsafeFn
          ) {
            isUnsafeCall = true;
          }

          if (!isUnsafeCall) {
            return;
          }

          context.report({
            node,
            messageId: 'noUnsafeOperation',
            fix(fixer) {
              const fixes = [];

              // Replace unsafe call with safe call
              if (node.callee.type === 'MemberExpression') {
                // For obj.method(), replace just the method name
                fixes.push(fixer.replaceText(node.callee.property, safeFn));
              } else {
                // For method(), replace the whole callee
                fixes.push(fixer.replaceText(node.callee, safeFn));
              }

              // Add import if needed
              if (!hasSafeImport) {
                if (safeImportNode) {
                  // Add to existing safe module import
                  const lastSpecifier = safeImportNode.specifiers[safeImportNode.specifiers.length - 1];
                  fixes.push(fixer.insertTextAfter(lastSpecifier, `, ${safeFn}`));
                } else {
                  // Create new import after unsafe import or at the top
                  const targetNode = unsafeImportNode || sourceCode.ast.body[0];
                  const newImport = `import { ${safeFn} } from '${safeModule}';\n`;
                  fixes.push(fixer.insertTextAfter(targetNode, newImport));
                }
              }

              // Remove unsafe import if it's the only specifier
              if (hasUnsafeImport && unsafeImportNode) {
                const unsafeSpecs = filterUnsafeSpecifiers(unsafeImportNode, unsafeFn);
                if (unsafeImportNode.specifiers.length === 1 && unsafeSpecs.length === 1) {
                  // Remove entire import
                  fixes.push(fixer.remove(unsafeImportNode));
                } else if (unsafeSpecs.length > 0) {
                  // Remove just the unsafe specifier
                  fixes.push(...removeUnsafeImportSpecifiers(fixer, sourceCode, unsafeImportNode, unsafeSpecs));
                }
              }

              return fixes;
            },
          });
        },
      };
    },
  };
};

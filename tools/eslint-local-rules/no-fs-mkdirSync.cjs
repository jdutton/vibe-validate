/**
 * ESLint rule: no-fs-mkdirSync
 *
 * Prevents usage of fs.mkdirSync() in favor of mkdirSyncReal() from @vibe-validate/utils
 *
 * Why: fs.mkdirSync() doesn't resolve Windows 8.3 short paths. If the parent path contains
 * short names (RUNNER~1), the created directory path will also have short names, causing
 * module loading errors when passed to child processes.
 *
 * mkdirSyncReal() creates the directory AND returns the normalized (long) path.
 *
 * Auto-fix: Replaces fs.mkdirSync() with mkdirSyncReal() assignment pattern and adds required import.
 */

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Enforce use of mkdirSyncReal() instead of fs.mkdirSync() for Windows compatibility',
      category: 'Best Practices',
      recommended: true,
    },
    fixable: 'code',
    schema: [],
    messages: {
      noFsMkdirSync: 'Use mkdirSyncReal() from @vibe-validate/utils instead of fs.mkdirSync() for Windows compatibility (returns normalized path without 8.3 short names)',
    },
  },

  create(context) {
    const sourceCode = context.getSourceCode();
    let hasMkdirSyncImport = false;
    let hasMkdirSyncRealImport = false;
    let utilsImportNode = null;
    let fsImportNode = null;

    return {
      ImportDeclaration(node) {
        if (node.source.value === 'node:fs' || node.source.value === 'fs') {
          fsImportNode = node;
          node.specifiers.forEach(spec => {
            if (spec.type === 'ImportSpecifier' && spec.imported.name === 'mkdirSync') {
              hasMkdirSyncImport = true;
            }
          });
        }

        if (node.source.value === '@vibe-validate/utils') {
          utilsImportNode = node;
          node.specifiers.forEach(spec => {
            if (spec.type === 'ImportSpecifier' && spec.imported.name === 'mkdirSyncReal') {
              hasMkdirSyncRealImport = true;
            }
          });
        }
      },

      CallExpression(node) {
        // Check for mkdirSync() call
        if (node.callee.name === 'mkdirSync') {
          context.report({
            node,
            messageId: 'noFsMkdirSync',
            fix(fixer) {
              const fixes = [];

              // Replace mkdirSync with mkdirSyncReal
              fixes.push(fixer.replaceText(node.callee, 'mkdirSyncReal'));

              // Add import if needed
              if (!hasMkdirSyncRealImport) {
                if (utilsImportNode) {
                  // Add to existing @vibe-validate/utils import
                  const lastSpecifier = utilsImportNode.specifiers[utilsImportNode.specifiers.length - 1];
                  fixes.push(fixer.insertTextAfter(lastSpecifier, ', mkdirSyncReal'));
                } else {
                  // Create new import after fs import or at the top
                  const targetNode = fsImportNode || sourceCode.ast.body[0];
                  const newImport = "import { mkdirSyncReal } from '@vibe-validate/utils';\n";
                  fixes.push(fixer.insertTextAfter(targetNode, newImport));
                }
              }

              // Remove mkdirSync from fs import if it's the only specifier
              if (hasMkdirSyncImport && fsImportNode) {
                const mkdirSyncSpecs = fsImportNode.specifiers.filter(s => s.imported && s.imported.name === 'mkdirSync');
                if (fsImportNode.specifiers.length === 1 && mkdirSyncSpecs.length === 1) {
                  // Remove entire import
                  fixes.push(fixer.remove(fsImportNode));
                } else if (mkdirSyncSpecs.length > 0) {
                  // Remove just mkdirSync specifier
                  mkdirSyncSpecs.forEach(spec => {
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

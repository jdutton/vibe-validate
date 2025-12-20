/**
 * ESLint rule: no-child-process-execSync
 *
 * Prevents usage of execSync() from child_process in favor of safeExecSync() from @vibe-validate/utils
 *
 * Why: execSync() uses shell: true by default, which:
 * - Creates command injection vulnerabilities
 * - Causes Windows platform compatibility issues
 * - Bypasses proper command resolution
 *
 * Auto-fix: Replaces execSync() with safeExecSync() and adds required import.
 */

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Enforce use of safeExecSync() instead of execSync() for security and cross-platform compatibility',
      category: 'Security',
      recommended: true,
    },
    fixable: 'code',
    schema: [],
    messages: {
      noExecSync: 'Use safeExecSync() from @vibe-validate/utils instead of execSync() for security (no shell injection) and Windows compatibility',
    },
  },

  create(context) {
    const sourceCode = context.getSourceCode();
    let hasExecSyncImport = false;
    let hasSafeExecSyncImport = false;
    let utilsImportNode = null;
    let childProcessImportNode = null;

    return {
      ImportDeclaration(node) {
        if (node.source.value === 'node:child_process' || node.source.value === 'child_process') {
          childProcessImportNode = node;
          node.specifiers.forEach(spec => {
            if (spec.type === 'ImportSpecifier' && spec.imported.name === 'execSync') {
              hasExecSyncImport = true;
            }
          });
        }

        if (node.source.value === '@vibe-validate/utils') {
          utilsImportNode = node;
          node.specifiers.forEach(spec => {
            if (spec.type === 'ImportSpecifier' && spec.imported.name === 'safeExecSync') {
              hasSafeExecSyncImport = true;
            }
          });
        }
      },

      CallExpression(node) {
        // Check for execSync() call
        if (node.callee.name === 'execSync') {
          context.report({
            node,
            messageId: 'noExecSync',
            fix(fixer) {
              const fixes = [];

              // Replace execSync with safeExecSync
              fixes.push(fixer.replaceText(node.callee, 'safeExecSync'));

              // Add import if needed
              if (!hasSafeExecSyncImport) {
                if (utilsImportNode) {
                  // Add to existing @vibe-validate/utils import
                  const lastSpecifier = utilsImportNode.specifiers[utilsImportNode.specifiers.length - 1];
                  fixes.push(fixer.insertTextAfter(lastSpecifier, ', safeExecSync'));
                } else {
                  // Create new import after child_process import or at the top
                  const targetNode = childProcessImportNode || sourceCode.ast.body[0];
                  const newImport = "import { safeExecSync } from '@vibe-validate/utils';\n";
                  fixes.push(fixer.insertTextAfter(targetNode, newImport));
                }
              }

              // Remove execSync from child_process import if it's the only specifier
              if (hasExecSyncImport && childProcessImportNode) {
                const execSyncSpecs = childProcessImportNode.specifiers.filter(s => s.imported && s.imported.name === 'execSync');
                if (childProcessImportNode.specifiers.length === 1 && execSyncSpecs.length === 1) {
                  // Remove entire import
                  fixes.push(fixer.remove(childProcessImportNode));
                } else if (execSyncSpecs.length > 0) {
                  // Remove just execSync specifier
                  execSyncSpecs.forEach(spec => {
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

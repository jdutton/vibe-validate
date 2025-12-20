/**
 * ESLint rule: no-os-tmpdir
 *
 * Prevents usage of os.tmpdir() in favor of normalizedTmpdir() from @vibe-validate/utils
 *
 * Why: os.tmpdir() returns Windows 8.3 short paths (RUNNER~1) which cause module loading
 * errors when paths are passed to child processes or used with import statements.
 *
 * Auto-fix: Replaces os.tmpdir() with normalizedTmpdir() and adds required import.
 */

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Enforce use of normalizedTmpdir() instead of os.tmpdir() for Windows compatibility',
      category: 'Best Practices',
      recommended: true,
    },
    fixable: 'code',
    schema: [],
    messages: {
      noOsTmpdir: 'Use normalizedTmpdir() from @vibe-validate/utils instead of os.tmpdir() for Windows compatibility (prevents 8.3 short name issues like RUNNER~1)',
    },
  },

  create(context) {
    const sourceCode = context.getSourceCode();
    let hasTmpdirImport = false;
    let hasNormalizedTmpdirImport = false;
    let utilsImportNode = null;
    let osImportNode = null;

    return {
      ImportDeclaration(node) {
        if (node.source.value === 'node:os' || node.source.value === 'os') {
          osImportNode = node;
          node.specifiers.forEach(spec => {
            if (spec.type === 'ImportSpecifier' && spec.imported.name === 'tmpdir') {
              hasTmpdirImport = true;
            }
          });
        }

        if (node.source.value === '@vibe-validate/utils') {
          utilsImportNode = node;
          node.specifiers.forEach(spec => {
            if (spec.type === 'ImportSpecifier' && spec.imported.name === 'normalizedTmpdir') {
              hasNormalizedTmpdirImport = true;
            }
          });
        }
      },

      CallExpression(node) {
        // Check for tmpdir() call
        if (node.callee.name === 'tmpdir') {
          context.report({
            node,
            messageId: 'noOsTmpdir',
            fix(fixer) {
              const fixes = [];

              // Replace tmpdir() with normalizedTmpdir()
              fixes.push(fixer.replaceText(node.callee, 'normalizedTmpdir'));

              // Add import if needed
              if (!hasNormalizedTmpdirImport) {
                if (utilsImportNode) {
                  // Add to existing @vibe-validate/utils import
                  const lastSpecifier = utilsImportNode.specifiers[utilsImportNode.specifiers.length - 1];
                  fixes.push(fixer.insertTextAfter(lastSpecifier, ', normalizedTmpdir'));
                } else {
                  // Create new import after os import or at the top
                  const targetNode = osImportNode || sourceCode.ast.body[0];
                  const newImport = "import { normalizedTmpdir } from '@vibe-validate/utils';\n";
                  fixes.push(fixer.insertTextAfter(targetNode, newImport));
                }
              }

              // Remove tmpdir from os import if it's the only specifier
              if (hasTmpdirImport && osImportNode) {
                const tmpdirSpecs = osImportNode.specifiers.filter(s => s.imported && s.imported.name === 'tmpdir');
                if (osImportNode.specifiers.length === 1 && tmpdirSpecs.length === 1) {
                  // Remove entire import
                  fixes.push(fixer.remove(osImportNode));
                } else if (tmpdirSpecs.length > 0) {
                  // Remove just tmpdir specifier
                  tmpdirSpecs.forEach(spec => {
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

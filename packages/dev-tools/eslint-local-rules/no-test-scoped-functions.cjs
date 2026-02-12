/**
 * ESLint rule to disallow function declarations inside test blocks
 *
 * Catches the SonarQube code smell: "Move function to the outer scope"
 * Functions defined inside describe/it/test blocks should be moved to module scope
 * for better reusability and to prevent the code smell.
 *
 * Why: Helper functions inside test blocks are harder to:
 * - Reuse across test files
 * - Test independently
 * - Understand (hidden inside blocks)
 * - Maintain (scattered throughout test suites)
 *
 * @example
 * // ❌ BAD - Function inside describe block
 * describe('validate command', () => {
 *   function setupWorkingDirectoryMocks(configDir, treeHash) {
 *     // ... setup code
 *   }
 *
 *   it('should work', () => {
 *     setupWorkingDirectoryMocks('/path', 'abc123');
 *   });
 * });
 *
 * // ✅ GOOD - Function at module scope
 * function setupWorkingDirectoryMocks(configDir, treeHash) {
 *   // ... setup code
 * }
 *
 * describe('validate command', () => {
 *   it('should work', () => {
 *     setupWorkingDirectoryMocks('/path', 'abc123');
 *   });
 * });
 */

module.exports = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Disallow function declarations inside test blocks (SonarQube code smell)',
      category: 'Best Practices',
      recommended: true,
    },
    messages: {
      moveToModuleScope:
        'Move function \'{{name}}\' to module scope (outside describe/it/test blocks). ' +
        'Helper functions inside test blocks are harder to reuse and maintain. ' +
        'This matches SonarQube rule S1515 (Intentionality/Maintainability).',
    },
    schema: [
      {
        type: 'object',
        properties: {
          allowedFunctionNames: {
            type: 'array',
            items: { type: 'string' },
            description: 'Function names that are allowed inside test blocks',
          },
        },
        additionalProperties: false,
      },
    ],
  },

  create(context) {
    let testBlockDepth = 0;
    const allowedNames = new Set(
      context.options[0]?.allowedFunctionNames || []
    );

    /**
     * Check if a node is a test-related call expression
     * (describe, it, test, beforeEach, afterEach, beforeAll, afterAll, etc.)
     */
    function isTestBlock(node) {
      if (node.type !== 'CallExpression') {
        return false;
      }

      const callee = node.callee;

      // Direct calls: describe(), it(), test(), etc.
      if (callee.type === 'Identifier') {
        return /^(describe|it|test|before|after|beforeEach|afterEach|beforeAll|afterAll)$/i.test(
          callee.name
        );
      }

      // Member calls: test.describe(), test.it(), etc. (Playwright)
      if (
        callee.type === 'MemberExpression' &&
        callee.property.type === 'Identifier'
      ) {
        return /^(describe|it|test|before|after|beforeEach|afterEach|beforeAll|afterAll)$/i.test(
          callee.property.name
        );
      }

      return false;
    }

    return {
      // Track entering any call expression
      CallExpression(node) {
        if (isTestBlock(node)) {
          testBlockDepth++;
        }
      },

      // Track exiting any call expression
      'CallExpression:exit'(node) {
        if (isTestBlock(node)) {
          testBlockDepth--;
        }
      },

      // Check function declarations
      FunctionDeclaration(node) {
        // Only flag if we're inside a test block
        if (testBlockDepth > 0) {
          const functionName = node.id?.name || '<anonymous>';

          // Skip if this function name is explicitly allowed
          if (allowedNames.has(functionName)) {
            return;
          }

          context.report({
            node,
            messageId: 'moveToModuleScope',
            data: {
              name: functionName,
            },
          });
        }
      },
    };
  },
};

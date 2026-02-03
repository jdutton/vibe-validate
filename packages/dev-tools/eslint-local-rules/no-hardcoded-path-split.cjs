/**
 * ESLint rule to disallow splitting strings by hardcoded path separators
 *
 * Using .split('/') or .split('\\') on file paths breaks on Windows/Unix.
 * Use path.basename(), path.dirname(), or normalize with toForwardSlash() first.
 *
 * This rule is smart enough to detect when paths are already normalized:
 * - Inline: toForwardSlash(path).split('/') ✅
 * - Variable: const normalized = toForwardSlash(path); normalized.split('/') ✅
 *
 * @example
 * // ❌ BAD - breaks on Windows (paths use backslashes)
 * const filename = filePath.split('/').pop();
 * const parts = filePath.split('\\');
 *
 * // ✅ GOOD - use path.basename() for filename
 * import { basename } from 'node:path';
 * const filename = basename(filePath);
 *
 * // ✅ GOOD - normalize then split (inline)
 * import { toForwardSlash } from '@vibe-validate/utils';
 * const parts = toForwardSlash(filePath).split('/');
 *
 * // ✅ GOOD - normalize then split (variable)
 * const normalizedPath = toForwardSlash(filePath);
 * const parts = normalizedPath.split('/');
 */

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow splitting strings by hardcoded path separators',
      category: 'Cross-platform compatibility',
      recommended: true,
    },
    messages: {
      noHardcodedSplit:
        String.raw`Avoid .split('/') or .split('\') on file paths (breaks on Windows/Unix). ` +
        'Use path.basename() to extract filename, or toForwardSlash() from @vibe-validate/utils to normalize paths first.',
    },
    schema: [],
  },

  create(context) {
    // Track variables that were assigned from toForwardSlash()
    const normalizedVariables = new Set();

    return {
      // Track variable declarations
      VariableDeclarator(node) {
        // Check if this variable is assigned from toForwardSlash()
        if (
          node.init &&
          node.init.type === 'CallExpression' &&
          node.init.callee.type === 'Identifier' &&
          node.init.callee.name === 'toForwardSlash' &&
          node.id.type === 'Identifier'
        ) {
          normalizedVariables.add(node.id.name);
        }
      },

      CallExpression(node) {
        // Check if this is a .split() call
        if (
          node.callee.type !== 'MemberExpression' ||
          node.callee.property.type !== 'Identifier' ||
          node.callee.property.name !== 'split'
        ) {
          return;
        }

        // Check if the argument is a hardcoded path separator
        const firstArg = node.arguments[0];
        if (!firstArg) {
          return;
        }

        // Check for literal '/' or '\\'
        const isPathSeparator =
          (firstArg.type === 'Literal' &&
            typeof firstArg.value === 'string' &&
            (firstArg.value === '/' || firstArg.value === '\\')) ||
          // Check for regex like /[/\\]/ or /\//
          (firstArg.type === 'Literal' &&
            firstArg.value instanceof RegExp &&
            (firstArg.value.source.includes('/') ||
              firstArg.value.source.includes('\\\\')));

        if (!isPathSeparator) {
          return;
        }

        // Check if this is a safe usage (normalized path)
        const object = node.callee.object;

        // Case 1: Inline normalization - toForwardSlash(...).split('/')
        if (
          object.type === 'CallExpression' &&
          object.callee.type === 'Identifier' &&
          object.callee.name === 'toForwardSlash'
        ) {
          return; // Safe - normalized inline
        }

        // Case 2: Variable that was normalized earlier
        if (
          object.type === 'Identifier' &&
          normalizedVariables.has(object.name)
        ) {
          return; // Safe - variable was normalized
        }

        // Case 3: Check if variable name suggests normalization
        // Common patterns: normalizedPath, unixPath, forwardSlashPath
        if (
          object.type === 'Identifier' &&
          (object.name.toLowerCase().includes('normalized') ||
           object.name.toLowerCase().includes('unix') ||
           object.name.toLowerCase().includes('forward'))
        ) {
          return; // Safe - variable naming suggests normalization
        }

        // Not safe - report the issue
        context.report({
          node,
          messageId: 'noHardcodedSplit',
        });
      },
    };
  },
};

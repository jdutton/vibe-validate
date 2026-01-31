/**
 * ESLint rule to enforce using toForwardSlash() before path.startsWith()
 *
 * Cross-platform path comparisons fail on Windows when mixing backslashes and forward slashes.
 * This rule enforces using toForwardSlash() from @vibe-validate/utils for consistent behavior.
 *
 * @example
 * // ❌ BAD - fails on Windows
 * if (pluginDir.startsWith(marketplaceDir)) { ... }
 *
 * // ✅ GOOD - works cross-platform
 * import { toForwardSlash } from '@vibe-validate/utils';
 * const normalizedPlugin = toForwardSlash(pluginDir);
 * const normalizedMarketplace = toForwardSlash(marketplaceDir);
 * if (normalizedPlugin.startsWith(normalizedMarketplace)) { ... }
 */

/**
 * Check if the comparison argument is a URL scheme or absolute path indicator
 * These don't need normalization: 'http://', 'https://', 'file://', '/', '#'
 */
function isUrlSchemeOrAbsoluteCheck(node) {
  if (node.arguments.length === 0 || node.arguments[0]?.type !== 'Literal') {
    return false;
  }

  const compareValue = node.arguments[0].value;
  if (typeof compareValue !== 'string') {
    return false;
  }

  return (
    compareValue === '/' ||
    compareValue === '#' ||
    compareValue.startsWith('http://') ||
    compareValue.startsWith('https://') ||
    compareValue.startsWith('file://')
  );
}

/**
 * Check if a variable name contains path-related keywords
 */
function hasPathKeyword(name) {
  const lowerName = name.toLowerCase();
  return (
    lowerName.includes('path') ||
    lowerName.includes('dir') ||
    lowerName.includes('file') ||
    lowerName.includes('location')
  );
}

/**
 * Check if a variable name indicates it's already normalized
 */
function isNormalizedVariable(name) {
  return name.toLowerCase().startsWith('normalized');
}

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow direct path.startsWith() without normalization',
      category: 'Cross-platform compatibility',
      recommended: true,
    },
    messages: {
      useNormalizeHelper:
        'Use toForwardSlash() from @vibe-validate/utils before path.startsWith() for cross-platform compatibility. ' +
        'Direct string comparison fails on Windows with mixed separators.',
    },
    schema: [],
  },

  create(context) {
    return {
      CallExpression(node) {
        // Check if this is a .startsWith() call
        if (
          node.callee.type !== 'MemberExpression' ||
          node.callee.property.type !== 'Identifier' ||
          node.callee.property.name !== 'startsWith'
        ) {
          return;
        }

        // Skip URL scheme and absolute path checks
        if (isUrlSchemeOrAbsoluteCheck(node)) {
          return;
        }

        const objectNode = node.callee.object;

        // Check identifier variables (e.g., pluginPath.startsWith(...))
        if (objectNode.type === 'Identifier') {
          const varName = objectNode.name;

          if (isNormalizedVariable(varName)) {
            return;
          }

          if (hasPathKeyword(varName)) {
            context.report({
              node,
              messageId: 'useNormalizeHelper',
            });
          }
        }

        // Check member expressions (e.g., resource.filePath.startsWith(...))
        if (objectNode.type === 'MemberExpression' && objectNode.property.type === 'Identifier') {
          const propName = objectNode.property.name;

          if (isNormalizedVariable(propName)) {
            return;
          }

          if (hasPathKeyword(propName)) {
            context.report({
              node,
              messageId: 'useNormalizeHelper',
            });
          }
        }
      },
    };
  },
};

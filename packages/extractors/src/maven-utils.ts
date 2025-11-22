/**
 * Maven Utilities
 *
 * Shared utility functions for Maven extractors (Checkstyle, Surefire, Compiler)
 *
 * @package @vibe-validate/extractors
 */

/**
 * Extract relative path from absolute path
 *
 * Attempts to extract the meaningful source path from absolute file paths
 * by finding common Java/Kotlin source roots.
 *
 * @example
 * ```typescript
 * extractRelativePath('/Users/name/project/src/main/java/com/example/Foo.java')
 * // => 'src/main/java/com/example/Foo.java'
 * ```
 *
 * @param absolutePath - Absolute file path
 * @returns Relative path from source root, or fallback to last few segments
 */
export function extractRelativePath(absolutePath: string): string {
  // Common Java/Kotlin source roots in Maven projects
  const sourceRoots = ['src/main/java', 'src/test/java', 'src/main/kotlin', 'src/test/kotlin'];

  for (const root of sourceRoots) {
    const index = absolutePath.indexOf(root);
    if (index !== -1) {
      return absolutePath.slice(index);
    }
  }

  // Fallback: return last few path segments (enough to identify the file)
  const segments = absolutePath.split('/');
  return segments.slice(-3).join('/');
}

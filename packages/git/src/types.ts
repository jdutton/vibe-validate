/**
 * Branded types for git objects
 *
 * These types prevent incorrect usage at compile time by ensuring only
 * properly validated values can be used with git operations.
 *
 * @example
 * // ✅ CORRECT - TreeHash from getGitTreeHash()
 * const treeHash = await getGitTreeHash();
 * addNote(notesRef, treeHash, content);
 *
 * // ❌ WRONG - Compilation error
 * addNote(notesRef, 'HEAD', content);
 * addNote(notesRef, 'main', content);
 */

/**
 * Branded type for git tree hashes
 *
 * Tree hashes are content-based identifiers for the working tree state.
 * They must be hexadecimal strings (4-40 chars) obtained from getGitTreeHash().
 *
 * Symbolic refs like 'HEAD', 'main', 'origin/main' are NOT valid tree hashes.
 */
export type TreeHash = string & { readonly __brand: 'TreeHash' };

/**
 * Branded type for git commit SHAs
 *
 * Commit SHAs are hexadecimal identifiers for git commits.
 * They must be 40-character hexadecimal strings.
 */
export type CommitSha = string & { readonly __brand: 'CommitSha' };

/**
 * Branded type for git notes references
 *
 * Notes refs are namespace paths like 'vibe-validate/run/abc123/cmd'.
 * They must not contain special characters that could enable command injection.
 */
export type NotesRef = string & { readonly __brand: 'NotesRef' };

/**
 * Pure exit-condition logic for watch-pr polling loop
 *
 * Extracted for testability — these functions determine when to stop polling.
 *
 * @packageDocumentation
 */

import type { WatchPRResult } from '../schemas/watch-pr-result.schema.js';

/**
 * Check if ALL failed checks have extraction or log_file
 *
 * Used in normal (non-fail-fast) mode to wait for complete error extraction
 * before displaying final results.
 *
 * @param result - Current result
 * @returns True if all failed checks have extraction or log_file
 */
export function allFailedChecksHaveExtraction(result: WatchPRResult): boolean {
  const failedActions = result.checks.github_actions.filter(c => c.conclusion === 'failure');
  const failedExternal = result.checks.external_checks.filter(c => c.conclusion === 'failure');

  // All failed GitHub Actions must have extraction OR log_file
  // Use Boolean() to satisfy eslint prefer-nullish-coalescing rule
  const actionsComplete = failedActions.every(c => Boolean(c.extraction) || Boolean(c.log_file));

  // External checks don't have log extraction, so just check they're complete
  const externalComplete = failedExternal.every(c => c.status === 'completed');

  return actionsComplete && externalComplete;
}

/**
 * Check if ANY failed check has extraction or log_file
 *
 * Used in fail-fast mode — exit as soon as the first failure has its
 * extraction ready, rather than waiting for all failures.
 *
 * @param result - Current result
 * @returns True if at least one failed check has extraction or log_file
 */
export function anyFailedCheckHasExtraction(result: WatchPRResult): boolean {
  const failedActions = result.checks.github_actions.filter(c => c.conclusion === 'failure');
  const failedExternal = result.checks.external_checks.filter(c => c.conclusion === 'failure');

  // Any failed GitHub Action with extraction OR log_file counts
  const anyActionComplete = failedActions.some(c => Boolean(c.extraction) || Boolean(c.log_file));

  // Any completed failed external check counts
  const anyExternalComplete = failedExternal.some(c => c.status === 'completed');

  // If there are no failed actions, external completions are enough (and vice versa)
  if (failedActions.length === 0 && failedExternal.length === 0) return false;
  if (failedActions.length === 0) return anyExternalComplete;
  if (failedExternal.length === 0) return anyActionComplete;

  return anyActionComplete || anyExternalComplete;
}

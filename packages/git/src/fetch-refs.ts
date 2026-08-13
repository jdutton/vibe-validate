/**
 * Targeted Remote Ref Fetching
 *
 * Fetches only the specific refs a caller needs, in as few network round-trips
 * as possible.
 *
 * ## Why this exists
 *
 * Sync checks compare local refs against remote-tracking refs. Those comparisons
 * are only as truthful as the last fetch, so a check that matters has to fetch
 * first. But a bare `git fetch` pulls every ref on every remote — far more than
 * any single check needs, and slow enough to be felt on the commit path.
 *
 * `fetchRemoteRefs` takes the exact refs the caller's active checks depend on,
 * groups them by remote, and issues one `git fetch` per remote. Callers that
 * have turned a check off simply do not list its ref, and pay nothing.
 *
 * ## Failure is reported, never thrown
 *
 * Being offline is a normal state, not an error condition. Results are returned
 * per remote so a caller can degrade the affected check to "no opinion" while
 * leaving unaffected checks running.
 */

import { executeGitCommand } from './git-executor.js';

/** Fetches contact the network; allow more headroom than a local git call. */
const FETCH_TIMEOUT = 60000;

/** A single branch on a single remote. */
export interface RemoteRef {
  /** Remote name, e.g. `origin` */
  remote: string;
  /** Branch name on the remote, e.g. `main` or `feature/foo` */
  branch: string;
}

/** Outcome of the fetch for one ref. */
export interface FetchOutcome {
  ok: boolean;
  /** Populated when `ok` is false — git's stderr, for verbose reporting. */
  error?: string;
}

/**
 * Key under which a ref's outcome is reported by {@link fetchRemoteRefs}.
 *
 * Never parsed back apart — branch names contain slashes, so this is an opaque
 * identity, not a splittable path.
 */
export function refKey(ref: RemoteRef): string {
  return `${ref.remote}/${ref.branch}`;
}

/** Deterministic ordering that does not depend on locale or ICU build. */
function byCodePoint(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function toOutcome(result: { success: boolean; stdout: string; stderr: string }, label: string): FetchOutcome {
  return result.success
    ? { ok: true }
    : { ok: false, error: (result.stderr || result.stdout).trim() || `git fetch ${label} failed` };
}

function runFetch(remote: string, branches: string[]) {
  return executeGitCommand(
    ['fetch', '--quiet', remote, ...branches],
    { timeout: FETCH_TIMEOUT, ignoreErrors: true }
  );
}

/**
 * Fetch the given refs, grouped into one `git fetch` per distinct remote.
 *
 * Outcomes are reported **per ref**, not per remote, because git treats an
 * unresolvable refspec as fatal for the entire invocation: asking for a deleted
 * branch alongside a live one aborts the whole fetch and leaves the live ref
 * unmoved. Reporting that as "the remote is unreachable" would take out every
 * check on that remote — most commonly after a PR merges and the remote branch
 * is deleted while the local branch keeps its upstream config.
 *
 * So the happy path stays one round-trip per remote, and only a failing group
 * pays for isolation: each of its refs is retried individually to find which
 * one git actually objected to.
 *
 * @param refs - Refs to refresh. Duplicates and blank entries are ignored.
 * @returns Outcome keyed by {@link refKey}. An empty input yields an empty
 *          object and makes no network calls at all.
 *
 * @example
 * ```typescript
 * const outcomes = fetchRemoteRefs([
 *   { remote: 'origin', branch: 'main' },
 *   { remote: 'origin', branch: 'feature/foo' },
 * ]);
 * // One call: git fetch --quiet origin feature/foo main
 * if (!outcomes['origin/main']?.ok) {
 *   // origin/main specifically could not be refreshed.
 * }
 * ```
 */
export function fetchRemoteRefs(refs: RemoteRef[]): Record<string, FetchOutcome> {
  const branchesByRemote = new Map<string, Set<string>>();

  for (const { remote, branch } of refs) {
    if (!remote || !branch) continue;
    const branches = branchesByRemote.get(remote) ?? new Set<string>();
    branches.add(branch);
    branchesByRemote.set(remote, branches);
  }

  const outcomes: Record<string, FetchOutcome> = {};

  for (const [remote, branchSet] of branchesByRemote) {
    // Sorted so the emitted command is deterministic (stable logs and tests).
    const branches = [...branchSet].sort(byCodePoint);
    const combined = runFetch(remote, branches);

    if (combined.success || branches.length === 1) {
      const outcome = toOutcome(combined, remote);
      for (const branch of branches) {
        outcomes[refKey({ remote, branch })] = outcome;
      }
      continue;
    }

    // The group failed. One bad ref aborts the whole call, so re-ask per ref
    // to find out which — otherwise a single deleted branch would silently
    // disable every check pointed at this remote.
    for (const branch of branches) {
      outcomes[refKey({ remote, branch })] = toOutcome(runFetch(remote, [branch]), `${remote} ${branch}`);
    }
  }

  return outcomes;
}

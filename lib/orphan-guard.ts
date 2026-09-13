/**
 * The circuit breaker on deleting "orphaned" storage objects.
 *
 * An orphan sweep is only as good as its list of the places a URL can be
 * stored, and that list is a hand-kept set of queries that has to be extended
 * every time a feature starts storing a file. Miss one and every file that
 * feature ever wrote looks orphaned. The delete is not recoverable; the check
 * that produced it is a join the compiler cannot see.
 *
 * So the sweep is bounded by plausibility rather than trusted: a genuine orphan
 * is a leftover from a failed write or a deleted row, which is a handful. A
 * large fraction of the whole bucket means the reference set is incomplete.
 *
 * Kept here, pure, so the rule can be tested without a bucket or a database —
 * which is the only way it gets tested at all, since CI has neither.
 */

/** Above this share of the bucket, a sweep refuses and deletes nothing. */
export const MAX_ORPHAN_SHARE = 0.2

export type CleanupDecision =
    | { proceed: true; deleting: number }
    | { proceed: false; reason: "nothing_to_do" }
    | { proceed: false; reason: "implausible"; share: number }

export function decideCleanup(orphans: number, total: number): CleanupDecision {
    if (orphans <= 0) return { proceed: false, reason: "nothing_to_do" }
    // An empty bucket that somehow reports orphans is not a share of anything;
    // treat it as implausible rather than dividing by zero.
    if (total <= 0) return { proceed: false, reason: "implausible", share: 1 }

    const share = orphans / total
    if (share > MAX_ORPHAN_SHARE) return { proceed: false, reason: "implausible", share }
    return { proceed: true, deleting: orphans }
}

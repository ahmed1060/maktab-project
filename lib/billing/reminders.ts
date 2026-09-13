/**
 * The expiry reminder ladder.
 *
 * Which reminder, if any, a subscription is due for — expressed as a pure
 * decision over (days remaining, rungs already sent) so it can be tested
 * without a database or a clock.
 */

/**
 * Descending, and the order matters: a rung is "earlier" the larger it is.
 * 14 is the threshold three other places in the system already use; 3 is late
 * enough to feel urgent and early enough to act on; 1 is the last warning
 * before grace begins.
 */
export const REMINDER_RUNGS = [14, 3, 1] as const

export type ReminderDecision = {
    /** The rung to send now, or null to send nothing this run. */
    send: number | null
    /**
     * Rungs to record as spent, including `send` when it is set. Recording a
     * rung without sending it is how a ladder avoids becoming a backlog.
     */
    markSent: number[]
}

/**
 * @param daysLeft whole days until expiry, rounded up (see `daysUntil`)
 * @param alreadySent rungs recorded against this subscription so far
 */
export function decideReminder(daysLeft: number, alreadySent: readonly number[]): ReminderDecision {
    const sent = new Set(alreadySent)
    const firstObservation = alreadySent.length === 0

    // On first observation, every rung whose moment predates our knowledge of
    // this subscription is marked spent without being sent. Otherwise a ladder
    // deployed mid-period fires its whole history at once: a subscription first
    // seen at day 5 would get the 14-day notice that same morning, and three
    // notices about one subscription in one morning is what teaches someone to
    // stop reading them. Seen at day 5, it gets the 3-day and 1-day notices and
    // never the 14-day one.
    const skipped = firstObservation ? REMINDER_RUNGS.filter(r => r > daysLeft) : []
    skipped.forEach(r => sent.add(r))

    // Due: any unsent rung whose threshold this subscription has reached.
    const due = REMINDER_RUNGS.filter(r => r >= daysLeft && !sent.has(r))

    if (due.length === 0) {
        return { send: null, markSent: skipped }
    }

    // Send the most urgent due rung, and spend the rest. More than one is due
    // only when the job could not run for a few days; sending the backlog then
    // would deliver "expires in 3 days" and "expires in 1 day" together, which
    // is worse than sending only the true one.
    const send = Math.min(...due)

    return { send, markSent: [...skipped, ...due] }
}

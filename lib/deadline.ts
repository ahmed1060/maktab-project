/**
 * How soon a task or obligation deadline may be.
 *
 * The server refuses anything sooner than this (DEADLINE_TOO_SOON), and every
 * date picker offers this as its minimum so people are not invited to choose
 * something that will be refused. Those two were eleven separate copies of
 * `3 * 60 * 60 * 1000` — five that enforce and six that advise — with nothing
 * holding them together. A change to one would have left the picker offering
 * deadlines the server rejects, or refusing ones it would accept.
 */
export const MIN_DEADLINE_LEAD_MS = 3 * 60 * 60 * 1000

/** The earliest acceptable deadline, measured from `now`. */
export function earliestDeadline(now: number = Date.now()): Date {
    return new Date(now + MIN_DEADLINE_LEAD_MS)
}

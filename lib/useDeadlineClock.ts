'use client'

import { useEffect, useState } from 'react'

/** The longest a timer waits: setTimeout fires at once past it. */
const LONGEST_WAIT = 2 ** 31 - 1

/**
 * How long until a page looks at its deadline again: just after it, or as
 * long as a timer can wait, to look again then. Null once it's passed.
 */
export function untilDeadline(deadlineAt: number, now: number): number | null {
    if (now > deadlineAt) return null
    return Math.min(deadlineAt - now + 500, LONGEST_WAIT)
}

/**
 * The time a page with a deadline is drawn at: the server's to begin with,
 * so the first paint matches, then moved on just after the deadline, so a
 * page left open across it locks then, not at the next reload (found by
 * Codex on PR 122, on an obligation's page).
 */
export function useDeadlineClock(deadlineAt: number, now: number): number {
    const [clock, setClock] = useState(now)
    useEffect(() => {
        const wait = untilDeadline(deadlineAt, clock)
        if (wait === null) return
        const timer = setTimeout(() => setClock(Date.now()), wait)
        return () => clearTimeout(timer)
    }, [deadlineAt, clock])
    return clock
}

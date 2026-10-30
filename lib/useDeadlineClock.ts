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
 * How long until a page looks at its deadline again, from the time it shows
 * and the time it is now: nothing to wait for once the deadline shows as
 * passed; at once when it has passed but doesn't show so yet; otherwise just
 * after it, from now. From now, not the time last drawn at: the deadline may
 * have moved since, edited while the page was open (found by Codex on PR 123).
 */
export function nextLook(deadlineAt: number, shown: number, wallNow: number): number | null {
    if (shown > deadlineAt) return null
    return untilDeadline(deadlineAt, wallNow) ?? 0
}

/**
 * The time a page with a deadline is drawn at: the server's to begin with,
 * so the first paint matches, then moved on just after the deadline, so a
 * page left open across it locks then, not at the next reload (found by
 * Codex on PR 122, on an obligation's page). A fresh drawing on the server,
 * after a refresh, brings its own later time.
 */
export function useDeadlineClock(deadlineAt: number, now: number): number {
    const [clock, setClock] = useState(now)
    const shown = Math.max(clock, now)
    useEffect(() => {
        const wait = nextLook(deadlineAt, shown, Date.now())
        if (wait === null) return
        const timer = setTimeout(() => setClock(Date.now()), wait)
        return () => clearTimeout(timer)
    }, [deadlineAt, shown])
    return shown
}

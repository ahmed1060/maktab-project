'use client'

import { useEffect, useState } from 'react'

/**
 * The current time, as state that moves.
 *
 * Calling Date.now() while rendering gives an answer that is only as fresh as
 * the last re-render. A form left open for an hour kept offering the deadline
 * minimum it computed when it opened — an hour stale, and so an hour of
 * choices the server would refuse. A "3 hours ago" label stayed "3 hours ago"
 * until something unrelated redrew it. It is also exactly what the React
 * Compiler's purity rule flags, because a render that reads the clock is not
 * repeatable.
 *
 * This reads the clock once when the component mounts, then again on an
 * interval, so render reads state instead of the clock. Once a minute is
 * plenty for both uses — neither a deadline floor nor an "ago" label needs
 * second precision.
 */
export function useNow(intervalMs: number = 60_000): number {
    const [now, setNow] = useState(() => Date.now())
    useEffect(() => {
        const id = setInterval(() => setNow(Date.now()), intervalMs)
        return () => clearInterval(id)
    }, [intervalMs])
    return now
}

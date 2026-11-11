'use client'

import { useEffect, useState } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { useLive } from '@/components/LiveUpdates'
import { useAdjustOnChange } from '@/lib/useAdjustOnChange'
import { ARRIVAL_MS, EXPECT_MS, arrivedOnDraw, drawn, expectNext, type Expecting } from '@/lib/arrivals'
import type { LiveKind } from '@/lib/live-updates'

const NONE: ReadonlySet<string> = new Set()

/**
 * The rows of a list that someone else just added or changed (DESIGN.md §8;
 * REALTIME_PLAN.md, part 5), for DataList's `arrived`: the keys of the rows
 * new, or holding something new, in the draw that follows a `kind` signal,
 * for ARRIVAL_MS.
 *
 * Not as the page opens, which has no draw before it. Not when the person
 * looks at another tab, filter or page: that's another list. And not for
 * their own changes: a page calls `own()` as it draws itself again after
 * one. Their own change sends a signal too, which reaches the page after
 * its own draw and finds nothing new; `own()` keeps a slow draw of theirs
 * from being taken for someone else's all the same.
 */
export function useArrivals<T>(kind: LiveKind, rows: readonly T[], rowKey: (row: T) => string) {
    const now = drawn(`${usePathname()}?${useSearchParams().toString()}`, rows, rowKey)
    const [before, setBefore] = useState(now)
    const [expecting, setExpecting] = useState<Expecting>(null)
    const [arrived, setArrived] = useState(NONE)

    const expect = (from: 'live' | 'own') => setExpecting(was => expectNext(was, from))
    useLive(kind, () => expect('live'))

    // Each draw is compared with the one before it, and waits for no other.
    useAdjustOnChange([now], () => {
        const keys = arrivedOnDraw(expecting, before, now)
        if (keys.length > 0) setArrived(was => new Set([...was, ...keys]))
        setExpecting(null)
        setBefore(now)
    })

    // A signal or an action whose draw changed nothing is forgotten, so it
    // can't claim a change the person makes later.
    useEffect(() => {
        if (expecting === null) return
        const forget = setTimeout(() => setExpecting(null), EXPECT_MS)
        return () => clearTimeout(forget)
    }, [expecting])

    // Each is marked for its 2 seconds: its tint holds and fades within them.
    useEffect(() => {
        if (arrived.size === 0) return
        const done = setTimeout(() => setArrived(NONE), ARRIVAL_MS)
        return () => clearTimeout(done)
    }, [arrived])

    return { arrived, own: () => expect('own') }
}

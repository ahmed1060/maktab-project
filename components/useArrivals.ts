'use client'

import { useEffect, useState } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { useLive } from '@/components/LiveUpdates'
import { useAdjustOnChange } from '@/lib/useAdjustOnChange'
import { ARRIVAL_MS, EXPECT_MS, arrivedOnDraw, drawn, expectNext, mark, unmark, type Expecting, type Marks } from '@/lib/arrivals'
import type { LiveKind } from '@/lib/live-updates'

const NONE: Marks = new Map()

/**
 * The rows of a list that someone else just added or changed (DESIGN.md §8;
 * REALTIME_PLAN.md, part 5), for DataList's `arrived`: the keys of the rows
 * new, or holding something new, in the draw that follows a `kind` signal,
 * for ARRIVAL_MS.
 *
 * Not as the page opens, which has no draw before it. Not when the person
 * looks at another tab, filter or page: that's another list. And not for
 * their own changes: a page calls `own()` as each of its actions starts,
 * before it sends anything (through useBusyAction). Their change sends a
 * signal too, which can come before their answer, if the server goes on
 * working after saving it; the draw that follows is taken as theirs (found
 * by Codex on PR 251).
 */
export function useArrivals<T>(kind: LiveKind, rows: readonly T[], rowKey: (row: T) => string) {
    const now = drawn(`${usePathname()}?${useSearchParams().toString()}`, rows, rowKey)
    const [before, setBefore] = useState(now)
    const [expecting, setExpecting] = useState<Expecting>(null)
    const [arrived, setArrived] = useState(NONE)
    // How many draws have marked rows: the last one's number.
    const [marked, setMarked] = useState(0)

    const expect = (from: 'live' | 'own') => setExpecting(was => expectNext(was, from))
    useLive(kind, () => expect('live'))

    // Each draw is compared with the one before it, and waits for no other.
    useAdjustOnChange([now], () => {
        const keys = arrivedOnDraw(expecting, before, now)
        if (keys.length > 0) {
            setArrived(was => mark(was, keys, marked + 1))
            setMarked(marked + 1)
        }
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

    // Each draw's rows are marked for their 2 seconds: their tint holds and
    // fades within them. Not put off by the draws after it, so its timer
    // isn't cleared as they come; one that outlives the list sets nothing.
    useEffect(() => {
        if (marked === 0) return
        setTimeout(() => setArrived(was => unmark(was, marked)), ARRIVAL_MS)
    }, [marked])

    return { arrived, own: () => expect('own') }
}

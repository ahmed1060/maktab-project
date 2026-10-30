'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAdjustOnChange } from '@/lib/useAdjustOnChange'
import { arrived, changed, type Picked } from './address'

/**
 * A list whose filters, order and page are in its address, which its server
 * page reads, so a filtered list can be shared.
 *
 * What's picked shows at once, and the address follows: it changes only
 * once its navigation lands. The date range picker reads its start back
 * for its end, so it lost the start picked just before (found by Codex on
 * PR 117). Each change builds on the last, so the search, sent once typing
 * pauses, keeps a filter picked meanwhile.
 *
 * `picked` is what the filters show; `listed` is the address the list shown
 * is of, the server's.
 */
export function useListAddress(path: string) {
    const router = useRouter()
    const searchParams = useSearchParams()
    const committed = searchParams.toString()
    const [shown, setShown] = useState<Picked>({ latest: committed, sent: [] })
    useAdjustOnChange([committed], () => setShown(p => arrived(p, committed)))
    const [made, setMade] = useState(0)
    const pushed = useRef(0)
    useEffect(() => {
        if (made === pushed.current) return
        pushed.current = made
        router.push(`${path}?${shown.latest}`)
    }, [made, shown.latest, router, path])
    /** The list with these changed in the address, from its first page unless it's the page that changes. */
    const go = useCallback((changes: Record<string, string>) => {
        setShown(p => changed(p, changes))
        setMade(n => n + 1)
    }, [])
    return { picked: new URLSearchParams(shown.latest), listed: searchParams, go }
}

/**
 * A list's search field, sent once typing pauses, not on every key. The
 * field follows the search picked only when something else changed it, as
 * going back does: not when it's the search this sent, while more is typed.
 */
export function useSearchField(search: string, go: (changes: Record<string, string>) => void) {
    const [query, setQuery] = useState(search)
    const [sent, setSent] = useState(search)
    useAdjustOnChange([search], () => {
        if (search !== sent) setQuery(search)
        setSent(search)
    })
    useEffect(() => {
        if (query.trim() === sent) return
        const timer = setTimeout(() => {
            setSent(query.trim())
            go({ search: query.trim() })
        }, 400)
        return () => clearTimeout(timer)
    }, [query, sent, go])
    /** Empties the field with the rest of the filters, so it isn't sent again. */
    const clear = () => {
        setQuery('')
        setSent('')
    }
    return { query, setQuery, clear }
}

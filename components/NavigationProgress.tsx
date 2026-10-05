'use client'

import { useEffect, useState } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { useAdjustOnChange } from '@/lib/useAdjustOnChange'
import { startsNavigation } from '@/lib/navigation-progress'

const START = 'app:navigation-start'
// Never left running: a navigation that fails or is abandoned still ends here.
const GIVE_UP_MS = 15000

/**
 * For a button that navigates without a link (router.back(), or a push after
 * some work): show the bar as it starts. A link needs nothing — clicks on
 * links are noticed on their own.
 */
export function startNavigationProgress() {
    window.dispatchEvent(new Event(START))
}

/**
 * A thin bar along the top of the screen from the click that leaves a page
 * until the next one is there. Before, nothing moved between the click and
 * the next page's spinner, so a link on a slow connection looked dead.
 */
export default function NavigationProgress() {
    const pathname = usePathname()
    const search = useSearchParams().toString()
    const [state, setState] = useState<'idle' | 'loading' | 'done'>('idle')

    // Arrived: finish the bar in the same render the address changes.
    useAdjustOnChange([pathname, search], () => {
        if (state === 'loading') setState('done')
    })

    useEffect(() => {
        const start = () => setState('loading')
        const onClick = (e: MouseEvent) => {
            const anchor = (e.target as Element | null)?.closest?.('a')
            if (anchor && startsNavigation(e, anchor, window.location.href)) start()
        }
        // Capture, so a link inside something that stops the click still counts.
        document.addEventListener('click', onClick, true)
        window.addEventListener('popstate', start)
        window.addEventListener(START, start)
        return () => {
            document.removeEventListener('click', onClick, true)
            window.removeEventListener('popstate', start)
            window.removeEventListener(START, start)
        }
    }, [])

    useEffect(() => {
        if (state === 'idle') return
        const t = setTimeout(() => setState('idle'), state === 'done' ? 400 : GIVE_UP_MS)
        return () => clearTimeout(t)
    }, [state])

    return <div className="nav-progress" data-state={state} aria-hidden="true" />
}

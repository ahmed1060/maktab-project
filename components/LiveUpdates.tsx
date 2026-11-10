'use client'

import { createContext, useContext, useEffect, useEffectEvent, useState, type ReactNode } from 'react'
import { LiveDrawer, type LiveKind } from '@/lib/live-updates'
import { LiveConnection, type Answer, type LiveClient } from '@/lib/live-connection'
import { fetchRetrying } from '@/lib/swr-fetcher'

/**
 * Live updates (REALTIME_PLAN.md): one connection per tab, to the private
 * channels its person may hear (lib/live-connection.ts), and each screen
 * drawn again when what it shows changes elsewhere (DESIGN.md §8).
 *
 * The connection is opened once the dashboard is drawn, and Supabase's client
 * loaded only then, as the maintenance channel's is (components/UserHeartbeat.tsx).
 * Until the project's JWT secret is in Vercel, the token route says it's off,
 * nothing connects, and every screen goes on as today.
 */

const LiveContext = createContext<LiveDrawer | null>(null)

async function askForToken(): Promise<Answer> {
    // Tried again, as anything loaded is (DESIGN.md §5.5); without an answer,
    // the connection asks again a minute later, and meanwhile the screens go
    // on asking on their own schedule.
    const res = await fetchRetrying('/api/realtime/token', { cache: 'no-store' }).catch(() => null)
    if (!res?.ok) return null
    const data = (await res.json().catch(() => null))?.data
    if (data?.off) return 'off'
    return data?.token ? data : null
}

async function loadClient() {
    const { getSupabaseBrowserClient, setLiveToken } = await import('@/lib/supabase-browser')
    return { client: getSupabaseBrowserClient() as LiveClient | null, setToken: setLiveToken }
}

export function LiveUpdates({ scope, children }: { scope: string | null; children: ReactNode }) {
    const [drawer] = useState(() => new LiveDrawer({ hidden: () => document.visibilityState === 'hidden' }))

    // What waited while the tab was hidden is drawn as it's shown again.
    useEffect(() => {
        const onShown = () => { if (document.visibilityState === 'visible') drawer.shown() }
        document.addEventListener('visibilitychange', onShown)
        return () => document.removeEventListener('visibilitychange', onShown)
    }, [drawer])

    // Joined again for the company in view, when the Super Admin picks another.
    useEffect(() => {
        const connection = new LiveConnection({ ask: askForToken, load: loadClient, drawer })
        connection.start().catch(error => console.error('[live] could not connect', error))
        return () => connection.stop()
    }, [drawer, scope])

    return <LiveContext.Provider value={drawer}>{children}</LiveContext.Provider>
}

/**
 * Calls `onChange` when what `kind` covers changes elsewhere: a company's
 * tasks or requests, the person's notifications, or whether their account
 * can go on. A screen passes how it draws itself again, through its usual
 * route: router.refresh(), or its data's mutate().
 */
export function useLive(kind: LiveKind, onChange: () => void) {
    const drawer = useContext(LiveContext)
    const draw = useEffectEvent(onChange)
    useEffect(() => drawer?.on(kind, () => draw()), [drawer, kind])
}

'use client'

import { createContext, useContext, useEffect, useEffectEvent, useState, type ReactNode } from 'react'
import { LiveDrawer, LiveWants, type LiveKind } from '@/lib/live-updates'
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

const LiveContext = createContext<{ drawer: LiveDrawer; wants: LiveWants } | null>(null)

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
    // The channels the screens open want heard (part 6b), kept across the
    // connections made for each company in view.
    const [wants] = useState(() => new LiveWants())
    const [live] = useState(() => ({ drawer, wants }))

    // What waited while the tab was hidden is drawn as it's shown again.
    useEffect(() => {
        const onShown = () => { if (document.visibilityState === 'visible') drawer.shown() }
        document.addEventListener('visibilitychange', onShown)
        return () => document.removeEventListener('visibilitychange', onShown)
    }, [drawer])

    // Joined again for the company in view, when the Super Admin picks another.
    useEffect(() => {
        const connection = new LiveConnection({ ask: askForToken, load: loadClient, drawer, wants })
        connection.start().catch(error => console.error('[live] could not connect', error))
        return () => connection.stop()
    }, [drawer, wants, scope])

    return <LiveContext.Provider value={live}>{children}</LiveContext.Provider>
}

/**
 * Calls `onChange` when what `kinds` cover changes elsewhere: a company's
 * tasks, requests, cash advances or costs, the person's notifications, or
 * whether their account can go on. A screen passes how it draws itself
 * again, through its usual route: router.refresh(), or its data's mutate().
 * A screen hearing several kinds is drawn once when they come together
 * (part 4b, the cost screens: the company's tasks and costs).
 */
export function useLive(kinds: LiveKind | readonly LiveKind[], onChange: () => void) {
    const live = useContext(LiveContext)
    const draw = useEffectEvent(onChange)
    // By value: a screen hearing several names them in a new array each draw.
    const heard = (typeof kinds === 'string' ? [kinds] : kinds).join(' ')
    useEffect(() => {
        if (!live) return
        // One function for them all, which the drawer calls once however many came.
        const once = () => draw()
        const stops = heard.split(' ').map(kind => live.drawer.on(kind as LiveKind, once))
        return () => { for (const stop of stops) stop() }
    }, [live, heard])
}

/**
 * The channels a screen wants heard while it's open, beyond the tab's own
 * (parts 6b and 4c, who's online and attendance): each joined once however
 * many screens want it, and left a few seconds after the last lets go
 * (LiveWants). What each says is drawn as its name says: useLive('online')
 * or useLive('attendance').
 */
export function useWantedChannels(topics: string[]) {
    const live = useContext(LiveContext)
    // By value: the list makes a new array on every draw.
    const wanted = topics.join(' ')
    useEffect(() => {
        if (!live || !wanted) return
        const releases = wanted.split(' ').map(topic => live.wants.want(topic))
        return () => { for (const release of releases) release() }
    }, [live, wanted])
}

/**
 * Who's online (part 6b): while a list showing the badge is open, it hears
 * when someone in the companies it shows comes or goes (`topics`, from
 * onlineTopics), and calls `onChange` to draw itself again, untinted
 * (DESIGN.md §8). And again as its first person online would run out with
 * nothing heard (`runsOutInMs`, from the list's answer): a tab whose leaving
 * wasn't heard runs out with nothing written, so no signal says so. Both
 * wait for the tab to be shown, as every signal does.
 */
export function useLiveOnline(topics: string[], onChange: () => void, runsOutInMs: number | null | undefined) {
    const live = useContext(LiveContext)
    useLive('online', onChange)
    useWantedChannels(topics)
    useEffect(() => {
        if (!live || runsOutInMs == null) return
        const timer = setTimeout(() => live.drawer.signal('online'), runsOutInMs)
        return () => clearTimeout(timer)
    }, [live, runsOutInMs])
}

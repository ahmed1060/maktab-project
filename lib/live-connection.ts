import type { LiveDrawer, LiveTopic } from "./live-updates"

/**
 * A tab's connection to its live-update channels (REALTIME_PLAN.md), apart
 * from React so it can be tested on its own (live-updates.test.ts):
 * components/LiveUpdates.tsx starts one when the dashboard is drawn, and
 * stops it when it goes or the company in view changes.
 *
 *   - Asks the app for a token and the channels its person may hear.
 *   - Joins them as private channels, once Supabase has the token.
 *   - Turns each signal into a screen drawn again, through the drawer.
 *   - Draws what a channel is for once each time it's joined: first, for a
 *     change saved while the page was on its way, before the channel was
 *     there to hear it; and again, after a laptop slept or a phone lost its
 *     signal, for what was missed meanwhile.
 *   - Asks for the next token five minutes before the one held ends, as
 *     Supabase closes a channel whose token has ended; a failed renewal is
 *     tried again a minute later.
 */

export type Grant = { token: string; expiresAt: number; topics: LiveTopic[] }

/** The part of Supabase's client this uses (lib/supabase-browser.ts). */
export type LiveChannel = {
    on(type: "broadcast", filter: { event: string }, callback: () => void): LiveChannel
    subscribe(callback: (status: string) => void): LiveChannel
}
export type LiveClient = {
    channel(topic: string, options: { config: { private: boolean } }): LiveChannel
    removeChannel(channel: LiveChannel): unknown
    realtime: { setAuth(): Promise<void> }
}

export const RENEW_BEFORE_MS = 5 * 60_000
export const RETRY_MS = 60_000

export class LiveConnection {
    private stopped = false
    private renewal: ReturnType<typeof setTimeout> | undefined
    private channels: LiveChannel[] = []
    private client: LiveClient | null = null
    private setToken: ((token: string | null) => void) | null = null

    constructor(private readonly deps: {
        /** The token and channels, from /api/realtime/token; null when it's off or failed. */
        ask: () => Promise<Grant | null>
        /** Supabase's client, loaded only once it's needed, and where its token is kept. */
        load: () => Promise<{ client: LiveClient | null; setToken: (token: string | null) => void }>
        drawer: LiveDrawer
    }) {}

    async start() {
        const grant = await this.deps.ask()
        if (!grant || this.stopped) return
        const { client, setToken } = await this.deps.load()
        if (!client || this.stopped) return
        this.client = client
        this.setToken = setToken
        setToken(grant.token)
        await client.realtime.setAuth()
        if (this.stopped) return

        this.channels = grant.topics.map(({ kind, topic }) =>
            client.channel(topic, { config: { private: true } })
                .on("broadcast", { event: "changed" }, () => this.deps.drawer.signal(kind))
                .subscribe(status => { if (status === "SUBSCRIBED") this.deps.drawer.signal(kind) }))
        this.renewBy(grant.expiresAt)
    }

    stop() {
        this.stopped = true
        clearTimeout(this.renewal)
        for (const channel of this.channels) void this.client?.removeChannel(channel)
        this.channels = []
        this.setToken?.(null)
    }

    private renewBy(expiresAt: number) {
        this.renewal = setTimeout(async () => {
            const next = await this.deps.ask().catch(() => null)
            if (this.stopped) return
            if (!next) return this.renewBy(Date.now() + RENEW_BEFORE_MS + RETRY_MS)
            this.setToken?.(next.token)
            void this.client?.realtime.setAuth()
            this.renewBy(next.expiresAt)
        }, Math.max(0, expiresAt - Date.now() - RENEW_BEFORE_MS))
    }
}

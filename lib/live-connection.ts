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
 *   - Hears on every channel, too, that the account can't go on (part 3),
 *     which the heartbeat checks at once, and that requests changed
 *     (part 2), which the Requests page and its count draw again.
 *   - Draws what a channel is for once each time it's joined, the requests
 *     with it, and checks the account: first, for a change saved while the
 *     page was on its way, before the channel was there to hear it; and
 *     again, after a laptop slept or a phone lost its signal, for what was
 *     missed meanwhile.
 *   - Asks for the next token five minutes before the one held ends, as
 *     Supabase closes a channel whose token has ended.
 *   - A token or Supabase's client that doesn't come, as when offline or
 *     the server fails, is asked for again a minute later; while the token
 *     route says it's off, nothing is.
 */

export type Grant = { token: string; expiresAt: number; topics: LiveTopic[] }
/** The token route's answer: a grant, "off" until the secret is set, or null when none came. */
export type Answer = Grant | "off" | null

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
    /** The next renewal, or the next try at starting. */
    private timer: ReturnType<typeof setTimeout> | undefined
    private channels: LiveChannel[] = []
    private client: LiveClient | null = null
    private setToken: ((token: string | null) => void) | null = null

    constructor(private readonly deps: {
        /** The token and channels, from /api/realtime/token. */
        ask: () => Promise<Answer>
        /** Supabase's client, loaded only once it's needed, and where its token is kept. */
        load: () => Promise<{ client: LiveClient | null; setToken: (token: string | null) => void }>
        drawer: LiveDrawer
    }) {}

    async start() {
        const grant = await this.deps.ask().catch(() => null)
        if (this.stopped || grant === "off") return
        if (!grant) return this.startAgainLater()
        const loaded = await this.deps.load().catch(() => null)
        if (this.stopped) return
        if (!loaded) return this.startAgainLater()
        const { client, setToken } = loaded
        if (!client) return
        this.client = client
        this.setToken = setToken
        setToken(grant.token)
        await client.realtime.setAuth()
        if (this.stopped) return

        const { drawer } = this.deps
        this.channels = grant.topics.map(({ kind, topic }) =>
            client.channel(topic, { config: { private: true } })
                .on("broadcast", { event: "changed" }, () => drawer.signal(kind))
                .on("broadcast", { event: "account" }, () => drawer.signal("account"))
                .on("broadcast", { event: "requests" }, () => drawer.signal("requests"))
                .subscribe(status => {
                    if (status !== "SUBSCRIBED") return
                    drawer.signal(kind)
                    drawer.signal("account")
                    drawer.signal("requests")
                }))
        this.renewBy(grant.expiresAt)
    }

    stop() {
        this.stopped = true
        clearTimeout(this.timer)
        for (const channel of this.channels) void this.client?.removeChannel(channel)
        this.channels = []
        this.setToken?.(null)
    }

    private startAgainLater() {
        this.timer = setTimeout(() => { this.start().catch(() => this.startAgainLater()) }, RETRY_MS)
    }

    private renewBy(expiresAt: number) {
        this.timer = setTimeout(async () => {
            const next = await this.deps.ask().catch(() => null)
            if (this.stopped || next === "off") return
            if (!next) return this.renewBy(Date.now() + RENEW_BEFORE_MS + RETRY_MS)
            this.setToken?.(next.token)
            void this.client?.realtime.setAuth()
            this.renewBy(next.expiresAt)
        }, Math.max(0, expiresAt - Date.now() - RENEW_BEFORE_MS))
    }
}

/**
 * Live updates (REALTIME_PLAN.md): which signals a person may hear, and a
 * screen drawn again once for signals close together.
 *
 * A signal says only that something changed: a company's tasks, or a
 * person's notifications. The database sends it (the live_* triggers,
 * prisma/migrations/20261208000000_live_updates), and Supabase lets only the
 * right people hear each channel. A screen that hears one draws itself again
 * through its usual route, so what it shows is always what the server says.
 *
 * And, on the same channels, that the person's account can't go on: they're
 * suspended, closed or deleted, or their company is banned (part 3,
 * prisma/migrations/20261209000000_live_account). The heartbeat hears it and
 * asks at once, rather than at its next beat.
 *
 * And that a company's requests changed (part 2,
 * prisma/migrations/20261210000000_live_requests): the Requests page and the
 * count on Requests in the side bar draw themselves again. On the company's
 * channel, and on each Super Admin's own, as their count is every company's
 * when none is in view.
 *
 * And that a company's cash advances changed (part 4a,
 * prisma/migrations/20261211000000_live_advances): the Cash advances tab, a
 * person's cash advance, Add cost's line about it and an open Give advance
 * window draw themselves again. On the same channels as the requests.
 *
 * And that someone in a company came or went (part 6b,
 * prisma/migrations/20261214000000_live_online): the Employees list and All
 * users draw the Online badge again. On a channel of its own for each
 * company, which a tab joins only while one of them is open, so a coming or
 * going is heard by the few people looking, not by every tab (LiveWants).
 */

export type LiveKind = 'tasks' | 'notices' | 'account' | 'requests' | 'advances' | 'online'
/** A channel, and what it's for; any of them may also say the account can't go on, or that requests or cash advances changed. */
export type LiveTopic = { kind: Exclude<LiveKind, 'account' | 'requests' | 'advances' | 'online'>; topic: string }

type Viewer = { id: string; role: string; companyId?: string | null }

/**
 * The channels a person listens to: their company's tasks, or for the Super
 * Admin the company in view's, and their own notifications. The rules on
 * Supabase's side refuse any other, whatever a browser asks for.
 */
export function liveTopics(viewer: Viewer, scopedCompanyId: string | null): LiveTopic[] {
    const company = viewer.role === 'SUPER_ADMIN' ? scopedCompanyId : viewer.companyId ?? null
    return [
        ...(company ? [{ kind: 'tasks' as const, topic: `tasks:${company}` }] : []),
        { kind: 'notices', topic: `notices:${viewer.id}` },
    ]
}

/**
 * The channels a list showing who's online hears (part 6b): its company's,
 * for anyone but the Super Admin; the company in view's, or the one picked,
 * for the Super Admin; and with neither, each company on the page shown,
 * once each. Supabase counts a signal as it's sent, whoever listens, so
 * there's no channel for every company's comings and goings.
 */
export function onlineTopics(viewer: Viewer, shownCompanyId: string | null, listed: (string | null | undefined)[]): string[] {
    if (viewer.role !== 'SUPER_ADMIN') return viewer.companyId ? [`online:${viewer.companyId}`] : []
    if (shownCompanyId) return [`online:${shownCompanyId}`]
    const companies = new Set<string>()
    for (const company of listed) if (company) companies.add(company)
    return [...companies].sort().map(company => `online:${company}`)
}

/** How long a channel no screen wants any more is kept, in case one wants it again. */
export const LEAVE_AFTER_MS = 5_000

/**
 * The channels the screens open now want heard, beyond the tab's own
 * (part 6b): each joined once, however many screens want it, and left a few
 * seconds after the last lets go. React mounts a screen twice in
 * development, letting go between, and a list's next page may want the same
 * company: a channel being left can't be joined again until Supabase has
 * closed it. The tab's connection watches them (lib/live-connection.ts),
 * and outlives none of them: another connection, for another company in
 * view, joins the same.
 */
export class LiveWants {
    private readonly counts = new Map<string, number>()
    private readonly leaving = new Map<string, ReturnType<typeof setTimeout>>()
    private readonly watchers = new Set<(topic: string, wanted: boolean) => void>()

    /** `topic` is heard while it's wanted; returns how to let it go. */
    want(topic: string): () => void {
        const count = this.counts.get(topic) ?? 0
        this.counts.set(topic, count + 1)
        const leaving = this.leaving.get(topic)
        if (leaving !== undefined) {
            clearTimeout(leaving)
            this.leaving.delete(topic)
        } else if (count === 0) {
            this.tell(topic, true)
        }
        let released = false
        return () => {
            if (released) return
            released = true
            const left = (this.counts.get(topic) ?? 1) - 1
            this.counts.set(topic, left)
            if (left > 0) return
            this.leaving.set(topic, setTimeout(() => {
                this.leaving.delete(topic)
                this.counts.delete(topic)
                this.tell(topic, false)
            }, LEAVE_AFTER_MS))
        }
    }

    /** What's joined now: wanted, or let go of within the last few seconds. */
    topics(): string[] {
        return [...this.counts.keys()]
    }

    /** Told as each topic is joined or left; returns how to stop. */
    watch(watcher: (topic: string, wanted: boolean) => void): () => void {
        this.watchers.add(watcher)
        return () => { this.watchers.delete(watcher) }
    }

    private tell(topic: string, wanted: boolean) {
        for (const watcher of this.watchers) watcher(topic, wanted)
    }
}

/**
 * Turns signals into screens drawn again (DESIGN.md §8):
 *   - once for signals close together, a second after the last, and at
 *     least every five seconds while they keep coming;
 *   - not while the tab is hidden: it's drawn at once when it's shown again;
 *   - once for everything after joining again, for whatever was missed.
 */
export class LiveDrawer {
    private readonly listeners = new Map<LiveKind, Set<() => void>>()
    private readonly pending = new Set<LiveKind>()
    private timer: ReturnType<typeof setTimeout> | null = null
    private firstPendingAt: number | null = null
    private readonly delayMs: number
    private readonly maxWaitMs: number
    private readonly hidden: () => boolean

    constructor({ delayMs = 1000, maxWaitMs = 5000, hidden }: { delayMs?: number; maxWaitMs?: number; hidden: () => boolean }) {
        this.delayMs = delayMs
        this.maxWaitMs = maxWaitMs
        this.hidden = hidden
    }

    /** Draws `draw` when `kind` changes; returns how to stop. */
    on(kind: LiveKind, draw: () => void): () => void {
        let set = this.listeners.get(kind)
        if (!set) this.listeners.set(kind, set = new Set())
        set.add(draw)
        return () => { set.delete(draw) }
    }

    signal(kind: LiveKind) {
        this.pending.add(kind)
        const now = Date.now()
        this.firstPendingAt ??= now
        if (this.timer) clearTimeout(this.timer)
        const wait = Math.max(0, Math.min(this.delayMs, this.firstPendingAt + this.maxWaitMs - now))
        this.timer = setTimeout(() => this.flush(), wait)
    }

    /** Joined again after a break: whatever was missed meanwhile. */
    everything() {
        for (const kind of this.listeners.keys()) this.signal(kind)
    }

    /** The tab is shown again: what waited while it was hidden, at once. */
    shown() {
        if (this.pending.size > 0 && !this.timer) this.flush()
    }

    private flush() {
        this.timer = null
        this.firstPendingAt = null
        // Waits in `pending` until shown(): a hidden tab draws nothing.
        if (this.hidden()) return
        const kinds = [...this.pending]
        this.pending.clear()
        for (const kind of kinds) {
            for (const draw of this.listeners.get(kind) ?? []) {
                try {
                    draw()
                } catch (error) {
                    console.error(`[live] drawing ${kind} again failed`, error)
                }
            }
        }
    }
}

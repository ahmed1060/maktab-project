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
 */

export type LiveKind = 'tasks' | 'notices' | 'account' | 'requests'
/** A channel, and what it's for; any of them may also say the account can't go on, or that requests changed. */
export type LiveTopic = { kind: Exclude<LiveKind, 'account' | 'requests'>; topic: string }

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

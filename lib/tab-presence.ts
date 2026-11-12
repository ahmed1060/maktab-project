import { AWAY_AFTER_MS, HEARTBEAT_MS } from "./presence"

/**
 * Who's online, part 6a (REALTIME_PLAN.md §3, PR 262): each open tab says when
 * it's shown and when it goes, so someone who closes the app shows as offline
 * at once, where they showed as online for minutes after, and the heartbeat
 * is only the safety net, every 15 minutes.
 *
 * What a tab sends, and when, is decided here, away from the page, so it can
 * be checked without a browser (lib/tab-presence.test.ts):
 * components/UserHeartbeat.tsx passes it the page's events, and the server
 * keeps a row for each tab that's here (UserService.updateActivity).
 */

/** Here: the tab is shown. Away: it's closed, or out of sight for 2 minutes. */
export type TabState = "here" | "away"

/** What a tab sends: its id, and here or away, or neither to ask only the account's state. */
export type TabReport = { tab: string; state?: TabState }

/**
 * A tab's id, made for it as its page loads, and kept only for that page:
 * a reload is another page, whose old row its closing takes away. Kept in
 * sessionStorage instead, a tab duplicated would share its id, and closing
 * one would take away the other's row.
 */
export function newTabId(): string {
    const bytes = new Uint8Array(16)
    crypto.getRandomValues(bytes)
    return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("")
}

/** An id the server keeps a row for: letters, digits and dashes, 16 to 64 of them. */
export function isTabId(value: unknown): value is string {
    return typeof value === "string" && /^[A-Za-z0-9-]{16,64}$/.test(value)
}

/**
 * The report in a request's body: undefined for none, as a page still on the
 * old script sends, and "bad" for anything that isn't one. A closing tab's
 * beacon comes as text, which every browser sends as the page closes.
 */
export function readTabReport(body: unknown): TabReport | undefined | "bad" {
    if (body === null || body === undefined || body === "") return undefined
    if (typeof body === "string") {
        try {
            body = JSON.parse(body)
        } catch {
            return "bad"
        }
    }
    if (typeof body !== "object" || body === null || Array.isArray(body)) return "bad"
    const { tab, state } = body as { tab?: unknown; state?: unknown }
    if (!isTabId(tab)) return "bad"
    if (state === undefined) return { tab }
    if (state !== "here" && state !== "away") return "bad"
    return { tab, state }
}

type Ways = {
    /** Whether the page is shown now. */
    isVisible: () => boolean
    /** Sends a report, and reads the account's state from the answer. */
    send: (state: TabState) => void
    /** Sends a report as the page closes, with nothing to read back. */
    beacon: (state: TabState) => void
}

/**
 * One tab's reports. The page calls shown() and hidden() as it's shown and
 * goes out of sight, closed() as it closes, and beat() at each heartbeat.
 */
export function createTabReporter({ isVisible, send, beacon }: Ways) {
    // What the server was last told, and when: nothing yet, for a tab opened
    // out of sight, which has no row until it's looked at.
    let said: TabState | null = null
    let saidAt = 0
    let awayTimer: ReturnType<typeof setTimeout> | null = null

    const cancelAway = () => {
        if (awayTimer !== null) clearTimeout(awayTimer)
        awayTimer = null
    }
    const here = () => {
        said = "here"
        saidAt = Date.now()
        send("here")
    }

    return {
        shown() {
            cancelAway()
            // Looked at again within the 2 minutes: its row is there, and
            // fresh enough to last to the next beat. A phone pauses a page out
            // of sight, and its timers with it, so one away a long time may
            // have no "away" heard and a row near running out.
            if (said === "here" && Date.now() - saidAt < HEARTBEAT_MS) return
            here()
        },
        hidden() {
            if (said !== "here" || awayTimer !== null) return
            awayTimer = setTimeout(() => {
                awayTimer = null
                // A timer due while a phone paused the page runs only as it's
                // shown again: then the tab is here, and there's nothing to say.
                if (isVisible() || said !== "here") return
                said = "away"
                saidAt = Date.now()
                send("away")
            }, AWAY_AFTER_MS)
        },
        closed() {
            cancelAway()
            if (said !== "here") return
            said = "away"
            saidAt = Date.now()
            beacon("away")
        },
        beat() {
            if (!isVisible()) return
            here()
        },
        stop() {
            cancelAway()
        },
    }
}

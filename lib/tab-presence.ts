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

/**
 * What a tab sends: its id, and here or away with its place in the tab's
 * order (nextSeq), or neither, to ask only the account's state.
 */
export type TabReport = { tab: string } | { tab: string; state: TabState; seq: number }

/**
 * The end of every tab's order (a Postgres integer's largest), where signing
 * out puts a session's tabs: a report's place is below it.
 */
export const SEQ_MAX = 2 ** 31 - 1

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

// The last place given in this page's order: its tabs' reports, one after
// another (a tab's id lasts only as long as its page).
let lastSeq = 0

/**
 * A report's place in its tab's order. Two requests from one tab can reach
 * the server either way round, as a closing tab's beacon overtaking the beat
 * it sent just before, and the server keeps a report only if none after it
 * has arrived (UserService.updateActivity, PR 262).
 */
export function nextSeq(): number {
    lastSeq += 1
    return lastSeq
}

/** An id the server keeps a row for: letters, digits and dashes, 16 to 64 of them. */
export function isTabId(value: unknown): value is string {
    return typeof value === "string" && /^[A-Za-z0-9-]{16,64}$/.test(value)
}

/**
 * The report in a request's body: undefined for none, as a page still on the
 * old script sends, and "bad" for anything that isn't one, here or away
 * without its place in the order among them. A closing tab's beacon comes as
 * text, which every browser sends as the page closes.
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
    const { tab, state, seq } = body as { tab?: unknown; state?: unknown; seq?: unknown }
    if (!isTabId(tab)) return "bad"
    if (state === undefined) return { tab }
    if (state !== "here" && state !== "away") return "bad"
    if (typeof seq !== "number" || !Number.isInteger(seq) || seq < 1 || seq >= SEQ_MAX) return "bad"
    return { tab, state, seq }
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
    // Whether the closing beacon has gone since the tab was last here.
    let beaconed = false
    let awayTimer: ReturnType<typeof setTimeout> | null = null

    const cancelAway = () => {
        if (awayTimer !== null) clearTimeout(awayTimer)
        awayTimer = null
    }
    const here = () => {
        said = "here"
        saidAt = Date.now()
        beaconed = false
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
            // Said away already, after 2 minutes out of sight, it says so
            // again: that was an ordinary request, which a page closing as
            // it's sent can cancel, and a beacon still goes as the page does
            // (Codex on #262). The server keeps the later of the two. A tab
            // never looked at has no row to close.
            if (said === null || beaconed) return
            said = "away"
            saidAt = Date.now()
            beaconed = true
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

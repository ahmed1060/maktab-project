import { describe, it, expect, beforeEach, vi } from "vitest"
import { readFileSync } from "node:fs"
import { AWAY_AFTER_MS, HEARTBEAT_MS } from "./presence"
import { createTabReporter, isTabId, newTabId, readTabReport } from "./tab-presence"

/**
 * Who's online, part 6a (REALTIME_PLAN.md §3): each tab says when it's shown
 * and when it goes, so someone who closes the app shows as offline at once,
 * and the heartbeat only has to be a safety net, every 15 minutes. What a tab
 * sends, and when, is decided here, away from the page, so it can be checked
 * without a browser; components/UserHeartbeat.tsx only passes it the page's
 * events.
 */

type Sent = { via: "fetch" | "beacon"; state?: "here" | "away" }

function setup(visible = true) {
    vi.useFakeTimers()
    const sent: Sent[] = []
    const page = { visible }
    const reporter = createTabReporter({
        isVisible: () => page.visible,
        send: (state) => { sent.push({ via: "fetch", state }) },
        beacon: (state) => { sent.push({ via: "beacon", state }) },
    })
    return { sent, page, reporter }
}

describe("a tab says it's here", () => {
    beforeEach(() => { vi.useRealTimers() })

    it("as it's shown, once, asking the account's state with it", () => {
        const { sent, reporter } = setup()
        reporter.shown()
        expect(sent).toEqual([{ via: "fetch", state: "here" }])
        // Shown again without having gone: nothing more to say.
        reporter.shown()
        expect(sent).toHaveLength(1)
    })

    it("and again at each heartbeat while it's shown, as the safety net", () => {
        const { sent, reporter } = setup()
        reporter.shown()
        reporter.beat()
        expect(sent).toEqual([{ via: "fetch", state: "here" }, { via: "fetch", state: "here" }])
    })

    it("but a tab out of sight doesn't beat", () => {
        const { sent, page, reporter } = setup()
        reporter.shown()
        page.visible = false
        reporter.hidden()
        reporter.beat()
        expect(sent).toEqual([{ via: "fetch", state: "here" }])
    })

    it("and again as it's shown after a long time out of sight with nothing heard", () => {
        // A phone pauses a page out of sight, its timers with it, so the
        // 2 minutes never ran and no "away" went: its row may be near running
        // out as it's looked at again.
        const { sent, page, reporter } = setup()
        reporter.shown()
        page.visible = false
        vi.advanceTimersByTime(HEARTBEAT_MS)
        page.visible = true
        reporter.shown()
        expect(sent).toEqual([{ via: "fetch", state: "here" }, { via: "fetch", state: "here" }])
    })

    it("beats every 15 minutes, where it was every 90 seconds", () => {
        expect(HEARTBEAT_MS).toBe(15 * 60_000)
    })
})

describe("a tab says it's gone", () => {
    beforeEach(() => { vi.useRealTimers() })

    it("once it's been out of sight for 2 minutes", () => {
        const { sent, page, reporter } = setup()
        reporter.shown()
        page.visible = false
        reporter.hidden()
        vi.advanceTimersByTime(AWAY_AFTER_MS - 1)
        expect(sent).toHaveLength(1)
        vi.advanceTimersByTime(1)
        expect(sent).toEqual([{ via: "fetch", state: "here" }, { via: "fetch", state: "away" }])
        expect(AWAY_AFTER_MS).toBe(2 * 60_000)
    })

    it("but not if it's looked at again within them: a glance at another tab sends nothing", () => {
        const { sent, page, reporter } = setup()
        reporter.shown()
        page.visible = false
        reporter.hidden()
        vi.advanceTimersByTime(AWAY_AFTER_MS / 2)
        page.visible = true
        reporter.shown()
        vi.advanceTimersByTime(AWAY_AFTER_MS)
        expect(sent).toEqual([{ via: "fetch", state: "here" }])
    })

    it("and comes back as here when it's shown after that", () => {
        const { sent, page, reporter } = setup()
        reporter.shown()
        page.visible = false
        reporter.hidden()
        vi.advanceTimersByTime(AWAY_AFTER_MS)
        page.visible = true
        reporter.shown()
        expect(sent.map(s => s.state)).toEqual(["here", "away", "here"])
    })

    it("as it closes, with a beacon, which still goes as the page does", () => {
        const { sent, reporter } = setup()
        reporter.shown()
        reporter.closed()
        expect(sent).toEqual([{ via: "fetch", state: "here" }, { via: "beacon", state: "away" }])
    })

    it("only once, closing a tab already gone", () => {
        const { sent, page, reporter } = setup()
        reporter.shown()
        page.visible = false
        reporter.hidden()
        vi.advanceTimersByTime(AWAY_AFTER_MS)
        reporter.closed()
        expect(sent.map(s => s.state)).toEqual(["here", "away"])
    })

    it("not twice, closing while it waits out the 2 minutes", () => {
        const { sent, page, reporter } = setup()
        reporter.shown()
        page.visible = false
        reporter.hidden()
        reporter.closed()
        vi.advanceTimersByTime(AWAY_AFTER_MS)
        expect(sent).toEqual([{ via: "fetch", state: "here" }, { via: "beacon", state: "away" }])
    })

    it("and a timer that fires late, as the tab is shown again, says nothing", () => {
        // A phone pauses a page out of sight, and its timers with it: one due
        // while it was away can run only as it comes back.
        const { sent, page, reporter } = setup()
        reporter.shown()
        page.visible = false
        reporter.hidden()
        page.visible = true
        vi.advanceTimersByTime(AWAY_AFTER_MS)
        expect(sent).toEqual([{ via: "fetch", state: "here" }])
    })

    it("stops when the page stops", () => {
        const { sent, page, reporter } = setup()
        reporter.shown()
        page.visible = false
        reporter.hidden()
        reporter.stop()
        vi.advanceTimersByTime(AWAY_AFTER_MS)
        expect(sent).toHaveLength(1)
    })
})

describe("a tab's own id", () => {
    it("is made for it, and is one the server takes", () => {
        const a = newTabId(), b = newTabId()
        expect(isTabId(a)).toBe(true)
        expect(a).not.toBe(b)
    })

    it("keeps nothing out of the server's rule", () => {
        for (const bad of ["", "short", "x".repeat(65), "has space here", "semi;colon-1234", "legacy"]) expect(isTabId(bad), bad).toBe(false)
        expect(isTabId(undefined)).toBe(false)
        expect(isTabId(5)).toBe(false)
    })
})

describe("what the server reads of a tab's report", () => {
    const tab = newTabId()

    it("its id, and here or away", () => {
        expect(readTabReport({ tab, state: "here" })).toEqual({ tab, state: "here" })
        expect(readTabReport({ tab, state: "away" })).toEqual({ tab, state: "away" })
    })

    it("its id alone, asking only the account's state", () => {
        expect(readTabReport({ tab })).toEqual({ tab })
    })

    it("nothing at all from a page still on the old script", () => {
        expect(readTabReport(null)).toBeUndefined()
        expect(readTabReport(undefined)).toBeUndefined()
    })

    it("a closing tab's beacon, which comes as text", () => {
        expect(readTabReport(JSON.stringify({ tab, state: "away" }))).toEqual({ tab, state: "away" })
        expect(readTabReport("")).toBeUndefined()
    })

    it("refuses anything else", () => {
        for (const bad of [{}, { tab: "x" }, { tab, state: "gone" }, { tab, state: 1 }, [tab], "not json", "5", 5, true]) {
            expect(readTabReport(bad), JSON.stringify(bad)).toBe("bad")
        }
    })
})

describe("the page passes it the events", () => {
    const heartbeat = readFileSync("components/UserHeartbeat.tsx", "utf8")

    it("shown and out of sight, closed, and the beat", () => {
        expect(heartbeat).toContain("createTabReporter(")
        expect(heartbeat).toContain("'visibilitychange'")
        expect(heartbeat).toContain("'pagehide'")
        expect(heartbeat).toContain("navigator.sendBeacon(")
        expect(heartbeat).toContain("}, HEARTBEAT_MS)")
    })

    it("and sends the tab's id with every beat", () => {
        expect(heartbeat).toMatch(/JSON\.stringify\(\{ tab: tabId/)
    })

    it("and is told of signing out before the session ends, which would refuse it after", () => {
        expect(heartbeat).toContain("'app:signing-out'")
        const header = readFileSync("components/DashboardHeader.tsx", "utf8")
        const told = header.indexOf("new CustomEvent('app:signing-out')")
        expect(told).toBeGreaterThan(-1)
        expect(told).toBeLessThan(header.indexOf("await signOut("))
    })

    it("keeps one reporter while signed in: the session, refreshed every 5 minutes, doesn't start another", () => {
        // A new reporter says "here" as it starts, so one for each refresh of
        // the session would be a call every 5 minutes from every tab, shown or
        // not, where the beat is every 15 and only while shown.
        expect(heartbeat).toContain("const userId = session?.user?.id")
        expect(heartbeat).toMatch(/\}, \[userId, tabId\]\)/)
    })
})

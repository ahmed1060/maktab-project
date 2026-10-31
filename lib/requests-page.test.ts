import { describe, it, expect, vi } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"
import type { FeedRow } from "@/lib/requests/kinds"
import { en } from "./translations/en"
import { ar } from "./translations/ar"

/**
 * The one Requests page, part 1 (UI_PLAN.md §2.3): on the building blocks,
 * Mine and To review, Waiting and Done, the kind filter once there's more
 * than one kind, and every request read the same way: who asked, what for,
 * when, its status and the buttons to decide it.
 */

vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: () => {}, refresh: () => {} }),
    useSearchParams: () => new URLSearchParams(""),
}))
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: null }) }))
vi.mock("@/context/LanguageContext", () => ({ useLanguage: () => ({ locale: "en", t: (key: string) => key }) }))
vi.mock("@/context/ToastContext", () => ({ useToast: () => ({ showToast: () => {} }) }))
vi.mock("@/context/CompanyContext", () => ({ useCompany: () => ({ selectedCompanyId: null }) }))
vi.mock("@/lib/useModules", () => ({ useModules: () => ({ label: (k: string) => k === "requests" ? "Requests" : k }) }))

const row = (fields: Partial<FeedRow> = {}): FeedRow => ({
    kind: "internal", id: "r1", who: { id: "e2", name: "Mona Adel" }, what: "A new chair", detail: "Mine is broken.",
    asked: "2026-10-29T09:00:00.000Z", started: null, finished: null, status: "PENDING", sortAt: "2026-10-29T09:00:00.000Z",
    mayDecide: false, mayDelete: false, ...fields,
})

async function page(props: Record<string, unknown> = {}) {
    const { default: RequestsClient } = await import("@/app/(dashboard)/dashboard/requests/RequestsClient")
    return renderToStaticMarkup(h(RequestsClient, {
        rows: [row()], total: 1, page: 1, totalPages: 1, kinds: ["internal"],
        tabs: { mine: true, review: true }, tab: "review", show: "waiting", superAdmin: false,
        ...props,
    } as any))
}

describe("the Requests page", () => {
    it("has the page header, with New request for whoever asks for things", async () => {
        const html = await page()
        expect(html).toContain('class="ui-page-header"')
        expect(html).toMatch(/<h1[^>]*>Requests</)
        expect(html).toContain("requests_subtitle")
        expect(html).toMatch(/ui-btn-primary[^>]*>.*requests_new/)
        expect(await page({ tabs: { mine: false, review: true } })).not.toContain("requests_new")
    })

    it("has Mine and To review for whoever sees others' requests, and no tabs otherwise", async () => {
        const html = await page()
        expect(html).toContain("requests_tab_mine")
        expect(html).toContain("requests_tab_review")
        expect(html).toMatch(/aria-current="page"[^>]*>requests_tab_review|requests_tab_review[^<]*<\/a>/)
        expect(await page({ tabs: { mine: true, review: false }, tab: "mine" })).not.toContain("requests_tab_review")
    })

    it("filters by Waiting or Done, by who asked on To review, and by kind once there's more than one", async () => {
        const html = await page()
        expect(html).toContain("requests_show_waiting")
        expect(html).toContain("requests_show_done")
        expect(html).toContain("all_employees")
        expect(html).not.toContain("requests_kind_all")
        expect(await page({ tab: "mine" })).not.toContain("all_employees")
        expect(await page({ kinds: ["internal", "dayOff"] })).toContain("requests_kind_all")
    })

    it("reads each request the same way: what for, who asked, when, and its status", async () => {
        const html = await page()
        expect(html).toContain("A new chair")
        expect(html).toContain("Mona Adel")
        expect(html).toContain("ui-badge ui-badge-waiting")
        expect(html).toContain("status_pending")
        expect(await page({ rows: [row({ status: "IN_PROGRESS" })] })).toContain("ui-badge ui-badge-progress")
        expect(await page({ rows: [row({ status: "COMPLETED" })], show: "done" })).toContain("ui-badge ui-badge-good")
        // Who asked is on To review; on Mine it's them.
        expect(await page({ tab: "mine" })).not.toContain("requests_col_who")
    })

    it("keeps when it was asked on one line, its time not broken from its day (found in the browser)", () => {
        const client = readFileSync("app/(dashboard)/dashboard/requests/RequestsClient.tsx", "utf8")
        expect(client).toContain('<span className="ui-nowrap"><SafeDate date={r.asked} locale={locale} format="short" /></span>')
    })

    it("offers the next step to whoever may decide it: Start, then Mark as done", async () => {
        expect(await page()).not.toContain("requests_start")
        expect(await page({ rows: [row({ mayDecide: true })] })).toMatch(/<button[^>]*>.*requests_start/)
        expect(await page({ rows: [row({ mayDecide: true, status: "IN_PROGRESS" })] })).toMatch(/<button[^>]*>.*requests_mark_done/)
    })

    it("puts its details and Delete in its More actions", async () => {
        expect(await page()).toContain('aria-label="ui_more_actions_for"')
        const client = readFileSync("app/(dashboard)/dashboard/requests/RequestsClient.tsx", "utf8")
        expect(client).toContain("label: t('requests_view_details')")
        expect(client).toContain("label: t('delete'), danger: true")
    })

    it("says when there's nothing, for each tab and show, and when the filters match nothing", async () => {
        expect(await page({ rows: [], total: 0, tab: "mine" })).toContain("requests_empty_mine")
        expect(await page({ rows: [], total: 0 })).toContain("requests_empty_review")
        expect(await page({ rows: [], total: 0, show: "done" })).toContain("requests_empty_done")
    })

    it("has no styles typed in", async () => {
        const html = await page({ rows: [row({ mayDecide: true, mayDelete: true })] })
        expect(html).not.toContain("style=")
        expect(html).not.toContain("<style")
    })
})

describe("day off on it (UI_PLAN.md §2.3, part 2c)", () => {
    const leave = (fields: Partial<FeedRow> = {}): FeedRow => row({
        kind: "dayOff", id: "d1", what: "REGULAR", detail: "A wedding",
        dayOff: { from: "2026-11-03T00:00:00.000Z", to: "2026-11-05T00:00:00.000Z", deducted: 0, deductedFrom: "CREDIT", rejectionReason: null, credit: 12 },
        ...fields,
    })
    const client = readFileSync("app/(dashboard)/dashboard/requests/RequestsClient.tsx", "utf8")
    const dialogs = readFileSync("app/(dashboard)/dashboard/requests/DayOffDialogs.tsx", "utf8")

    it("reads as any request does: the kind of leave, which days and how many work days, who asked and its status", async () => {
        const html = await page({ rows: [leave()], kinds: ["internal", "dayOff"] })
        expect(html).toContain("regular_day_off")
        expect(html).toContain("3 Nov 2026 – 5 Nov 2026")
        expect(html).toContain("count_days_other")
        expect(html).toContain("Mona Adel")
        expect(html).toContain("ui-badge ui-badge-waiting")
        // Its kind is "Day off", not the side bar's "Day off requests" (found in the browser).
        expect(html).toContain("requests_kind_day_off")
    })

    it("joins its days with an Arabic comma in Arabic, where a dot reads as the digit zero (found in the browser)", () => {
        expect(client).toContain("const sep = locale === 'ar' ? '، ' : ' · '")
        expect(client).not.toContain("join(' · ')")
        expect(client).not.toMatch(/\{leaveDates\(r\)\} · \{leaveDays\(r\)\}/)
    })

    it("is approved or rejected under To review by whoever may decide it", async () => {
        expect(await page({ rows: [leave()] })).not.toContain("approve_button")
        const html = await page({ rows: [leave({ mayDecide: true })] })
        expect(html).toMatch(/<button[^>]*>.*approve_button/)
        expect(html).toMatch(/<button[^>]*>.*reject_button/)
    })

    it("once decided, is Approved or Rejected", async () => {
        expect(await page({ rows: [leave({ status: "APPROVED" })], show: "done" })).toContain("ui-badge ui-badge-good")
        expect(await page({ rows: [leave({ status: "REJECTED" })], show: "done" })).toContain("ui-badge ui-badge-problem")
    })

    it("is searched by its reason as well as a request by its title", async () => {
        expect(await page({ kinds: ["internal", "dayOff"] })).toContain("requests_search_any")
        expect(await page()).not.toContain("requests_search_any")
    })

    it("shows one's day off balance on Mine, above the list, to whoever may ask for leave", async () => {
        const mine = await page({ tab: "mine", kinds: ["internal", "dayOff"], credit: { remaining: 9, used: 3 }, mayAskDayOff: true })
        expect(mine).toContain("credit_overview")
        expect(mine.indexOf("credit_overview")).toBeLessThan(mine.indexOf("ui-filterbar"))
        expect(await page({ kinds: ["internal", "dayOff"], credit: { remaining: 9, used: 3 }, mayAskDayOff: true })).not.toContain("credit_overview")
        expect(await page({ tab: "mine", credit: null })).not.toContain("credit_overview")
    })

    it("is decided as the old page did: days to take, from the balance or the salary, or a reason to refuse", () => {
        expect(dialogs).toContain("fetch(`/api/admin/day-off-requests/${request.id}`")
        expect(dialogs).toContain("t('days_to_deduct_label')")
        expect(dialogs).toContain("t('insufficient_credit')")
        expect(dialogs).toContain("maxLength={300}")
    })

    it("is asked for from New request, by whoever may, with its type, days and reason", () => {
        expect(client).toContain("mayAskDayOff")
        expect(dialogs).toContain("fetch('/api/day-off-requests'")
        expect(dialogs).toContain("t('requests_day_off_date_missing')")
        // Why the server refused it, in their language.
        expect(dialogs).toContain("OVERLAPPING_REQUEST")
        expect(dialogs).toContain("DATE_IN_PAST")
    })

    it("has no styles typed in", async () => {
        const html = await page({ rows: [leave({ mayDecide: true })], kinds: ["internal", "dayOff"] })
        expect(html).not.toContain("style=")
    })
})

describe("its server page", () => {
    const server = readFileSync("app/(dashboard)/dashboard/requests/page.tsx", "utf8")

    it("reads the rows from the one feed, on the tab this person has", () => {
        expect(server).toContain("requestFeed(viewer,")
        expect(server).toContain("tabsFor(viewer)")
    })

    it("offers asking for a day off to whoever's role may, in a company with Day off, with their balance", () => {
        expect(server).toContain("can(viewer, 'dayoff.request')")
        expect(server).toContain("sessionHasModule({ user: viewer }, 'DAY_OFF')")
        expect(server).toContain("usedDayOffCredit(")
    })

    it("opens a notification's request on its tab and with its status", () => {
        expect(server).toContain("searchParams.highlight")
    })
})

describe("the old history page and links to it", () => {
    it("send people to Done on the Requests page, keeping the request picked out", () => {
        const history = readFileSync("app/(dashboard)/dashboard/requests/history/page.tsx", "utf8")
        expect(history).toContain("redirect(")
        expect(history).toContain("show: 'done'")
        expect(history).toContain("highlight")
    })

    it("are a notification's link to its request, without asking for its status first", () => {
        const bell = readFileSync("components/NotificationBell.tsx", "utf8")
        expect(bell).toContain("router.push(`/dashboard/requests?highlight=${notification.relatedId}`)")
        expect(bell).not.toContain("/dashboard/requests/history")
    })
})

describe("its words", () => {
    it("are in sentence case, and the same keys in both languages (DESIGN.md §3.4)", () => {
        for (const key of ["requests_new", "requests_tab_mine", "requests_tab_review", "requests_show_waiting", "requests_show_done", "requests_start", "requests_mark_done", "requests_view_details"] as const) {
            expect(en[key].slice(1), key).toBe(en[key].slice(1).toLowerCase())
            expect(ar[key], key).toBeTruthy()
        }
    })
})

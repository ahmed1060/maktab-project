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

/** The page's address, which a test may set. */
const address = { query: "" }
vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: () => {}, refresh: () => {} }),
    useSearchParams: () => new URLSearchParams(address.query),
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
    // The first to render the page imports it, which takes a while on a cold start.
    it("has the page header, with New request for whoever asks for things", { timeout: 60_000 }, async () => {
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
        expect(client).toMatch(/<span className="ui-nowrap">\{r\.overtime \? permissionDay\(r\.overtime\.date, locale\)[\s\S]{0,200}: <SafeDate date=\{r\.asked\} locale=\{locale\} format="short" \/>\}<\/span>/)
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

    it("is filtered by its dates of leave once the kind is Day off, as the Day off list was (decided on 2026-10-31)", async () => {
        expect(await page({ kinds: ["internal", "dayOff"] })).not.toContain("requests_leave_dates")
        address.query = "kind=dayOff&from=2026-11-01&to=2026-11-07"
        try {
            const html = await page({ kinds: ["internal", "dayOff"] })
            expect(html).toContain("requests_leave_dates")
            // Day off and its dates: two filters on.
            expect(html).toMatch(/ui-filterbar-count[^>]*>2</)
        } finally {
            address.query = ""
        }
        // Leaving Day off, or resetting, takes its dates with it.
        expect(client).toContain("go({ kind: e.target.value, from: '', to: '' })")
        expect(client).toContain("go({ kind: '', employeeId: '', search: '', from: '', to: '' })")
    })
})

describe("permission hours on it (UI_PLAN.md §2.3, part 3a)", () => {
    const hours = (fields: Partial<FeedRow> = {}): FeedRow => row({
        kind: "permission", id: "p1", what: "EARLY_LEAVE", detail: "Doctor",
        permission: { date: "2026-11-03", start: "16:00", end: "17:00", minutes: 60, rejectionReason: null },
        ...fields,
    })
    const client = readFileSync("app/(dashboard)/dashboard/requests/RequestsClient.tsx", "utf8")
    const dialogs = readFileSync("app/(dashboard)/dashboard/requests/AttendanceDialogs.tsx", "utf8")
    const allowance = { left: 90, total: 120, pending: 30, carried: 0 }

    it("reads as any request does: the type of permission, its day and hours, who asked and its status", async () => {
        const html = await page({ rows: [hours()], kinds: ["internal", "dayOff", "permission"] })
        expect(html).toContain("audit_value_EARLY_LEAVE")
        expect(html).toContain("3 Nov 2026")
        expect(html).toContain("16:00")
        expect(html).toContain("17:00")
        expect(html).toContain("Mona Adel")
        expect(html).toContain("requests_kind_permission")
        expect(html).toContain("ui-badge ui-badge-waiting")
    })

    it("is approved or rejected under To review by whoever may decide it", async () => {
        expect(await page({ rows: [hours()] })).not.toContain("approve_button")
        const html = await page({ rows: [hours({ mayDecide: true })] })
        expect(html).toMatch(/<button[^>]*>.*approve_button/)
        expect(html).toMatch(/<button[^>]*>.*reject_button/)
        expect(dialogs).toContain("permission: '/api/attendance/permissions'")
        expect(dialogs).toContain("fetch(`${ATTENDANCE_API[request.kind as AttendanceKind]}/${request.id}/decide`")
    })

    it("once ended, is Approved, Rejected or Withdrawn, which is no one's fault", async () => {
        expect(await page({ rows: [hours({ status: "APPROVED" })], show: "done" })).toContain("ui-badge ui-badge-good")
        expect(await page({ rows: [hours({ status: "REJECTED" })], show: "done" })).toContain("ui-badge ui-badge-problem")
        const withdrawn = await page({ rows: [hours({ status: "CANCELLED" })], show: "done" })
        expect(withdrawn).toContain("ui-badge ui-badge-neutral")
        expect(withdrawn).toContain("status_withdrawn")
    })

    it("may be withdrawn from its More actions by whoever asked, once they've said so", () => {
        expect(client).toContain("r.mayWithdraw")
        expect(client).toContain(": t('req_withdraw')")
        expect(dialogs).toContain("fetch(`${ATTENDANCE_API[request.kind as AttendanceKind]}/${request.id}`, { method: 'DELETE' })")
        expect(client).toContain("'req_withdraw_hint'")
    })

    it("shows what's left of the month's permission hours on Mine, under the day off balance and above the list", async () => {
        const mine = await page({ tab: "mine", kinds: ["internal", "dayOff", "permission"], credit: { remaining: 9, used: 3 }, mayAskDayOff: true, allowance })
        expect(mine).toContain("requests_permission_left")
        expect(mine).toContain("requests_permission_waiting")
        expect(mine.indexOf("credit_overview")).toBeLessThan(mine.indexOf("requests_permission_left"))
        expect(mine.indexOf("requests_permission_left")).toBeLessThan(mine.indexOf("ui-filterbar"))
        // Nothing waiting, nothing said of it.
        expect(await page({ tab: "mine", allowance: { ...allowance, pending: 0 } })).not.toContain("requests_permission_waiting")
        expect(await page({ allowance })).not.toContain("requests_permission_left")
    })

    it("is asked for from New request, with the chosen day's limits, its type, hours and reason", () => {
        expect(client).toContain("mayAskAttendance")
        expect(dialogs).toContain("fetch('/api/attendance/permissions', {")
        expect(dialogs).toContain("/api/attendance/permissions/balance?date=")
        expect(dialogs).toContain("t('req_limits')")
        expect(dialogs).toContain("t('req_permissions_off_on_day')")
        expect(dialogs).toContain("maxLength={500}")
        // Why the server refused it, in their language.
        for (const code of ["PERMISSION_TOO_LATE", "PERMISSION_OVER_ALLOWANCE", "PERMISSION_OVERLAPS", "PERMISSION_TOO_SHORT", "PERMISSION_TOO_LONG", "PERMISSION_TOO_MANY_REQUESTS", "PAYROLL_MONTH_LOCKED"]) {
            expect(dialogs, code).toContain(code)
        }
    })

    it("is searched by its reason, and by reason alone where there's no title to search", async () => {
        expect(await page({ kinds: ["internal", "permission"] })).toContain("requests_search_any")
        expect(await page({ kinds: ["permission"] })).toContain("requests_search_reason")
    })

    it("has no styles typed in", async () => {
        const html = await page({ rows: [hours({ mayDecide: true }), hours({ id: "p2", mayWithdraw: true })], tab: "mine", kinds: ["permission"], allowance })
        expect(html).not.toContain("style=")
    })
})

describe("missing punches on it (UI_PLAN.md §2.3, part 3b)", () => {
    const punch = (fields: Partial<FeedRow> = {}): FeedRow => row({
        kind: "missingPunch", id: "m1", what: "OUT", detail: "The terminal was down",
        missingPunch: { at: "2026-10-28T17:05", direction: "OUT", rejectionReason: null },
        ...fields,
    })
    const client = readFileSync("app/(dashboard)/dashboard/requests/RequestsClient.tsx", "utf8")
    const dialogs = readFileSync("app/(dashboard)/dashboard/requests/AttendanceDialogs.tsx", "utf8")

    it("reads as any request does: which punch, its day and time, who reported it and its status", async () => {
        const html = await page({ rows: [punch()], kinds: ["internal", "permission", "missingPunch"] })
        expect(html).toContain("requests_missing_out")
        expect(html).toContain("28 Oct 2026")
        expect(html).toContain("17:05")
        expect(html).toContain("Mona Adel")
        expect(html).toContain("requests_kind_missing_punch")
        expect(await page({ rows: [punch({ what: "", missingPunch: { at: "2026-10-28T17:05", direction: null, rejectionReason: null } })] })).toContain("requests_missing_any")
    })

    it("is approved, adding the punch, or rejected, under To review by whoever may decide it", async () => {
        expect(await page({ rows: [punch()] })).not.toContain("approve_button")
        const html = await page({ rows: [punch({ mayDecide: true })] })
        expect(html).toMatch(/<button[^>]*>.*approve_button/)
        expect(html).toMatch(/<button[^>]*>.*reject_button/)
        expect(dialogs).toContain("missingPunch: '/api/attendance/missing-punches'")
        expect(client).toContain("t('requests_missing_reject_question')")
    })

    it("may be withdrawn while it waits, once the one who reported it says so", async () => {
        expect(client).toContain("'requests_missing_withdraw_hint'")
        expect(await page({ rows: [punch({ status: "CANCELLED" })], show: "done" })).toContain("status_withdrawn")
    })

    it("is reported from New request: the day, which can't be after today, the time, in or out, and why", () => {
        expect(dialogs).toContain("fetch('/api/attendance/missing-punches', {")
        expect(dialogs).toContain("maxDate={today}")
        expect(dialogs).toContain("t('req_missing_hint')")
        expect(dialogs).toContain("t('punch_direction_unknown')")
        // Why the server refused it, in their language.
        for (const code of ["PUNCH_IN_FUTURE", "MISSING_PUNCH_ALREADY_REPORTED", "PAYROLL_MONTH_LOCKED"]) expect(dialogs, code).toContain(code)
    })

    it("knows today as the company's calendar has it, not the browser's, which can be a day behind (found by Codex on PR 131)", () => {
        const server = readFileSync("app/(dashboard)/dashboard/requests/page.tsx", "utf8")
        expect(server).toContain("const attendanceToday = mayAskAttendance ? await AttendanceRequestService.todayIn(viewer.companyId!) : null")
        expect(server).toContain("attendanceToday={attendanceToday}")
        expect(client).toContain("<ReportMissingPunch today={today}")
        expect(client).toContain("<AskPermission today={today}")
        // Both forms start on it, and a missing punch can't be after it.
        expect(dialogs).toContain("const [date, setDate] = useState(today)")
        expect(dialogs).not.toMatch(/function today\(\)/)
    })

    it("has no styles typed in", async () => {
        const html = await page({ rows: [punch({ mayDecide: true }), punch({ id: "m2", mayWithdraw: true })], kinds: ["missingPunch"] })
        expect(html).not.toContain("style=")
    })
})

describe("overtime on it (UI_PLAN.md §2.3, part 4a)", () => {
    const day = (fields: Partial<FeedRow> = {}): FeedRow => row({
        kind: "overtime", id: "d1", what: "", detail: null, asked: "2026-10-29T00:00:00.000Z", sortAt: "2026-10-29T00:00:00.000Z",
        overtime: { companyId: "c1", userId: "e2", date: "2026-10-29", minutes: 90, firstIn: "09:00", lastOut: "18:30", approvedMinutes: null, note: null },
        ...fields,
    })
    const client = readFileSync("app/(dashboard)/dashboard/requests/RequestsClient.tsx", "utf8")
    const dialogs = readFileSync("app/(dashboard)/dashboard/requests/AttendanceDialogs.tsx", "utf8")

    it("reads as any request does: whose overtime, which day, how much, and when they came and left", async () => {
        const html = await page({ rows: [day()], kinds: ["internal", "overtime"] })
        expect(html).toContain("requests_overtime")
        expect(html).toContain("29 Oct 2026")
        // English writes the hour as it is said: 9:00, not 09:00.
        expect(html).toContain("9:00 – 18:30")
        expect(html).toContain("Mona Adel")
        expect(html).toContain("requests_kind_overtime")
    })

    it("is asked on its day, not at a time of it, and its details say no time it was asked at (found in the browser)", () => {
        expect(client).toContain("r.overtime ? permissionDay(r.overtime.date, locale)")
        expect(client).toContain("...(viewing.overtime || viewing.flagged ? [] : [{ label: t('requested_on')")
    })

    it("is approved, all its minutes, or rejected with a reason, by whoever may decide it", async () => {
        const html = await page({ rows: [day({ mayDecide: true })] })
        expect(html).toMatch(/<button[^>]*>.*approve_button/)
        expect(html).toMatch(/<button[^>]*>.*reject_button/)
        expect(dialogs).toContain("overtime: '/api/attendance/overtime'")
        expect(client).toContain("t('requests_overtime_reject_question')")
        for (const code of ["OVERTIME_OFF", "OVERTIME_NEEDS_NO_APPROVAL", "OVERTIME_MINUTES_REQUIRED"]) expect(dialogs, code).toContain(code)
    })

    it("once decided, says what came of it, and its decision may be withdrawn, once they've said so", async () => {
        const approved = await page({ rows: [day({ status: "APPROVED", overtime: { companyId: "c1", userId: "e2", date: "2026-10-29", minutes: null, firstIn: null, lastOut: null, approvedMinutes: 60, note: null } })], show: "done" })
        expect(approved).toContain("ui-badge ui-badge-good")
        expect(approved).toContain("requests_overtime_approved")
        expect(client).toContain("t('requests_overtime_withdraw')")
        expect(client).toContain("'requests_overtime_withdraw_hint'")
    })

    it("has no styles typed in", async () => {
        const html = await page({ rows: [day({ mayDecide: true })], kinds: ["overtime"] })
        expect(html).not.toContain("style=")
    })
})

describe("check-in phones on it (UI_PLAN.md §2.3, part 4b)", () => {
    const phone = (fields: Partial<FeedRow> = {}): FeedRow => row({
        kind: "phone", id: "ph1", what: "Pixel 8", detail: null,
        phone: { platform: "ANDROID", model: "Pixel 8", appVersion: "1.4.0", attested: false, held: 3, reason: null, replaced: false },
        ...fields,
    })
    const client = readFileSync("app/(dashboard)/dashboard/requests/RequestsClient.tsx", "utf8")
    const dialogs = readFileSync("app/(dashboard)/dashboard/requests/AttendanceDialogs.tsx", "utf8")

    it("reads as any request does: whose phone, which, its system and app, and the check-ins it holds", async () => {
        const html = await page({ rows: [phone()], kinds: ["internal", "phone"] })
        expect(html).toContain("Pixel 8")
        expect(html).toContain("requests_kind_phone")
        expect(html).toContain("audit_value_ANDROID")
        expect(html).toContain("v1.4.0")
        // "1 check-in held", "3 check-ins held" (found in the browser).
        expect(html).toContain("count_held_other")
        // Its app not shown to be genuine, as the Attendance page said.
        expect(html).toContain("req_phone_unverified")
        expect(html).toContain("Mona Adel")
    })

    it("without a model kept, is named by its system", async () => {
        const html = await page({ rows: [phone({ what: "", phone: { platform: "IOS", model: null, appVersion: null, attested: true, held: 0, reason: null, replaced: false } })] })
        expect(html).toContain("audit_value_IOS")
        expect(html).not.toContain("req_phone_unverified")
        expect(html).not.toContain("count_held_")
    })

    it("is approved or rejected with a reason by whoever may decide it, as the Attendance page did", async () => {
        const html = await page({ rows: [phone({ mayDecide: true })] })
        expect(html).toMatch(/<button[^>]*>.*approve_button/)
        expect(html).toMatch(/<button[^>]*>.*reject_button/)
        expect(dialogs).toContain("phone: '/api/attendance/phones'")
        expect(client).toContain("t('requests_phone_reject_question')")
        expect(dialogs).toContain("PHONE_NOT_PENDING")
    })

    it("once decided, says so: in use, rejected and why, revoked and why, replaced, or withdrawn", async () => {
        const facts = { platform: "ANDROID", model: "Pixel 8", appVersion: "1.4.0", attested: true, held: 0, reason: null, replaced: false } as const
        expect(await page({ rows: [phone({ status: "ACTIVE", phone: facts })], show: "done" })).toMatch(/ui-badge ui-badge-good[^>]*>req_phone_in_use/)
        expect(await page({ rows: [phone({ status: "REVOKED", phone: facts })], show: "done" })).toMatch(/ui-badge ui-badge-problem[^>]*>requests_phone_revoked/)
        expect(await page({ rows: [phone({ status: "REVOKED", phone: { ...facts, replaced: true } })], show: "done" })).toMatch(/ui-badge ui-badge-neutral[^>]*>requests_phone_replaced/)
        expect(await page({ rows: [phone({ status: "WITHDRAWN", phone: facts })], show: "done" })).toMatch(/ui-badge ui-badge-neutral[^>]*>status_withdrawn/)
        expect(client).toContain("'requests_phone_revoked_on'")
        expect(client).toContain("'requests_phone_replaced_on'")
    })

    it("the one in use may be revoked, with a reason if there is one, by whoever may decide it", () => {
        expect(client).toContain("...(r.mayRevoke ? [{ key: 'revoke'")
        expect(dialogs).toContain("export function RevokePhone(")
        expect(dialogs).toContain("`${ATTENDANCE_API.phone}/${request.id}/revoke`")
        expect(dialogs).toContain("PHONE_NOT_ACTIVE")
    })

    it("has no styles typed in", async () => {
        const html = await page({ rows: [phone({ mayDecide: true })], kinds: ["phone"] })
        expect(html).not.toContain("style=")
    })
})

describe("flagged check-ins on it (UI_PLAN.md §2.3, part 4c)", () => {
    const facts = {
        at: "2026-10-29T09:02", direction: "IN" as const, reasons: ["OUTSIDE_AREA", "IMPRECISE_LOCATION"], place: "Head office", distance: 240, accuracy: 85,
        ip: "41.33.1.2", latitude: 30.0444, longitude: 31.2357, phone: "Pixel 8", reason: null, mayViewFace: false,
    }
    const punch = (fields: Partial<FeedRow> = {}): FeedRow => row({ kind: "flagged", id: "k1", what: "IN", detail: null, status: "FLAGGED", flagged: facts, ...fields })
    const client = readFileSync("app/(dashboard)/dashboard/requests/RequestsClient.tsx", "utf8")
    const dialogs = readFileSync("app/(dashboard)/dashboard/requests/AttendanceDialogs.tsx", "utf8")

    it("reads as any request does: whose check-in, why it waits, when on the wall's clock, and where", async () => {
        const html = await page({ rows: [punch()], kinds: ["internal", "flagged"] })
        // Why, in a sentence: the reasons' words, the first capitalised.
        expect(html).toContain("Att_flag_OUTSIDE_AREA, att_flag_IMPRECISE_LOCATION")
        expect(html).toContain("requests_kind_flagged")
        expect(html).toContain("requests_flagged_in")
        expect(html).toContain("29 Oct 2026")
        expect(html).toContain("9:02")
        // The company's words keep their own direction in an Arabic line, as <bdi> keeps them.
        expect(html).toContain("\u2068Head office\u2069")
        expect(html).toContain("req_flagged_distance")
        expect(html).toContain("Mona Adel")
    })

    it("is approved or rejected with a reason by whoever may decide it, as the Attendance page did", async () => {
        const html = await page({ rows: [punch({ mayDecide: true })] })
        expect(html).toMatch(/<button[^>]*>.*approve_button/)
        expect(html).toMatch(/<button[^>]*>.*reject_button/)
        expect(dialogs).toContain("flagged: '/api/attendance/flagged'")
        // The flagged route takes accept, not approve.
        expect(dialogs).toContain("{ accept: approve, reason }")
        expect(dialogs).toContain("CHECK_IN_NOT_FLAGGED")
        expect(client).toContain("t('requests_flagged_reject_question')")
    })

    it("has the map of where the phone was, and a failed face check's photos for whoever may see them, as the Attendance page did", () => {
        expect(client).toContain("googleMapsLink(")
        expect(client).toContain("...(r.flagged?.mayViewFace ? [{ key: 'face'")
        expect(client).toContain("<FlaggedFaceModal")
    })

    it("once decided, says so, and why it was rejected", async () => {
        expect(await page({ rows: [punch({ status: "ACCEPTED" })], show: "done" })).toMatch(/ui-badge ui-badge-good[^>]*>requests_flagged_accepted/)
        expect(client).toContain("?? r.flagged?.reason")
    })

    it("has no styles typed in", async () => {
        const html = await page({ rows: [punch({ mayDecide: true })], kinds: ["flagged"] })
        expect(html).not.toContain("style=")
    })
})

describe("name changes on it (UI_PLAN.md §2.3, part 5a)", () => {
    const change = (fields: Partial<FeedRow> = {}): FeedRow => row({
        kind: "nameChange", id: "n1", what: "Mona Adel Fahmy", detail: null,
        nameChange: { from: "Mona Adel", to: "Mona Adel Fahmy", note: null },
        ...fields,
    })
    const client = readFileSync("app/(dashboard)/dashboard/requests/RequestsClient.tsx", "utf8")
    const dialogs = readFileSync("app/(dashboard)/dashboard/requests/AttendanceDialogs.tsx", "utf8")

    it("reads as any request does: the name it's for, the one it was, and who asked", async () => {
        const html = await page({ rows: [change()], kinds: ["internal", "nameChange"] })
        expect(html).toContain("Mona Adel Fahmy")
        expect(html).toContain("requests_kind_name_change")
        expect(html).toContain("requests_name_change_from")
        expect(html).toContain("Mona Adel")
    })

    it("is approved or rejected, with a reason if there is one, by whoever may decide it", async () => {
        const html = await page({ rows: [change({ mayDecide: true })] })
        expect(html).toMatch(/<button[^>]*>.*approve_button/)
        expect(html).toMatch(/<button[^>]*>.*reject_button/)
        // Its own routes, with the note they take.
        expect(dialogs).toContain("`/api/profile-requests/${request.id}/${approve ? 'approve' : 'reject'}`")
        expect(dialogs).toContain("JSON.stringify({ adminNote: reason ?? '' })")
        expect(client).toContain("t('requests_name_change_reject_question')")
    })

    it("once decided, says so, and why it was rejected", async () => {
        expect(await page({ rows: [change({ status: "APPROVED" })], show: "done" })).toMatch(/ui-badge ui-badge-good[^>]*>status_approved/)
        expect(client).toContain("?? r.nameChange?.note")
    })

    it("has no styles typed in", async () => {
        const html = await page({ rows: [change({ mayDecide: true })], kinds: ["nameChange"] })
        expect(html).not.toContain("style=")
    })
})

describe("role requests on it (UI_PLAN.md §2.3, part 5b)", () => {
    const facts = {
        to: { name: "Accountant", builtIn: null }, now: { name: "Employee", builtIn: "EMPLOYEE" }, actingUntil: null,
        by: "Hoda Samir", decidedBy: null, note: null,
    }
    const request = (fields: Partial<FeedRow> = {}): FeedRow => row({ kind: "role", id: "g1", what: "Accountant", detail: "Joins the accounts team", role: facts, ...fields })
    const client = readFileSync("app/(dashboard)/dashboard/requests/RequestsClient.tsx", "utf8")
    const dialogs = readFileSync("app/(dashboard)/dashboard/requests/AttendanceDialogs.tsx", "utf8")

    it("reads as any request does: the role, whose it would be, and who asked", async () => {
        const html = await page({ rows: [request()], kinds: ["internal", "role"] })
        expect(html).toContain("Accountant")
        expect(html).toContain("requests_kind_role")
        expect(html).toContain("requests_role_by")
        expect(html).toContain("Mona Adel")
    })

    it("on Mine, says whose it would be, since it isn't one's own", async () => {
        const html = await page({ rows: [request({ mayWithdraw: true })], kinds: ["internal", "role"], tab: "mine" })
        expect(html).toContain("requests_role_for")
        expect(html).not.toContain("requests_role_by")
    })

    it("names a built-in role in the person's language", async () => {
        const html = await page({ rows: [request({ what: "Team Leader", role: { ...facts, to: { name: "Team Leader", builtIn: "TEAM_LEADER" } } })], kinds: ["role"] })
        expect(html).toContain("role_team_leader")
    })

    it("is approved, or rejected with the reason it must have, by whoever gives roles, through its own route", async () => {
        const html = await page({ rows: [request({ mayDecide: true })] })
        expect(html).toMatch(/<button[^>]*>.*approve_button/)
        expect(html).toMatch(/<button[^>]*>.*reject_button/)
        expect(dialogs).toContain("`/api/role-requests/${request.id}`")
        expect(dialogs).toContain("JSON.stringify({ action: approve ? 'APPROVE' : 'REJECT', note: reason })")
        expect(client).toContain("t('requests_role_reject_question')")
        expect(client).toContain("reasonRequired={rejecting.kind === 'role'}")
    })

    it("refused, says why in the person's language", () => {
        for (const code of ["ALREADY_DECIDED", "ROLE_EXCEEDS_YOURS", "FORBIDDEN_ROLE_ASSIGNMENT", "ROLE_NOT_IN_COMPANY", "LEADER_HAS_REPORTS", "LAST_ADMIN", "ADMIN_IS_SUPER_ADMINS", "ACTING_END_IN_PAST", "REASON_REQUIRED"]) {
            expect(dialogs, code).toMatch(new RegExp(`\\b${code}: '`))
        }
    })

    it("may be withdrawn by whoever asked, while it waits", () => {
        expect(dialogs).toContain("JSON.stringify({ action: 'CANCEL' })")
        expect(client).toContain("'requests_role_withdraw_hint'")
    })

    it("once decided, says so, who decided, and why it was rejected", async () => {
        expect(await page({ rows: [request({ status: "REJECTED", role: { ...facts, now: null, decidedBy: "Amal One", note: "Wait" } })], show: "done" })).toMatch(/ui-badge ui-badge-problem[^>]*>status_rejected/)
        expect(client).toContain("?? r.role?.note")
        expect(client).toContain("t('requests_role_decided_by_label')")
    })

    it("has no styles typed in", async () => {
        const html = await page({ rows: [request({ mayDecide: true })], kinds: ["role"] })
        expect(html).not.toContain("style=")
    })
})

describe("its server page", () => {
    const server = readFileSync("app/(dashboard)/dashboard/requests/page.tsx", "utf8")

    it("finds a role request a notification picked out too, on Mine for whoever asked (part 5b)", () => {
        expect(server).toContain("prisma.roleRequest.findUnique({ where: { id: searchParams.highlight }, select: { requestedById: true, status: true } })")
        expect(server).toContain("({ userId: r.requestedById, status: r.status })")
    })

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

    it("finds a day off a notification picked out too, now that its links land here (part 2d)", () => {
        expect(server).toContain("prisma.dayOffRequest.findUnique({ where: { id: searchParams.highlight }, select: { userId: true, status: true } })")
        expect(server).toContain('picked.status === "PENDING" || picked.status === "IN_PROGRESS" ? "waiting" : "done"')
    })

    it("offers asking for permission hours to whoever has attendance of their own, with what's left of the month's", () => {
        expect(server).toContain("sessionHasModule({ user: viewer }, 'ATTENDANCE')")
        expect(server).toContain("AttendanceRequestService.permissionBalance(")
    })

    it("finds permission hours and missing punches a notification picked out too, now that their links land here (part 3c)", () => {
        expect(server).toContain("prisma.permissionRequest.findUnique({ where: { id: searchParams.highlight }, select: { userId: true, status: true } })")
        expect(server).toContain("prisma.missingPunchRequest.findUnique({ where: { id: searchParams.highlight }, select: { userId: true, status: true } })")
    })

    it("finds a check-in phone a notification picked out too, now that its links land here (part 4d)", () => {
        expect(server).toContain("prisma.checkInPhone.findUnique({ where: { id: searchParams.highlight }, select: { userId: true, status: true } })")
        // A phone in use, revoked or withdrawn is done too: only waiting is waiting.
        expect(server).toContain('show ??= picked.status === "PENDING" || picked.status === "IN_PROGRESS" ? "waiting" : "done"')
    })

    it("finds a name change a notification picked out too, now that its links land here (part 5a)", () => {
        expect(server).toContain("prisma.profileUpdateRequest.findUnique({ where: { id: searchParams.highlight }, select: { userId: true, status: true } })")
    })

    it("reads the dates of leave only for Day off", () => {
        expect(server).toContain('from: kind === "dayOff" ? searchParams.from ?? "" : ""')
        expect(server).toContain('to: kind === "dayOff" ? searchParams.to ?? "" : ""')
    })
})

describe("the old history page and links to it", () => {
    it("send people to Done on the Requests page, keeping the request picked out", () => {
        const history = readFileSync("app/(dashboard)/dashboard/requests/history/page.tsx", "utf8")
        expect(history).toContain("redirect(")
        expect(history).toContain("show: 'done'")
        expect(history).toContain("highlight")
    })

    it("send people from the Profile requests page to name changes on the Requests page, keeping the one picked out (part 5a)", () => {
        const profile = readFileSync("app/(dashboard)/dashboard/profile-requests/page.tsx", "utf8")
        expect(profile).toContain("redirect(")
        expect(profile).toContain("kind: 'nameChange'")
        expect(profile).toContain("highlight")
    })

    it("are the header's name-change count, the dashboard's tile, and a decision's notice, all on the Requests page (part 5a)", () => {
        // Waiting, which they count, as the day off tile says too.
        expect(readFileSync("components/DashboardHeader.tsx", "utf8")).toContain('href="/dashboard/requests?tab=review&kind=nameChange&show=waiting"')
        expect(readFileSync("app/(dashboard)/dashboard/page.tsx", "utf8")).toContain("href: '/dashboard/requests?tab=review&kind=nameChange&show=waiting'")
        expect(readFileSync("components/NotificationBell.tsx", "utf8")).toContain("router.push(`/dashboard/requests?kind=nameChange&highlight=${notification.relatedId}`)")
        for (const f of ["components/DashboardHeader.tsx", "app/(dashboard)/dashboard/page.tsx", "components/NotificationBell.tsx"]) {
            expect(readFileSync(f, "utf8"), f).not.toContain("/dashboard/profile-requests")
        }
    })

    it("send people from the Role requests page to role requests on the Requests page, and its other two tabs to Roles and access (part 5b)", () => {
        const old = readFileSync("app/(dashboard)/dashboard/role-requests/page.tsx", "utf8")
        expect(old).toContain("redirect(")
        expect(old).toContain("kind: 'role'")
        expect(old).toContain("`/dashboard/roles-and-access?${")
        expect(old).toContain("highlight")
    })

    it("are a role request's notices, and the Role field's waiting one, on the Requests page (part 5b)", () => {
        expect(readFileSync("components/RoleRequestControl.tsx", "utf8")).toContain("href={`/dashboard/requests?kind=role&highlight=${pending.id}`}")
        // Asking the Super Admin to change a role, and access reviews, on their own page.
        expect(readFileSync("lib/services/role-change-request.service.ts", "utf8")).toContain("`/dashboard/roles-and-access?tab=changes&highlight=${id}`")
        expect(readFileSync("lib/services/access-review.service.ts", "utf8")).toContain("`/dashboard/roles-and-access?tab=reviews&highlight=${review.id}`")
        for (const f of ["components/RoleRequestControl.tsx", "lib/services/role-request.service.ts", "lib/services/role-change-request.service.ts", "lib/services/access-review.service.ts"]) {
            expect(readFileSync(f, "utf8"), f).not.toContain("/dashboard/role-requests")
        }
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

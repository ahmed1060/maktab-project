import { describe, it, expect, vi } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"
import { ar } from "./translations/ar"
import { en } from "./translations/en"

/**
 * Payroll's Approve while days of the month wait to be settled
 * (ATTENDANCE_PLAN.md §6.9, §12.1, round 10, decisions 14 and 24, PR 276;
 * DESIGN.md §5.5, Dialog): in place of asking, the window says why, lists
 * each day waiting, opening the Exceptions screen on it, and offers Close.
 * The month's requests not yet decided follow under a heading of their own,
 * as a warning that doesn't stop the approval.
 */

const state = { locale: "en" as "en" | "ar" }
vi.mock("@/context/LanguageContext", () => ({
    useLanguage: () => ({ locale: state.locale, isRtl: state.locale === "ar", t: (key: string) => (state.locale === "ar" ? ar : en)[key as keyof typeof en] ?? key }),
}))

const days = [
    { userId: "e1", name: "Ehab One", date: "2026-10-04", status: "INCOMPLETE" as const, firstIn: "2026-10-04T09:40:00.000Z", lastOut: null },
    { userId: "e1", name: "Ehab One", date: "2026-10-05", status: "TO_CONFIRM" as const, firstIn: "2026-10-05T09:00:00.000Z", lastOut: "2026-10-05T13:30:00.000Z" },
]
// As the markup writes them.
const esc = (text: string) => text.replace(/'/g, "&#x27;")
const settle = (fields: Record<string, unknown> = {}) => ({ count: 2, days, requests: { permissions: 1, missing: 0, overtime: 3 }, ...fields })

async function render(what: "days" | "requests", locale: "en" | "ar" = "en", fields: Record<string, unknown> = {}) {
    state.locale = locale
    const { DaysToSettle, UndecidedRequests } = await import("@/app/(dashboard)/dashboard/payroll/SettleFirst")
    const s = settle(fields)
    return renderToStaticMarkup(what === "days" ? h(DaysToSettle, { settle: s, year: 2026, month: 10 }) : h(UndecidedRequests, { requests: s.requests }))
}

describe("the days to settle before a month's payroll is approved", () => {
    it("says why, then a row for each, opening the Exceptions screen on its day and kind", async () => {
        const html = await render("days")
        expect(html).toContain(`<p>${en.payroll_settle_msg}</p>`)
        expect(html).toContain(`<ul class="ui-rows" aria-label="${en.payroll_settle_title}">`)
        expect(html).toContain('href="/dashboard/attendance?tab=exceptions&amp;year=2026&amp;month=10&amp;day=4&amp;kind=incomplete"')
        expect(html).toContain('href="/dashboard/attendance?tab=exceptions&amp;year=2026&amp;month=10&amp;day=5&amp;kind=departure"')
        expect(html.match(/<li/g)).toHaveLength(2)
    })

    it("names each day's person, date, what it waits on and its scans", async () => {
        const html = await render("days")
        expect(html).toContain("Ehab One")
        expect(html).toContain("Sun 4 Oct")
        expect(html).toContain(en.exc_tab_incomplete)
        expect(html).toContain(en.exc_tab_departure)
        expect(html).toContain(`${en.exc_punched}: <bdi>09:40</bdi>`)
        expect(html).toContain(`${en.exc_punched}: <bdi>09:00–13:30</bdi>`)
    })

    it("in Arabic, its words, dates and digits", async () => {
        const html = await render("days", "ar")
        expect(html).toContain(ar.payroll_settle_msg)
        expect(html).toContain(ar.exc_tab_incomplete)
        expect(html).toContain(ar.exc_tab_departure)
        expect(html).toContain("<bdi>٠٩:٤٠</bdi>")
        expect(html).toContain("أكتوبر")
    })

    it("says how many more wait when it lists only some, opening the Exceptions screen on the month", async () => {
        const html = await render("days", "en", { count: 52 })
        expect(html).toContain(esc(en.payroll_settle_more.replace("{n}", "50")))
        expect(html).toContain('href="/dashboard/attendance?tab=exceptions&amp;year=2026&amp;month=10&amp;kind=incomplete"')
        expect(await render("days")).not.toContain(esc(en.payroll_settle_more.split("{n}")[1]))
    })
})

describe("the month's requests not yet decided", () => {
    it("follow under a heading of their own, saying approving doesn't wait for them", async () => {
        const html = await render("requests")
        expect(html).toMatch(new RegExp(`<section aria-labelledby="[^"]+"><h3 id="[^"]+" class="ui-subsection-title">${en.payroll_undecided_title}</h3><p>${esc(en.payroll_undecided_msg)}</p>`))
    })

    it("a row for each kind with any, with how many, opening the Requests page on it", async () => {
        const html = await render("requests")
        expect(html).toContain('href="/dashboard/requests?tab=review&amp;kind=permission&amp;show=waiting"')
        expect(html).toContain('href="/dashboard/requests?tab=review&amp;kind=overtime&amp;show=waiting"')
        expect(html).not.toContain("kind=missingPunch")
        expect(html).toContain(en.payroll_undecided_permissions)
        expect(html).toContain(en.payroll_undecided_overtime)
        expect(html).toMatch(/<span class="ui-row-end"><span class="ui-num">3<\/span><\/span>/)
    })

    it("are nothing when there are none", async () => {
        expect(await render("requests", "en", { requests: { permissions: 0, missing: 0, overtime: 0 } })).toBe("")
    })

    it("in Arabic, its words and digits", async () => {
        const html = await render("requests", "ar", { requests: { permissions: 0, missing: 12, overtime: 0 } })
        expect(html).toContain(ar.payroll_undecided_title)
        expect(html).toContain(ar.payroll_undecided_missing)
        expect(html).toContain("١٢")
    })
})

describe("Payroll's Approve uses them", () => {
    const PAGE = readFileSync("app/(dashboard)/dashboard/payroll/page.tsx", "utf8")
    const dialog = PAGE.slice(PAGE.indexOf("open={confirming?.kind === 'approve'}"), PAGE.indexOf("open={confirming?.kind === 'paid'}"))

    it("says what waits in place of asking, with Close in place of Approve", () => {
        expect(dialog).toContain("<DaysToSettle settle={settle!} year={year} month={month} />")
        expect(dialog).toContain("title={t(waits ? 'payroll_settle_title' : 'payroll_approve_title')}")
        expect(dialog).toMatch(/actions=\{waits\s*\?\s*<Button onClick=\{closeConfirm\}>\{t\('close'\)\}<\/Button>/)
        expect(dialog).toContain("{waits ? <DaysToSettle")
    })

    it("warns of the requests not yet decided whether it can go ahead or not", () => {
        expect(dialog).toContain("{settle && <UndecidedRequests requests={settle.requests} />}")
    })

    it("stays open and shows what waits when the server refuses for days to settle", () => {
        expect(PAGE).toContain("body?.details?.code === 'DAYS_TO_SETTLE'")
        expect(dialog).toContain("if ((await approve()) !== 'settle') setConfirming(null)")
    })

    it("reads what waits from the register", () => {
        expect(PAGE).toContain("const settle = view?.toSettle ?? null")
        expect(PAGE).toContain("const waits = (settle?.count ?? 0) > 0")
    })
})

import { describe, it, expect, vi } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"
import { ar } from "./translations/ar"
import { en } from "./translations/en"
import { updateCompanySchema } from "./validations/company.schema"
import { settingsTab } from "./company-settings-tabs"

/**
 * Payday and when payroll closes, as set (LATER_CHANGES_PLAN.md §7.10,
 * PR 430): the two settings at the top of the Payroll settings card, a
 * payday that doesn't come after the close refused under its field, on the
 * page and again on the server, and every company today moved onto
 * settings that follow the rule.
 */

const state = { locale: "en" as "en" | "ar" }
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }))
vi.mock("@/context/LanguageContext", () => ({
    useLanguage: () => ({ locale: state.locale, t: (key: string) => (state.locale === "ar" ? ar : en)[key as keyof typeof en] ?? key }),
}))
vi.mock("@/context/ToastContext", () => ({ useToast: () => ({ showToast: () => {} }) }))

const esc = (s: string) => s.replace(/'/g, "&#x27;")
async function card(props: Record<string, unknown> = {}, locale: "en" | "ar" = "en") {
    state.locale = locale
    const { default: Card } = await import("@/components/CompanyPayrollCard")
    return renderToStaticMarkup(h(Card, {
        companyId: "c1", payrollDay: 1, paydayLastDay: false, paydayNextMonth: true, paydayMove: "BEFORE", payrollCloseDay: null,
        payslipsVisible: false, timezone: "Africa/Cairo", debtRecoveryPercent: 25, onSaved: () => {}, ...props,
    } as never))
}
const selected = (html: string, label: string) => html.includes(`selected="">${esc(label)}</option>`)

describe("the Payroll settings card", () => {
    it("starts with when payroll closes, then payday, before the time zone", async () => {
        const html = await card()
        const close = html.indexOf(esc(en.payroll_close_label)), payday = html.indexOf(`>${en.payroll_day_label}<`), zone = html.indexOf(en.company_timezone_label)
        expect(close).toBeGreaterThan(-1)
        expect(close).toBeLessThan(payday)
        expect(payday).toBeLessThan(zone)
        expect(html).toContain(esc(en.payroll_close_hint))
        expect(html).toContain(esc(en.payday_move_hint))
    })

    it("closes on the month's last day with no day to type, or on a day of the month with one", async () => {
        const last = await card()
        expect(selected(last, en.payroll_close_last)).toBe(true)
        expect(last).not.toContain('name="payrollCloseDay"')
        const day = await card({ payrollCloseDay: 24, paydayNextMonth: false, payrollDay: 28 })
        expect(selected(day, en.payroll_close_on_day)).toBe(true)
        expect(day).toMatch(/<input[^>]*name="payrollCloseDay"[^>]*value="24"/)
    })

    it("has payday on a day or the month's last, in its own month or the next, and where it moves off a day off", async () => {
        const html = await card({ payrollDay: 1, paydayNextMonth: true, paydayMove: "AFTER" })
        expect(selected(html, en.payday_on_day)).toBe(true)
        expect(html).toMatch(/<input[^>]*name="payrollDay"[^>]*value="1"/)
        expect(selected(html, en.payday_in_next)).toBe(true)
        expect(selected(html, en.payday_move_after)).toBe(true)
        for (const word of [en.payday_last_day, en.payday_in_own, en.payday_move_before, en.payday_in_label, en.payday_move_label]) expect(html, word).toContain(esc(word))
        const last = await card({ paydayLastDay: true, paydayNextMonth: false, payrollCloseDay: 25 })
        expect(selected(last, en.payday_last_day)).toBe(true)
        expect(last).not.toContain('name="payrollDay"')
        expect(selected(last, en.payday_in_own)).toBe(true)
    })

    it("puts a day and its select side by side, as a card's fields are, lined up at the top", () => {
        // So a hint or an error under one doesn't move the other (found in the flows).
        const source = readFileSync("components/CompanyPayrollCard.tsx", "utf8")
        expect(source.split('<div className="ui-field-row ui-field-row-top">').length - 1).toBe(3)
        expect(source).not.toContain('<div className="ui-field-row">')
        expect(readFileSync("components/ui/ui.css", "utf8")).toMatch(/\.ui-field-row-top \{\s*align-items: flex-start;\s*\}/)
    })

    it("puts one field under another on phones, where a select's words need the whole line", () => {
        // Half the width, every choice was cut short on a phone (found in the flows).
        const css = readFileSync("components/ui/ui.css", "utf8")
        const rule = css.indexOf(".ui-field-row-top > .ui-field {\n    flex: 1 1 100%;")
        expect(rule).toBeGreaterThan(css.indexOf(".ui-field-row > .ui-field {\n    flex: 1 1 calc(50%"))
        expect(css.lastIndexOf("@media (max-width: 767px)", rule)).toBeGreaterThan(css.indexOf(".ui-field-row-top {"))
    })

    it("is in the page's language", async () => {
        const html = await card({}, "ar")
        for (const word of [ar.payroll_close_label, ar.payday_in_next, ar.payday_move_before]) expect(html, word).toContain(word)
    })

    it("sends all five with the rest of the card", () => {
        const source = readFileSync("components/CompanyPayrollCard.tsx", "utf8")
        expect(source).toContain("payrollCloseDay: closeLast ? null : Number(closeText)")
        expect(source).toContain("paydayLastDay: payLast, paydayNextMonth: payNext, paydayMove: move")
    })
})

describe("a payday that doesn't come after the close", () => {
    it("is said under payday's field before anything is sent", async () => {
        const { payrollFieldErrors } = await import("@/components/CompanyPayrollCard")
        const own = { closeDay: "24", lastDay: false, nextMonth: false }
        expect(payrollFieldErrors("20", "25", own)).toEqual({ payrollDay: "payday_before_close" })
        expect(payrollFieldErrors("24", "25", own)).toEqual({ payrollDay: "payday_before_close" })
        expect(payrollFieldErrors("25", "25", own)).toEqual({})
        expect(payrollFieldErrors("25", "25", { closeDay: null, lastDay: false, nextMonth: false })).toEqual({ payrollDay: "payday_before_close_last" })
        expect(payrollFieldErrors("25", "25", { closeDay: null, lastDay: false, nextMonth: true })).toEqual({})
        expect(payrollFieldErrors("", "25", { closeDay: "28", lastDay: true, nextMonth: false })).toEqual({ payrollDay: "payday_before_close" })
        expect(payrollFieldErrors("", "25", { closeDay: "27", lastDay: true, nextMonth: false })).toEqual({})
    })

    it("says a close day typed wrong under its own field", async () => {
        const { payrollFieldErrors } = await import("@/components/CompanyPayrollCard")
        expect(payrollFieldErrors("1", "25", { closeDay: "29", lastDay: false, nextMonth: true })).toEqual({ payrollCloseDay: "payroll_day_invalid" })
    })

    it("names the day to come after, and what else to pick, in both languages", () => {
        expect(en.payday_before_close).toContain("{day}")
        expect(ar.payday_before_close).toContain("{day}")
        expect(en.payday_before_close_last).toContain("in the month after")
    })

    it("is refused by the server too, as the settings will be once saved", () => {
        const service = readFileSync("lib/services/company.service.ts", "utf8")
        expect(service).toContain('if (refusal) throw Object.assign(new Error("PAYDAY_BEFORE_CLOSE"), { closeDay: refusal.closeDay })')
        expect(service).toContain("payrollCloseDay !== undefined ? payrollCloseDay : existing.payrollCloseDay")
        const route = readFileSync("app/api/company-settings/route.ts", "utf8")
        expect(route).toContain('if (error.message === "PAYDAY_BEFORE_CLOSE")')
    })
})

describe("what's saved", () => {
    const base = { id: "c1" }
    it("takes a close day from 1 to 28, or none for the month's last day", () => {
        for (const day of [1, 24, 28, null]) expect(updateCompanySchema.safeParse({ ...base, payrollCloseDay: day }).success, String(day)).toBe(true)
        for (const day of [0, 29, 31, 2.5]) expect(updateCompanySchema.safeParse({ ...base, payrollCloseDay: day }).success, String(day)).toBe(false)
    })

    it("takes payday's choices, and where it moves only as before or after", () => {
        expect(updateCompanySchema.safeParse({ ...base, paydayLastDay: true, paydayNextMonth: false, paydayMove: "AFTER" }).success).toBe(true)
        expect(updateCompanySchema.safeParse({ ...base, paydayMove: "NONE" }).success).toBe(false)
    })

    it("is the Payroll tab's, and audited with a label for each", () => {
        expect(settingsTab("payroll")?.fields).toEqual(expect.arrayContaining(["paydayLastDay", "paydayNextMonth", "paydayMove", "payrollCloseDay"]))
        for (const key of ["audit_field_paydayLastDay", "audit_field_paydayNextMonth", "audit_field_paydayMove", "audit_field_payrollCloseDay", "audit_value_BEFORE", "audit_value_AFTER"] as const) {
            expect(en[key], key).toBeTruthy()
            expect(ar[key], key).toBeTruthy()
        }
    })
})

describe("the companies there are today", () => {
    const sql = readFileSync("prisma/migrations/20270124000000_payday_and_close/migration.sql", "utf8")
    it("are each paid on day 1 of the month after where payday doesn't come after the close, as the owner decided", () => {
        expect(sql).toContain('SET "payrollDay" = 1, "paydayLastDay" = false, "paydayNextMonth" = true')
        expect(sql).toContain('WHERE "paydayNextMonth" = false')
    })

    it("are added in their own month first, so nobody's payday moves a month without that", () => {
        expect(sql).toContain('ADD COLUMN "paydayNextMonth" BOOLEAN NOT NULL DEFAULT false')
        expect(sql.indexOf('ALTER COLUMN "paydayNextMonth" SET DEFAULT true')).toBeGreaterThan(sql.indexOf('SET "payrollDay" = 1'))
    })

    it("keep each month approved before as it was: the calendar month, paid on its payroll day", () => {
        expect(sql).toContain(`"payday" = make_date("year", "month", "payrollDay")`)
        expect(sql).toContain(`WHERE "status" IN ('APPROVED', 'PAID')`)
    })
})

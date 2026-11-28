import { describe, it, expect, vi } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"
import { en } from "./translations/en"
import { ar } from "./translations/ar"
import { stripComments } from "./strip-comments"
import { SALARY_ADVANCE_POLICY_DEFAULTS, type SalaryAdvancePolicy } from "./salary-advance-policy"

/**
 * The Salary advances card (LATER_CHANGES_PLAN.md §7.5, step 2; DESIGN.md
 * §5.5, Salary advances), on the Payroll tab under Payroll deductions: the
 * rules a salary advance follows, before anyone can ask for one.
 */

// The card's first import brings in its whole client tree, which under the
// full suite's load can take longer than the default 5 seconds.
vi.setConfig({ testTimeout: 60_000 })

const state = { locale: "en" as "en" | "ar", swr: {} as { data?: unknown; error?: unknown } }
vi.mock("@/context/LanguageContext", () => ({
    useLanguage: () => ({ locale: state.locale, t: (key: string) => ((state.locale === "ar" ? ar : en) as Record<string, string>)[key] ?? key }),
}))
vi.mock("@/context/ToastContext", () => ({ useToast: () => ({ showToast: () => {} }) }))
vi.mock("@/lib/useUnsavedChanges", () => ({ useReportUnsaved: () => {} }))
vi.mock("swr", () => ({ default: () => ({ ...state.swr, isValidating: false, mutate: async () => {} }) }))

const card = async (view: SalaryAdvancePolicy | null, { readOnly = false, error = false, locale = "en" as "en" | "ar" } = {}) => {
    state.locale = locale
    state.swr = view ? { data: { data: view } } : error ? { error: new Error("down") } : {}
    const { default: CompanySalaryAdvancesCard } = await import("@/components/CompanySalaryAdvancesCard")
    return renderToStaticMarkup(h(CompanySalaryAdvancesCard, { companyId: "c1", readOnly }))
}
const SET: SalaryAdvancePolicy = { maxMonths: 1.5, minServiceMonths: 0, oneOpen: false, installmentPercent: 12.5, debtsPercent: 30, overLimit: "WARN" }
const has = (html: string, text: string) => html.includes(text.replace(/&/g, "&amp;").replace(/'/g, "&#x27;").replace(/"/g, "&quot;"))
const input = (html: string, name: string) => html.match(new RegExp(`<input[^>]*name="${name}"[^>]*>`, "g")) ?? []

describe("the card", () => {
    it("is titled, and says what it's for, and that nobody can approve one yet (PR 449)", async () => {
        const html = await card(SALARY_ADVANCE_POLICY_DEFAULTS)
        expect(has(html, en.salary_advances_title)).toBe(true)
        expect(has(html, en.salary_advances_note)).toBe(true)
        expect(en.salary_advances_note).toMatch(/can ask for one on the Requests page, but nobody can approve one yet/)
    })

    it("shows the rules unless changed: 2 months, after 3, one at a time, 10%, 25% and Block", async () => {
        const html = await card(SALARY_ADVANCE_POLICY_DEFAULTS)
        expect(input(html, "maxMonths")[0]).toContain('value="2"')
        expect(input(html, "minServiceMonths")[0]).toContain('value="3"')
        expect(input(html, "oneOpen")[0]).toMatch(/type="checkbox"[^>]*checked=""/)
        expect(input(html, "installmentPercent")[0]).toContain('value="10"')
        expect(input(html, "debtsPercent")[0]).toContain('value="25"')
        const choices = input(html, "overLimit")
        expect(choices).toHaveLength(2)
        expect(choices.find(c => c.includes('value="BLOCK"'))).toContain('checked=""')
        expect(choices.find(c => c.includes('value="WARN"'))).not.toContain('checked=""')
    })

    it("labels each as the design says, with its hint", async () => {
        const html = await card(SALARY_ADVANCE_POLICY_DEFAULTS)
        for (const key of [
            "salary_advance_max_months", "salary_advance_max_months_hint", "salary_advance_min_service", "salary_advance_min_service_hint",
            "salary_advance_one_open", "salary_advance_one_open_hint", "salary_advance_installment", "salary_advance_installment_hint",
            "salary_advance_debts", "salary_advance_debts_hint", "salary_advance_over_limit", "salary_advance_over_limit_BLOCK", "salary_advance_over_limit_WARN",
        ] as const) expect(has(html, en[key]), key).toBe(true)
        // The law's figures, so a company outside Egypt knows what it's moving away from.
        expect(en.salary_advance_installment_hint).toContain("10%")
        expect(en.salary_advance_debts_hint).toContain("25%")
        // All debts together isn't a cap at payroll.
        expect(en.salary_advance_debts_hint).toMatch(/payroll isn't capped/)
    })

    it("says under Over a limit what the one picked does", async () => {
        const blocked = await card(SALARY_ADVANCE_POLICY_DEFAULTS)
        expect(has(blocked, en.salary_advance_over_limit_BLOCK_hint)).toBe(true)
        expect(has(blocked, en.salary_advance_over_limit_WARN_hint)).toBe(false)
        const warned = await card(SET)
        expect(has(warned, en.salary_advance_over_limit_WARN_hint)).toBe(true)
        expect(has(warned, en.salary_advance_over_limit_BLOCK_hint)).toBe(false)
    })

    it("has that line read with the group, as a field's hint is", async () => {
        const html = await card(SALARY_ADVANCE_POLICY_DEFAULTS)
        const group = html.match(/<fieldset[^>]*>(?:(?!<\/fieldset>)[\s\S])*name="overLimit"[\s\S]*?<\/fieldset>/)?.[0] ?? ""
        const describedBy = group.match(/^<fieldset[^>]*aria-describedby="([^"]+)"/)?.[1]
        expect(describedBy).toBeTruthy()
        const line = html.match(new RegExp(`id="${describedBy}"[^>]*>([^<]*)<`))?.[1]
        expect(line).toBe(en.salary_advance_over_limit_BLOCK_hint.replace(/'/g, "&#x27;"))
    })

    it("shows what's saved", async () => {
        const html = await card(SET)
        expect(input(html, "maxMonths")[0]).toContain('value="1.5"')
        expect(input(html, "minServiceMonths")[0]).toContain('value="0"')
        expect(input(html, "oneOpen")[0]).not.toContain('checked=""')
        expect(input(html, "installmentPercent")[0]).toContain('value="12.5"')
        expect(input(html, "debtsPercent")[0]).toContain('value="30"')
    })

    it("has Save waiting until something's changed", async () => {
        const html = await card(SET)
        expect(html).toMatch(/<button type="submit"[^>]*disabled=""/)
    })

    it("for whoever may only see them: the rules, and nothing to change or save", async () => {
        const html = await card(SET, { readOnly: true })
        expect(html).not.toContain('type="submit"')
        const inputs = html.match(/<input[^>]*>/g)!
        // The four figures, one at a time, and Block and Warn.
        expect(inputs).toHaveLength(7)
        for (const i of inputs) expect(i, i).toContain('disabled=""')
    })

    it("says it's loading, then why it couldn't, with Try again", async () => {
        expect(has(await card(null), en.loading)).toBe(true)
        const failed = await card(null, { error: true })
        expect(has(failed, en.salary_advances_load_failed)).toBe(true)
        expect(has(failed, en.try_again)).toBe(true)
    })

    it("in Arabic, in Arabic", async () => {
        const html = await card(SALARY_ADVANCE_POLICY_DEFAULTS, { locale: "ar" })
        expect(html).toContain(ar.salary_advances_title)
        expect(html).toContain(ar.salary_advance_installment)
        expect(html).toContain(ar.salary_advance_over_limit_BLOCK)
        expect(ar.salary_advances_title).toMatch(/سلف|سُلف/)
    })

    it("sits on the Payroll tab under Payroll deductions", () => {
        const tabs = stripComments(readFileSync("components/CompanySettingsTabs.tsx", "utf8"))
        const payroll = tabs.slice(tabs.indexOf("{tab === 'payroll' && ("), tabs.indexOf("{tab === 'attendance' && ("))
        const deductions = payroll.indexOf("<CompanyDeductionsCard")
        expect(deductions).toBeGreaterThan(-1)
        expect(payroll.indexOf("<CompanySalaryAdvancesCard companyId={companyId} readOnly={readOnly} />")).toBeGreaterThan(deductions)
    })

    it("is read again only while nothing's typed or being saved, as Payroll deductions is", () => {
        const source = stripComments(readFileSync("components/CompanySalaryAdvancesCard.tsx", "utf8"))
        expect(source).toMatch(/takesRefreshed\(/)
    })
})

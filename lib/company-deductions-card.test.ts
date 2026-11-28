import { describe, it, expect, vi } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"
import { en } from "./translations/en"
import { ar } from "./translations/ar"
import { stripComments } from "./strip-comments"
import { MAX_MORE_DEDUCTIONS } from "./payroll-deductions"
import { payslipLineLabel } from "./payslip-line-label"

/**
 * Payroll deductions' card (LATER_CHANGES_PLAN.md §7.12, PR 440; DESIGN.md
 * §5.5, Payroll deductions), on the Payroll tab under Payroll settings, and
 * the payslip lines it makes, named in the page's language.
 */

const state = { locale: "en" as "en" | "ar", swr: {} as { data?: unknown; error?: unknown } }
vi.mock("@/context/LanguageContext", () => ({
    useLanguage: () => ({ locale: state.locale, t: (key: string) => ((state.locale === "ar" ? ar : en) as Record<string, string>)[key] ?? key }),
}))
vi.mock("@/context/ToastContext", () => ({ useToast: () => ({ showToast: () => {} }) }))
vi.mock("@/lib/useUnsavedChanges", () => ({ useReportUnsaved: () => {} }))
vi.mock("swr", () => ({ default: () => ({ ...state.swr, isValidating: false, mutate: async () => {} }) }))

type View = { incomeTax: number; socialInsurance: number; more: { id: string; name: string; basis: "PERCENT" | "AMOUNT"; value: number }[] }
const card = async (view: View | null, { readOnly = false, error = false, locale = "en" as "en" | "ar" } = {}) => {
    state.locale = locale
    state.swr = view ? { data: { data: view } } : error ? { error: new Error("down") } : {}
    const { default: CompanyDeductionsCard } = await import("@/components/CompanyDeductionsCard")
    return renderToStaticMarkup(h(CompanyDeductionsCard, { companyId: "c1", readOnly }))
}
const NONE: View = { incomeTax: 0, socialInsurance: 0, more: [] }
const SET: View = { incomeTax: 10, socialInsurance: 11.25, more: [{ id: "d1", name: "Union fee", basis: "AMOUNT", value: 150 }, { id: "d2", name: "Club", basis: "PERCENT", value: 2.5 }] }
const has = (html: string, text: string) => html.includes(text.replace(/&/g, "&amp;").replace(/'/g, "&#x27;").replace(/"/g, "&quot;"))

describe("the card", () => {
    it("is titled and says what it's for", async () => {
        const html = await card(NONE)
        expect(has(html, en.deductions_title)).toBe(true)
        expect(has(html, en.deductions_note)).toBe(true)
    })

    it("shows income tax and social insurance at 0, and none of the company's own yet", async () => {
        const html = await card(NONE)
        expect(html).toMatch(/name="incomeTax"[^>]*value="0"|value="0"[^>]*name="incomeTax"/)
        expect(html).toMatch(/name="socialInsurance"[^>]*value="0"|value="0"[^>]*name="socialInsurance"/)
        expect(has(html, en.deductions_none)).toBe(true)
        expect(has(html, en.deduction_add)).toBe(true)
    })

    it("shows what's saved: each of the company's own with its name, how it's taken and its figure", async () => {
        const html = await card(SET)
        expect(html).toMatch(/value="10"/)
        expect(html).toMatch(/value="11.25"/)
        expect(html).toMatch(/value="Union fee"/)
        expect(html).toMatch(/value="150"/)
        expect(html).toMatch(/value="2.5"/)
        expect(has(html, en.deductions_none)).toBe(false)
        // How it's taken, a choice of two, the label of its figure saying which.
        expect(html.match(/type="radio"/g)).toHaveLength(4)
        expect(has(html, en.deduction_value_AMOUNT)).toBe(true)
        expect(has(html, en.deduction_value_PERCENT)).toBe(true)
        // Remove, named for the deduction.
        expect(html).toContain(`aria-label="${en.deduction_remove.replace("{name}", "Union fee")}"`)
    })

    it("has Save waiting until something's changed", async () => {
        const html = await card(SET)
        expect(html).toMatch(/<button type="submit"[^>]*disabled=""/)
    })

    it("at its most, keeps Add a deduction greyed with why beside it", async () => {
        const full = { ...NONE, more: Array.from({ length: MAX_MORE_DEDUCTIONS }, (_, i) => ({ id: `d${i}`, name: `Fee ${i}`, basis: "AMOUNT" as const, value: 1 })) }
        const html = await card(full)
        expect(html).toMatch(/aria-disabled="true"[^>]*aria-describedby="c1-deductions-most"/)
        expect(has(html, en.deductions_at_most.replace("{n}", "10"))).toBe(true)
    })

    it("for whoever may only see them: the figures, and nothing to change or save", async () => {
        const html = await card(SET, { readOnly: true })
        expect(html).toMatch(/value="Union fee"/)
        expect(html).not.toContain('type="submit"')
        expect(has(html, en.deduction_add)).toBe(false)
        expect(html).not.toContain("aria-label=\"Remove")
        // Every field greyed: both percentages, each name, how it's taken and its figure.
        const inputs = html.match(/<input[^>]*>/g)!
        expect(inputs.length).toBe(2 + 2 * (1 + 2 + 1))
        for (const input of inputs) expect(input, input).toContain('disabled=""')
    })

    it("says it's loading, then why it couldn't, with Try again", async () => {
        expect(has(await card(null), en.loading)).toBe(true)
        const failed = await card(null, { error: true })
        expect(has(failed, en.deductions_load_failed)).toBe(true)
        expect(has(failed, en.try_again)).toBe(true)
    })

    it("in Arabic, in Arabic", async () => {
        const html = await card(SET, { locale: "ar" })
        expect(html).toContain(ar.deductions_title)
        expect(html).toContain(ar.deduction_income_tax)
        expect(html).toContain(ar.deduction_basis_PERCENT)
    })

    it("sits on the Payroll tab under Payroll settings", () => {
        const tabs = stripComments(readFileSync("components/CompanySettingsTabs.tsx", "utf8"))
        const payroll = tabs.slice(tabs.indexOf("{tab === 'payroll' && ("), tabs.indexOf("{tab === 'attendance' && ("))
        expect(payroll.indexOf("<CompanyPayrollCard")).toBeGreaterThan(-1)
        expect(payroll.indexOf("<CompanyDeductionsCard companyId={companyId} readOnly={readOnly} />")).toBeGreaterThan(payroll.indexOf("<CompanyPayrollCard"))
    })
})

describe("saving, while more is typed (Codex review on PR 440)", () => {
    const saved = (more: { id: string; name: string; basis: "PERCENT" | "AMOUNT"; value: number }[]) => ({ incomeTax: 10, socialInsurance: 0, more })

    it("keeps what was typed since it was sent, and gives the new ones the ids they were saved with", async () => {
        const { withSavedIds, deductionsUnchanged } = await import("@/components/CompanyDeductionsCard")
        const kept = { key: "d1", id: "d1", name: "Union fee", basis: "AMOUNT" as const, value: "150" }
        const now = saved([{ id: "d1", name: "Union fee", basis: "AMOUNT", value: 150 }, { id: "x9", name: "Club", basis: "PERCENT", value: 2.5 }])
        const after = withSavedIds([
            kept,
            // Sent as "Club", then typed on.
            { key: "new-1", name: "Club fee", basis: "PERCENT", value: "2.5" },
            // Added once it was sent.
            { key: "new-2", name: "Gym", basis: "AMOUNT", value: "" },
        ], ["d1", "new-1"], now)
        expect(after[0]).toBe(kept)
        expect(after[1]).toEqual({ key: "new-1", id: "x9", name: "Club fee", basis: "PERCENT", value: "2.5" })
        expect(after[2]).toEqual({ key: "new-2", name: "Gym", basis: "AMOUNT", value: "" })
        // Still to save.
        expect(deductionsUnchanged({ incomeTax: "10", socialInsurance: "0", more: after }, now)).toBe(false)
    })

    it("with nothing typed since, leaves the card as saved", async () => {
        const { withSavedIds, deductionsUnchanged } = await import("@/components/CompanyDeductionsCard")
        const now = saved([{ id: "x1", name: "Union fee", basis: "AMOUNT", value: 150 }])
        const after = withSavedIds([{ key: "new-1", name: " Union fee ", basis: "AMOUNT", value: "150.0" }], ["new-1"], now)
        expect(after[0].id).toBe("x1")
        expect(deductionsUnchanged({ incomeTax: "10.0", socialInsurance: "0", more: after }, now)).toBe(true)
    })

    it("one removed while it was being saved stays removed, and is still to save", async () => {
        const { withSavedIds, deductionsUnchanged } = await import("@/components/CompanyDeductionsCard")
        const now = saved([{ id: "x1", name: "Union fee", basis: "AMOUNT", value: 150 }])
        const after = withSavedIds([], ["new-1"], now)
        expect(after).toEqual([])
        expect(deductionsUnchanged({ incomeTax: "10", socialInsurance: "0", more: after }, now)).toBe(false)
    })
})

describe("a copy read again (Codex review on PR 440)", () => {
    it("replaces what's on the card only while nothing's typed or being saved", async () => {
        const { takesRefreshed } = await import("@/components/CompanyDeductionsCard")
        const cached = { incomeTax: 10, socialInsurance: 0, more: [] }
        const fresh = { incomeTax: 12, socialInsurance: 0, more: [{ id: "d9", name: "Club", basis: "PERCENT" as const, value: 1 }] }
        expect(takesRefreshed(fresh, cached, true, false)).toBe(true)
        expect(takesRefreshed(fresh, cached, false, false)).toBe(false)
        expect(takesRefreshed(fresh, cached, true, true)).toBe(false)
        // The card's own save, put in the cache, is what it already shows.
        expect(takesRefreshed(cached, cached, true, false)).toBe(false)
    })

    it("the card's own save keeps what's on it, giving the new ones their ids", () => {
        const card = stripComments(readFileSync("components/CompanyDeductionsCard.tsx", "utf8"))
        const saved = card.slice(card.indexOf("const now: Saved = body.data"), card.indexOf("onSaved(body)"))
        expect(saved).toContain("setMore(list => withSavedIds(list, sentKeys, now))")
        expect(saved).not.toMatch(/setIncomeTax|setSocialInsurance|draftOf/)
    })

    it("is taken up as the card renders, not left to the card's first copy", () => {
        const card = stripComments(readFileSync("components/CompanyDeductionsCard.tsx", "utf8"))
        expect(card).toMatch(/if \(initial !== seen\) \{\s*setSeen\(initial\)\s*if \(takesRefreshed\(initial, saved, !dirty, saving\)\)/)
    })
})

describe("a payslip's lines, in the page's language", () => {
    const t = (words: Record<string, string>) => (key: string) => words[key] ?? ""
    it("names income tax and social insurance as Nizmo does, and the company's own as it named them", () => {
        expect(payslipLineLabel({ label: "Income tax", source: "INCOME_TAX" }, t(ar) as any)).toBe(ar.payslip_line_income_tax)
        expect(payslipLineLabel({ label: "Social insurance", source: "SOCIAL_INSURANCE" }, t(ar) as any)).toBe(ar.payslip_line_social_insurance)
        expect(payslipLineLabel({ label: "Union fee", source: "PAYROLL_DEDUCTION", sourceId: "d1" }, t(ar) as any)).toBe("Union fee")
        expect(payslipLineLabel({ label: "Salary", source: "SALARY" }, t(ar) as any)).toBe("Salary")
        // Attendance's lines, by their category, as the Payroll page named them already.
        expect(payslipLineLabel({ label: "Absence", source: "ATTENDANCE", sourceId: "ABSENCE" }, t(ar) as any)).toBe(ar.attpay_line_ABSENCE)
    })

    it("on the Payroll page and on the payslip both", () => {
        const payroll = stripComments(readFileSync("app/(dashboard)/dashboard/payroll/page.tsx", "utf8"))
        expect(payroll).toContain("label: payslipLineLabel(line, t),")
        // The payslip's earnings and its deductions both.
        const payslip = stripComments(readFileSync("app/(dashboard)/dashboard/documents/payslip/[id]/page.tsx", "utf8"))
        expect(payslip.match(/<DocLine key=\{i\} label=\{payslipLineLabel\(l, t\)\}/g)).toHaveLength(2)
        // The payslip is sent where each line came from.
        const route = stripComments(readFileSync("app/api/payslips/[id]/route.ts", "utf8"))
        expect(route).toContain("source: l.source,")
        expect(route).toContain("sourceId: l.sourceId,")
    })
})

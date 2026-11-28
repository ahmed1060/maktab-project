import { describe, it, expect, vi } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { en } from "./translations/en"
import { ar } from "./translations/ar"

/**
 * A person's payroll deductions' card (LATER_CHANGES_PLAN.md §7.12, 9b;
 * DESIGN.md §5.5, A person's payroll deductions), on their profile: each of
 * the company's deductions, as the company takes it, their own figure, or
 * not applied. Seen as details; changed as a choice of three each, with its
 * own Save. Made-up figures.
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

type Row = { ref: string; kind: "INCOME_TAX" | "SOCIAL_INSURANCE" | "OTHER"; name: string | null; basis: "PERCENT" | "AMOUNT"; company: number; mode: "COMPANY" | "OWN" | "NONE"; value: number | null }
const TAX: Row = { ref: "INCOME_TAX", kind: "INCOME_TAX", name: null, basis: "PERCENT", company: 10, mode: "COMPANY", value: null }
const INSURANCE: Row = { ref: "SOCIAL_INSURANCE", kind: "SOCIAL_INSURANCE", name: null, basis: "PERCENT", company: 11, mode: "COMPANY", value: null }
const FEE: Row = { ref: "fee", kind: "OTHER", name: "Union fee", basis: "AMOUNT", company: 150, mode: "COMPANY", value: null }
const SET = [{ ...TAX, mode: "OWN" as const, value: 12.5 }, { ...INSURANCE, mode: "NONE" as const }, { ...FEE, mode: "OWN" as const, value: 50 }]

const card = async (rows: Row[] | null, { change = false, own = false, error = false, locale = "en" as "en" | "ar" } = {}) => {
    state.locale = locale
    state.swr = rows ? { data: { data: { deductions: rows } } } : error ? { error: new Error("down") } : {}
    const { default: PersonDeductionsCard } = await import("@/components/profile/PersonDeductionsCard")
    return renderToStaticMarkup(h(PersonDeductionsCard, { userId: "e1", own, change }))
}
const has = (html: string, text: string) => html.includes(text.replace(/&/g, "&amp;").replace(/'/g, "&#x27;").replace(/"/g, "&quot;"))
const fill = (key: keyof typeof en, figure: string, locale: "en" | "ar" = "en") => (locale === "ar" ? ar : en)[key].replace("{figure}", figure)

describe("seen", () => {
    it("is a titled card of details: each deduction and what's taken from them", async () => {
        const html = await card(SET)
        expect(has(html, en.deductions_title)).toBe(true)
        expect(has(html, en.payslip_line_income_tax)).toBe(true)
        expect(has(html, fill("person_deduction_own", "12.5%"))).toBe(true)
        expect(has(html, en.payslip_line_social_insurance)).toBe(true)
        expect(has(html, en.person_deduction_none)).toBe(true)
        expect(has(html, "Union fee")).toBe(true)
        expect(has(html, fill("person_deduction_own", "50.00"))).toBe(true)
        // Nothing to change or save.
        expect(html).not.toContain("<input")
        expect(html).not.toContain('type="submit"')
    })

    it("in the company's order: income tax, social insurance, then the company's own", async () => {
        const html = await card([TAX, INSURANCE, FEE])
        const at = (text: string) => html.indexOf(text)
        expect(at(en.payslip_line_income_tax)).toBeLessThan(at(en.payslip_line_social_insurance))
        expect(at(en.payslip_line_social_insurance)).toBeLessThan(at("Union fee"))
        expect(has(html, fill("person_deduction_company", "10%"))).toBe(true)
        expect(has(html, fill("person_deduction_company", "150.00"))).toBe(true)
    })

    it("says Your own on one's own", async () => {
        const html = await card(SET, { own: true })
        expect(has(html, fill("person_deduction_own_self", "12.5%"))).toBe(true)
        expect(has(html, fill("person_deduction_own", "12.5%"))).toBe(false)
    })

    it("isn't there while nothing's taken from them and nothing's set", async () => {
        expect(await card([{ ...TAX, company: 0 }, { ...INSURANCE, company: 0 }])).toBe("")
        // Something the company takes, or something set for them, and it is.
        expect(await card([{ ...TAX, company: 0 }, { ...INSURANCE, company: 0, mode: "NONE" }])).not.toBe("")
        expect(await card([TAX, { ...INSURANCE, company: 0 }])).not.toBe("")
    })

    it("isn't there while it's being read, and says so when it couldn't be", async () => {
        expect(await card(null)).toBe("")
        const html = await card(null, { error: true })
        expect(has(html, en.deductions_load_failed)).toBe(true)
        expect(has(html, en.try_again)).toBe(true)
    })

    it("in Arabic, in its words and digits", async () => {
        const html = await card(SET, { locale: "ar" })
        expect(has(html, ar.payslip_line_income_tax)).toBe(true)
        expect(has(html, fill("person_deduction_own", "١٢٫٥٪", "ar"))).toBe(true)
        expect(has(html, fill("person_deduction_own", "٥٠٫٠٠", "ar"))).toBe(true)
        expect(has(html, ar.person_deduction_none)).toBe(true)
    })
})

describe("changed", () => {
    it("is the same card with a note and its own Save, waiting until something's changed", async () => {
        const html = await card(SET, { change: true })
        expect(has(html, en.deductions_title)).toBe(true)
        expect(has(html, en.person_deductions_note)).toBe(true)
        expect(html).toMatch(/<button type="submit"[^>]*disabled=""/)
    })

    it("each deduction a choice of three, its legend the deduction's name", async () => {
        const html = await card([TAX, INSURANCE, FEE], { change: true })
        expect(html.match(/<fieldset/g)).toHaveLength(3)
        expect(html.match(/type="radio"/g)).toHaveLength(9)
        expect(html).toMatch(new RegExp(`<legend[^>]*>${en.payslip_line_income_tax}</legend>`))
        expect(html).toMatch(/<legend[^>]*>Union fee<\/legend>/)
        expect(has(html, fill("person_deduction_company", "10%"))).toBe(true)
        expect(has(html, fill("person_deduction_company", "150.00"))).toBe(true)
        expect(has(html, en.person_deduction_choice_own_PERCENT)).toBe(true)
        expect(has(html, en.person_deduction_choice_own_AMOUNT)).toBe(true)
        expect(html.match(new RegExp(`<input[^>]*type="radio"[^>]*>${en.person_deduction_none}</label>`, "g"))).toHaveLength(3)
        // As the company is picked, and no figure is asked for.
        expect(html.match(/checked=""/g)).toHaveLength(3)
        expect(html).not.toMatch(/inputMode="decimal"|inputmode="decimal"/)
    })

    it("their own shows its field under the choice, with their figure, labelled for its kind", async () => {
        const html = await card(SET, { change: true })
        expect(html.match(/inputmode="decimal"/gi)).toHaveLength(2)
        expect(html).toMatch(/value="12.5"/)
        expect(html).toMatch(/value="50"/)
        expect(has(html, en.person_deduction_value_PERCENT)).toBe(true)
        expect(has(html, en.person_deduction_value_AMOUNT)).toBe(true)
        // Not applied asks for nothing.
        expect(html.match(/checked=""/g)).toHaveLength(3)
    })

    it("in Arabic, in its words", async () => {
        const html = await card([TAX], { change: true, locale: "ar" })
        expect(has(html, ar.person_deductions_note)).toBe(true)
        expect(has(html, ar.person_deduction_choice_own_PERCENT)).toBe(true)
        expect(has(html, fill("person_deduction_company", "١٠٪", "ar"))).toBe(true)
    })
})

describe("what's still to save", () => {
    const load = async () => import("@/components/profile/PersonDeductionsCard")
    const VIEW = { deductions: SET }

    it("nothing, as opened, their own typed another way", async () => {
        const { entriesOf, personUnchanged } = await load()
        expect(personUnchanged(entriesOf(VIEW), VIEW)).toBe(true)
        const typed = entriesOf(VIEW).map(e => e.ref === "INCOME_TAX" ? { ...e, value: "12.50" } : e)
        expect(personUnchanged(typed, VIEW)).toBe(true)
    })

    it("another pick, or another figure of their own", async () => {
        const { entriesOf, personUnchanged } = await load()
        expect(personUnchanged(entriesOf(VIEW).map(e => e.ref === "SOCIAL_INSURANCE" ? { ...e, mode: "COMPANY" as const } : e), VIEW)).toBe(false)
        expect(personUnchanged(entriesOf(VIEW).map(e => e.ref === "INCOME_TAX" ? { ...e, value: "13" } : e), VIEW)).toBe(false)
    })

    it("after the company's changed: them as they are now, each keeping its pick where it's taken the same way", async () => {
        const { entriesOf, entriesAfterChange } = await load()
        const picked = entriesOf(VIEW).map(e => e.ref === "fee" ? { ...e, value: "60" } : e)
        const now = { deductions: [SET[0], SET[1], { ...FEE, basis: "PERCENT" as const, company: 1 }, { ...FEE, ref: "club", name: "Club" }] }
        expect(entriesAfterChange(picked, now)).toEqual([
            { ref: "INCOME_TAX", basis: "PERCENT", mode: "OWN", value: "12.5" },
            { ref: "SOCIAL_INSURANCE", basis: "PERCENT", mode: "NONE", value: "" },
            // Taken another way now: as it is now, their figure being the other kind.
            { ref: "fee", basis: "PERCENT", mode: "COMPANY", value: "" },
            { ref: "club", basis: "AMOUNT", mode: "COMPANY", value: "" },
        ])
    })
})

describe("on the profile", () => {
    it("where their salary is: seen on the view, changed on the form by whoever may change their salary", async () => {
        const { readFileSync } = await import("node:fs")
        const form = readFileSync("components/EmployeeProfileForm.tsx", "utf8")
        const seeing = form.slice(form.indexOf("if (seeing) {"), form.indexOf("const values: ProfileValues"))
        const editing = form.slice(form.indexOf("const values: ProfileValues"))
        expect(seeing).toContain("{access.salary && <PersonDeductionsCard userId={userId} own={own} change={false} />}")
        expect(editing).toContain("{access.salary && <PersonDeductionsCard userId={userId} own={own} change={access.changeSalary} />}")
        // Before Contacting clients, as DESIGN.md has it.
        expect(editing.indexOf("<PersonDeductionsCard")).toBeLessThan(editing.indexOf("<WhatsAppCard"))
    })
})

describe("its words", () => {
    it("are in both languages, and the Arabic is gender-neutral", () => {
        const keys = [
            "person_deductions_note", "person_deduction_company", "person_deduction_own", "person_deduction_own_self", "person_deduction_none",
            "person_deduction_choice_own_PERCENT", "person_deduction_choice_own_AMOUNT", "person_deduction_value_PERCENT", "person_deduction_value_AMOUNT",
            "person_deductions_changed", "person_deductions_saved",
        ] as const
        for (const k of keys) {
            expect(en[k], k).toBeTruthy()
            expect(ar[k], k).toBeTruthy()
            expect(ar[k]).not.toMatch(/اختر|ابحث|حاول/)
        }
        expect(en.person_deductions_note).not.toMatch(/\bwe\b/i)
    })
})

import { beforeAll, beforeEach, describe, it, expect, vi } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"
import { ar } from "./translations/ar"
import { en } from "./translations/en"
import { moduleForApiPath } from "./features/routes"

/**
 * Ending a contract where the company's package doesn't include HR
 * (DESIGN.md §5.5, Dialog; CLIENTS_PLAN.md §7.3). A settlement is payroll's
 * statement, and its debts are payroll's to recover, and such a company has
 * neither, nor a screen for them: the ending is all that's recorded, and the
 * dialog shows no statement. What they still hold of a cash advance stays on
 * it, on the Cash advances tab, until its return is recorded, and the dialog
 * says so where the statement would be. The dialog showed the settlement and
 * ending recorded it, and the advance became a debt no screen there shows.
 *
 * What's recorded is proven against Postgres in
 * lib/end-contract-without-payroll.db.test.ts; here, what CI can run.
 */

const state = { locale: "en" as "en" | "ar" }
const words = () => (state.locale === "ar" ? ar : en) as Record<string, string>
vi.mock("@/context/LanguageContext", () => ({ useLanguage: () => ({ locale: state.locale, t: (key: string) => words()[key] ?? key }) }))
vi.mock("@/context/ToastContext", () => ({ useToast: () => ({ showToast: () => {} }) }))
vi.mock("@/lib/useHydrated", () => ({ useHydrated: () => true }))
vi.mock("react-dom", async (importOriginal) => ({ ...(await importOriginal<typeof import("react-dom")>()), createPortal: (node: unknown) => node }))
vi.mock("swr", () => ({ default: () => ({ data: undefined, error: undefined, isValidating: false, mutate: async () => {} }) }))
vi.mock("@/lib/prisma", () => ({ prisma: {} }))
vi.mock("@/lib/storage", () => ({ supabase: {}, uploadToCloud: async () => { throw new Error("no uploads here") } }))
beforeEach(() => { state.locale = "en" })
// Loaded once, first: compiled cold, a dialog takes longer than a test may.
beforeAll(async () => { await import("@/components/profile/EndContractDialog") }, 60_000)

const esc = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/'/g, "&#x27;").replace(/"/g, "&quot;")
const note = (tone: string, text: string) => `<p class="ui-doc-note" data-tone="${tone}">${esc(text)}</p>`
const read = (path: string) => readFileSync(path, "utf8")

async function rendered<P>(load: () => Promise<(props: P) => unknown>, props: P) {
    const Component = await load()
    // Its portal is a stand-in's here, which still asks where it goes.
    vi.stubGlobal("document", { body: {} })
    try {
        return renderToStaticMarkup(h(Component as never, props as never))
    } finally {
        vi.unstubAllGlobals()
    }
}
const endDialog = (over: Record<string, unknown> = {}) => rendered(async () => (await import("@/components/profile/EndContractDialog")).EndContractDialog as never,
    { userId: "u1", name: "Laila Fouad", status: "ACTIVE", today: "2026-11-05", onClose: () => {}, onDone: () => {}, ...over })
const inPlace = (over: Record<string, unknown> = {}) => rendered(async () => (await import("@/components/profile/EndContractDialog")).WithoutSettlement as never,
    { held: 0, ...over })

describe("the dialog, where the package has no Payroll", () => {
    it("shows no statement while it's worked out, says it's being worked out, and End contract waits", async () => {
        const html = await endDialog({ settles: false })
        expect(html).not.toContain(esc(en.settlement_preview))
        expect(html).toContain(`<p class="ui-hint">${esc(en.loading)}</p>`)
        expect(html).toMatch(/<button type="submit" class="ui-btn ui-btn-danger" disabled="">/)
        // Where it has Payroll, the statement's heading as before.
        expect(await endDialog()).toContain(`class="ui-settlement-title">${esc(en.settlement_preview)}</h3>`)
    })

    it("says what they still hold of a cash advance stays on it, to be returned, where the statement would be", async () => {
        const html = await inPlace({ held: 300 })
        expect(html).toContain(note("waiting", en.end_contract_advance_stays.replace("{amount}", "300.00")))
        expect(html).not.toContain(esc(en.settlement_preview))
        // Heard as it comes, as the statement is.
        expect(html).toMatch(/^<div class="ui-settlement" aria-live="polite">/)
        expect(await inPlace({ held: 300, stale: true })).toMatch(/^<div class="ui-settlement" aria-live="polite" aria-busy="true">/)
    })

    it("says nothing at all when they hold none", async () => {
        expect(await inPlace({ held: 0 })).toBe("")
    })

    it("says it's being worked out, and when it couldn't be, with Try again", async () => {
        expect(await inPlace({ held: null })).toContain(`<p class="ui-hint">${esc(en.loading)}</p>`)
        const failed = await inPlace({ held: null, failed: true })
        expect(failed).toContain(`<p class="ui-error">${esc(en.end_contract_check_failed)}</p>`)
        expect(failed).toContain(`<button type="button" class="ui-btn ui-btn-secondary ui-btn-sm">${esc(en.try_again)}</button>`)
        // Not the settlement's words: there's none.
        expect(failed).not.toContain(esc(en.end_contract_preview_failed))
    })

    it("is in the page's language, digits too", async () => {
        state.locale = "ar"
        const money = new Intl.NumberFormat("ar-EG", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(1250)
        expect(await inPlace({ held: 1250 })).toContain(note("waiting", ar.end_contract_advance_stays.replace("{amount}", money)))
    })

    it("follows the server's answer for the date, and the package only until it's in", () => {
        const src = read("components/profile/EndContractDialog.tsx")
        expect(src).toContain("const statement = preview ? preview.settles : settles")
        expect(src).toMatch(/statement\s*\?\s*<SettlementPreview/)
        expect(src).toContain("<WithoutSettlement")
    })

    it("is told the package by the profile: the session's for the company's people, the company's own for the Super Admin", () => {
        const form = read("components/EmployeeProfileForm.tsx")
        expect(form).toContain("hasModule(resolveBundles(companies.find(c => c.id === companyId)?.package), 'PAYROLL')")
        expect(form).toContain(": features.has('PAYROLL')")
        expect(form).toMatch(/<EndContractDialog[\s\S]*?settles=\{settles\}/)
    })
})

describe("the server", () => {
    it("works the settlement out only where the company's package includes Payroll, whoever asks", () => {
        const service = read("lib/services/settlement.service.ts")
        // Read from the company's own package, never the session's.
        expect(service).toContain('settles: hasModule(resolveBundles(user.company?.package), "PAYROLL")')
        expect(service).not.toMatch(/session/)
        const preview = service.slice(service.indexOf("static async preview"), service.indexOf("private static async recoverableDebtsFor"))
        expect(preview).toContain("if (!settles) return { settles: false as const, endsAt, timeZone, cashAdvanceHeldMinor: heldMinor }")
        // Before any salary is read, which only a settlement needs.
        expect(preview.indexOf("if (!settles)")).toBeLessThan(preview.indexOf("SalaryHistoryService.ratesForMonth"))
    })

    it("answers the preview with no figures where there's no settlement", () => {
        const route = read("app/api/users/[id]/employment/route.ts")
        expect(route).toContain("if (!preview.settles) {")
        expect(route).toContain("preview: { settles: false, cashAdvanceHeld: toMajor(preview.cashAdvanceHeldMinor) }")
    })

    it("lists a person's settlements under Payroll, as their payslips and debts are", () => {
        expect(moduleForApiPath("/api/users/abc/settlements")).toBe("PAYROLL")
        expect(moduleForApiPath("/api/users/abc/debts")).toBe("PAYROLL")
        expect(moduleForApiPath("/api/users/abc/payslips")).toBe("PAYROLL")
        // Ending a contract is the directory's, which every package has.
        expect(moduleForApiPath("/api/users/abc/employment")).toBeNull()
    })
})

describe("a cash advance held by someone who's gone", () => {
    const by = { id: "a1", name: "Amal One" }
    function tx(pkg: unknown, held = 500) {
        return {
            $queryRaw: async () => [],
            company: { findUnique: vi.fn(async () => ({ package: pkg, timezone: "Africa/Cairo" })) },
            systemSettings: { findUnique: async () => null },
            // Held for no task or client (CLIENTS_PLAN.md §7.9): nothing to move first.
            cashAdvanceEntry: { aggregate: async () => ({ _sum: { amount: held } }), groupBy: async () => [], create: vi.fn(async () => ({ id: "x1" })) },
            debt: { create: vi.fn(async ({ data }: { data: unknown }) => ({ id: "d1", ...(data as object) })) },
        }
    }
    const toDebt = async (db: ReturnType<typeof tx>, counted: number | null = null) => {
        const { CashAdvanceService } = await import("@/lib/services/cash-advance.service")
        return CashAdvanceService.toDebt(db as never, "c1", "e1", counted, { dueDate: new Date("2026-11-08T00:00:00Z"), by })
    }

    it("stays on their advance where the package has no Payroll, whose debts these are", async () => {
        const db = tx({ hasCompanyManagement: true, hasHR: false })
        expect(await toDebt(db)).toBeNull()
        expect(db.cashAdvanceEntry.create).not.toHaveBeenCalled()
        expect(db.debt.create).not.toHaveBeenCalled()
    })

    it("becomes a debt where it has Payroll, or where the company has no package and so has everything", async () => {
        for (const pkg of [{ hasCompanyManagement: true, hasHR: true }, null]) {
            const db = tx(pkg)
            expect(await toDebt(db)).toMatchObject({ amount: 500, source: "CASH_ADVANCE" })
            expect(db.cashAdvanceEntry.create).toHaveBeenCalledOnce()
        }
    })

    it("is a debt as a settlement counted it, which is worked out only where there's Payroll", async () => {
        const db = tx({ hasCompanyManagement: true, hasHR: false })
        expect(await toDebt(db, 500)).toMatchObject({ amount: 500 })
    })

    it("answers a correction with the balance there is", () => {
        const service = read("lib/services/cash-advance.service.ts")
        expect(service).toContain("if (debt) return { entry: entryOf(entry), balance: 0 }")
    })
})

describe("the words", () => {
    const KEYS = ["end_contract_advance_stays", "end_contract_check_failed"]

    it("are in both languages, in sentence case, the amount in each", () => {
        for (const key of KEYS) {
            expect((en as Record<string, string>)[key], key).toBeTruthy()
            expect((ar as Record<string, string>)[key], key).toBeTruthy()
        }
        expect(en.end_contract_advance_stays).toBe("They still hold {amount} of a cash advance. It stays on the Cash advances tab until its return is recorded.")
        expect(ar.end_contract_advance_stays).toContain("{amount}")
        // The tab, by the name it has there.
        expect(en.end_contract_advance_stays).toContain(en.costs_tab_advances)
        expect(ar.end_contract_advance_stays).toContain(ar.costs_tab_advances)
    })

    // Gender-neutral Arabic, and the app never speaks as "we".
    it("ask nothing in the masculine in Arabic, and never speak as we", () => {
        for (const key of KEYS) {
            expect((ar as Record<string, string>)[key], key).not.toMatch(/(^|[\s،.:—]|و)(أدخل|اختر|حاول|اكتب|سجّل|تابع|أكّد|انتظر|معه|لديه|عنده|يحمله)([\s،.:—]|$)|هل أنت متأكد|هل تريد|أنك تريد|نحن|لدينا/)
            expect((en as Record<string, string>)[key], key).not.toMatch(/\b(we|our|us)\b/i)
        }
    })
})

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { createElement as h } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { ar } from "./translations/ar"
import { en } from "./translations/en"

/**
 * Change this month's payday (LATER_CHANGES_PLAN.md §7.10, 10f, PR 430;
 * DESIGN.md §5.5): the dialog on the Payroll page, its attendance's last day
 * to start with, and each refusal under the field it's about.
 */

const state = { locale: "en" as "en" | "ar" }
vi.mock("@/context/LanguageContext", () => ({
    useLanguage: () => ({ locale: state.locale, t: (key: string) => (state.locale === "ar" ? ar : en)[key as keyof typeof en] ?? key }),
}))
vi.mock("@/context/ToastContext", () => ({ useToast: () => ({ showToast: () => {} }) }))
// A dialog draws in place, once the page is on screen (as in lib/ask-about-claim.test.ts).
vi.mock("@/lib/useHydrated", () => ({ useHydrated: () => true }))
vi.mock("react-dom", async (importOriginal) => ({ ...(await importOriginal<typeof import("react-dom")>()), createPortal: (node: unknown) => node }))
beforeEach(() => { vi.stubGlobal("document", { body: {} }) })
afterEach(() => { vi.unstubAllGlobals() })

describe("Change this month's payday", () => {
    it("ends a draft's attendance the day before the new payday, where that's before the close", async () => {
        const { attendanceUntilFor } = await import("@/app/(dashboard)/dashboard/payroll/ChangePaydayDialog")
        expect(attendanceUntilFor("2026-10-25", "2026-10-31")).toBe("2026-10-24")
        expect(attendanceUntilFor("2026-10-31", "2026-10-31")).toBe("2026-10-30")
        expect(attendanceUntilFor("2026-11-01", "2026-10-31")).toBe("2026-10-31")
    })

    it("never lets the attendance end before the month's own 1st, its period starting in the month before (review on PR 430)", async () => {
        const { earliestUntil } = await import("@/app/(dashboard)/dashboard/payroll/ChangePaydayDialog")
        expect(earliestUntil(2026, 11, "2026-10-25")).toBe("2026-11-01")
        expect(earliestUntil(2026, 11, "2026-11-01")).toBe("2026-11-01")
        expect(earliestUntil(2026, 12, "2026-12-02")).toBe("2026-12-02")
        const source = (await import("node:fs")).readFileSync("app/(dashboard)/dashboard/payroll/ChangePaydayDialog.tsx", "utf8")
        expect(source).toContain("minDate={earliestUntil(year, month, period.from)}")
        expect(en.payday_change_until_range).toBe("Attendance can end no earlier than this month's 1st, and no later than payroll closes.")
    })

    it("says each refusal under the field it's about, in both languages", async () => {
        const { PAYDAY_REFUSAL } = await import("@/app/(dashboard)/dashboard/payroll/ChangePaydayDialog")
        expect(Object.keys(PAYDAY_REFUSAL).sort()).toEqual(["ATTENDANCE_OUT_OF_RANGE", "PAYDAY_NOT_AFTER_PERIOD", "PAYDAY_TOO_LATE", "PERIOD_FROZEN", "RUN_PAID"])
        expect(PAYDAY_REFUSAL.ATTENDANCE_OUT_OF_RANGE.field).toBe("until")
        expect(PAYDAY_REFUSAL.PAYDAY_NOT_AFTER_PERIOD.field).toBe("payday")
        for (const { key } of Object.values(PAYDAY_REFUSAL)) {
            expect(en[key], key).toBeTruthy()
            expect(ar[key], key).toBeTruthy()
        }
    })

    it("asks for the attendance's last day only while the month is a draft", async () => {
        const { ChangePaydayDialog } = await import("@/app/(dashboard)/dashboard/payroll/ChangePaydayDialog")
        const dialog = (draft: boolean) => renderToStaticMarkup(h(ChangePaydayDialog, {
            open: true, onClose: () => {}, onDone: () => {}, year: 2026, month: 10, companyId: null,
            payday: "2026-11-01", draft, period: { from: "2026-10-01", to: "2026-10-31" }, close: "2026-10-31",
        }))
        const esc = (s: string) => s.replace(/'/g, "&#x27;")
        const open = dialog(true)
        expect(open).toContain(`class="ui-dialog-title">${esc(en.payday_change_title)}</h2>`)
        expect(open).toContain('name="attendanceUntil">31 Oct 2026</button>')
        expect(open).toContain(esc(en.payday_change_hint))
        // Cancel, then the button that does it, in the dialog's one row of actions.
        expect(open).toContain('<div class="ui-dialog-actions"><button type="button" class="ui-btn ui-btn-quiet">Cancel</button><button type="button" class="ui-btn ui-btn-primary">Change payday</button></div>')
        const approved = dialog(false)
        expect(approved).not.toContain('name="attendanceUntil"')
        expect(approved).toContain(esc(en.payday_change_hint_approved))
        // A draft whose next month is approved: only payday, saying why (review on PR 430).
        const pinned = renderToStaticMarkup(h(ChangePaydayDialog, {
            open: true, onClose: () => {}, onDone: () => {}, year: 2026, month: 10, companyId: null,
            payday: "2026-11-01", draft: false, nextApproved: true, period: { from: "2026-10-01", to: "2026-10-31" }, close: "2026-10-31",
        }))
        expect(pinned).not.toContain('name="attendanceUntil"')
        expect(pinned).toContain(esc(en.payday_change_hint_next_approved))
        expect(ar.payday_change_hint_next_approved).toBeTruthy()
    })
})

describe("a refusal in the dialog", () => {
    it("takes the focus to the field it's said under, as a form's first wrong field (found in the interface audit)", async () => {
        const { readFileSync } = await import("node:fs")
        const source = readFileSync("app/(dashboard)/dashboard/payroll/ChangePaydayDialog.tsx", "utf8")
        expect(source).toContain("requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-dialog] button[name=\"${FIELD_NAME[why.field]}\"]`)?.focus())")
        expect(source).toContain("const FIELD_NAME = { payday: 'payday', until: 'attendanceUntil' } as const")
    })
})

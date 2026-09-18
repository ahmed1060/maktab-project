import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { stripComments } from "./strip-comments"
import { daysAlreadyPaid } from "./payday"
import { valueDaysIn, toMinor } from "./payroll"
import { en } from "@/lib/translations/en"
import { ar } from "@/lib/translations/ar"

/**
 * G6 — the settlement's "already paid" figure.
 *
 * It was inferred from the calendar: if payday had passed, assume the whole
 * month went out at the rate in force. Every way that assumption is wrong is
 * wrong in the same direction — it overstates what somebody received, which
 * makes a leaver owe back money they were never given.
 */

const SERVICE = stripComments(readFileSync("lib/services/settlement.service.ts", "utf8"))
const MODAL = readFileSync("components/EndContractModal.tsx", "utf8")

describe("what the old inference got wrong, in figures", () => {
    const CAIRO = "Africa/Cairo"
    const monthly = toMinor("30000")   // 30,000 a month
    const payrollDay = 25

    it("assumes a whole month the moment payday passes", () => {
        // 26 September, payday the 25th: the inference says the full month.
        const paidDays = daysAlreadyPaid(new Date("2026-09-26T09:00:00Z"), payrollDay, CAIRO)
        expect(paidDays).toBe(30)
        expect(valueDaysIn(2026, 9, paidDays, monthly)).toBe(monthly)
    })

    it("and nothing at all the day before", () => {
        const paidDays = daysAlreadyPaid(new Date("2026-09-24T09:00:00Z"), payrollDay, CAIRO)
        expect(paidDays).toBe(0)
    })

    it("so a month approved but never paid was billed as a full month", () => {
        // This is the failure the fix removes. The inference cannot see that no
        // money moved, so it charges the leaver for every day after payday.
        const assumed = valueDaysIn(2026, 9, 30, monthly)
        const actuallyPaid = 0
        expect(assumed - actuallyPaid).toBe(monthly)
        // 30,000 of pay somebody never received, appearing as something they owe.
        expect(assumed).toBeGreaterThan(actuallyPaid)
    })

    it("and a part-month payslip was rounded up to a full one", () => {
        // Somebody suspended for ten days is paid for twenty, but the inference
        // still says thirty.
        const realNet = valueDaysIn(2026, 9, 20, monthly)
        const assumed = valueDaysIn(2026, 9, 30, monthly)
        expect(assumed - realNet).toBe(toMinor("10000"))
    })
})

describe("the figure is read where it can be", () => {
    it("only a run that is PAID counts as paid", () => {
        // APPROVED means the figures are agreed and the money has not moved.
        expect(SERVICE).toContain('payslip.payrollRun.status !== "PAID"')
        expect(SERVICE).toContain('return { source: "RUN_NOT_PAID" }')
    })

    it("uses the net, which is what was actually transferred", () => {
        // Not earnings: a deduction is not money they hold. Not net plus
        // carried: what the run carried as debt is already owed somewhere else
        // and counting it here would charge for it twice.
        expect(SERVICE).toContain("toMinor(payslip.netAmount.toString())")
        expect(SERVICE).not.toContain("earningsAmount")
        expect(SERVICE).not.toContain("carriedAmount")
    })

    it("treats an excluded row as a recorded zero, not as unknown", () => {
        expect(SERVICE).toContain('if (payslip.excluded) return { source: "PAYSLIP", minor: 0 }')
    })

    it("keeps the inference only for the two cases with nothing to read", () => {
        expect(SERVICE).toContain('return { source: "NO_RUN" }')
        expect(SERVICE).toContain('paid.source === "PAYSLIP" ? paid.minor : assumedMinor')
    })

    it("does not fabricate a paid figure from an unpaid run", () => {
        // Guessing either way puts a wrong number on a final statement; the
        // unpaid run is reported so somebody can resolve it in seconds.
        const fn = SERVICE.slice(SERVICE.indexOf("private static async paidForMonth"), SERVICE.indexOf("static async preview"))
        expect(fn).not.toContain("daysAlreadyPaid")
        expect(fn).not.toContain("valueDaysIn")
    })

    it("says which of the three the figure is", () => {
        expect(SERVICE).toContain("paidSource: paid.source")
    })

    it("and keeps paydayHasPassed meaning what it always meant", () => {
        // Redefining it as "was anything paid" would quietly change what the
        // screen says about why a figure lands the way it does.
        expect(SERVICE).toContain("paydayHasPassed: paidDays > 0")
    })
})

describe("the screen says a true thing rather than one blanket caveat", () => {
    it("shows all three states", () => {
        expect(MODAL).toContain("settlement_paid_from_payslip")
        expect(MODAL).toContain("settlement_run_not_paid")
        expect(MODAL).toContain("settlement_provisional")
    })

    it("marks the actionable one differently from the other two", () => {
        // Printing "provisional" over a fact teaches people to disregard the
        // word on the day it matters.
        expect(MODAL).toContain("preview.paidSource === 'RUN_NOT_PAID' ? 'var(--warn-fg)'")
    })

    it("the unpaid-run message names the remedy", () => {
        expect(en.settlement_run_not_paid).toMatch(/mark the month paid/i)
    })

    it("and the old caveat no longer claims paid figures are untracked", () => {
        // They are tracked now. A message that says otherwise is a stale
        // apology for a limitation that has been removed.
        expect(en.settlement_provisional).not.toMatch(/not yet tracked/i)
    })
})

describe("the copy exists in both languages", () => {
    it("every English key has an Arabic value", () => {
        const missing = Object.keys(en as any).filter(k => !(k in (ar as any)))
        expect(missing, `no Arabic translation:\n${missing.join("\n")}`).toEqual([])
    })
})

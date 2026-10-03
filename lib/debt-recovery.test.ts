import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { stripComments } from "./strip-comments"
import { planRecovery, recoverableFrom, FULL_RECOVERY_PERCENT, type RecoverableDebt } from "./debt-recovery"
import { toMinor } from "./payroll"
import { en } from "@/lib/translations/en"
import { ar } from "@/lib/translations/ar"

/**
 * G4 — collecting a debt instead of forgiving it by inaction.
 *
 * The danger in doing this automatically is that it compounds: chained across
 * months it can take somebody's pay to zero twice running with nobody deciding
 * it should. So the cap exists from the start, set to 100 because that is what
 * was asked for, and the tests hold both the behaviour and the cap.
 */

const REGISTER = stripComments(readFileSync("lib/register.ts", "utf8"))
const SERVICE = stripComments(readFileSync("lib/services/payroll-run.service.ts", "utf8"))
const CARD = readFileSync("components/CompanyPayrollCard.tsx", "utf8")
const SCHEMA = readFileSync("prisma/schema.prisma", "utf8")

const MAY = new Date("2026-05-31T23:59:59.999Z")
const debt = (id: string, minor: number, due: string): RecoverableDebt =>
    ({ id, outstandingMinor: minor, dueDate: new Date(due) })

describe("how much a month may give up", () => {
    it("at 100 gives the whole net, which is what makes the default a no-op", () => {
        expect(recoverableFrom(toMinor("30000"), FULL_RECOVERY_PERCENT)).toBe(toMinor("30000"))
    })

    it("at 0 gives nothing, so recovery can be switched off without deleting a debt", () => {
        expect(recoverableFrom(toMinor("30000"), 0)).toBe(0)
    })

    it("rounds down, because a cap that rounds up is not a cap", () => {
        // 25% of 1000.01 is 250.0025 — a quarter of a piastre over.
        expect(recoverableFrom(100001, 25)).toBe(25000)
    })

    it("never takes from a net of nothing", () => {
        expect(recoverableFrom(0, 100)).toBe(0)
        expect(recoverableFrom(-500, 100)).toBe(0)
    })

    it("treats an out-of-range percentage as its nearest bound", () => {
        expect(recoverableFrom(10000, 150)).toBe(10000)
        expect(recoverableFrom(10000, -20)).toBe(0)
    })
})

describe("what gets taken", () => {
    it("takes the whole debt when the net covers it", () => {
        // Sara: 5,000 carried from April, 30,000 net in May.
        const plan = planRecovery({
            netMinor: toMinor("30000"),
            debts: [debt("d1", toMinor("5000"), "2026-05-25")],
            capPercent: 100,
            dueOnOrBefore: MAY,
        })
        expect(plan.totalMinor).toBe(toMinor("5000"))
        expect(plan.allocations).toEqual([{ debtId: "d1", amountMinor: toMinor("5000") }])
    })

    it("takes only what is there and leaves the rest owed", () => {
        const plan = planRecovery({
            netMinor: toMinor("2000"),
            debts: [debt("d1", toMinor("5000"), "2026-05-25")],
            capPercent: 100,
            dueOnOrBefore: MAY,
        })
        expect(plan.totalMinor).toBe(toMinor("2000"))
    })

    it("can never take more than the net, so recovery cannot create a debt", () => {
        // The property the whole design rests on: a recovery that could exceed
        // the net would be floored by totalPayslip and carried, turning one
        // debt into two.
        for (const net of [0, 1, toMinor("100"), toMinor("30000")]) {
            const plan = planRecovery({
                netMinor: net,
                debts: [debt("d1", toMinor("999999"), "2026-05-25")],
                capPercent: 100,
                dueOnOrBefore: MAY,
            })
            expect(plan.totalMinor, `net ${net}`).toBeLessThanOrEqual(net)
        }
    })

    it("honours the cap across several debts at once", () => {
        const plan = planRecovery({
            netMinor: toMinor("30000"),
            debts: [debt("d1", toMinor("4000"), "2026-03-25"), debt("d2", toMinor("4000"), "2026-04-25")],
            capPercent: 20,          // 6,000 available
            dueOnOrBefore: MAY,
        })
        expect(plan.availableMinor).toBe(toMinor("6000"))
        expect(plan.totalMinor).toBe(toMinor("6000"))
        // Oldest cleared in full, the newer one part-paid.
        expect(plan.allocations).toEqual([
            { debtId: "d1", amountMinor: toMinor("4000") },
            { debtId: "d2", amountMinor: toMinor("2000") },
        ])
    })

    it("drains oldest first, so nothing is overtaken indefinitely", () => {
        const plan = planRecovery({
            netMinor: toMinor("1000"),
            debts: [debt("new", toMinor("900"), "2026-05-01"), debt("old", toMinor("900"), "2026-01-01")],
            capPercent: 100,
            dueOnOrBefore: MAY,
        })
        expect(plan.allocations[0].debtId).toBe("old")
    })

    it("breaks ties on id rather than on arrival order", () => {
        // A plan that depends on which row came back first is a plan that
        // changes between a draft and its approval.
        const same = "2026-04-25"
        const a = planRecovery({ netMinor: 500, capPercent: 100, dueOnOrBefore: MAY, debts: [debt("b", 400, same), debt("a", 400, same)] })
        const b = planRecovery({ netMinor: 500, capPercent: 100, dueOnOrBefore: MAY, debts: [debt("a", 400, same), debt("b", 400, same)] })
        expect(a.allocations).toEqual(b.allocations)
        expect(a.allocations[0].debtId).toBe("a")
    })

    it("leaves a debt that is not due yet alone", () => {
        // Owing money due in June is not defaulting in May.
        const plan = planRecovery({
            netMinor: toMinor("30000"),
            debts: [debt("june", toMinor("5000"), "2026-06-25")],
            capPercent: 100,
            dueOnOrBefore: MAY,
        })
        expect(plan.totalMinor).toBe(0)
    })

    it("ignores a debt already paid down to nothing", () => {
        const plan = planRecovery({
            netMinor: toMinor("30000"),
            debts: [debt("done", 0, "2026-01-25")],
            capPercent: 100,
            dueOnOrBefore: MAY,
        })
        expect(plan.allocations).toEqual([])
    })
})

describe("Sara's four months, end to end", () => {
    // The example the decision was made from, as arithmetic.
    const salary = toMinor("30000")

    it("April floors at zero and carries 5,000", () => {
        // 30,000 earned, 35,000 deducted.
        const rawNet = salary - toMinor("35000")
        expect(Math.max(0, rawNet)).toBe(0)
        expect(-rawNet).toBe(toMinor("5000"))
    })

    it("May collects it in full at the default cap", () => {
        const plan = planRecovery({
            netMinor: salary,
            debts: [debt("apr", toMinor("5000"), "2026-04-25")],
            capPercent: FULL_RECOVERY_PERCENT,
            dueOnOrBefore: MAY,
        })
        expect(salary - plan.totalMinor).toBe(toMinor("25000"))
    })

    it("and at a 25% cap spreads it over two months instead", () => {
        const first = planRecovery({
            netMinor: salary, capPercent: 25, dueOnOrBefore: MAY,
            debts: [debt("apr", toMinor("5000"), "2026-04-25")],
        })
        expect(first.totalMinor).toBe(toMinor("5000"))   // 7,500 available, debt is smaller
        // A bigger debt is where the cap bites.
        const big = planRecovery({
            netMinor: salary, capPercent: 25, dueOnOrBefore: MAY,
            debts: [debt("apr", toMinor("20000"), "2026-04-25")],
        })
        expect(big.totalMinor).toBe(toMinor("7500"))
        expect(salary - big.totalMinor).toBe(toMinor("22500"))
    })
})

describe("it is wired where it cannot create a second debt", () => {
    it("runs after the net is totalled, not alongside the other deductions", () => {
        // Added to the list before totalPayslip and it would be floored like
        // anything else, carrying the excess into a new debt.
        expect(REGISTER).toContain("const beforeRecovery = totalPayslip(lines)")
        expect(REGISTER).toContain("netMinor: beforeRecovery.netMinor")
    })

    it("never runs for somebody who is being paid nothing", () => {
        expect(REGISTER).toContain("if (!person.exclusion && person.debts?.length)")
    })

    it("traces every recovery line back to the debt it paid", () => {
        expect(REGISTER).toContain("source: DEBT_RECOVERY_SOURCE")
        expect(REGISTER).toContain("sourceId: allocation.debtId")
    })

    it("takes the month end from the company's calendar, not from UTC", () => {
        expect(REGISTER).toContain("person.debtsDueOnOrBefore ?? endOfMonthInstant(year, month)")
        expect(SERVICE).toContain("debtsDueOnOrBefore: monthEnd")
        expect(SERVICE).toContain("startOfMonthIn(")
    })
})

describe("the debt is closed when the money is taken", () => {
    it("applies recoveries from the stored lines, not a recomputation", () => {
        // The line on the payslip is the claim; this is that claim being
        // honoured. Recomputing here would let the two disagree.
        expect(SERVICE).toContain("line.source !== DEBT_RECOVERY_SOURCE")
        expect(SERVICE).toContain("recoveredAmount: recovered")
    })

    it("settles a debt once it is fully recovered", () => {
        expect(SERVICE).toContain('status: "SETTLED", settledAt: new Date()')
    })

    it("keeps the original amount rather than shrinking it", () => {
        // A column that shrinks cannot answer what the debt was to begin with,
        // which is the thing somebody disputes.
        expect(
            declaresField(SCHEMA, "recoveredAmount", "Decimal", "@default(0)", "@db.Decimal(12, 2)"),
            "Debt.recoveredAmount must stay a separate Decimal(12,2) defaulting to 0",
        ).toBe(true)
        expect(SERVICE).not.toContain("amount: { decrement:")
    })

    it("applies recoveries before raising this month's new debts", () => {
        // A debt raised by this run is due on this run's payday, and could
        // otherwise read as collectable by the very month that created it.
        const approve = SERVICE.slice(SERVICE.indexOf("static async approve"))
        expect(approve.indexOf("DEBT_RECOVERY_SOURCE")).toBeLessThan(approve.indexOf("tx.debt.create"))
    })

    it("skips a debt that vanished between draft and approval rather than failing", () => {
        // Refusing the whole approval over one stale row would hold up
        // everybody else's pay.
        expect(SERVICE).toContain('if (!debt || debt.status !== "OUTSTANDING") continue')
    })
})

describe("the cap is a setting, not a constant", () => {
    it("is stored per company and defaults to the whole net", () => {
        // Spacing-blind: prisma format re-aligns the whole model whenever a
        // longer field joins it (the attendance calendar's relations did).
        expect(SCHEMA).toMatch(/debtRecoveryPercent\s+Int\s+@default\(100\)/)
    })

    it("is settable, and bounded at both ends", () => {
        // Pinned against the request body: the name also appears in the
        // onSaved callback, so a file-wide toContain passed with the field
        // stripped out of the PUT. Caught by break-testing it, and the same
        // trap as the last two settings fields.
        const body = CARD.slice(CARD.indexOf("body: JSON.stringify("), CARD.indexOf("const body = await res.json()"))
        expect(body).toContain("debtRecoveryPercent: cap")
        expect(CARD).toContain("min={0}")
        expect(CARD).toContain("max={100}")
    })

    it("says what the number means at each end of its range", () => {
        expect(CARD).toContain("debt_recovery_hint_full")
        expect(CARD).toContain("debt_recovery_hint_off")
        expect(CARD).toContain("debt_recovery_hint_capped")
        expect(en.debt_recovery_hint_full).toMatch(/nothing to pay/i)
        expect(en.debt_recovery_hint_off).toMatch(/never/i)
    })
})

describe("the copy exists in both languages", () => {
    it("every English key has an Arabic value", () => {
        const missing = Object.keys(en as any).filter(k => !(k in (ar as any)))
        expect(missing, `no Arabic translation:\n${missing.join("\n")}`).toEqual([])
    })
})

/** Matches a schema field regardless of the column alignment `prisma format`
 *  applies. The spacing is not what any of these assertions are about, and
 *  baking it in makes the next reformat look like a payroll regression. */
function declaresField(schema: string, field: string, type: string, ...attrs: string[]) {
    const parts = [field, type, ...attrs].map(p => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    return new RegExp(parts.join("\\s+")).test(schema)
}

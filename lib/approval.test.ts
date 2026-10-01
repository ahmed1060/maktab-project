import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { checkApproval, canUndoAdjustment, type ApprovalInput } from "./approval"
import { stripComments } from "./strip-comments"

const base: ApprovalInput = {
    status: "DRAFT",
    refused: [],
    pendingDecisions: [],
    acknowledgePending: false,
    includedCount: 3,
}

describe("what has to be true before a month can be frozen", () => {
    it("approves an ordinary month", () => {
        expect(checkApproval(base)).toEqual({ ok: true })
    })

    it("refuses a month that is already approved", () => {
        // Approving again would restate figures that have been issued.
        for (const status of ["APPROVED", "PAID"] as const) {
            const verdict = checkApproval({ ...base, status })
            expect(verdict.ok, status).toBe(false)
            expect(!verdict.ok && verdict.refusal.code).toBe("ALREADY_APPROVED")
        }
    })

    it("refuses outright when somebody cannot be calculated, and names them", () => {
        // Not something to acknowledge. They are not on the register at all, so
        // approving pays everybody else and leaves them with nothing and no
        // record of why — a failure that arrives as an absence.
        const verdict = checkApproval({
            ...base,
            refused: [{ userId: "u1", name: "Sara Kamal", reason: "No salary in effect for 2026-09" }],
        })
        expect(verdict.ok).toBe(false)
        if (verdict.ok) return
        expect(verdict.refusal.code).toBe("CANNOT_COMPUTE")
        expect(verdict.refusal).toHaveProperty("names", ["Sara Kamal"])
        // Acknowledging must not get past it.
        expect(checkApproval({
            ...base,
            refused: [{ userId: "u1", name: "Sara Kamal", reason: "x" }],
            acknowledgePending: true,
        }).ok).toBe(false)
    })

    it("holds on an undecided suspension until somebody says they know", () => {
        // "Pay them for now and decide later" is a legitimate answer. Making it
        // without noticing is not, so it takes a deliberate act.
        const pending = [{ userId: "u2", name: "Hala Nour", undecidedDays: 3 }]
        const held = checkApproval({ ...base, pendingDecisions: pending })
        expect(held.ok).toBe(false)
        expect(!held.ok && held.refusal.code).toBe("PENDING_UNACKNOWLEDGED")
        expect(!held.ok && (held.refusal as any).names).toEqual(["Hala Nour"])

        expect(checkApproval({ ...base, pendingDecisions: pending, acknowledgePending: true }))
            .toEqual({ ok: true })
    })

    it("refuses a month with nobody in it", () => {
        expect(checkApproval({ ...base, includedCount: 0 }).ok).toBe(false)
    })

    it("reports the worst problem first", () => {
        // Somebody who cannot be calculated is not fixed by acknowledging a
        // suspension, and being told about the smaller thing first is how the
        // larger one gets clicked past.
        const verdict = checkApproval({
            ...base,
            refused: [{ userId: "u1", name: "A", reason: "x" }],
            pendingDecisions: [{ userId: "u2", name: "B", undecidedDays: 1 }],
        })
        expect(!verdict.ok && verdict.refusal.code).toBe("CANNOT_COMPUTE")
    })
})

describe("approval closes the month to correction", () => {
    it("allows an undo while the month is open or has no run", () => {
        expect(canUndoAdjustment(null)).toBe(true)
        expect(canUndoAdjustment("DRAFT")).toBe(true)
    })

    it("refuses one once the figures are frozen", () => {
        // Undoing decrements the salary record, and a frozen payslip does not
        // move with it — so the document somebody was issued and the figures
        // behind it would disagree, with nothing to say which is right.
        expect(canUndoAdjustment("APPROVED")).toBe(false)
        expect(canUndoAdjustment("PAID")).toBe(false)
    })

    it("is enforced on both undo paths, on the adjustment's own period", () => {
        const service = stripComments(readFileSync("lib/services/salary.service.ts", "utf8"))
        expect(service).toContain("canUndoAdjustment")
        expect(service).toContain("MONTH_CLOSED")
        // The period comes off the row, which is why P6 gave it one.
        expect(service).toContain("month: adjustment.month")
        expect(service).toContain("year: adjustment.year")
        // Both rollback and reversal go through undoAdjustment, so one check
        // covers both — and that is asserted rather than assumed.
        expect(service).toContain("return this.undoAdjustment(userId, adjId, session, \"ROLLED_BACK\"")
        expect(service).toContain("return this.undoAdjustment(userId, adjId, session, \"REVERSED\"")
    })

    it("tells the caller what to do instead", () => {
        for (const action of ["rollback", "reverse"]) {
            const route = stripComments(readFileSync(`app/api/users/[id]/adjustments/[adjId]/${action}/route.ts`, "utf8"))
            expect(route, action).toContain("MONTH_CLOSED")
            expect(route, action).toContain("open month")
        }
    })
})

describe("approving is its own act", () => {
    const service = stripComments(readFileSync("lib/services/payroll-run.service.ts", "utf8"))

    it("recomputes from source before freezing", () => {
        // What gets approved should be what was true at the moment of approval,
        // not whatever a draft happened to be storing from an hour ago.
        // Inside the approval's own transaction, under the month's lock, after
        // attendance's last recompute (ATTENDANCE_PLAN.md §12.1): a draft
        // saved before the transaction could be out of date by the time it froze.
        const approve = service.slice(service.indexOf("static async approve"))
        expect(approve).toContain("this.compute(companyId, year, month, tx, reaches)")
        expect(approve).toContain("this.writeDraft(tx, companyId, year, month, final, payrollDay)")
    })

    it("writes the payslips, the settlements and the debts together", () => {
        const approve = service.slice(service.indexOf("static async approve"))
        expect(approve).toContain("prisma.$transaction")
        expect(approve).toContain("tx.debt.create")
        expect(approve).toContain("tx.finalSettlement.updateMany")
        expect(approve).toContain('status: "APPROVED"')
    })

    it("has its own endpoint, not a flag on the draft one", () => {
        // Saving a draft is reversible and approving is not. An endpoint that
        // does either depending on a body field is one typo away from doing the
        // wrong one.
        const route = stripComments(readFileSync("app/api/payroll/[year]/[month]/approve/route.ts", "utf8"))
        expect(route).toContain("PayrollRunService.approve")
        // The draft route legitimately mentions approval in its refusal text.
        // What it must not do is perform one.
        const draft = stripComments(readFileSync("app/api/payroll/[year]/[month]/route.ts", "utf8"))
        expect(draft).not.toContain("PayrollRunService.approve")
    })

    it("sends the names back with the refusal", () => {
        // A screen that can only say "no" sends somebody hunting through a list
        // of fifty to find the two people it meant.
        const route = stripComments(readFileSync("app/api/payroll/[year]/[month]/approve/route.ts", "utf8"))
        expect(route).toContain("names")
        expect(route).toContain("ApiResponse.badRequest")
    })
})

describe("the register screen asks before it freezes", () => {
    const PAGE = readFileSync("app/(dashboard)/dashboard/payroll/page.tsx", "utf8")

    it("puts the acknowledgement with the names, not beside the button", () => {
        // A tickbox beside a button is a step in pressing the button. One
        // beside the list is a statement about the list.
        // Asserted on containment rather than on position: the buttons live in
        // the page header, above everything, so "after the list" and "not in
        // the button group" are different claims and only the second is true.
        const cardStart = PAGE.indexOf("register.pendingDecisions.length > 0 && card(")
        expect(cardStart).toBeGreaterThan(-1)
        const pendingCard = PAGE.slice(cardStart, PAGE.indexOf("'warn')}", cardStart))
        expect(pendingCard, "the acknowledgement is no longer inside the pending list")
            .toContain("payroll_acknowledge_pending")

        // Bounded at the end of the header rather than at the approve title.
        // That title used to sit in the header's confirm() call and now lives
        // in the themed modal further down the file, so anchoring on it made
        // this slice swallow the pending card it is meant to exclude — a slice
        // that silently widened, which is the third time bounding a slice on
        // the wrong marker has bitten in this repository.
        const header = PAGE.slice(PAGE.indexOf("payroll_save_draft"), PAGE.indexOf("{view && !isDraft && card("))
        expect(header.length, "the header slice no longer terminates").toBeGreaterThan(0)
        expect(header, "the acknowledgement moved into the button group")
            .not.toContain("payroll_acknowledge_pending")
    })

    it("says what approving does before it does it", () => {
        // Still asked before it happens, now in the app's own dialog rather
        // than the browser's — confirm() ignored the palette, could not be
        // translated, and rendered Arabic left-to-right.
        expect(PAGE).toContain("payroll_approve_msg")
        expect(PAGE).toMatch(/<ConfirmModal[\s/>]/)
        expect(PAGE).toContain("setConfirming({ kind: 'approve' })")
        expect(PAGE).not.toMatch(/(?<![.\w])confirm\s*\(/)
    })

    it("relays the names a refusal came back with", () => {
        expect(PAGE).toContain("body?.details?.names")
    })
})

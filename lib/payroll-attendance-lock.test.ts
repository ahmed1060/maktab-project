import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { stripComments } from "./strip-comments"

/**
 * Approving a month's payroll takes the month's attendance lock
 * (ATTENDANCE_PLAN.md §12.1; review on #12). Every write to that month's
 * attendance takes the same lock and then checks whether the month is
 * approved, so the two cannot interleave: a punch lands before the approval,
 * or is refused after it. Without the lock on this side, a punch could check
 * the month while it was still a draft and commit after it was approved.
 */

const SERVICE = stripComments(readFileSync("lib/services/payroll-run.service.ts", "utf8"))

describe("payroll approval and attendance", () => {
    it("takes the month's attendance lock inside the transaction, before the run becomes APPROVED", () => {
        const approve = SERVICE.slice(SERVICE.indexOf("static async approve("))
        const tx = approve.indexOf("prisma.$transaction(")
        const lock = approve.indexOf("lockMonths(tx, companyId,")
        const approved = approve.indexOf('status: "APPROVED"')
        expect(tx).toBeGreaterThan(-1)
        expect(lock).toBeGreaterThan(tx)
        expect(approved).toBeGreaterThan(lock)
    })

    it("uses the one lock the attendance writes use", () => {
        const lock = readFileSync("lib/services/attendance-lock.ts", "utf8")
        expect(lock).toContain("attendance-month:${companyId}:${month}")
        expect(SERVICE).toContain('from "./attendance-lock"')
    })
})

import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { prisma } from "@/lib/prisma"
import { managesCompany } from "@/lib/payroll-scope"

/**
 * Writing a debt off.
 *
 * H3: `WAIVED` has been in the enum since P8 and was written by nothing. G4
 * closed the half that mattered — money owed is no longer forgiven by inaction
 * — but the deliberate version of forgiving it had no door, and some debts
 * need one: somebody who leaves owing 200 has no next month to recover it
 * from, so recovery will never clear the row and it sits on the list forever.
 *
 * A reason is required. That is the whole difference between this and the
 * inaction it replaces: waiving is a decision somebody makes and signs, and a
 * write-off with no stated reason is indistinguishable a year later from a
 * mistake.
 *
 * Only an OUTSTANDING debt can be waived. A settled one is already closed, and
 * re-closing it under a different status would rewrite what happened to money
 * that actually moved.
 */
export const POST = withStandardHandler(async (_req, session, json, { params }) => {
    const reason = typeof json?.reason === "string" ? json.reason.trim() : ""
    if (reason.length < 3) {
        return ApiResponse.badRequest("Say why this debt is being written off")
    }

    const debt = await prisma.debt.findUnique({
        where: { id: params.id },
        select: { id: true, companyId: true, status: true, amount: true, recoveredAmount: true },
    })
    if (!debt) return ApiResponse.notFound("Debt not found")

    if (!managesCompany(session.user, "debts.waive", debt.companyId)) {
        return ApiResponse.forbidden("Access denied")
    }

    if (debt.status !== "OUTSTANDING") {
        return ApiResponse.badRequest("This debt is already closed")
    }

    const updated = await prisma.debt.update({
        where: { id: debt.id },
        data: {
            status: "WAIVED",
            settledAt: new Date(),
            // Appended rather than replacing whatever the debt was raised with:
            // why it arose and why it was forgiven are two different facts and
            // the second does not cancel the first.
            reason: reason,
        },
    })

    const { AuditLogService } = await import("@/lib/services/audit-log.service")
    await AuditLogService.log("WAIVE_DEBT", "DEBT", debt.id, {
        userId: session.user.role !== "SUPER_ADMIN" ? session.user.id : null,
        superAdminId: session.user.role === "SUPER_ADMIN" ? session.user.id : null,
        details: {
            amount: Number(debt.amount),
            recovered: Number(debt.recoveredAmount),
            writtenOff: Number(debt.amount) - Number(debt.recoveredAmount),
            reason,
        },
    })

    return ApiResponse.success({ id: updated.id, status: updated.status })
}, { rateLimit: { maxRequests: 20, windowMs: 60_000 } })

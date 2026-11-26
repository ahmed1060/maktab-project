import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { can } from "@/lib/permissions/can"
import { prisma } from "@/lib/prisma"
import { personTarget, verifyResourceAccess } from "@/lib/security"
import { RoleAssignmentService } from "@/lib/services/role-assignment.service"
import { ContractStartService } from "@/lib/services/contract-start.service"
import { adminRefusal } from "@/lib/role-errors"
import { assertStepUp } from "@/lib/step-up"

/**
 * Changing when someone's contract started (LATER_CHANGES_PLAN.md §7.2,
 * PR 425): their hiring, and their starting salary with it, so their pay.
 * With employees.edit_contract_start, never one's own, and an Admin's by the
 * Super Admin alone. Its refusals carry their codes, so the dialog says them
 * in the reader's language, under the date.
 */

const REFUSALS: Record<string, [400 | 409, string]> = {
    CONTRACT_START_OUT_OF_RANGE: [400, "The contract start date must be a date within a year of today."],
    CONTRACT_START_SAME: [400, "Their contract already starts on that date."],
    CONTRACT_START_AFTER_CHANGE: [409, "Something else is recorded about their job, or their salary changed, on or before that date."],
    PAYROLL_MONTH_LOCKED: [409, "A month between the two dates has its payroll approved."],
    NO_CONTRACT_START: [400, "There's no contract start on record for them."],
}

export const POST = withStandardHandler(async (_req, session, json, { params }) => {
    const userId = params.id
    if (!can(session.user, "employees.edit_contract_start")) return ApiResponse.forbidden("Not allowed")
    if (userId === session.user.id) return ApiResponse.forbidden("Not your own")
    const person = await personTarget(userId)
    if (!person || !can(session.user, "employees.edit_contract_start", person)) return ApiResponse.forbidden("Access denied")
    if (!(await verifyResourceAccess(session, userId, "USER"))) return ApiResponse.forbidden("Access denied")
    const target = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } })
    if (!target) return ApiResponse.notFound("User not found")
    try {
        RoleAssignmentService.onlySuperAdminActsOnAdmins(session.user, target)
    } catch (error) {
        const refusal = adminRefusal(error)
        if (refusal) return refusal
        throw error
    }
    // A high-risk action, as it moves pay: confirmed with a code within the hour (ROLES_PLAN.md §6.15).
    await assertStepUp(session, "employees.edit_contract_start")

    const superAdmin = session.user.role === "SUPER_ADMIN"
    try {
        const changed = await ContractStartService.change(userId, json?.date, {
            userId: superAdmin ? null : session.user.id,
            superAdminId: superAdmin ? session.user.id : null,
        })
        return ApiResponse.success(changed)
    } catch (error) {
        const code = error instanceof Error ? error.message : ""
        const refusal = REFUSALS[code]
        if (refusal) return ApiResponse.refused(refusal[0], refusal[1], code)
        throw error
    }
})

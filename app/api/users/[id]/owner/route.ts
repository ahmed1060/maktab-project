import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { can } from "@/lib/permissions/can"
import { prisma } from "@/lib/prisma"
import { personTarget, verifyResourceAccess } from "@/lib/security"
import { RoleAssignmentService } from "@/lib/services/role-assignment.service"
import { OwnerRefused, OwnerService } from "@/lib/services/owner.service"
import { adminRefusal } from "@/lib/role-errors"
import { assertStepUp } from "@/lib/step-up"

/**
 * Adding someone to the owners, or removing them (LATER_CHANGES_PLAN.md
 * §7.3, step 3a, PR 426): from the start of this month, no payslip and no
 * attendance days, so it's their pay. With employees.set_owner, never one's
 * own, and an Admin's by the Super Admin alone. Its refusals carry their
 * codes, and the work still open where that's why, so the dialog says them
 * in the reader's language.
 */

const REFUSALS: Record<string, [400 | 409, string]> = {
    OWNER_OPEN_WORK: [409, "They have work still open, to be moved to someone else first."],
    PAYROLL_MONTH_LOCKED: [409, "The payroll of this month or a later one is approved."],
    ALREADY_OWNER: [409, "They're already among the owners."],
    NOT_OWNER: [409, "They're not among the owners."],
    NO_COMPANY: [400, "Only someone in a company can be among its owners."],
}

export const POST = withStandardHandler(async (_req, session, json, { params }) => {
    const userId = params.id
    if (!can(session.user, "employees.set_owner")) return ApiResponse.forbidden("Not allowed")
    if (userId === session.user.id) return ApiResponse.forbidden("Not your own")
    if (typeof json?.owner !== "boolean") return ApiResponse.badRequest("owner must be true or false")
    const person = await personTarget(userId)
    if (!person || !can(session.user, "employees.set_owner", person)) return ApiResponse.forbidden("Access denied")
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
    await assertStepUp(session, "employees.set_owner")

    const superAdmin = session.user.role === "SUPER_ADMIN"
    try {
        const set = await OwnerService.set(userId, json.owner, {
            userId: superAdmin ? null : session.user.id,
            superAdminId: superAdmin ? session.user.id : null,
        })
        return ApiResponse.success(set)
    } catch (error) {
        const refusal = error instanceof OwnerRefused ? REFUSALS[error.message] : undefined
        if (error instanceof OwnerRefused && refusal) return ApiResponse.refused(refusal[0], refusal[1], error.message, error.work.length > 0 ? { work: error.work } : undefined)
        throw error
    }
})

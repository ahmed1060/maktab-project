import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { prisma } from "@/lib/prisma"
import { RoleAssignmentService } from "@/lib/services/role-assignment.service"

/**
 * The roles the signed-in person may hand out — what a Role dropdown offers
 * (ROLES_PLAN.md §6.4). The same rules the server applies on saving, so the
 * list never offers what would be refused: no ADMIN-based role but for the
 * Super Admin, and none holding access the person does not have.
 *
 * Their own company's; the Super Admin names one.
 */
export const GET = withStandardHandler(async (req, session) => {
    const companyId = session.user.role === "SUPER_ADMIN"
        ? new URL(req.url).searchParams.get("companyId")
        : session.user.companyId
    if (!companyId) return ApiResponse.badRequest("companyId is required")
    return ApiResponse.success(await RoleAssignmentService.assignable(prisma, session.user, companyId))
}, { permission: "employees.assign_role" })

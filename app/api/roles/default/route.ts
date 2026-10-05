import { z } from "zod"
import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { RoleService } from "@/lib/services/role.service"
import { roleErrorResponse, denyUnlessSuperAdmin } from "@/lib/role-errors"

const setDefaultSchema = z.object({
    companyId: z.string().min(1),
    // Null goes back to the built-in Employee.
    roleId: z.string().min(1).nullable(),
})

/**
 * A company's default role for new accounts (ROLES_PLAN.md §6.4). Set by the
 * Super Admin, like the roles themselves.
 */
export const PUT = withStandardHandler(async (req, session, json) => {
    const denied = denyUnlessSuperAdmin(session)
    if (denied) return denied
    const validation = setDefaultSchema.safeParse(json)
    if (!validation.success) return ApiResponse.badRequest("Validation Error", validation.error.format())
    try {
        return ApiResponse.success(await RoleService.setDefault(validation.data.companyId, validation.data.roleId, session))
    } catch (error) {
        return roleErrorResponse(error) ?? Promise.reject(error)
    }
})

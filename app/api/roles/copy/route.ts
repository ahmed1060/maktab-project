import { z } from "zod"
import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { RoleService } from "@/lib/services/role.service"
import { roleErrorResponse, denyUnlessSuperAdmin } from "@/lib/role-errors"

const copySchema = z.object({
    targetCompanyId: z.string().min(1),
    sourceCompanyId: z.string().min(1),
    includeBuiltIn: z.boolean().optional(),
})

/** Copy another company's roles into this one (ROLES_PLAN.md §6.7). Super Admin only. */
export const POST = withStandardHandler(async (req, session, json) => {
    const denied = denyUnlessSuperAdmin(session)
    if (denied) return denied
    const validation = copySchema.safeParse(json)
    if (!validation.success) return ApiResponse.badRequest("Validation Error", validation.error.format())
    const { targetCompanyId, sourceCompanyId, includeBuiltIn } = validation.data
    try {
        return ApiResponse.success(await RoleService.copyFrom(targetCompanyId, sourceCompanyId, { includeBuiltIn }, session))
    } catch (error) {
        return roleErrorResponse(error) ?? Promise.reject(error)
    }
})

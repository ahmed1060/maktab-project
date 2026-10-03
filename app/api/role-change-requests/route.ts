import { z } from "zod"
import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { RoleChangeRequestService } from "@/lib/services/role-change-request.service"
import { roleRequestRefusal } from "@/lib/role-errors"

const createSchema = z.object({
    roleId: z.string().min(1).optional().nullable(),
    description: z.string().trim().min(5, "Describe what is needed").max(2000),
})

/**
 * Role change requests to the Super Admin (ROLES_PLAN.md §6.9): made by a
 * company's Admins, listed for them and for the Super Admin.
 */
export const GET = withStandardHandler(async (req, session) => {
    const params = new URL(req.url).searchParams
    try {
        return ApiResponse.success(await RoleChangeRequestService.list(session, { status: params.get("status"), companyId: params.get("companyId") }))
    } catch (error) {
        return roleRequestRefusal(error) ?? Promise.reject(error)
    }
})

export const POST = withStandardHandler(async (req, session, json) => {
    const validation = createSchema.safeParse(json)
    if (!validation.success) return ApiResponse.badRequest("Validation Error", validation.error.format())
    try {
        return ApiResponse.success(await RoleChangeRequestService.create(validation.data, session), 201)
    } catch (error) {
        return roleRequestRefusal(error) ?? Promise.reject(error)
    }
})

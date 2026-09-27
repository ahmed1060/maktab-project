import { z } from "zod"
import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { can } from "@/lib/permissions/can"
import { RoleRequestService } from "@/lib/services/role-request.service"
import { roleRequestRefusal } from "@/lib/role-errors"

const createSchema = z.object({
    userId: z.string().min(1),
    roleId: z.string().min(1),
    note: z.string().trim().max(500).optional().nullable(),
    // Asked for as an acting role, until then (ROLES_PLAN.md §6.13).
    actingUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "A date, YYYY-MM-DD").optional().nullable(),
})

/**
 * Role assignment requests (ROLES_PLAN.md §6.12). Listed for whoever decides
 * them or made them; made by whoever holds employees.request_role.
 */
export const GET = withStandardHandler(async (req, session) => {
    const user = session.user
    if (user.role !== "SUPER_ADMIN" && !can(user, "employees.assign_role") && !can(user, "employees.request_role")) {
        return ApiResponse.forbidden()
    }
    const params = new URL(req.url).searchParams
    return ApiResponse.success(await RoleRequestService.list(session, {
        companyId: params.get("companyId"), status: params.get("status"), userId: params.get("userId"),
    }))
})

export const POST = withStandardHandler(async (req, session, json) => {
    const validation = createSchema.safeParse(json)
    if (!validation.success) return ApiResponse.badRequest("Validation Error", validation.error.format())
    try {
        return ApiResponse.success(await RoleRequestService.create(validation.data, session), 201)
    } catch (error) {
        return roleRequestRefusal(error) ?? Promise.reject(error)
    }
}, { permission: "employees.request_role" })

import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { RoleService } from "@/lib/services/role.service"
import { createRoleSchema, updateRoleSchema } from "@/lib/validations/role.schema"
import { roleErrorResponse, denyUnlessSuperAdmin } from "@/lib/role-errors"

/**
 * A company's roles (ROLES_PLAN.md §6.2). The Super Admin's alone, reads
 * included: which roles a company has, and what each holds, is how its
 * contract is written, and only the Super Admin writes it.
 */
export const GET = withStandardHandler(async (req, session) => {
    const denied = denyUnlessSuperAdmin(session)
    if (denied) return denied
    const { searchParams } = new URL(req.url)
    try {
        const id = searchParams.get("id")
        if (id) return ApiResponse.success(await RoleService.getById(id))
        const companyId = searchParams.get("companyId")
        if (!companyId) return ApiResponse.badRequest("companyId is required")
        return ApiResponse.success(await RoleService.listForCompany(companyId))
    } catch (error) {
        return roleErrorResponse(error) ?? Promise.reject(error)
    }
})

export const POST = withStandardHandler(async (req, session, json) => {
    const denied = denyUnlessSuperAdmin(session)
    if (denied) return denied
    const validation = createRoleSchema.safeParse(json)
    if (!validation.success) return ApiResponse.badRequest("Validation Error", validation.error.format())
    try {
        return ApiResponse.success(await RoleService.create(validation.data, session), 201)
    } catch (error) {
        return roleErrorResponse(error) ?? Promise.reject(error)
    }
})

export const PUT = withStandardHandler(async (req, session, json) => {
    const denied = denyUnlessSuperAdmin(session)
    if (denied) return denied
    const validation = updateRoleSchema.safeParse(json)
    if (!validation.success) return ApiResponse.badRequest("Validation Error", validation.error.format())
    try {
        return ApiResponse.success(await RoleService.update(validation.data, session))
    } catch (error) {
        return roleErrorResponse(error) ?? Promise.reject(error)
    }
})

export const DELETE = withStandardHandler(async (req, session) => {
    const denied = denyUnlessSuperAdmin(session)
    if (denied) return denied
    const id = new URL(req.url).searchParams.get("id")
    if (!id) return ApiResponse.badRequest("id is required")
    try {
        return ApiResponse.success(await RoleService.delete(id, session))
    } catch (error) {
        return roleErrorResponse(error) ?? Promise.reject(error)
    }
})

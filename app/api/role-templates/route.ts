import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { RoleTemplateService } from "@/lib/services/role-template.service"
import { createTemplateSchema, updateTemplateSchema } from "@/lib/validations/role.schema"
import { roleErrorResponse, denyUnlessSuperAdmin } from "@/lib/role-errors"

/** Role templates (ROLES_PLAN.md §6.1). The Super Admin's alone. */
export const GET = withStandardHandler(async (req, session) => {
    const denied = denyUnlessSuperAdmin(session)
    if (denied) return denied
    const id = new URL(req.url).searchParams.get("id")
    try {
        return ApiResponse.success(id ? await RoleTemplateService.getById(id) : await RoleTemplateService.list())
    } catch (error) {
        return roleErrorResponse(error) ?? Promise.reject(error)
    }
})

export const POST = withStandardHandler(async (req, session, json) => {
    const denied = denyUnlessSuperAdmin(session)
    if (denied) return denied
    const validation = createTemplateSchema.safeParse(json)
    if (!validation.success) return ApiResponse.badRequest("Validation Error", validation.error.format())
    try {
        return ApiResponse.success(await RoleTemplateService.create(validation.data, session), 201)
    } catch (error) {
        return roleErrorResponse(error) ?? Promise.reject(error)
    }
})

export const PUT = withStandardHandler(async (req, session, json) => {
    const denied = denyUnlessSuperAdmin(session)
    if (denied) return denied
    const validation = updateTemplateSchema.safeParse(json)
    if (!validation.success) return ApiResponse.badRequest("Validation Error", validation.error.format())
    try {
        return ApiResponse.success(await RoleTemplateService.update(validation.data, session))
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
        return ApiResponse.success(await RoleTemplateService.delete(id, session))
    } catch (error) {
        return roleErrorResponse(error) ?? Promise.reject(error)
    }
})

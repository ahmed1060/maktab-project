import { z } from "zod"
import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { RoleTemplateService } from "@/lib/services/role-template.service"
import { roleErrorResponse, denyUnlessSuperAdmin } from "@/lib/role-errors"

const pushSchema = z.object({
    templateId: z.string().min(1),
    roleIds: z.array(z.string().min(1)).min(1).max(500),
    applyNow: z.boolean().optional(),
})

/**
 * Offer a template's change to the company roles copied from it (ROLES_PLAN.md
 * §6.8): GET lists them with how each differs; POST applies it to those picked.
 * Super Admin only.
 */
export const GET = withStandardHandler(async (req, session) => {
    const denied = denyUnlessSuperAdmin(session)
    if (denied) return denied
    const id = new URL(req.url).searchParams.get("id")
    if (!id) return ApiResponse.badRequest("id is required")
    try {
        return ApiResponse.success(await RoleTemplateService.offers(id))
    } catch (error) {
        return roleErrorResponse(error) ?? Promise.reject(error)
    }
})

export const POST = withStandardHandler(async (req, session, json) => {
    const denied = denyUnlessSuperAdmin(session)
    if (denied) return denied
    const validation = pushSchema.safeParse(json)
    if (!validation.success) return ApiResponse.badRequest("Validation Error", validation.error.format())
    const { templateId, roleIds, applyNow } = validation.data
    try {
        return ApiResponse.success(await RoleTemplateService.applyTo(templateId, roleIds, { applyNow }, session))
    } catch (error) {
        return roleErrorResponse(error) ?? Promise.reject(error)
    }
})

import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { SuperAdminService } from "@/lib/services/super-admin.service"
import { superAdminUpdateSchema } from "@/lib/validations/super-admin.schema"

// Self-edit always allowed; editing a different super admin requires the
// actor be protected (session.user.isProtected) — see
// SuperAdminService.update for the actual check.
export const PUT = withStandardHandler(async (req, session, json, { params }) => {
    if (session.user.role !== 'SUPER_ADMIN') {
        return ApiResponse.forbidden("Access denied")
    }

    const validation = superAdminUpdateSchema.safeParse(json)
    if (!validation.success) {
        return ApiResponse.badRequest("Validation Error", validation.error.format())
    }

    try {
        const result = await SuperAdminService.update(params.id, validation.data, session)
        return ApiResponse.success(result)
    } catch (error: any) {
        if (error.message === 'FORBIDDEN') return ApiResponse.forbidden("Only a protected super admin can edit another super admin's account")
        if (error.message === 'SUPER_ADMIN_NOT_FOUND') return ApiResponse.notFound("Super admin not found")
        if (error.message === 'EMAIL_ALREADY_EXISTS') return ApiResponse.badRequest("Email already exists")
        if (error.message === 'EMAIL_CHANGE_REQUIRES_VERIFICATION') return ApiResponse.badRequest("Email changes require verification — use Email settings")
        if (error.message === 'TARGET_PROTECTED') return ApiResponse.forbidden("This account's email is protected and cannot be changed")
        throw error
    }
})

// Deletable only by a protected super admin (session.user.isProtected).
// The database trigger added alongside SuperAdmin.isProtected is the real
// backstop — it blocks deleting a protected row or the last remaining one
// regardless of this check, including against a direct SQL DELETE. This
// check exists to fail fast with a clear message instead of a raw
// Postgres exception, and to stop a non-protected admin from even
// attempting it.
export const DELETE = withStandardHandler(async (req, session, json, { params }) => {
    if (session.user.role !== 'SUPER_ADMIN') {
        return ApiResponse.forbidden("Access denied")
    }

    try {
        await SuperAdminService.delete(params.id, session)
        return ApiResponse.success({ id: params.id })
    } catch (error: any) {
        if (error.message === 'FORBIDDEN') return ApiResponse.forbidden("Only a protected super admin can delete a super admin account")
        if (error.message === 'SUPER_ADMIN_NOT_FOUND') return ApiResponse.notFound("Super admin not found")
        if (error.message === 'TARGET_PROTECTED') return ApiResponse.forbidden("This account is protected and cannot be deleted")
        if (error.message === 'LAST_SUPER_ADMIN') return ApiResponse.forbidden("Cannot delete the last remaining super admin account")
        throw error
    }
})

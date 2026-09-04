import { z } from "zod"
import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { SystemSettingsService } from "@/lib/services/system-settings.service"

const updateSystemSettingsSchema = z.object({
    locationVerifyRadiusMeters: z.number().int().min(1).max(10000),
})

export const GET = withStandardHandler(async (req, session) => {
    if (session.user.role !== 'SUPER_ADMIN') return ApiResponse.forbidden()

    const settings = await SystemSettingsService.get()
    return ApiResponse.success(settings)
})

export const PUT = withStandardHandler(async (req, session, json) => {
    if (session.user.role !== 'SUPER_ADMIN') return ApiResponse.forbidden()

    const validation = updateSystemSettingsSchema.safeParse(json)
    if (!validation.success) {
        return ApiResponse.badRequest("Validation Error", validation.error.format())
    }

    const before = await SystemSettingsService.get()
    const updated = await SystemSettingsService.update(validation.data)

    if (before.locationVerifyRadiusMeters !== updated.locationVerifyRadiusMeters) {
        const { AuditLogService } = await import("@/lib/services/audit-log.service")
        await AuditLogService.log('UPDATE_SYSTEM_SETTINGS', 'SYSTEM', 'default', {
            superAdminId: session.user.id,
            details: {
                locationVerifyRadiusMeters: { old: before.locationVerifyRadiusMeters, new: updated.locationVerifyRadiusMeters }
            }
        })
    }

    return ApiResponse.success(updated)
})

import { z } from "zod"
import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { SystemSettingsService } from "@/lib/services/system-settings.service"

const updateSystemSettingsSchema = z.object({
    locationVerifyRadiusMeters: z.number().int().min(1).max(10000).optional(),
    maintenanceMode: z.boolean().optional(),
    maintenanceMessage: z.string().max(500).nullable().optional(),
}).refine(data => Object.keys(data).length > 0, { message: "No fields to update" })

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

    const changes: Record<string, { old: any, new: any }> = {}
    if (before.locationVerifyRadiusMeters !== updated.locationVerifyRadiusMeters) {
        changes.locationVerifyRadiusMeters = { old: before.locationVerifyRadiusMeters, new: updated.locationVerifyRadiusMeters }
    }
    if (before.maintenanceMode !== updated.maintenanceMode) {
        changes.maintenanceMode = { old: before.maintenanceMode, new: updated.maintenanceMode }
    }
    if (before.maintenanceMessage !== updated.maintenanceMessage) {
        changes.maintenanceMessage = { old: before.maintenanceMessage, new: updated.maintenanceMessage }
    }

    if (Object.keys(changes).length > 0) {
        const { AuditLogService } = await import("@/lib/services/audit-log.service")
        await AuditLogService.log('UPDATE_SYSTEM_SETTINGS', 'SYSTEM', 'default', {
            superAdminId: session.user.id,
            details: changes
        })
    }

    return ApiResponse.success(updated)
})

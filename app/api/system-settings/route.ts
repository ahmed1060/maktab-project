import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { SystemSettingsService } from "@/lib/services/system-settings.service"
import { updateSystemSettingsSchema } from "@/lib/validations/system-settings.schema"
import { RealtimeBroadcastService } from "@/lib/services/realtime-broadcast.service"



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
    if (before.showPoweredBy !== updated.showPoweredBy) {
        changes.showPoweredBy = { old: before.showPoweredBy, new: updated.showPoweredBy }
    }
    if (before.poweredByName !== updated.poweredByName) {
        changes.poweredByName = { old: before.poweredByName, new: updated.poweredByName }
    }
    if (before.defaultTimezone !== updated.defaultTimezone) {
        changes.defaultTimezone = { old: before.defaultTimezone, new: updated.defaultTimezone }
    }
    if (before.stepUpMinutes !== updated.stepUpMinutes) {
        changes.stepUpMinutes = { old: before.stepUpMinutes, new: updated.stepUpMinutes }
    }
    if (before.brandColour !== updated.brandColour) {
        changes.brandColour = { old: before.brandColour, new: updated.brandColour }
    }

    if (Object.keys(changes).length > 0) {
        const { AuditLogService } = await import("@/lib/services/audit-log.service")
        await AuditLogService.log('UPDATE_SYSTEM_SETTINGS', 'SYSTEM', 'default', {
            superAdminId: session.user.id,
            details: changes
        })
    }

    // Instant notice to every connected browser, instead of everyone
    // polling to eventually find out — see UserHeartbeat.tsx for the
    // listener. Fire on any change that touches maintenanceMode/Message,
    // not just a flip of the boolean, so editing the message while already
    // on updates what's shown without needing to toggle off and back on.
    if ('maintenanceMode' in changes || 'maintenanceMessage' in changes) {
        await RealtimeBroadcastService.broadcastMaintenanceStatus(updated.maintenanceMode, updated.maintenanceMessage)
    }

    return ApiResponse.success(updated)
})

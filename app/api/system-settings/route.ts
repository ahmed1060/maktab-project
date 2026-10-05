import { z } from "zod"
import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { SystemSettingsService } from "@/lib/services/system-settings.service"
import { checkTimeZone } from "@/lib/timezone"
import { RealtimeBroadcastService } from "@/lib/services/realtime-broadcast.service"

const updateSystemSettingsSchema = z.object({
    locationVerifyRadiusMeters: z.number().int().min(1).max(10000).optional(),
    maintenanceMode: z.boolean().optional(),
    maintenanceMessage: z.string().max(500).nullable().optional(),
    showPoweredBy: z.boolean().optional(),
    poweredByName: z.string().max(40).optional(),
    // The calendar zone for anybody with no company — a Super Admin, mostly.
    // Same validation as a company's own zone, and for the same reason: the
    // crons are global, so a zone far behind UTC cannot be served correctly and
    // should be refused where somebody can read why.
    defaultTimezone: z
        .string()
        .min(1)
        .superRefine((zone, ctx) => {
            const verdict = checkTimeZone(zone)
            if (!verdict.ok) {
                ctx.addIssue({ code: z.ZodIssueCode.custom, message: verdict.reason ?? "Unsupported time zone" })
            }
        })
        .optional(),
    // How long a step-up MFA confirmation lasts (ROLES_PLAN.md §6.15). The
    // database holds the same bounds.
    stepUpMinutes: z.number().int().min(5).max(480).optional(),
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

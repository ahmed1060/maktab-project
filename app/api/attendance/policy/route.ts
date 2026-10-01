import { z } from "zod"
import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { AttendancePolicyService } from "@/lib/services/attendance-policy.service"
import { AttendanceCalendarService } from "@/lib/services/attendance-calendar.service"
import { attendanceCompanyFor, denyAttendanceSettings } from "@/lib/attendance/settings-access"
import { can } from "@/lib/permissions/can"

/**
 * A company's attendance policy (ATTENDANCE_PLAN.md §6): its versions, and the
 * templates it can start from. Part of the company's Attendance settings tab.
 */
export const GET = withStandardHandler(async (req, session) => {
    const companyId = attendanceCompanyFor(session, new URL(req.url).searchParams.get("companyId"))
    const denied = await denyAttendanceSettings(session, companyId, "view")
    if (denied) return denied
    const [versions, templates, today] = await Promise.all([
        AttendancePolicyService.versions(companyId!),
        AttendancePolicyService.templates(),
        AttendanceCalendarService.today(companyId!),
    ])
    return ApiResponse.success({ versions, templates, today, canEdit: can(session.user, "settings.edit", { companyId: companyId! }) })
})

const saveSchema = z.object({
    companyId: z.string().optional(),
    effectiveFrom: z.string(),
    // Checked in full by the service (lib/attendance/policy.ts).
    body: z.record(z.string(), z.unknown()),
    appliedTemplateId: z.string().nullable().optional(),
})

/** A new version from a date, typed or copied from a template (§6.1, §6.8). */
export const POST = withStandardHandler(async (_req, session, json) => {
    const validation = saveSchema.safeParse(json)
    if (!validation.success) return ApiResponse.badRequest("Validation Error", validation.error.format())
    const companyId = attendanceCompanyFor(session, validation.data.companyId)
    const denied = await denyAttendanceSettings(session, companyId, "edit")
    if (denied) return denied
    const { effectiveFrom, body, appliedTemplateId } = validation.data
    return ApiResponse.success(await AttendancePolicyService.saveVersion(companyId!, { effectiveFrom, body, appliedTemplateId }, session.user.id), 201)
})

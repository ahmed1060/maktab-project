import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { AttendanceCalendarService } from "@/lib/services/attendance-calendar.service"
import { attendanceCompanyFor, denyAttendanceSettings } from "@/lib/attendance/settings-access"
import { publicHolidaysApplySchema } from "@/lib/validations/attendance-calendar.schema"

/**
 * Public holidays off for the company, or back on, from a date
 * (FIRST_CHANGES_PLAN.md §6, PR 362): for whoever may change the Attendance
 * settings tab, as working through one holiday is.
 */
export const PUT = withStandardHandler(async (_req, session, json) => {
    const validation = publicHolidaysApplySchema.safeParse(json)
    if (!validation.success) return ApiResponse.badRequest("Validation Error", validation.error.format())
    const companyId = attendanceCompanyFor(session, validation.data.companyId)
    const denied = await denyAttendanceSettings(session, companyId, "edit")
    if (denied) return denied
    const { apply, effectiveFrom } = validation.data
    await AttendanceCalendarService.setPublicHolidays(companyId!, apply, effectiveFrom, session.user.id)
    return ApiResponse.success({ apply, effectiveFrom })
})

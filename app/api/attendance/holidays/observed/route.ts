import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { AttendanceCalendarService } from "@/lib/services/attendance-calendar.service"
import { attendanceCompanyFor, denyAttendanceSettings } from "@/lib/attendance/settings-access"
import { observedSchema } from "@/lib/validations/attendance-calendar.schema"

/** Whether the company observes a central holiday or works through it (ATTENDANCE_PLAN.md §7.2). */
export const PUT = withStandardHandler(async (_req, session, json) => {
    const validation = observedSchema.safeParse(json)
    if (!validation.success) return ApiResponse.badRequest("Validation Error", validation.error.format())
    const companyId = attendanceCompanyFor(session, validation.data.companyId)
    const denied = await denyAttendanceSettings(session, companyId, "edit")
    if (denied) return denied
    const { publicHolidayId, observed } = validation.data
    await AttendanceCalendarService.setObserved(companyId!, publicHolidayId, observed, session.user.id)
    return ApiResponse.success({ observed })
})

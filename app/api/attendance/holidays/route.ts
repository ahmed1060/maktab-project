import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { AttendanceCalendarService } from "@/lib/services/attendance-calendar.service"
import { attendanceCompanyFor, denyAttendanceSettings } from "@/lib/attendance/settings-access"
import { companyHolidaySchema } from "@/lib/validations/attendance-calendar.schema"

/** A company's own holiday, beside the central calendar (ATTENDANCE_PLAN.md §7.2). */
export const POST = withStandardHandler(async (_req, session, json) => {
    const validation = companyHolidaySchema.safeParse(json)
    if (!validation.success) return ApiResponse.badRequest("Validation Error", validation.error.format())
    const companyId = attendanceCompanyFor(session, validation.data.companyId)
    const denied = await denyAttendanceSettings(session, companyId, "edit")
    if (denied) return denied
    const { date, name, isPaid } = validation.data
    return ApiResponse.success(await AttendanceCalendarService.addHoliday(companyId!, { date, name, isPaid }, session.user.id), 201)
})

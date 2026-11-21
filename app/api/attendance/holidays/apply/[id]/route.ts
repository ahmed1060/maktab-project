import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { AttendanceCalendarService } from "@/lib/services/attendance-calendar.service"
import { denyAttendanceSettings } from "@/lib/attendance/settings-access"

/** Withdraw a change of public holidays still to come (FIRST_CHANGES_PLAN.md §6, PR 362). */
export const DELETE = withStandardHandler(async (_req, session, _json, context) => {
    const row = await AttendanceCalendarService.publicHolidaysChangeOf(context.params.id)
    if (!row) return ApiResponse.notFound("Not found")
    const denied = await denyAttendanceSettings(session, row.companyId, "edit")
    if (denied) return denied
    await AttendanceCalendarService.withdrawPublicHolidaysChange(row.id, session.user.id)
    return ApiResponse.success({ deleted: true })
})

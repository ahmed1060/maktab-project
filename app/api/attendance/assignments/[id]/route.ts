import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { AttendanceCalendarService } from "@/lib/services/attendance-calendar.service"
import { denyAttendanceSettings } from "@/lib/attendance/settings-access"

/** Withdraw a move between schedules, while payroll has not locked its month. */
export const DELETE = withStandardHandler(async (_req, session, _json, context) => {
    const assignment = await AttendanceCalendarService.assignmentOf(context.params.id)
    if (!assignment?.user.companyId) return ApiResponse.notFound("Assignment not found")
    const denied = await denyAttendanceSettings(session, assignment.user.companyId, "edit")
    if (denied) return denied
    await AttendanceCalendarService.removeAssignment(assignment.id, session.user.id)
    return ApiResponse.success({ deleted: true })
})

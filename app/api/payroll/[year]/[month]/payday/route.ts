import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { PayrollRunService } from "@/lib/services/payroll-run.service"
import { resolvePayrollScope, payrollScopeRefusal } from "@/lib/payroll-scope"
import { isDateString } from "@/lib/attendance/calendar"
import { assertStepUp } from "@/lib/step-up"

/**
 * Change this month's payday (LATER_CHANGES_PLAN.md §7.10, 10f, PR 430), for
 * whoever may approve payroll: a one-off, such as paying before Eid. While
 * the month is a draft, its attendance may end sooner with it; once
 * approved, only payday changes; once paid, nothing does. Each refusal comes
 * back with its code and the dates it concerns, for the dialog to say.
 */

const WHY: Record<string, string> = {
    RUN_PAID: "This month is marked paid, so its payday stays as it was.",
    PERIOD_FROZEN: "This month is approved, so its attendance stays as it was approved; only payday can change.",
    ATTENDANCE_OUT_OF_RANGE: "Attendance can end no earlier than its period starts, and no later than payroll closes.",
    PAYDAY_NOT_AFTER_PERIOD: "Payday has to come after the attendance's last day, so the month can be approved before it's paid.",
    PAYDAY_TOO_LATE: "Payday can be no later than the month after next.",
}

export const PUT = withStandardHandler(async (_req, session, json, { params }) => {
    const scope = resolvePayrollScope(session.user, "payroll.approve", json?.companyId, params.year, params.month)
    if (!scope.ok) return payrollScopeRefusal(scope)
    // Approving payroll's permission, a high-risk one: confirmed with a code within the hour, as approving is (ROLES_PLAN.md §6.15).
    await assertStepUp(session, "payroll.approve")

    const payday = json?.payday
    const attendanceUntil = json?.attendanceUntil ?? null
    if (!isDateString(payday)) return ApiResponse.badRequest("payday must be a date, YYYY-MM-DD")
    if (attendanceUntil !== null && !isDateString(attendanceUntil)) return ApiResponse.badRequest("attendanceUntil must be a date, YYYY-MM-DD")

    const result = await PayrollRunService.changePayday(scope.companyId, scope.year, scope.month, { payday, attendanceUntil }, session)
    if ("refused" in result) {
        const { code, ...dates } = result.refused
        return ApiResponse.refused(409, WHY[code], code, dates)
    }
    return ApiResponse.success(result)
})

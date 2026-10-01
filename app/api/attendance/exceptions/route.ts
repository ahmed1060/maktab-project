import { withStandardHandler } from "@/lib/api-utils"
import { can } from "@/lib/permissions/can"
import { ApiResponse } from "@/lib/api-response"
import { AttendanceExceptionService } from "@/lib/services/attendance-exception.service"
import { punchCompany, visibilityFor, decidesFor, correctsCompany } from "@/lib/attendance/punch-access"
import { isDateString, addDays } from "@/lib/attendance/calendar"

/**
 * What needs a decision between two dates (ATTENDANCE_PLAN.md §13.1), for
 * whoever sees other people's attendance: attendance.view_team, at its scope.
 */
export const GET = withStandardHandler(async (req, session) => {
    const url = new URL(req.url)
    const access = await punchCompany(session, url.searchParams.get("companyId"))
    if ("denied" in access) return access.denied
    const visible = visibilityFor(session)
    if (visible.kind === "OWN") return ApiResponse.forbidden()
    const from = url.searchParams.get("from") ?? ""
    const to = url.searchParams.get("to") ?? ""
    if (!isDateString(from) || !isDateString(to) || to < from) return ApiResponse.badRequest("from and to must be dates, from first")
    if (to > addDays(from, 62)) return ApiResponse.badRequest("Ask for at most two months at a time")
    const out = await AttendanceExceptionService.list(access.companyId, { from, to }, visible, {
        permissions: decidesFor(session, "attendance.approve_permissions"),
        missing: decidesFor(session, "attendance.correct"),
        unmatched: correctsCompany(session, access.companyId),
    })
    // What a day cost is a share of that person's salary: theirs to see, and
    // others' only where salary.view reaches them — as on the days list
    // (review on #15).
    const me = session.user.id
    const redact = <T extends { userId: string; teamLeaderId: string | null; deductionMinor: number | null; overtimeMinor: number | null }>(rows: T[]) =>
        rows.map(d => d.userId === me || can(session.user, "salary.view", { companyId: access.companyId, userId: d.userId, teamLeaderId: d.teamLeaderId })
            ? d : { ...d, deductionMinor: null, overtimeMinor: null })
    return ApiResponse.success({
        ...out,
        late: redact(out.late), early: redact(out.early), absent: redact(out.absent), incomplete: redact(out.incomplete), overtime: redact(out.overtime),
    })
})

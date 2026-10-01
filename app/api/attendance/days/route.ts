import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { can } from "@/lib/permissions/can"
import { AttendanceEngineService, DAY_LIST_LIMIT } from "@/lib/services/attendance-engine.service"
import { punchCompany, visibilityFor } from "@/lib/attendance/punch-access"
import { isDateString, addDays } from "@/lib/attendance/calendar"

/**
 * Derived days between two dates: one's own always, other people's with
 * attendance.view_team at its scope. What a day costs is money from that
 * person's salary, so it is shown to them, and to others only where
 * salary.view reaches them; anyone else sees the minutes and not the money.
 */
export const GET = withStandardHandler(async (req, session) => {
    const url = new URL(req.url)
    const access = await punchCompany(session, url.searchParams.get("companyId"))
    if ("denied" in access) return access.denied
    const from = url.searchParams.get("from") ?? ""
    const to = url.searchParams.get("to") ?? ""
    if (!isDateString(from) || !isDateString(to) || to < from) return ApiResponse.badRequest("from and to must be dates, from first")
    if (to > addDays(from, 62)) return ApiResponse.badRequest("Ask for at most two months at a time")
    // One more than is shown, so a list cut short says so (review on #13).
    const rows = await AttendanceEngineService.days(access.companyId, { from, to, userId: url.searchParams.get("userId") }, visibilityFor(session), DAY_LIST_LIMIT + 1)
    const days = rows.slice(0, DAY_LIST_LIMIT)
    const me = session.user.id
    const shown = days.map(({ teamLeaderId, ...d }) => {
        const seesPay = d.userId === me || can(session.user, "salary.view", { companyId: access.companyId, userId: d.userId, teamLeaderId })
        return seesPay ? d : { ...d, deductionMinor: null, overtimeMinor: null }
    })
    return ApiResponse.success({ days: shown, truncated: rows.length > DAY_LIST_LIMIT, limit: DAY_LIST_LIMIT })
})

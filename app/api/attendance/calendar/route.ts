import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { AttendanceCalendarService } from "@/lib/services/attendance-calendar.service"
import { attendanceCompanyFor, denyAttendanceSettings } from "@/lib/attendance/settings-access"
import { addOnSections } from "@/lib/attendance/add-on-sections"
import { CompanyService } from "@/lib/services/company.service"
import { can } from "@/lib/permissions/can"

/**
 * A company's attendance calendar (ATTENDANCE_PLAN.md §7): schedules with their
 * versions and overrides, who works which, and one year's holidays. With it,
 * which add-ons' sections the tab shows this person, so it asks only for
 * those (FIRST_CHANGES_PLAN.md §5, PR 361).
 */
export const GET = withStandardHandler(async (req, session) => {
    const params = new URL(req.url).searchParams
    const companyId = attendanceCompanyFor(session, params.get("companyId"))
    const denied = await denyAttendanceSettings(session, companyId, "view")
    if (denied) return denied
    const asked = Number(params.get("year"))
    const today = await AttendanceCalendarService.today(companyId!)
    const year = Number.isInteger(asked) && asked >= 2000 && asked <= 2100 ? asked : Number(today.slice(0, 4))
    const company = await CompanyService.settingsExposure(companyId!)
    return ApiResponse.success({
        ...(await AttendanceCalendarService.calendar(companyId!, year)),
        canEdit: can(session.user, "settings.edit", { companyId: companyId! }),
        sections: addOnSections(session.user, company!),
    })
})

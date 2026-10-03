import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { AttendancePhoneService } from "@/lib/services/attendance-phone.service"
import { punchCompany, decidesFor } from "@/lib/attendance/punch-access"

/** Phones waiting for approval, and those in use, for whoever decides them: the company's, or their team's (§9.3). */
export const GET = withStandardHandler(async (req, session) => {
    const access = await punchCompany(session, new URL(req.url).searchParams.get("companyId"))
    if ("denied" in access) return access.denied
    const visible = decidesFor(session, "attendance.approve_devices")
    if (!visible) return ApiResponse.forbidden()
    return ApiResponse.success({ phones: await AttendancePhoneService.list(access.companyId, visible) })
})

import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { AttendanceDeviceService } from "@/lib/services/attendance-device.service"
import { TerminalBrandService } from "@/lib/services/terminal-brand.service"
import { attendanceCompanyFor } from "@/lib/attendance/settings-access"
import { denyTerminals } from "@/lib/attendance/terminals-access"

/**
 * The company's fingerprint terminals, as its agents report them (ATTENDANCE_PLAN.md §17),
 * and the brands one may be given: the Super Admin's, not retired (§17.9, PR 280),
 * with their notes for the setup guide's steps (§17.7, PR 282).
 */
export const GET = withStandardHandler(async (req, session) => {
    const companyId = attendanceCompanyFor(session, new URL(req.url).searchParams.get("companyId"))
    const denied = await denyTerminals(session, companyId)
    if (denied) return denied
    const [devices, brands] = await Promise.all([AttendanceDeviceService.list(companyId!), TerminalBrandService.offered()])
    return ApiResponse.success({ devices, brands })
})

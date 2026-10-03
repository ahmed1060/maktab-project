import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { AttendanceLocationService } from "@/lib/services/attendance-location.service"
import { attendanceCompanyFor } from "@/lib/attendance/settings-access"
import { denyMobile } from "@/lib/attendance/mobile-access"
import { locationSchema } from "@/lib/validations/attendance-location.schema"

/** Where the company's people check in with the app (ATTENDANCE_PLAN.md §8.5, §9.4). */
export const GET = withStandardHandler(async (req, session) => {
    const companyId = attendanceCompanyFor(session, new URL(req.url).searchParams.get("companyId"))
    const denied = await denyMobile(session, companyId, "view")
    if (denied) return denied
    return ApiResponse.success(await AttendanceLocationService.list(companyId!))
})

export const POST = withStandardHandler(async (_req, session, json) => {
    const validation = locationSchema.safeParse(json)
    if (!validation.success) return ApiResponse.badRequest("Validation Error", validation.error.format())
    const { companyId: asked, ...input } = validation.data
    const companyId = attendanceCompanyFor(session, asked)
    const denied = await denyMobile(session, companyId, "edit")
    if (denied) return denied
    return ApiResponse.success(await AttendanceLocationService.create(companyId!, input, session.user.id), 201)
})

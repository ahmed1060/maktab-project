import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { AttendanceRequestService } from "@/lib/services/attendance-request.service"
import { punchCompany, decidesFor, asksForSelf } from "@/lib/attendance/punch-access"
import { permissionRequestSchema } from "@/lib/validations/attendance-request.schema"

const STATUSES = new Set(["PENDING", "APPROVED", "REJECTED", "CANCELLED"])

/**
 * Permission hours (إذن): one's own (`mine=1`), or those this person decides
 * — the company's or their team's, with attendance.approve_permissions.
 */
export const GET = withStandardHandler(async (req, session) => {
    const url = new URL(req.url)
    const status = url.searchParams.get("status")
    if (status && !STATUSES.has(status)) return ApiResponse.badRequest("Unknown status")
    if (url.searchParams.get("mine") === "1") {
        const self = asksForSelf(session)
        if (!self) return ApiResponse.success({ requests: [] })
        return ApiResponse.success({ requests: await AttendanceRequestService.permissions(self.companyId, { status }, { kind: "OWN", userId: self.userId }) })
    }
    const access = await punchCompany(session, url.searchParams.get("companyId"))
    if ("denied" in access) return access.denied
    const visible = decidesFor(session, "attendance.approve_permissions")
    if (!visible) return ApiResponse.forbidden()
    return ApiResponse.success({ requests: await AttendanceRequestService.permissions(access.companyId, { status }, visible) })
})

/** Asks for permission hours, for oneself. */
export const POST = withStandardHandler(async (_req, session, json) => {
    const validation = permissionRequestSchema.safeParse(json)
    if (!validation.success) return ApiResponse.badRequest("Validation Error", validation.error.format())
    const self = asksForSelf(session)
    if (!self) return ApiResponse.forbidden()
    const created = await AttendanceRequestService.requestPermission(self.companyId, self.userId, validation.data)
    return ApiResponse.success(created, 201)
})

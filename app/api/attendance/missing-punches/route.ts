import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { AttendanceRequestService, MissingPunchOutOfRange } from "@/lib/services/attendance-request.service"
import { punchCompany, decidesFor, asksForSelf } from "@/lib/attendance/punch-access"
import { missingPunchSchema } from "@/lib/validations/attendance-request.schema"

const STATUSES = new Set(["PENDING", "APPROVED", "REJECTED", "CANCELLED"])

/** Reports of a missing punch: one's own (`mine=1`), or those this person corrects. */
export const GET = withStandardHandler(async (req, session) => {
    const url = new URL(req.url)
    const status = url.searchParams.get("status")
    if (status && !STATUSES.has(status)) return ApiResponse.badRequest("Unknown status")
    if (url.searchParams.get("mine") === "1") {
        const self = asksForSelf(session)
        if (!self) return ApiResponse.success({ requests: [] })
        return ApiResponse.success({ requests: await AttendanceRequestService.missingPunches(self.companyId, { status }, { kind: "OWN", userId: self.userId }) })
    }
    const access = await punchCompany(session, url.searchParams.get("companyId"))
    if ("denied" in access) return access.denied
    const visible = decidesFor(session, "attendance.correct")
    if (!visible) return ApiResponse.forbidden()
    return ApiResponse.success({ requests: await AttendanceRequestService.missingPunches(access.companyId, { status }, visible) })
})

/** Reports a punch one forgot. */
export const POST = withStandardHandler(async (_req, session, json) => {
    const validation = missingPunchSchema.safeParse(json)
    if (!validation.success) return ApiResponse.badRequest("Validation Error", validation.error.format())
    const self = asksForSelf(session)
    if (!self) return ApiResponse.forbidden()
    try {
        const created = await AttendanceRequestService.reportMissingPunch(self.companyId, self.userId, validation.data)
        return ApiResponse.success(created, 201)
    } catch (error) {
        // Before the days it may be reported for (LATER_CHANGES_PLAN.md §7.20): which days, for the form to say.
        if (error instanceof MissingPunchOutOfRange) return ApiResponse.refused(400, `Missing punches can be reported from ${error.from} to ${error.to}.`, error.message, { from: error.from, to: error.to })
        throw error
    }
})

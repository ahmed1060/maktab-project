import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { AttendancePunchService } from "@/lib/services/attendance-punch.service"
import { punchCompany, correctsCompany, correctsPerson } from "@/lib/attendance/punch-access"

/** Removes a mapping made in error. */
export const DELETE = withStandardHandler(async (_req, session, _json, context) => {
    const { id } = await context.params
    const mapping = await AttendancePunchService.codeOf(id)
    if (!mapping) return ApiResponse.notFound("That employee number isn't mapped.")
    const access = await punchCompany(session, mapping.companyId)
    if ("denied" in access || access.companyId !== mapping.companyId) return ApiResponse.notFound("That employee number isn't mapped.")
    if (!correctsCompany(session, mapping.companyId)) return ApiResponse.forbidden()
    if (!correctsPerson(session, { companyId: mapping.companyId, userId: mapping.userId, teamLeaderId: mapping.user.teamLeaderId })) return ApiResponse.forbidden()
    return ApiResponse.success(await AttendancePunchService.unmapCode(id, session.user.id))
})

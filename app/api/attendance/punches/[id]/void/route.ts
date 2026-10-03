import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { AttendancePunchService } from "@/lib/services/attendance-punch.service"
import { punchCompany, correctsCompany, correctsPerson } from "@/lib/attendance/punch-access"
import { reasonSchema } from "@/lib/validations/attendance-punch.schema"

/** Withdraws one punch, keeping it on record. One waiting for a person is the whole company's to withdraw. */
export const POST = withStandardHandler(async (_req, session, json, context) => {
    const { id } = await context.params
    const validation = reasonSchema.safeParse(json)
    if (!validation.success) return ApiResponse.badRequest("Validation Error", validation.error.format())
    const punch = await AttendancePunchService.punchOf(id)
    if (!punch) return ApiResponse.notFound("Punch not found.")
    const access = await punchCompany(session, punch.companyId)
    if ("denied" in access || access.companyId !== punch.companyId) return ApiResponse.notFound("Punch not found.")
    const allowed = punch.userId
        ? correctsPerson(session, { companyId: punch.companyId, userId: punch.userId, teamLeaderId: punch.user?.teamLeaderId ?? null })
        : correctsCompany(session, punch.companyId)
    if (!allowed) return ApiResponse.forbidden()
    await AttendancePunchService.voidPunch(id, validation.data.reason, session.user.id)
    return ApiResponse.success({ voided: true })
})

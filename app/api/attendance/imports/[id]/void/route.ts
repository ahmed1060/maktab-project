import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { AttendancePunchService } from "@/lib/services/attendance-punch.service"
import { punchCompany, correctsCompany } from "@/lib/attendance/punch-access"
import { reasonSchema } from "@/lib/validations/attendance-punch.schema"

/** Withdraws every punch a file brought in: for a file of the wrong month, company or format. */
export const POST = withStandardHandler(async (_req, session, json, context) => {
    const { id } = await context.params
    const validation = reasonSchema.safeParse(json)
    if (!validation.success) return ApiResponse.badRequest("Validation Error", validation.error.format())
    const imp = await AttendancePunchService.importOf(id)
    if (!imp) return ApiResponse.notFound("Import not found.")
    const access = await punchCompany(session, imp.companyId)
    if ("denied" in access || access.companyId !== imp.companyId) return ApiResponse.notFound("Import not found.")
    if (!correctsCompany(session, imp.companyId)) return ApiResponse.forbidden()
    return ApiResponse.success(await AttendancePunchService.voidImport(id, validation.data.reason, session.user.id))
})

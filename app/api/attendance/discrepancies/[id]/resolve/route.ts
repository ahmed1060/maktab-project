import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { can } from "@/lib/permissions/can"
import { AttendanceDiscrepancyService } from "@/lib/services/attendance-discrepancy.service"
import { punchCompany } from "@/lib/attendance/punch-access"
import { reasonSchema } from "@/lib/validations/attendance-punch.schema"

/** Marks a difference settled, saying how: for whoever prepares payroll. */
export const POST = withStandardHandler(async (_req, session, json, context) => {
    const { id } = await context.params
    const validation = reasonSchema.safeParse(json)
    if (!validation.success) return ApiResponse.badRequest("Validation Error", validation.error.format())
    const found = await AttendanceDiscrepancyService.of(id)
    if (!found) return ApiResponse.notFound("Not found.")
    const access = await punchCompany(session, found.companyId)
    if ("denied" in access || access.companyId !== found.companyId) return ApiResponse.notFound("Not found.")
    if (!can(session.user, "payroll.prepare", { companyId: found.companyId })) return ApiResponse.forbidden()
    await AttendanceDiscrepancyService.resolve(id, validation.data.reason, session.user.id, session.user.role === "SUPER_ADMIN")
    return ApiResponse.success({ resolved: true })
})

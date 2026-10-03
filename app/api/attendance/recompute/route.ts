import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { z } from "zod"
import { AttendanceEngineService } from "@/lib/services/attendance-engine.service"
import { punchCompany, correctsCompany } from "@/lib/attendance/punch-access"

const schema = z.object({ companyId: z.string().optional(), month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) })

/**
 * Rebuilds a month's days now, for whoever corrects the company's attendance:
 * after a salary or employment change, which do not rebuild on their own, or
 * simply to see the result without waiting for the night. A month whose
 * payroll is approved is left as it is, and the answer says so.
 */
export const POST = withStandardHandler(async (_req, session, json) => {
    const validation = schema.safeParse(json)
    if (!validation.success) return ApiResponse.badRequest("Validation Error", validation.error.format())
    const access = await punchCompany(session, validation.data.companyId)
    if ("denied" in access) return access.denied
    if (!correctsCompany(session, access.companyId)) return ApiResponse.forbidden()
    return ApiResponse.success(await AttendanceEngineService.recomputeMonth(access.companyId, validation.data.month))
})

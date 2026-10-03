import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { AttendancePhoneService } from "@/lib/services/attendance-phone.service"
import { phoneToDecide } from "@/lib/attendance/phone-access"
import { phoneDecisionSchema } from "@/lib/validations/attendance-phone.schema"

/** Approves someone's new phone, or rejects it (§9.3). */
export const POST = withStandardHandler(async (_req, session, json, { params }) => {
    const validation = phoneDecisionSchema.safeParse(json)
    if (!validation.success) return ApiResponse.badRequest("Validation Error", validation.error.format())
    const found = await phoneToDecide(session, params.id)
    if ("denied" in found) return found.denied
    await AttendancePhoneService.decide(found.phone.id, validation.data, session.user.id)
    return ApiResponse.success({ decided: true })
})

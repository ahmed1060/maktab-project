import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { AttendancePhoneService } from "@/lib/services/attendance-phone.service"
import { phoneToDecide } from "@/lib/attendance/phone-access"
import { revokePhoneSchema } from "@/lib/validations/attendance-phone.schema"

/** A lost or stolen phone checks in no more (§9.3). */
export const POST = withStandardHandler(async (_req, session, json, { params }) => {
    const validation = revokePhoneSchema.safeParse(json ?? {})
    if (!validation.success) return ApiResponse.badRequest("Validation Error", validation.error.format())
    const found = await phoneToDecide(session, params.id)
    if ("denied" in found) return found.denied
    await AttendancePhoneService.revoke(found.phone.id, session.user.id, validation.data.reason)
    return ApiResponse.success({ revoked: true })
})

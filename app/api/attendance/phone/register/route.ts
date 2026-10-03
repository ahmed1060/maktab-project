import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { AttendancePhoneService } from "@/lib/services/attendance-phone.service"
import { mobileSelf } from "@/lib/attendance/mobile-access"
import { registerPhoneSchema } from "@/lib/validations/attendance-phone.schema"

/** This phone asks to be the one its owner checks in from (§9.3): it waits for approval. */
export const POST = withStandardHandler(async (_req, session, json) => {
    const validation = registerPhoneSchema.safeParse(json)
    if (!validation.success) return ApiResponse.badRequest("Validation Error", validation.error.format())
    const self = await mobileSelf(session)
    if ("denied" in self) return self.denied
    return ApiResponse.success(await AttendancePhoneService.register(self.companyId, self.userId, validation.data), 201)
})

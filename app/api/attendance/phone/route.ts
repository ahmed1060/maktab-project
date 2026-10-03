import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { AttendancePhoneService } from "@/lib/services/attendance-phone.service"
import { mobileSelf } from "@/lib/attendance/mobile-access"

/** One's own phone in use, and the one asked for. */
export const GET = withStandardHandler(async (_req, session) => {
    const self = await mobileSelf(session)
    if ("denied" in self) return self.denied
    return ApiResponse.success(await AttendancePhoneService.mine(self.userId))
})

/** The new phone asked for is not wanted after all: the old one checks in again. */
export const DELETE = withStandardHandler(async (_req, session) => {
    const self = await mobileSelf(session)
    if ("denied" in self) return self.denied
    return ApiResponse.success(await AttendancePhoneService.withdraw(self.userId))
})

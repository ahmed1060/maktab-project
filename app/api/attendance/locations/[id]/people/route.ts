import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { AttendanceLocationService } from "@/lib/services/attendance-location.service"
import { locationPeopleSchema } from "@/lib/validations/attendance-location.schema"
import { locationFor } from "@/lib/attendance/mobile-access"

/** Exactly these people may check in here (§8.5). */
export const PUT = withStandardHandler(async (_req, session, json, { params }) => {
    const validation = locationPeopleSchema.safeParse(json)
    if (!validation.success) return ApiResponse.badRequest("Validation Error", validation.error.format())
    const found = await locationFor(session, params.id)
    if ("denied" in found) return found.denied
    return ApiResponse.success(await AttendanceLocationService.setPeople(found.location.id, validation.data.userIds, session.user.id))
})

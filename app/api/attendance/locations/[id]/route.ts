import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { AttendanceLocationService } from "@/lib/services/attendance-location.service"
import { locationFor } from "@/lib/attendance/mobile-access"
import { locationUpdateSchema } from "@/lib/validations/attendance-location.schema"

/** Renamed, moved, its circle or office IPs changed. */
export const PATCH = withStandardHandler(async (_req, session, json, { params }) => {
    const validation = locationUpdateSchema.safeParse(json)
    if (!validation.success) return ApiResponse.badRequest("Validation Error", validation.error.format())
    const found = await locationFor(session, params.id)
    if ("denied" in found) return found.denied
    return ApiResponse.success(await AttendanceLocationService.update(found.location.id, validation.data, session.user.id))
})

/** Archived: it takes no more check-ins. */
export const DELETE = withStandardHandler(async (_req, session, _json, { params }) => {
    const found = await locationFor(session, params.id)
    if ("denied" in found) return found.denied
    await AttendanceLocationService.archive(found.location.id, session.user.id)
    return ApiResponse.success({ archived: true })
})

import { z } from "zod"
import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { AttendanceFlagService } from "@/lib/services/attendance-flag.service"
import { punchCompany, correctsPerson } from "@/lib/attendance/punch-access"

const schema = z.object({ accept: z.boolean(), reason: z.string().max(500).nullish() })

/**
 * Accepts a flagged check-in, so it counts, or rejects it (§9.6). The
 * company's reviewers decide the company's; the Super Admin decides any, and
 * alone decides those flagged because our app couldn't prove itself.
 */
export const POST = withStandardHandler(async (_req, session, json, { params }) => {
    const validation = schema.safeParse(json)
    if (!validation.success) return ApiResponse.badRequest("Validation Error", validation.error.format())
    const punch = await AttendanceFlagService.flaggedOf(params.id)
    if (!punch || !punch.userId) return ApiResponse.notFound("Check-in not found.")
    const access = await punchCompany(session, punch.companyId)
    if ("denied" in access || access.companyId !== punch.companyId) return ApiResponse.notFound("Check-in not found.")
    if (session.user.role !== "SUPER_ADMIN") {
        if (AttendanceFlagService.reviewerOf(punch.flagReasons) === "PLATFORM") return ApiResponse.forbidden("This check-in is waiting for the Super Admin's review.")
        if (!correctsPerson(session, { companyId: punch.companyId, userId: punch.userId, teamLeaderId: punch.user?.teamLeaderId ?? null })) return ApiResponse.forbidden()
    }
    await AttendanceFlagService.decide(punch.id, validation.data, session.user.id)
    return ApiResponse.success({ decided: true })
})

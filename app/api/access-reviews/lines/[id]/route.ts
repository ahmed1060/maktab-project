import { z } from "zod"
import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { AccessReviewService } from "@/lib/services/access-review.service"
import { roleRequestRefusal } from "@/lib/role-errors"

const answerSchema = z.object({
    decision: z.enum(["CONFIRMED", "CHANGE_REQUESTED"]),
    note: z.string().trim().max(1000).optional().nullable(),
})

/** Answer one line of an access review (ROLES_PLAN.md §6.14). The service checks who may. */
export const PUT = withStandardHandler(async (req, session, json, { params }) => {
    const validation = answerSchema.safeParse(json)
    if (!validation.success) return ApiResponse.badRequest("Validation Error", validation.error.format())
    try {
        return ApiResponse.success(await AccessReviewService.answer(params.id, validation.data, session))
    } catch (error: any) {
        switch (error?.message) {
            case "LINE_NOT_FOUND": return ApiResponse.notFound("Not found")
            case "OWN_LINE": return ApiResponse.forbidden("Somebody else must confirm your own access")
            case "ALREADY_ANSWERED": return ApiResponse.badRequest("This line has already been answered")
        }
        return roleRequestRefusal(error) ?? Promise.reject(error)
    }
})

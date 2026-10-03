import { z } from "zod"
import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { RoleChangeRequestService } from "@/lib/services/role-change-request.service"
import { roleRequestRefusal } from "@/lib/role-errors"

const respondSchema = z.object({
    status: z.enum(["DONE", "DECLINED"]),
    response: z.string().trim().max(2000).optional().nullable(),
})

/** The Super Admin answers a company's role change request. */
export const PUT = withStandardHandler(async (req, session, json, { params }) => {
    const validation = respondSchema.safeParse(json)
    if (!validation.success) return ApiResponse.badRequest("Validation Error", validation.error.format())
    try {
        return ApiResponse.success(await RoleChangeRequestService.respond(params.id, validation.data, session))
    } catch (error) {
        return roleRequestRefusal(error) ?? Promise.reject(error)
    }
})

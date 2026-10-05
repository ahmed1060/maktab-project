import { z } from "zod"
import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { RoleRequestService } from "@/lib/services/role-request.service"
import { roleRequestRefusal } from "@/lib/role-errors"
import { teamRefusalResponse } from "@/lib/team-handoff-response"

const decideSchema = z.object({
    action: z.enum(["APPROVE", "REJECT", "CANCEL"]),
    note: z.string().trim().max(500).optional().nullable(),
    // Where a stripped leader's team goes, as for a direct change.
    reassignReportsTo: z.string().min(1).nullable().optional(),
})

/** Decide a role request, or withdraw one you made. The service checks who may. */
export const PUT = withStandardHandler(async (req, session, json, { params }) => {
    const id = params.id
    const validation = decideSchema.safeParse(json)
    if (!validation.success) return ApiResponse.badRequest("Validation Error", validation.error.format())
    const { action, note, reassignReportsTo } = validation.data
    try {
        const result = action === "CANCEL"
            ? await RoleRequestService.cancel(id, session)
            : await RoleRequestService.decide(id, { approve: action === "APPROVE", note, reassignReportsTo }, session)
        return ApiResponse.success(result)
    } catch (error) {
        return teamRefusalResponse(error) ?? roleRequestRefusal(error) ?? Promise.reject(error)
    }
})

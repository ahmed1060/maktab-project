import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { ChargeService } from "@/lib/services/charge.service"

/**
 * A charge's service fee, typed as the fee or as the total, and its "Not
 * charged to client" tick (CLIENTS_PLAN.md §6.2–6.3). Each check is
 * ChargeService's, against the charge's company; the permission here only
 * turns away someone who holds none at all.
 */
export const PATCH = withStandardHandler(async (_req, session, json, { params }) => {
    if (json?.notCharged !== undefined) return ApiResponse.success(await ChargeService.setNotCharged(session, params.costId, json.notCharged))
    return ApiResponse.success(await ChargeService.setServiceFee(session, params.costId, { serviceFee: json?.serviceFee, total: json?.total }))
}, { permission: "charges.manage" })

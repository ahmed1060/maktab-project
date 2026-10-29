import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { assertStepUp } from "@/lib/step-up"
import { ChargeService } from "@/lib/services/charge.service"

/**
 * Mark uncollected (CLIENTS_PLAN.md §6.5): a collected charge due again, so
 * it can be corrected. Asks for two-factor sign-in, as collecting does.
 */
export const POST = withStandardHandler(async (_req, session, _json, { params }) => {
    await assertStepUp(session, "charges.collect")
    return ApiResponse.success(await ChargeService.uncollect(session, params.costId))
}, { permission: "charges.collect" })

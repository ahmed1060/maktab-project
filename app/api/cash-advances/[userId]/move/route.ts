import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { assertStepUp } from "@/lib/step-up"
import { CashAdvanceService } from "@/lib/services/cash-advance.service"

/**
 * Move to running balance (CLIENTS_PLAN.md §7.9, 7g): all a person holds for
 * one task or one client joins their running balance. It moves money, so it
 * asks for two-factor sign-in (§7.7).
 */
export const POST = withStandardHandler(async (_req, session, json, { params }) => {
    await assertStepUp(session, "cash_advances.give")
    const body = json ?? {}
    return ApiResponse.success(await CashAdvanceService.move(session, params.userId, { forTaskId: body.forTaskId, forClientId: body.forClientId }))
}, { permission: "cash_advances.give" })

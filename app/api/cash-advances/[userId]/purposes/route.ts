import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { CashAdvanceService } from "@/lib/services/cash-advance.service"

/**
 * What an advance for this person can be for (CLIENTS_PLAN.md §7.9): the
 * open tasks they're on, and the company's clients not archived. For Give
 * advance, so for whoever may give them one.
 */
export const GET = withStandardHandler(async (_req, session, _json, { params }) => {
    return ApiResponse.success(await CashAdvanceService.purposes(session.user as any, params.userId))
}, { permission: "cash_advances.give" })

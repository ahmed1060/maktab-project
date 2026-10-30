import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { CashAdvanceService } from "@/lib/services/cash-advance.service"

/** Confirm receipt (CLIENTS_PLAN.md §7.3): the employee says they received an advance given to them. */
export const POST = withStandardHandler(async (_req, session, _json, { params }) => {
    return ApiResponse.success(await CashAdvanceService.confirm(session, params.entryId))
})

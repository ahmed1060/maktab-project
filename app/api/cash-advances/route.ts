import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { parsePaging } from "@/lib/pagination"
import { CashAdvanceService } from "@/lib/services/cash-advance.service"

/**
 * The Costs page's Cash advances tab (CLIENTS_PLAN.md §7.5): a page of the
 * people this person sees, each with their balance, searched by name and
 * filtered to those holding an advance, and what all of them hold.
 */
export const GET = withStandardHandler(async (req, session) => {
    const searchParams = new URL(req.url).searchParams
    const paging = parsePaging(searchParams, 20)
    return ApiResponse.success(await CashAdvanceService.list(session.user as any, {
        companyId: searchParams.get("companyId") || undefined,
        search: searchParams.get("search")?.trim().slice(0, 100) || undefined,
        holding: searchParams.get("holding") === "1",
    }, paging))
}, { permission: "cash_advances.view" })

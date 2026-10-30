import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { parsePaging } from "@/lib/pagination"
import { assertStepUp } from "@/lib/step-up"
import { CashAdvanceService } from "@/lib/services/cash-advance.service"

/**
 * One person's cash advance (CLIENTS_PLAN.md §7.5): their balance and a page
 * of their entries. Everyone's own, on My cash advance; anyone else's for
 * whoever sees their cash advances.
 */
export const GET = withStandardHandler(async (req, session, _json, { params }) => {
    const { searchParams } = new URL(req.url)
    const paging = parsePaging(searchParams, 20)
    return ApiResponse.success(await CashAdvanceService.person(session.user as any, params.userId, paging))
})

/**
 * Give advance, Record return or Correction (§7.3, §7.4): an entry on their
 * advance. It moves money, so it asks for two-factor sign-in (§7.7).
 */
export const POST = withStandardHandler(async (_req, session, json, { params }) => {
    await assertStepUp(session, "cash_advances.give")
    const body = json ?? {}
    return ApiResponse.success(await CashAdvanceService.record(session, params.userId, {
        kind: body.kind, amount: body.amount, date: body.date, note: body.note, photoUrl: body.photoUrl,
    }))
}, { permission: "cash_advances.give" })

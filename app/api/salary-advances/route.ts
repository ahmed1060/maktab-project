import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { SalaryAdvanceRefused, SalaryAdvanceService } from "@/lib/services/salary-advance.service"

/**
 * Asking for a salary advance (LATER_CHANGES_PLAN.md §7.5, step 3a, PR 449):
 * what one may ask for, as the dialog reads it, and asking. Only for oneself,
 * in one's own company: the Super Admin asks for none.
 */

/** What asking offers this person; none where they may not ask at all. */
export const GET = withStandardHandler(async (_req, session) => {
    if (session.user.role === "SUPER_ADMIN" || !session.user.companyId) return ApiResponse.success({ offer: null })
    return ApiResponse.success({ offer: await SalaryAdvanceService.offer(session.user.id) })
})

const text = (value: unknown) => (typeof value === "string" ? value.slice(0, 40) : "")

/** Asks for one, as the dialog sent it, in the language its consent was shown in. */
export const POST = withStandardHandler(async (_req, session, json) => {
    if (session.user.role === "SUPER_ADMIN" || !session.user.companyId) return ApiResponse.forbidden()
    const body = (json ?? {}) as Record<string, unknown>
    try {
        const created = await SalaryAdvanceService.ask(session.user.id, { amount: text(body.amount), months: text(body.months), first: text(body.first) }, text(body.locale))
        return ApiResponse.success(created, 201)
    } catch (error) {
        if (!(error instanceof SalaryAdvanceRefused)) throw error
        // What's wrong under each field, or why none may be asked for now: the dialog reads what's offered again.
        if (error.code === "SALARY_ADVANCE_INVALID") return ApiResponse.refused(400, "Some of what was typed isn't within what can be asked for.", error.code, { errors: error.errors })
        if (error.code === "SALARY_ADVANCE_CLOSED") return ApiResponse.refused(409, "A salary advance can't be asked for now.", error.code, { closed: error.closed })
        return ApiResponse.refused(403, "Salary advances aren't asked for here.", error.code)
    }
})

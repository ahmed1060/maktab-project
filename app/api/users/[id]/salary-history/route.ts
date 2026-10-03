import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { SalaryService } from "@/lib/services/salary.service"
import { verifyResourceAccess, personTarget } from "@/lib/security"
import { can } from "@/lib/permissions/can"

export const GET = withStandardHandler(async (req, session, json, { params }) => {
    const userId = params.id
    const currentUserId = session.user.id
    const isSelf = currentUserId === userId

    if (!isSelf && !can(session.user, "salary.view")) {
        return ApiResponse.forbidden("Access denied")
    }

    // The grant's scope is about the person asked about: held for a team, it
    // reaches that team. The company check below keeps the rest out, but its
    // team rule is employees.view's, not this permission's.
    if (!isSelf) {
        const person = await personTarget(userId)
        if (!person || !can(session.user, "salary.view", person)) return ApiResponse.forbidden("Access denied")
    }

    // Company Isolation
    const hasAccess = await verifyResourceAccess(session, userId, 'USER')
    if (!hasAccess) return ApiResponse.forbidden("Access denied")

    // The gap fill is named and called deliberately, rather than happening
    // inside getHistory as a side effect of reading. Same net result for this
    // screen — every month from the first record to this one — but getHistory
    // is now a read, so nothing else that wants the history has to accept a
    // write it did not ask for.
    await SalaryService.ensureRecordsThrough(userId)

    // With each month's payslip attached where payroll has produced one. The
    // screen used to work the figure out itself; H1 was that it worked out a
    // different one.
    const history = await SalaryService.historyWithPayslips(userId)
    return ApiResponse.success(history)
})

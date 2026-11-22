import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { can } from "@/lib/permissions/can"
import { definitionOf } from "@/lib/permissions/catalogue"
import { sessionHasModule } from "@/lib/features/require"
import { assignableChoices, type AssignPermission } from "@/lib/services/assignee-guard"

/**
 * Who a picker that hands work to someone offers (LATER_CHANGES_PLAN.md §5.1
 * rule 5, PR 371): Add obligation, reassigning one, Create task and Transfer
 * task, each by `?for=` its action's permission. Names only, and the people
 * checkAssignees accepts for that permission, so these pickers need no "See
 * employees", as Attendance's picker doesn't (/api/attendance/people).
 *
 * Only whoever holds that permission asks, in a package with its module. A
 * Super Admin names the company (?companyId=), or with none picked gets
 * everyone's, as they may assign anywhere; nobody else can name one.
 */
const FOR: readonly AssignPermission[] = ["tasks.create", "obligations.create", "obligations.edit", "tasks.transfer"]

export const GET = withStandardHandler(async (req, session) => {
    const { searchParams } = new URL(req.url)
    const permission = searchParams.get("for") as AssignPermission | null
    if (!permission || !FOR.includes(permission)) return ApiResponse.badRequest("Ask for one of: " + FOR.join(", "))
    if (!can(session.user, permission)) return ApiResponse.forbidden()
    const area = definitionOf(permission).module
    if (area && !sessionHasModule(session, area)) return ApiResponse.forbidden()

    let companyId: string | null
    if (session.user.role === "SUPER_ADMIN") {
        companyId = searchParams.get("companyId") || null
    } else {
        companyId = session.user.companyId ?? null
        if (!companyId) return ApiResponse.forbidden()
    }
    return ApiResponse.success(await assignableChoices(session, permission, companyId))
})

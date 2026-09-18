import { withStandardHandler } from "@/lib/api-utils"
import { ApiResponse } from "@/lib/api-response"
import { verifyResourceAccess } from "@/lib/security"
import { SettlementService } from "@/lib/services/settlement.service"

/**
 * Every settlement on record for one person.
 *
 * The route that makes an ended contract's statement findable. It is the only
 * way to reach it: the person it is about cannot sign in, so if HR cannot open
 * it from that person's own page, the document exists and nobody can get to it.
 */
export const GET = withStandardHandler(async (req, session, _json, { params }) => {
    const userId = params.id

    if (!['ADMIN', 'SUPER_ADMIN'].includes(session.user.role || '')) {
        return ApiResponse.forbidden("Managers only")
    }
    if (!(await verifyResourceAccess(session, userId, 'USER'))) {
        return ApiResponse.forbidden("Access denied")
    }

    const settlements = await SettlementService.forUser(userId)

    return ApiResponse.success(settlements.map(s => ({
        id: s.id,
        lastWorkingDay: s.lastWorkingDay,
        net: Number(s.netAmount),
        status: s.status,
        dueDate: s.dueDate,
    })))
})

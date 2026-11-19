import { NextRequest } from "next/server"
import { ApiResponse } from "@/lib/api-response"
import { knownRefusal } from "@/lib/api-errors"
import { resetHeldBack } from "@/lib/password-reset"
import { RateLimiter, getClientIp } from "@/lib/api-utils"
import { readInvitation } from "@/lib/services/client-invitation.service"
import { AuditLogService } from "@/lib/services/audit-log.service"
import { isNextInternalError } from "@/lib/next-internal-error"

/**
 * Reading an invitation's link (CLIENT_PORTAL_PLAN.md §5.2, step 6b-1): who
 * invited them, for whom, their email, and until when. Open to anyone, as a
 * link in an email has to be, so each place's tries are counted, with setting
 * the password's (./password/route.ts): 10 in 15 minutes.
 *
 * The link's secret comes in the body, never the address, so no log keeps it.
 */
export async function POST(req: NextRequest) {
    try {
        const ip = getClientIp(req.headers)
        const { limited, resetAt } = await RateLimiter.getLimitData(`invitation:${ip}`, 10, 15 * 60 * 1000)
        if (limited) return resetHeldBack(resetAt)
        const body = await req.json().catch(() => null)
        return ApiResponse.success(await readInvitation(body))
    } catch (error) {
        if (isNextInternalError(error)) throw error
        const refusal = knownRefusal(error)
        if (refusal) return ApiResponse.refused(refusal.status, refusal.message, (error as Error).message)
        console.error("Invitation read error:", error)
        const ref = await AuditLogService.logSystemError({ error, route: "/api/invitation", method: "POST" })
        return ApiResponse.error(AuditLogService.friendlyErrorMessage(ref))
    }
}
